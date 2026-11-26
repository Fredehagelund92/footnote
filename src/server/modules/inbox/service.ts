import { ORPCError } from '@orpc/client'
import type { Card, Feed, Setup } from '../../../contract/inbox.ts'
import type { ReportOutcome } from '../../../contract/reports.ts'
import {
  alertCardDays,
  alertCardRules,
  cardReaches,
  type AlertCardRule,
  type AlertRuleId,
  type AlertState,
  type RaiseSubject,
} from '../../../domain/alerts.ts'
import { topicScope, topicWords } from '../../../domain/answer.ts'
import { monthWords } from '../../../domain/dates.ts'
import { listWords } from '../../../domain/proposal-attributes.ts'
import { visibleCount } from '../../../domain/gaps.ts'
import { compareIds } from '../../../domain/resolver.ts'
import {
  actionGroup,
  byNeed,
  cardKey,
  DRAFT_OLD_DAYS,
  groupCounts,
  parseCardKey,
  setupSteps,
  type CardAction,
  type SetupStep,
} from '../../../domain/inbox.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { liveSeq, standingSplits } from '../../db/family-splits.ts'
import { lastingUndo, undoOffer } from '../../db/undo.ts'
import { askedCounts, type BundleCache } from '../answer/index.ts'
import type { CommentsService } from '../comments/index.ts'
import type { ContextService } from '../context/index.ts'
import { syncedOf } from '../connectors/index.ts'
import type { ServingBundle } from '../editions/index.ts'
import type { GapsService } from '../gaps/index.ts'
import {
  loadProposal,
  type NamesService,
  type ReviewPath,
  type ReviewService,
} from '../review/index.ts'
import { missing } from '../../../contract/refusals.ts'

/*
  The Inbox of Footnote v1 (docs/product.md, section 5): the cards of the domains a person owns (every
  domain for an administrator), made from today's records and grouped by need. Not found: open
  gaps of those domains. Reported: anonymous feedback that said an answer was wrong or unclear,
  until an owner says it is not a problem (decided 26 October 2026), and named reports from Ask,
  with who sent them, until an owner closes one or checks, changes or archives its item (FR-622).
  Mentioned you: threads where a comment mentions the person and they haven't read it,
  whatever domain it is in. Due for a check: live items whose check date passed or whose
  definition changed. Suggestions: those waiting for a decision. Under All, the person's own
  suggestions that wait on an owner, those an owner closed (Don't publish) in the last two weeks
  with the reason, and what was decided in the last two weeks. Saved questions:
  one card for each domain whose saved questions need a look (FR-526). Names: one card for the
  names a read made that the person may accept (FR-141), above the rest, since nothing can be
  written about a metric that has none. Once only names an owner left out remain, it goes under
  Done, where they can be accepted after all.

  Alerts: a card for each raise of an alert rule with a card of its own, for a week. The alert
  rules (FR-621, src/domain/alerts.ts) decide whether an Alert, a Not found, a Saved questions or
  a check-date card reaches the person: not while an administrator turned its rule off, nor in a
  domain the person muted it for.

  Counts from agents are counts only, with no words and no person (FR-602), and a count under the
  minimum is hidden (FR-614).
*/

/** The most words a Not found card about words Ask could not find names in its title. */
const WORDS_SHOWN = 3

type Head = { seq: string; label: string; overlay: string }

/** How long a done card stays under Done. */
const doneDays = 14

/** The outcome of a decision, in a word the Inbox shows beside a done card. */
const outcomeWords: Record<string, string> = {
  accept: 'Published',
  // Published without a review round, under the policy the owner set for the agent (FR-421).
  policy: 'Published with your permission',
  request_changes: 'Returned',
  // Not published, with a reason its sender reads: Don't publish.
  reject: 'Closed',
  retire: 'Archived',
  // A suggestion to archive that is not archived: closed once its sender took it back.
  close: 'Closed',
  recheck: 'Checked',
  not_a_problem: 'Not a problem',
  not_written: 'Not something we write down',
}

/** What the owners did after a named report, in the word the Inbox shows beside its done card. */
const reportWords: Record<ReportOutcome, string> = {
  not_a_problem: 'Not a problem',
  checked: 'Checked',
  changed: 'Changed',
  archived: 'Archived',
}

/**
 * The context a reported answer gave (FR-618): the items of the delivery the report names, in the
 * order agents got them, each by the title of the very version agents got, and only a version
 * whose audience lets the person read it (never a suggestion's unpublished text). No question and
 * no person: a delivery keeps neither.
 */
const reportedItems = (feedback: string) => `coalesce((
  select jsonb_agg(jsonb_build_object('id', d.id, 'title', iv.title) order by d.rank)
    from deliveries dl
    cross join lateral jsonb_to_recordset(dl.delivered) as d(id text, v int, rank int)
    join item_versions iv on iv.item_id = d.id and iv.version_no = d.v
   where dl.id = ${feedback}.delivery_id and cl_audience_allows(iv.audience_groups)), '[]'::jsonb)`

export function createInboxFeedService(
  tx: Queryable,
  clock: Clock,
  cache: BundleCache,
  deps: {
    review: ReviewService
    path: ReviewPath
    gaps: GapsService
    comments: Pick<CommentsService, 'mentionCards' | 'markMentionsRead'>
    names: Pick<NamesService, 'waiting' | 'waitingValues'>
    context: Pick<ContextService, 'pointAtSplitMetrics'>
  },
) {
  async function liveBundle(): Promise<ServingBundle | null> {
    const [head] = await tx.query<Head>(
      `select e.seq::text,e.label,coalesce((select seq::text from serving_overlay),'0') as overlay
         from editions e join live_edition l on l.seq=e.seq`,
    )
    return head ? cache.bundle(tx, head) : null
  }
  async function minimum(): Promise<number> {
    const [row] = await tx.query<{ minimum: number }>(
      `select (value #>> '{}')::int as minimum from settings_current where key='privacy.min_count'`,
    )
    return row?.minimum ?? 5
  }
  /** The domains whose cards land in the person's Inbox: those they own, or every one for an admin. */
  async function domains(): Promise<string[]> {
    const rows = await tx.query<{ id: string }>(
      `select a.id from areas a where a.archived_at is null
          and (cl_is_admin_now() or cl_is_owner_now(a.id)) order by a.id`,
    )
    return rows.map((r) => r.id)
  }

  async function opened(cards: readonly string[]): Promise<Set<string>> {
    const rows = await tx.query<{ card: string }>(
      'select card from card_reads where person_id=cl_person() and card=any($1::text[])',
      [cards],
    )
    return new Set(rows.map((r) => r.card))
  }

  async function suggestions(areas: readonly string[]): Promise<Card[]> {
    const rows = await tx.query<{
      id: string
      at: string
      opened: boolean
      read: boolean
      name: string | null
    }>(
      `select p.id::text, coalesce(p.submitted_at,p.created_at)::text as at,
              exists(select 1 from review_reads r where r.proposal_id=p.id and r.person_id=cl_person()) as opened,
              exists(select 1 from review_reads r where r.proposal_id=p.id and r.person_id=cl_person()
                        and r.read_at is not null and r.item_version_id is not distinct from p.item_version_id) as read,
              (select display_name as name from people where id=p.proposer_id) as name
         from proposals p
        where p.subject='item' and p.state in ('submitted','in_review') and p.discarded_at is null
          and p.area_id=any($1::text[]) and p.action in ('create','change','retire')
        order by coalesce(p.submitted_at,p.created_at) desc limit 100`,
      [areas],
    )
    const cards: Card[] = []
    const synced = await syncedOf(
      tx,
      rows.map((row) => row.id),
    )
    for (const row of rows) {
      const p = await loadProposal(tx, row.id)
      const care = await deps.path.care(p).catch(() => ({ claims: 0, clash: false }))
      cards.push({
        id: cardKey.proposal(p.id),
        group: 'suggestion',
        areaId: p.areaId!,
        at: row.at,
        opened: row.opened,
        done: null,
        proposalId: p.id,
        number: p.number,
        title: p.title,
        action: p.action,
        itemId: p.itemId,
        from: p.proposerId === null ? null : { personId: p.proposerId, name: row.name },
        writtenBy: p.provenance?.by ?? null,
        agent: p.agentName,
        synced: synced.get(p.id) ?? null,
        read: row.read,
        care,
      })
    }
    return cards
  }

  async function gaps(bundle: ServingBundle | null, min: number): Promise<Card[]> {
    const rows = await tx.query<{
      id: string
      ref: string
      at: string
      area: string | null
      areas: string[]
      metrics: string[]
      values: string[]
      dimensions: string[]
      month: string | null
      calls: number
      told: number
      draft: string | null
      words: string[]
      copied: string | null
    }>(
      `select g.id::text, g.ref, g.status_since::text as at, t.area_id as area,
              (select l.copied_on::text from question_links l where l.gap_id=g.id) as copied,
              cl_topic_domains(t.area_id, t.metric_keys) as areas, t.metric_keys as metrics,
              t.value_keys as values, t.dimension_keys as dimensions, t.month::text as month,
              coalesce((select w.reports - w.human_reports + w.no_item_calls from gap_weekly_counts w
                         where w.gap_id=g.id and w.week=date_trunc('week', now() at time zone 'UTC')::date),0)::int as calls,
              coalesce((select w.human_reports from gap_weekly_counts w
                         where w.gap_id=g.id and w.week=date_trunc('week', now() at time zone 'UTC')::date),0)::int as told,
              (select p.id::text from proposals p
                where p.source_gap_id=g.id and p.discarded_at is null order by p.created_at desc limit 1) as draft,
              -- A topic of nothing is what people told an admin about by a word Ask could not find.
              case when cardinality(t.metric_keys) + cardinality(t.value_keys) + cardinality(t.dimension_keys) = 0
                   then coalesce((select array_agg(distinct n.note order by n.note) from gap_notes n
                                   where n.gap_id=g.id and n.source='person'), '{}')
                   else '{}' end as words
         from gaps g join topics t on t.id=g.topic_id
        where g.status='open' and cl_manages_topic(t.area_id, t.metric_keys)
        order by g.status_since desc limit 100`,
    )
    return rows.map((row): Card => {
      const scope = row.month
        ? topicScope({
            metrics: row.metrics,
            values: row.values,
            dimensions: row.dimensions,
            month: row.month,
          })
        : null
      return {
        id: cardKey.gap(row.id),
        group: 'gap',
        areaId: row.area ?? row.areas[0] ?? '',
        at: row.at,
        opened: false,
        done: null,
        gapId: row.id,
        ref: row.ref,
        // What agents asked about, and the month: "Orders in Spain, October 2026"; for words Ask
        // could not find, the words: "“EBITDA”, November 2026".
        title: row.words.length
          ? `${listWords(row.words.slice(0, WORDS_SHOWN).map((w) => `“${w}”`))}${row.words.length > WORDS_SHOWN ? ` and ${row.words.length - WORDS_SHOWN} more` : ''}, ${monthWords(row.month!)}`
          : bundle && scope
            ? `${topicWords(bundle, scope)}, ${monthWords(row.month!)}`
            : row.ref,
        scope: {
          metrics: row.metrics,
          values: row.values,
          dimensions: row.dimensions,
          month: row.month,
        },
        times: visibleCount(row.calls, min),
        told: row.told,
        draft: row.draft,
        asked: row.copied ? { copiedOn: row.copied } : null,
      }
    })
  }

  async function flags(areas: readonly string[]): Promise<Card[]> {
    const rows = await tx.query<{
      id: string
      at: string
      area: string
      verdict: 'wrong' | 'unclear'
      note: string | null
      items: { id: string; title: string }[]
    }>(
      `select f.id::text, f.created_hour::text as at, f.area_id as area, f.verdict::text as verdict, f.note,
              ${reportedItems('f')} as items
         from feedback f
        where f.verdict in ('wrong','unclear') and f.area_id=any($1::text[])
          and f.created_hour > now() - interval '90 days'
          and not exists (select 1 from card_states c where c.card='feedback:'||f.id::text)
        order by f.created_hour desc, f.id limit 100`,
      [areas],
    )
    return rows.map((row) => ({
      id: cardKey.feedback(row.id),
      group: 'flag',
      areaId: row.area,
      at: row.at,
      opened: false,
      done: null,
      source: 'agent' as const,
      feedbackId: row.id,
      verdict: row.verdict,
      note: row.note,
      by: null,
      question: null,
      correction: null,
      link: null,
      suggestion: null,
      items: row.items,
    }))
  }

  /**
   * Named reports from Ask (FR-622) in the person's domains, with who sent them: the open ones,
   * which wait until an owner acts, or (`done`) those an owner acted on in the last two weeks. An
   * owner acts by closing it as not a problem, or by checking, changing or archiving its item.
   */
  async function reports(areas: readonly string[], which: 'open' | 'done'): Promise<Card[]> {
    const rows = await tx.query<{
      id: string
      at: string
      area: string
      what: string
      question: string
      correction: string | null
      link: string | null
      suggestion: string | null
      by: string
      item: string
      title: string | null
      outcome: ReportOutcome | null
      decided: string | null
    }>(
      `select r.id::text, r.created_at::text as at, r.area_id as area, r.what, r.question, r.correction,
              r.link, r.person_id::text as by, r.item_id as item,
              (select p.id::text from proposals p where p.id = r.proposal_id
                  and p.state in ('submitted', 'in_review')) as suggestion,
              (select v.title from item_version_service s join item_versions v on v.id = s.version_id
                where s.item_id = r.item_id and cl_audience_allows(v.audience_groups)
                order by lower(s.editions) desc limit 1) as title,
              o.outcome, o.decided_at::text as decided
         from reports r left join lateral cl_report_outcome(r.id) o on true
        where r.area_id = any($1::text[])
          and r.created_at > now() - interval '90 days'
          and ${which === 'open' ? 'o.outcome is null' : 'o.decided_at > now() - make_interval(days => $2)'}
        order by r.created_at desc, r.id limit 100`,
      which === 'open' ? [areas] : [areas, doneDays],
    )
    return rows.map((row): Card => ({
      id: cardKey.report(row.id),
      group: 'flag',
      areaId: row.area,
      at: row.decided ?? row.at,
      opened: which === 'done',
      done:
        row.outcome && row.decided ? { outcome: reportWords[row.outcome], at: row.decided } : null,
      source: 'ask',
      feedbackId: row.id,
      verdict: 'wrong',
      note: row.what,
      by: row.by,
      question: row.question,
      correction: row.correction,
      link: row.link,
      suggestion: row.suggestion,
      items: row.title ? [{ id: row.item, title: row.title }] : [],
    }))
  }

  async function checks(bundle: ServingBundle | null, areas: readonly string[]): Promise<Card[]> {
    if (!bundle) return []
    const today = clock.today()
    // The items Context lists and counts as due, so one domain's number is the same on every
    // screen.
    const due = bundle.items.filter(
      (item) =>
        areas.includes(item.areaId) &&
        (item.checkFlag !== null || (item.reviewDate !== null && item.reviewDate < today)),
    )
    if (!due.length) return []
    const reviews = await tx.query<{ id: string; on: string | null; by: string | null }>(
      `select i.id, r.accepted_on::text as on, (select display_name as name from people where id=r.accepted_by) as by
         from unnest($1::text[]) as i(id)
         left join lateral (select s.version_id from item_version_service s
                             where s.item_id=i.id and upper_inf(s.editions) limit 1) s on true
         left join lateral cl_version_review(s.version_id) r on true`,
      [due.map((item) => item.id)],
    )
    const lastChecked = new Map(reviews.map((r) => [r.id, { on: r.on, by: r.by }]))
    // Its link, and what people answered there since its live version was last published or checked.
    const asked = await tx.query<{
      id: string
      copied: string
      answers: Extract<Card, { group: 'check' }>['answers']
    }>(
      `select l.item_id as id, l.copied_on::text as copied,
              coalesce((select jsonb_agg(jsonb_build_object('by', p.display_name, 'answer', a.answer,
                         'endedOn', a.ended_on::text, 'words', a.words, 'link', a.link, 'at', a.created_at::text)
                         order by a.created_at desc)
                  from (select * from question_answers x where x.link_id = l.id
                          and x.created_at > coalesce((select max(d.decided_at) from item_version_service s
                                join decisions d on d.item_version_id = s.version_id and d.outcome = 'accept'
                               where s.item_id = l.item_id and upper_inf(s.editions)), '-infinity')
                        order by x.created_at desc limit 5) a
                  left join people p on p.id = a.person_id), '[]'::jsonb) as answers
         from question_links l where l.item_id = any($1::text[])`,
      [due.map((item) => item.id)],
    )
    const askedOf = new Map(asked.map((row) => [row.id, row]))
    // A definition changed when its mark first read as it does now, after the last other mark.
    const moved = await tx.query<{ id: string; name: string; on: string }>(
      `select id, name, "on" from (
       select s.item_id as id,
              coalesce((select min(v.name collate "C") from vocab_term_service ts
                          join vocab_term_refs tr on tr.version_id = ts.version_id
                          join vocab_term_versions v on v.id = ts.version_id
                         where tr.definition_ref = d.ref and upper_inf(ts.editions)),
                       d.title, d.name) as name,
              (select min(k.fetched_at at time zone 'UTC')::date::text
                 from definition_marks m join connector_snapshots k on k.id = m.snapshot_id
                where m.definition_ref = d.ref and m.change_mark = d.change_mark
                  and k.fetched_at > coalesce((select max(o.fetched_at)
                        from definition_marks p join connector_snapshots o on o.id = p.snapshot_id
                       where p.definition_ref = d.ref and p.change_mark <> d.change_mark),
                      '-infinity')) as on
         from item_version_service s
         join item_version_refs r on r.version_id = s.version_id
         join definitions d on d.ref = r.definition_ref and d.change_mark <> r.change_mark
        where s.item_id = any($1::text[]) and upper_inf(s.editions)
       ) q order by id, name collate "C"`,
      [due.filter((item) => item.checkFlag === 'needs_check').map((item) => item.id)],
    )
    // A family it is about that was split, with the metrics it reaches agents through now.
    const split = await tx.query<{ id: string; name: string; metrics: string[] }>(
      `select s.item_id as id, x.name,
              array(select t.name from serving_vocabulary((select seq from live_edition)) t
                     where t.key = any(x.variants) order by t.name collate "en-x-icu") as metrics
         from item_version_service s
         join item_version_metrics m on m.version_id = s.version_id
         join ${standingSplits(liveSeq)} x on x.family_key = m.metric_key
        where s.item_id = any($1::text[]) and upper_inf(s.editions)
        order by s.item_id, x.name collate "en-x-icu"`,
      [due.filter((item) => item.checkFlag === 'needs_check').map((item) => item.id)],
    )
    return due.map((item) => ({
      id: cardKey.check(item.id),
      group: 'check',
      areaId: item.areaId,
      at: item.checkFlag === null && item.reviewDate ? item.reviewDate : today,
      opened: false,
      done: null,
      itemId: item.id,
      title: item.title,
      reason:
        item.checkFlag === null
          ? 'date'
          : split.some((s) => s.id === item.id) && !moved.some((m) => m.id === item.id)
            ? 'family'
            : 'source',
      changed: moved.filter((m) => m.id === item.id).map(({ name, on }) => ({ name, on })),
      families: split
        .filter((s) => s.id === item.id)
        .map(({ name, metrics }) => ({ name, metrics })),
      lastChecked: lastChecked.get(item.id) ?? { on: null, by: null },
      asked: askedOf.has(item.id) ? { copiedOn: askedOf.get(item.id)!.copied } : null,
      answers: askedOf.get(item.id)?.answers ?? [],
    }))
  }

  /** What was decided in the last two weeks: the person's own decisions, and closed cards. */
  async function done(areas: readonly string[]): Promise<Card[]> {
    const decided = await tx.query<{
      id: string
      proposal: string
      outcome: string
      action: string
      at: string
      policy: boolean
    }>(
      `select d.id::text, d.proposal_id::text as proposal, d.outcome::text, p.action::text, d.decided_at::text as at,
              d.auto_policy_id is not null as policy
         from decisions d join proposals p on p.id=d.proposal_id
        where d.decided_by=cl_person() and p.subject='item'
          and d.decided_at > now() - make_interval(days => $1)
          and not exists (select 1 from decision_undos u where u.decision_id=d.id)
        order by d.decided_at desc limit 100`,
      [doneDays],
    )
    const cards: Card[] = []
    for (const row of decided) {
      const p = await loadProposal(tx, row.proposal).catch(() => null)
      if (!p) continue
      const doneAs = {
        outcome:
          outcomeWords[
            row.action === 'recheck'
              ? 'recheck'
              : row.action === 'retire' && row.outcome === 'reject'
                ? 'close'
                : row.policy
                  ? 'policy'
                  : row.outcome
          ] ?? 'Decided',
        at: row.at,
      }
      if (row.action === 'recheck' && p.itemId) {
        cards.push({
          id: cardKey.check(p.itemId),
          group: 'check',
          areaId: p.areaId!,
          at: row.at,
          opened: true,
          done: doneAs,
          itemId: p.itemId,
          title: p.title,
          reason: 'date',
          changed: [],
          families: [],
          lastChecked: { on: row.at.slice(0, 10), by: null },
          asked: null,
          answers: [],
        })
        continue
      }
      cards.push({
        id: cardKey.proposal(p.id),
        group: 'suggestion',
        areaId: p.areaId!,
        at: row.at,
        opened: true,
        done: doneAs,
        proposalId: p.id,
        number: p.number,
        title: p.title,
        action: p.action,
        itemId: p.itemId,
        from: p.proposerId === null ? null : { personId: p.proposerId, name: null },
        writtenBy: p.provenance?.by ?? null,
        agent: p.agentName,
        synced: (await syncedOf(tx, [p.id])).get(p.id) ?? null,
        read: false,
        care: { claims: 0, clash: false },
      })
    }
    // A card decided twice (returned, then published) is one row, labelled by the newest decision.
    const newest = new Set<string>()
    cards.splice(0, cards.length, ...cards.filter((c) => !newest.has(c.id) && newest.add(c.id)))
    const closed = await tx.query<{
      card: string
      area: string
      at: string
      verdict: string
      note: string | null
      items: { id: string; title: string }[]
    }>(
      `select c.card, c.area_id as area, c.decided_at::text as at, f.verdict::text as verdict, f.note,
              ${reportedItems('f')} as items
         from card_states c join feedback f on 'feedback:'||f.id::text=c.card
        where c.area_id=any($1::text[]) and c.decided_at > now() - make_interval(days => $2)
        order by c.decided_at desc limit 100`,
      [areas, doneDays],
    )
    for (const row of closed)
      cards.push({
        id: row.card,
        group: 'flag',
        areaId: row.area,
        at: row.at,
        opened: true,
        done: { outcome: outcomeWords.not_a_problem!, at: row.at },
        source: 'agent',
        feedbackId: row.card.slice('feedback:'.length),
        verdict: row.verdict === 'wrong' ? 'wrong' : 'unclear',
        note: row.note,
        by: null,
        question: null,
        correction: null,
        link: null,
        suggestion: null,
        items: row.items,
      })
    cards.push(...(await reports(areas, 'done')))
    const notWritten = await tx.query<{
      id: string
      ref: string
      at: string
      area: string | null
      areas: string[]
    }>(
      `select g.id::text, g.ref, g.status_since::text as at, t.area_id as area,
              cl_topic_domains(t.area_id, t.metric_keys) as areas
         from gaps g join topics t on t.id=g.topic_id
        where g.status='wont_fix' and g.status_since > now() - make_interval(days => $1)
          and cl_manages_topic(t.area_id, t.metric_keys)
        order by g.status_since desc limit 100`,
      [doneDays],
    )
    for (const row of notWritten)
      cards.push({
        id: cardKey.gap(row.id),
        group: 'gap',
        areaId: row.area ?? row.areas[0] ?? '',
        at: row.at,
        opened: true,
        done: { outcome: outcomeWords.not_written!, at: row.at },
        gapId: row.id,
        ref: row.ref,
        title: row.ref,
        scope: { metrics: [], values: [], dimensions: [], month: null },
        times: 0,
        told: 0,
        draft: null,
        asked: null,
      })
    return cards
  }

  /** One card for each thread with comments that mention the person, unread. */
  async function mentions(): Promise<Card[]> {
    return (await deps.comments.mentionCards()).map((m) => ({
      id: cardKey.mention(m.subject),
      group: 'mention' as const,
      areaId: m.areaId,
      at: m.at,
      opened: false,
      done: null,
      subject: m.subject,
      title: m.title,
      commentId: m.commentId,
      from: m.from,
      excerpt: m.excerpt,
    }))
  }

  /** One card for each domain whose saved questions need a look now, the newest look first. */
  async function looks(areas: readonly string[]): Promise<Card[]> {
    const rows = await tx.query<{
      area: string
      at: string
      questions: { id: string; question: string }[]
    }>(
      `select l.area_id as area, max(l.since)::text as at,
              json_agg(json_build_object('id', q.id::text, 'question', q.question)
                       order by l.since desc, q.created_at desc, q.id) as questions
         from cl_saved_looks() l join saved_questions q on q.id = l.question_id
        where l.area_id = any($1::text[])
        group by l.area_id order by l.area_id`,
      [areas],
    )
    return rows.map((row) => ({
      id: cardKey.look(row.area),
      group: 'look',
      areaId: row.area,
      at: row.at,
      opened: false,
      done: null,
      questions: row.questions,
    }))
  }

  /** The rules turned off for everyone, and those the person muted for a domain. */
  async function alertState(): Promise<AlertState> {
    const off = await tx.query<{ rule: AlertRuleId }>(
      'select rule from alert_rules where not enabled',
    )
    const muted = await tx.query<{ rule: AlertRuleId; areaId: string }>(
      'select rule, area_id as "areaId" from alert_mutes where person_id = cl_person()',
    )
    return { off: off.map((r) => r.rule), muted }
  }

  /**
   * An Alert card for each raise of a rule with a card of its own (Conflict, More questions not
   * found, Calls fail, Model spend, A connected tool could not be read, New views not chosen) that
   * reached the person: the relay delivered it to their Inbox items, less those who muted it. It
   * stays for a week after the raise. A connected tool that could not be read and has read well
   * since needs nothing more: its card goes, as on a first start, when the alert job looked at the
   * old reads a moment before the first sync. Nor do new views once an admin chose what it reads,
   * it reads every view, or it is off; a newer raise of them takes the place of an older one.
   */
  async function alertCards(): Promise<Card[]> {
    const rows = await tx.query<{
      id: string
      at: string
      area: string | null
      rule: AlertCardRule
      title: string
      subject: RaiseSubject
    }>(
      `select r.id::text, r.raised_at::text as at, r.area_ids[1] as area, r.rule, r.title, r.subject
         from inbox_items i join alert_raises r on r.event_seq = i.event_seq
        where i.person_id = cl_person() and i.kind = 'alert.raised'
          and r.rule = any($1::text[]) and r.raised_at > now() - make_interval(days => $2)
          and not (r.rule = 'sync' and exists (
            select 1 from connector_snapshots s
             where s.connector_id = r.subject->>'connector' and s.status in ('ok', 'partial')
               and s.fetched_at > r.raised_at))
          and not (r.rule = 'views' and (
            not exists (
              select 1 from connectors c
               where c.id = r.subject->>'connector' and c.enabled and not c.all_groups
                 and (c.changed_at is null or c.changed_at < r.raised_at))
            or exists (
              select 1 from alert_raises n
               where n.rule = 'views' and n.subject->>'connector' = r.subject->>'connector'
                 and n.raised_at > r.raised_at)))
          and not (
            exists (select 1 from unnest(r.area_ids) a where cl_is_owner_now(a))
            and not exists (
              select 1 from unnest(r.area_ids) a
               where cl_is_owner_now(a)
                 and not exists (select 1 from alert_mutes m
                                  where m.person_id = cl_person() and m.rule = r.rule and m.area_id = a)))
        order by r.raised_at desc, r.id limit 100`,
      [alertCardRules, alertCardDays],
    )
    return rows.map((row) => ({
      id: cardKey.alert(row.id),
      group: 'alert',
      areaId: row.area ?? '',
      at: row.at,
      opened: false,
      done: null,
      raiseId: row.id,
      rule: row.rule,
      title: row.title,
      subject: row.subject,
    }))
  }

  async function waiting(): Promise<Feed['waiting']> {
    return tx.query<Feed['waiting'][number]>(
      `select p.id::text as "proposalId", coalesce(v.title,p.draft->>'title','Untitled') as title,
              p.area_id as "areaId", p.submitted_at::text as "sentAt",
              coalesce((select array_agg(x.display_name order by x.display_name) from area_assignments a join people x on x.id=a.person_id
                         where a.area_id=p.area_id and a.role='owner' and a.valid_at @> now()
                           and x.deactivated_at is null and x.erased_at is null and x.id<>cl_person()),'{}') as "waitingFor",
              case when p.state='changes_requested' then
                (select json_build_object('by',x.display_name,'at',d.decided_at::text)
                   from decisions d left join people x on x.id=d.decided_by
                  where d.proposal_id=p.id and d.outcome='request_changes'
                  order by d.decided_at desc,d.id desc limit 1) end as returned,
              case when p.state='rejected' then
                (select json_build_object('by',x.display_name,'at',d.decided_at::text,'reason',d.reason,
                          'read',exists(select 1 from card_reads r where r.person_id=cl_person() and r.card='closed:'||p.id))
                   from decisions d left join people x on x.id=d.decided_by
                  where d.proposal_id=p.id and d.outcome='reject'
                  order by d.decided_at desc,d.id desc limit 1) end as closed
         from proposals p left join item_versions v on v.id=p.item_version_id
        where p.proposer_id=cl_person() and p.subject='item' and p.discarded_at is null
          and (p.state in ('submitted','in_review','changes_requested')
               or (p.state='rejected' and exists(
                     select 1 from decisions d
                      where d.proposal_id=p.id and d.outcome='reject' and d.decided_by<>cl_person()
                        and d.decided_at > now() - make_interval(days => $1)
                        and not exists (select 1 from decision_undos u where u.decision_id=d.id))))
        order by coalesce(p.closed_at,p.submitted_at) desc nulls last limit 100`,
      [doneDays],
    )
  }

  /**
   * This week's questions from agents, as counts (FR-614), and what most that found nothing were
   * about: Ask's Asked this week, its last 7 full days and its counts as this person may have them.
   */
  async function week(bundle: ServingBundle | null): Promise<Feed['week']> {
    const { subjects, minimum, asked, askedAtLeast } = await askedCounts(tx, clock)
    // What found nothing is a sum only of the counts Asked this week's rows show: when any topic's
    // is hidden, a total would give it away.
    const shown = asked !== null && subjects.every((s) => s.count !== null && s.nothing !== null)
    const nothing = shown ? subjects.reduce((n, s) => n + s.nothing!, 0) : 0
    // Found and nothing add up to asked: when one is hidden, the other would give it away.
    const found = shown ? visibleCount(asked - nothing, minimum) : null
    const none = shown ? visibleCount(nothing, minimum) : null
    const both = found !== null && none !== null
    const top = subjects
      .filter((s) => s.nothing !== null && s.nothing >= minimum)
      .sort((a, b) => b.nothing! - a.nothing! || compareIds(a.key, b.key))[0]
    return {
      asked,
      askedAtLeast,
      found: both ? found : null,
      nothing: both ? none : null,
      mostAbout:
        top && bundle
          ? topicWords(
              bundle,
              topicScope({
                metrics: top.metrics,
                values: top.values,
                dimensions: top.dimensions,
                month: `${top.months[0] ?? clock.today().slice(0, 7)}-01`,
              }),
            )
          : null,
    }
  }

  /**
   * The one card of the names a read made and the values people added that wait for the person;
   * none when nothing is left to look at.
   */
  async function namesCard(): Promise<Card[]> {
    const { names, at } = await deps.names.waiting()
    const values = await deps.names.waitingValues()
    const looking = names.filter((name) => name.state !== 'left_out')
    const left = names.filter((name) => name.leftByOwner)
    if (!looking.length && !left.length && !values.length) return []
    const [area, ...others] = new Set([
      ...looking.map((name) => name.areaId),
      ...values.map((value) => value.areaId),
    ])
    const newest = [at, ...values.map((value) => value.at)].filter((when) => when !== null).sort()
    const when = newest.at(-1) ?? clock.now().toISOString()
    return [
      {
        id: cardKey.names(),
        group: 'names',
        areaId: others.length ? null : (area ?? null),
        at: when,
        opened: false,
        done: looking.length || values.length ? null : { outcome: 'Left out', at: when },
        ready: names.filter((name) => name.state === 'ready').length,
        flagged: names.filter((name) => name.state === 'flagged').length,
        families: looking.filter((name) => name.family).length,
        values: values.length,
        // A card of values alone names no tool: its words never say one.
        tool: names[0]?.tool ?? '',
      },
    ]
  }

  /**
   * The one card of the person's own drafts that wait for them (FR-139): every draft they imported,
   * and every other one they have not saved for DRAFT_OLD_DAYS days. Only they read their drafts,
   * so nobody else is told of them; none, and there is no card.
   */
  async function draftsCard(): Promise<Card[]> {
    const rows = await tx.query<{ id: string; areaId: string; imported: boolean; at: string }>(
      `select id::text, area_id as "areaId", import_batch_id is not null as imported,
              to_char((case when import_batch_id is not null then created_at
                            else draft_saved_at + make_interval(days => $2) end) at time zone 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at
         from proposals
        where proposer_id = cl_person() and subject = 'item' and state = 'draft'
          and discarded_at is null and area_id is not null
          and (import_batch_id is not null or draft_saved_at <= $1::timestamptz - make_interval(days => $2))
        order by created_at, id`,
      [clock.now().toISOString(), DRAFT_OLD_DAYS],
    )
    if (!rows.length) return []
    const [area, ...others] = new Set(rows.map((r) => r.areaId))
    return [
      {
        id: cardKey.drafts(),
        group: 'drafts',
        areaId: others.length ? null : area!,
        at: rows.reduce((at, r) => (r.at > at ? r.at : at), rows[0]!.at),
        opened: false,
        done: null,
        drafts: rows.map(({ id, areaId, imported }) => ({ id, areaId, imported })),
      },
    ]
  }

  return {
    async feed(tab: 'needs' | 'all' = 'needs'): Promise<Feed> {
      const areas = await domains()
      const bundle = await liveBundle()
      const min = await minimum()
      const names = await namesCard()
      let cards = [
        ...names.filter((card) => !card.done),
        ...(await gaps(bundle, min)),
        ...(await flags(areas)),
        ...(await reports(areas, 'open')),
        ...(await mentions()),
        ...(await looks(areas)),
        ...(await checks(bundle, areas)),
        ...(await suggestions(areas)),
        ...(await draftsCard()),
        ...(await alertCards()),
      ]
      const rules = await alertState()
      cards = cards.filter((c) => cardReaches(c, rules))
      // A suggestion's card is opened by its read receipt, and a mention's by reading the thread.
      const ownRead = (c: Card) => c.group === 'suggestion' || c.group === 'mention'
      const seen = await opened(cards.filter((c) => !ownRead(c)).map((c) => c.id))
      cards = cards.map((c) => (ownRead(c) ? c : { ...c, opened: seen.has(c.id) }))
      const waits = tab === 'all' ? await waiting() : []
      if (tab === 'all') {
        const open = new Set(cards.map((c) => c.id))
        cards.push(...(await done(areas)).filter((c) => !open.has(c.id)))
        cards.push(...names.filter((card) => card.done))
      }
      const sorted = byNeed(cards)
      // A Not found card's draft is that card, on the Inbox and in what it counts.
      const drafts = new Set(sorted.flatMap((c) => (c.group === 'gap' && c.draft ? [c.draft] : [])))
      const counted = sorted.filter((c) => !(c.group === 'suggestion' && drafts.has(c.proposalId)))
      return {
        week: await week(bundle),
        // What the person sent that still waits: a suggestion an owner closed waits on nobody.
        groups: groupCounts(counted, waits.filter((w) => !w.closed).length),
        cards: sorted,
        waiting: waits,
      }
    },

    async markRead(cards: readonly string[]): Promise<{ cards: string[] }> {
      const marked: string[] = []
      for (const card of new Set(cards)) {
        const key = parseCardKey(card)
        if (!key) continue
        if (key.kind === 'mention') {
          // Opening a mention's card is reading the comments that mention the person there.
          const read = await deps.comments
            .markMentionsRead({ subject: key.id })
            .then(() => true)
            .catch(() => false)
          if (!read) continue
        } else if (key.kind === 'proposal') {
          const p = await loadProposal(tx, key.id).catch(() => null)
          if (!p) continue
          await tx.query(
            `insert into review_reads (proposal_id,person_id,item_version_id) values ($1,cl_person(),$2)
             on conflict (proposal_id,person_id) do nothing`,
            [p.id, p.itemVersionId],
          )
        } else
          await tx.query(
            `insert into card_reads (person_id,card) values (cl_person(),$1)
             on conflict (person_id,card) do update set read_at=now()`,
            [card],
          )
        marked.push(card)
      }
      return { cards: marked }
    },

    /** A card's one decision (FR-616, FR-618, CON-211, FR-218), with a token that undoes it (FR-227). */
    async decide(input: { card: string; action: CardAction; reason?: string | undefined }) {
      const key = parseCardKey(input.card)
      const kindsOf = { gap: ['gap'], flag: ['feedback', 'report'], check: ['check'] } as const
      if (!key || !(kindsOf[actionGroup[input.action]] as readonly string[]).includes(key.kind))
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          message: "This card doesn't offer that decision.",
        })
      if (input.action === 'not_written') {
        await deps.gaps.move(key.id, 'set_aside', input.reason ?? 'Not something we write down.')
        return { edition: null, undo: lastingUndo(`gap:${key.id}`) }
      }
      if (input.action === 'not_a_problem') {
        const [row] = await tx.query<{ area: string | null }>(
          key.kind === 'report'
            ? `select area_id as area from reports where id::text=$1`
            : `select area_id as area from feedback where id=$1 and verdict in ('wrong','unclear')`,
          [key.id],
        )
        if (!row?.area) throw new ORPCError('NOT_FOUND', { message: missing('this item') })
        await tx
          .query(
            `insert into card_states (card,area_id,state,decided_by) values ($1,$2,'closed',cl_person())`,
            [input.card, row.area],
          )
          .catch((error: unknown) => {
            const code = (error as { code?: string }).code
            if (code === '23505')
              throw new ORPCError('CONFLICT', { message: 'Someone closed this report already.' })
            if (code === '42501')
              throw new ORPCError('FORBIDDEN', {
                message: 'Only an owner of its domain, or an admin, closes a report.',
              })
            throw error
          })
        return { edition: null, undo: await undoOffer(tx, `card:${input.card}`) }
      }
      const reason =
        input.reason ??
        (input.action === 'still_true' ? 'Checked: still true.' : 'Archived from the Inbox.')
      if (input.action === 'still_true') {
        // About a family that was split, it stays about each of its metrics (FR-142): its owner
        // publishes that change, as a check could not.
        const pointed = await deps.context.pointAtSplitMetrics(key.id)
        if (pointed) {
          const [live] = await tx.query<{ label: string }>(
            'select e.label from editions e join live_edition l on l.seq = e.seq',
          )
          return { edition: live?.label ?? null, undo: await undoOffer(tx, `decision:${pointed}`) }
        }
        // Footnote v1's check (FR-139): an owner of its domain or an admin, as Mark as checked.
        const result = await deps.review.recheck(key.id, reason)
        const [decision] = await tx.query<{ id: string }>(
          `select id::text from decisions where proposal_id=$1 and decided_by=cl_person() and outcome='accept'
            order by decided_at desc limit 1`,
          [result.proposal.id],
        )
        if (!decision) throw new Error('The check was not recorded')
        return {
          edition: result.edition?.label ?? null,
          undo: await undoOffer(tx, `decision:${decision.id}`),
        }
      }
      const edition = await deps.review.retire(key.id, reason)
      const [decision] = await tx.query<{ id: string }>(
        `select d.id::text from decisions d join item_versions v on v.id=d.item_version_id
          where v.item_id=$1 and d.decided_by=cl_person() and d.outcome='retire'
          order by d.decided_at desc limit 1`,
        [key.id],
      )
      if (!decision) throw new Error('The archive was not recorded')
      return { edition: edition.label, undo: await undoOffer(tx, `decision:${decision.id}`) }
    },

    /** Opens a card again that its maker closed moments ago (FR-227). */
    async undoCard(token: string): Promise<{ edition: string | null }> {
      const [kind, ...rest] = token.split(':')
      const ref = rest.join(':')
      if (kind === 'card') {
        const removed = await tx.query(
          'delete from card_states where card=$1 and decided_by=cl_person() returning 1',
          [ref],
        )
        if (!removed.length)
          throw new ORPCError('CONFLICT', {
            message: 'It is too late to undo this, or someone else closed it.',
          })
        return { edition: null }
      }
      if (kind === 'gap') {
        // Opening a gap again is a decision every owner of its domain may make at any time, so its
        // undo needs no window: only that it is still set aside.
        await deps.gaps.move(ref, 'reopen', 'Undone.')
        return { edition: null }
      }
      throw new ORPCError('NOT_FOUND', { message: missing('this change') })
    },

    /**
     * A new workspace's setup checklist (FR-816), read from what exists, with the server's own
     * definitions source (of `serverSources`, its ids) and where its read stands (none ended, a
     * good one, or only failed or discarded ones): the first one not read well yet, else the first.
     */
    async setup(serverSources: readonly string[] = []): Promise<Setup> {
      // Write and ask again is done by a question in Ask after the first item was published.
      const [row] = await tx.query<Record<SetupStep, boolean>>(
        `select exists(select 1 from serving_vocabulary((select seq from live_edition)) t
                        where t.kind in ('metric','dimension')) as definitions,
                exists(select 1 from setup_marks where step='ask') as ask,
                exists(select 1 from live_edition l join item_version_service s on s.editions @> l.seq)
                and exists(select 1 from setup_marks m
                            where m.step='ask'
                              and m.done_at >= (select min(e.created_at) from editions e
                                                  join item_version_service s on s.editions @> e.seq)) as fact,
                (exists(select 1 from mcp_requests where client_label<>'eval')
                 or exists(select 1 from auth.oauth_grants)) as agent`,
      )
      const steps = setupSteps.map((id) => ({ id, done: Boolean(row?.[id]) }))
      const reads = new Map(
        (
          await tx.query<{ id: string; good: boolean }>(
            `select connector_id as id, bool_or(status in ('ok','partial')) as good
               from connector_snapshots where connector_id = any($1) group by connector_id`,
            [serverSources],
          )
        ).map((r) => [r.id, r.good] as const),
      )
      const stateOf = (source: string) =>
        reads.get(source) === undefined ? 'reading' : reads.get(source) ? 'read' : 'failed'
      const id = serverSources.find((source) => stateOf(source) !== 'read') ?? serverSources[0]
      return {
        steps,
        done: steps.every((s) => s.done),
        serverSource: id === undefined ? null : { id, state: stateOf(id) },
      }
    },

    /**
     * Ask was used: the checklist's steps that leave no other record (no words, nobody). The mark
     * keeps the first question, and moves once more, to the first one after the first item was
     * published, which is the one asked again. After that a question changes nothing.
     */
    async asked(): Promise<void> {
      await tx.query(
        `insert into setup_marks (step) values ('ask') on conflict (step) do update set done_at = now()
          where setup_marks.done_at < (select min(e.created_at) from editions e
                                         join item_version_service s on s.editions @> e.seq)`,
      )
    },
  }
}

export type InboxFeedService = ReturnType<typeof createInboxFeedService>
