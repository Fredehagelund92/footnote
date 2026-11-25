import { ORPCError } from '@orpc/client'
import type { AnswerQuestion, Question, QuestionLink } from '../../../contract/questions.ts'
import { topicScope, topicWords } from '../../../domain/answer.ts'
import type { Draft } from '../../../domain/draft.ts'
import { dimensionOfValue, visibleCount } from '../../../domain/gaps.ts'
import { parseCardKey } from '../../../domain/inbox.ts'
import { monthWindow, titleOfWords } from '../../../domain/questions.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import type { BundleCache } from '../answer/index.ts'
import type { ServingBundle } from '../editions/index.ts'
import { rejectMentions, rejectSensitive, type ProposalsService } from '../proposals/index.ts'
import type { ReviewService } from '../review/index.ts'
import { missing, notAllowed } from '../../../contract/refusals.ts'

/*
  Ask someone who knows (src/domain/questions.ts). An owner of a card's domain, or an admin, copies
  a link for a Nothing written yet card or a Due for a check card: one link a card, copied again on
  a new day. Its id is its address. Anyone signed in who opens it reads the one question, as a topic
  in words, and answers it as themselves:

  - on a gap, with what happened: a suggestion in the gap's domain, under their name, written for
    the gap, so publishing it covers the gap. It is sent with the channel `question`, which lets it
    come without a source; the owner adds or confirms one before publishing (item-version.ts). It
    waits for the owner like any suggestion;
  - on a check, with still true, it ended on a day, or I don't know: an answer the owner reads on
    the card (question_answers), and the owner still does the check.

  Nothing here reaches an agent: a suggestion is served only once an owner publishes it, and an
  answer never is. Nothing records who opened a link.
*/

type Head = { seq: string; label: string; overlay: string }
type LinkRow = { id: string; gapId: string | null; itemId: string | null; areaId: string }
type GapRow = {
  status: string
  metrics: string[]
  values: string[]
  dimensions: string[]
  month: string
  calls: number
}

const gone = () =>
  new ORPCError('NOT_FOUND', {
    message:
      "We couldn't find this question. Nothing was sent. The link may be cut short: ask the person who sent it to copy it again.",
  })

export function createQuestionsService(
  tx: Queryable,
  clock: Clock,
  cache: BundleCache,
  deps: { proposals: ProposalsService; review: Pick<ReviewService, 'checkSubmitted'> },
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
  async function link(id: string): Promise<LinkRow> {
    const [row] = await tx.query<LinkRow>(
      `select id::text, gap_id::text as "gapId", item_id as "itemId", area_id as "areaId"
         from question_links where id=$1`,
      [id],
    )
    if (!row) throw gone()
    return row
  }
  /** A gap's topic and this week's calls, as a Nothing written yet card counts them. */
  async function gapOf(gapId: string) {
    const [row] = await tx.query<GapRow>(
      `select g.status::text as status, t.metric_keys as metrics, t.value_keys as values,
              t.dimension_keys as dimensions, t.month::text as month,
              coalesce((select w.reports - w.human_reports + w.no_item_calls from gap_weekly_counts w
                         where w.gap_id=g.id and w.week=date_trunc('week', now() at time zone 'UTC')::date),0)::int as calls
         from gaps g join topics t on t.id=g.topic_id where g.id=$1`,
      [gapId],
    )
    return row ?? null
  }
  /**
   * The live item a check is about, as agents get it now and as the reader may read it: null once
   * it was archived, or for a reader its audience leaves out, as everywhere else.
   */
  async function liveItem(itemId: string) {
    const [row] = await tx.query<{
      title: string
      summary: string
      areaId: string
      ownerId: string | null
      start: string
      end: string | null
    }>(
      `select title, summary, area_id as "areaId", owner_id::text as "ownerId",
              valid_from::text as start, valid_until::text as "end"
         from serving_items((select seq from live_edition))
        where item_id=$1 and cl_audience_allows(audience_groups)`,
      [itemId],
    )
    return row ?? null
  }
  async function owners(areaId: string, first: string | null) {
    const rows = await tx.query<{ id: string; name: string }>(
      `select p.id::text, p.display_name as name from area_assignments a join people p on p.id=a.person_id
        where a.area_id=$1 and a.role='owner' and a.valid_at @> now()
          and p.deactivated_at is null and p.erased_at is null
        order by p.display_name, p.id`,
      [areaId],
    )
    // The item's own owner first: the one who checks it.
    return [...rows].sort((a, b) => Number(b.id === first) - Number(a.id === first))
  }
  const topicOf = (bundle: ServingBundle | null, gap: GapRow) =>
    bundle
      ? topicWords(
          bundle,
          topicScope({
            metrics: gap.metrics,
            values: gap.values,
            dimensions: gap.dimensions,
            month: gap.month,
          }),
        )
      : null

  return {
    /** Copies a card's link: made the first time, the same link copied on a new day after. */
    async copy(card: string): Promise<QuestionLink> {
      const key = parseCardKey(card)
      let target: { gap: string | null; item: string | null; area: string }
      if (key?.kind === 'gap') {
        const [gap] = await tx.query<{ area: string | null; areas: string[]; scoped: boolean }>(
          `select t.area_id as area, cl_topic_domains(t.area_id, t.metric_keys) as areas,
                  cardinality(t.metric_keys) + cardinality(t.value_keys) + cardinality(t.dimension_keys) > 0 as scoped
             from gaps g join topics t on t.id=g.topic_id
            where g.id=$1 and g.status='open' and cl_manages_topic(t.area_id, t.metric_keys)`,
          [key.id],
        )
        const area = gap?.area ?? gap?.areas[0]
        if (!gap || !area) throw new ORPCError('NOT_FOUND', { message: missing('this card') })
        // A card about words Ask could not find has no topic to show: its words stay with its owners.
        if (!gap.scoped)
          throw new ORPCError('CONFLICT', {
            message:
              'This card is about words, not a metric, so it has no question to pass on. Nothing was copied.',
          })
        target = { gap: key.id, item: null, area }
      } else if (key?.kind === 'check') {
        const item = await liveItem(key.id)
        if (!item) throw new ORPCError('NOT_FOUND', { message: missing('this context item') })
        target = { gap: null, item: key.id, area: item.areaId }
      } else throw new ORPCError('NOT_FOUND', { message: missing('this card') })
      const [may] = await tx.query<{ ok: boolean }>(
        'select cl_is_admin_now() or cl_is_owner_now($1) as ok',
        [target.area],
      )
      if (!may?.ok)
        throw new ORPCError('FORBIDDEN', {
          message: notAllowed('pass this card on', 'an owner of its domain or an admin'),
        })
      const [row] = await tx.query<QuestionLink>(
        `insert into question_links (gap_id, item_id, area_id) values ($1, $2, $3)
         on conflict (${target.gap ? 'gap_id) where (gap_id is not null' : 'item_id) where (item_id is not null'})
         do update set copied_on = (now() at time zone 'UTC')::date
         returning id::text, copied_on::text as "copiedOn"`,
        [target.gap, target.item, target.area],
      )
      return row!
    },

    /** The one question a link asks, for anyone signed in who has the link. */
    async read(id: string): Promise<Question> {
      const row = await link(id)
      const min = await minimum()
      const [domain] = await tx.query<{ name: string }>('select name from areas where id=$1', [
        row.areaId,
      ])
      if (row.gapId) {
        const gap = await gapOf(row.gapId)
        if (!gap) throw gone()
        const topic = topicOf(await liveBundle(), gap)
        return {
          id: row.id,
          kind: 'gap',
          topic: topic ?? domain?.name ?? '',
          dates: monthWindow(gap.month),
          times: visibleCount(gap.calls, min),
          minimum: min,
          item: null,
          domain: domain?.name ?? '',
          owners: (await owners(row.areaId, null)).map((o) => o.name),
          open: gap.status === 'open' && topic !== null,
        }
      }
      const item = await liveItem(row.itemId!)
      if (!item)
        return {
          id: row.id,
          kind: 'check',
          topic: '',
          dates: { start: '', end: null },
          times: null,
          minimum: min,
          item: null,
          domain: domain?.name ?? '',
          owners: (await owners(row.areaId, null)).map((o) => o.name),
          open: false,
        }
      return {
        id: row.id,
        kind: 'check',
        topic: item.title,
        dates: { start: item.start, end: item.end },
        times: null,
        minimum: min,
        item: { summary: item.summary },
        domain: domain?.name ?? '',
        owners: (await owners(item.areaId, item.ownerId)).map((o) => o.name),
        open: true,
      }
    },

    /** The person's answer, as themselves: a suggestion for a gap, an answer for a check. */
    async answer(input: AnswerQuestion): Promise<{ proposalId: string | null }> {
      const row = await link(input.id)
      if (input.link) rejectSensitive(input.link)
      if (input.kind === 'gap') {
        if (!row.gapId) throw gone()
        const gap = await gapOf(row.gapId)
        if (!gap) throw gone()
        if (gap.status !== 'open')
          throw new ORPCError('CONFLICT', {
            message:
              'Someone answered this already, or its owner closed it. Nothing was sent. Thanks for looking.',
          })
        rejectMentions(input.words)
        const today = clock.today()
        const draft: Draft = {
          areaId: row.areaId,
          title: titleOfWords(input.words),
          summary: input.words,
          scope: {
            metrics: gap.metrics,
            dimensions: gap.dimensions,
            dimensionValues: gap.values.map((value) => ({
              dimension: dimensionOfValue(value),
              value,
            })),
          },
          validity: input.dates,
          // The link waits in the draft, with no sentence from it, for the owner to confirm.
          evidence: input.link ? [{ url: input.link, quote: '', date: today }] : [],
        }
        const created = await deps.proposals.create({ draft }, { question: true })
        const [linked] = await tx.query<{ revision: number }>(
          'update proposals set source_gap_id = $2 where id = $1 returning revision',
          [created.id, row.gapId],
        )
        const submitted = await deps.proposals.submit(created.id, linked!.revision)
        await deps.review.checkSubmitted(submitted.id)
        return { proposalId: submitted.id }
      }
      if (!row.itemId) throw gone()
      if (!(await liveItem(row.itemId)))
        throw new ORPCError('CONFLICT', {
          message:
            'This context item was archived since, so there is nothing to check. Nothing was sent.',
        })
      if ((input.answer === 'ended') !== (input.endedOn !== undefined))
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          message: 'Say the day it ended, or choose another answer.',
        })
      if (input.words) {
        rejectSensitive(input.words)
        rejectMentions(input.words)
      }
      await tx.query(
        `insert into question_answers (link_id, area_id, answer, ended_on, words, link)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          row.id,
          row.areaId,
          input.answer,
          input.endedOn ?? null,
          input.words ?? null,
          input.link ?? null,
        ],
      )
      return { proposalId: null }
    },
  }
}

export type QuestionsService = ReturnType<typeof createQuestionsService>
