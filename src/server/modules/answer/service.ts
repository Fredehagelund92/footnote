import { ORPCError } from '@orpc/client'
import type { AnswerResult, Asked, Reach, Replay } from '../../../contract/answer.ts'
import type { ProposalRecord } from '../../../contract/proposals.ts'
import {
  answer,
  reach,
  startersOf,
  topicScope,
  topicWords,
  type Answer,
  type TopicCount,
} from '../../../domain/answer.ts'
import { compareIds } from '../../../domain/resolver.ts'
import { askedTotals } from '../../../domain/gaps.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import type { ModelChoice } from '../models/index.ts'
import type { LoopDeps } from './loop.ts'
import { loadServingBundle, type ServingBundle } from '../editions/index.ts'
import { createObservabilityService } from '../observability/index.ts'
import { draftBundle } from '../proposals/index.ts'
import { missing } from '../../../contract/refusals.ts'

/**
 * An edition to answer on: its sequence, its label, the overlay of stops and flags now, and, for
 * the live edition, the mark of the terms people write, which are read as they are now.
 */
type Head = { seq: string; label: string; overlay: string; terms?: string }
type Target = AnswerResult['target']

const nothingLive = () =>
  new ORPCError('PRECONDITION_FAILED', {
    message:
      'Nothing is shared with agents yet. They get context once an owner publishes the first item.',
  })
/** Steps are timed with the process's clock; the answer is the same whatever it says. */
const clockMs = () => performance.now()

const overlayOf = `coalesce((select seq::text from serving_overlay),'0') as overlay`
async function liveHead(tx: Queryable): Promise<Head | null> {
  const [head] = await tx.query<Head>(
    `select e.seq::text,e.label,${overlayOf},serving_terms_mark() as terms
       from editions e join live_edition l on l.seq=e.seq`,
  )
  return head ?? null
}
/** The sealed edition before the live one: what agents got before the last publish. */
async function headBefore(tx: Queryable): Promise<Head | null> {
  const [head] = await tx.query<Head>(
    `select e.seq::text,e.label,${overlayOf} from editions e
      where e.sealed_at is not null and e.seq < (select seq from live_edition)
      order by e.seq desc limit 1`,
  )
  return head ?? null
}

/**
 * The bundles answers are read from, by edition, overlay and terms mark, kept until their key
 * changes, so a look-up does not read the whole edition each time. A bundle is what agents get,
 * the same for every person (its reads are the security definer serving functions), so one bundle
 * serves everyone. A new publish, a stop switch, a term written or a sync is a new key, so Ask
 * reads a word as agents do from the next question. The `capacity` bundles used last are kept.
 */
export function createBundleCache(capacity = 4) {
  const cache = new Map<string, Promise<ServingBundle>>()
  return {
    bundle(tx: Queryable, head: Head): Promise<ServingBundle> {
      const key = `${head.seq}:${head.overlay}:${head.terms ?? ''}`
      const cached = cache.get(key)
      // Used now: it is the last to go.
      cache.delete(key)
      const bundle = cached ?? loadServingBundle(tx, head)
      cache.set(key, bundle)
      // A failed read is not kept: the next request reads again.
      if (!cached) bundle.catch(() => cache.delete(key))
      while (cache.size > capacity) cache.delete(cache.keys().next().value!)
      return bundle
    },
  }
}
export type BundleCache = ReturnType<typeof createBundleCache>

/**
 * The live edition's key: its edition, overlay and terms mark, which a publish, a stop switch, a
 * word written or a sync changes. Null when nothing is shared yet.
 */
export async function liveEditionKey(tx: Queryable): Promise<string | null> {
  const head = await liveHead(tx)
  return head && `${head.seq}:${head.overlay}:${head.terms ?? ''}`
}

/** What agents get now, from the cache; refused when nothing is shared yet. */
export async function liveBundle(tx: Queryable, cache: BundleCache): Promise<ServingBundle> {
  const head = await liveHead(tx)
  if (!head) throw nothingLive()
  return cache.bundle(tx, head)
}

const result = (a: Answer, target: Target): AnswerResult => {
  const { overlay: _overlay, ...rest } = a
  return { target, ...rest }
}

/**
 * What a run of Ask's cases hears or replaces: the model the loop asks and what each turn read.
 * Never set by the service: these are words, which it keeps nowhere.
 */
export type AskTrace = {
  /** Ask's loop: the model it asks in place of the assistant's, such as a recorded one. */
  loopModel?: ModelChoice
  /** Each loop turn's reads, and the chat's earlier reads made again, with what they returned. */
  onLoopTurn?: LoopDeps['onTurn']
}

/** The minimum count under which no count is shown (FR-614, `privacy.min_count`). */
export async function minimumCount(tx: Queryable): Promise<number> {
  const [row] = await tx.query<{ minimum: number }>(
    `select (value #>> '{}')::int as minimum from settings_current where key='privacy.min_count'`,
  )
  return row?.minimum ?? 5
}

/**
 * The topics agents asked about in the week of `today` (Monday to Sunday, UTC), with how often:
 * agent calls only, as the topic counts keep them, with no words and no person (FR-602).
 */
async function topicsOfWeek(
  tx: Queryable,
  today: string,
): Promise<{ week: string; topics: TopicCount[] }> {
  const [week] = await tx.query<{ week: string }>(
    `select date_trunc('week', $1::date)::date::text as week`,
    [today],
  )
  const topics = await tx.query<TopicCount>(
    `select t.id::text, t.area_id as area, t.metric_keys as metrics, t.value_keys as values,
            t.dimension_keys as dimensions, t.month::text as month, w.calls,
            w.no_item_calls as "noItem"
       from v_topic_weeks w join topics t on t.id = w.topic_id
      where w.week = $1::date and w.calls > 0
      order by t.id`,
    [week!.week],
  )
  return { week: week!.week, topics }
}

/** An open Not found card the reader manages, by its topic's parts, with its draft. */
type OpenGap = {
  id: string
  area: string | null
  metrics: string[]
  values: string[]
  dimensions: string[]
  month: string
  draft: string | null
}
const partsKey = (t: Pick<OpenGap, 'area' | 'metrics' | 'values' | 'dimensions'>) =>
  [
    t.area ?? '',
    [...t.metrics].sort(compareIds).join(','),
    [...t.values].sort(compareIds).join(','),
    [...t.dimensions].sort(compareIds).join(','),
  ].join('|')

/**
 * The Not found cards open on the topics the reader manages (`cl_manages_topic`, administrators
 * and the owners of the topic's domains), latest month first, with the draft that waits on each.
 */
async function openGaps(tx: Queryable): Promise<OpenGap[]> {
  return tx.query<OpenGap>(
    `select g.id::text, t.area_id as area, t.metric_keys as metrics, t.value_keys as values,
            t.dimension_keys as dimensions, t.month::text as month,
            (select p.id::text from proposals p
              where p.source_gap_id=g.id and p.discarded_at is null order by p.created_at desc limit 1) as draft
       from gaps g join topics t on t.id=g.topic_id
      where g.status='open' and cl_manages_topic(t.area_id, t.metric_keys)
      order by t.month desc, g.id`,
  )
}

/**
 * Asked this week (FR-714): the topics agents asked about most in the last 7 full days, one row per
 * metric, market and dimension with its months joined, each with the state Ask gives it now on the
 * live edition for its latest month. Counts only, never the words. Every count is the reader's own
 * (`readerSubjects`): what their Observability shows, or the strictest view of the owners of its
 * domain, so a floor stays a floor and a row under the minimum is not listed (FR-614). An owner sees
 * the Not found card open on a topic of their domain. Beside them, the workspace's first questions,
 * made from what it has written, for when nothing has been asked yet.
 */
export async function askedThisWeek(
  tx: Queryable,
  clock: Clock,
  cache: BundleCache,
): Promise<Asked | null> {
  // Before the first publish nothing is shared with agents, so there is no week to say: an answer
  // of its own, not a refusal a new install's first page would log.
  if (!(await liveHead(tx))) return null
  return (await askedFor(tx, clock, cache)).asked
}

/**
 * What agents asked this week as the reader may have it: the topics listed and not, and the total
 * beside them. Asked this week and the Inbox's week line both count from here, so the two agree.
 */
export async function askedCounts(tx: Queryable, clock: Clock) {
  const { subjects, domains, minimum, start, today } = await createObservabilityService(
    tx,
    clock,
  ).asked()
  const size = (s: (typeof subjects)[number]) => s.count ?? s.atLeast
  const listed = subjects
    .filter((s) => size(s) >= minimum)
    .sort((a, b) => size(b) - size(a) || compareIds(a.key, b.key))
  const askedAtLeast = listed.reduce((sum, s) => sum + size(s), 0)
  const calls = (rows: typeof subjects) => rows.reduce((sum, s) => sum + s.calls, 0)
  const unshown = subjects.filter((s) => !listed.includes(s))
  const { asked, hidden } = askedTotals(
    listed.map((s) => ({ domain: s.domain, size: size(s) })),
    calls(unshown),
    calls(subjects),
    domains,
    minimum,
  )
  return { subjects, listed, unshown, domains, minimum, start, today, asked, askedAtLeast, hidden }
}

/** Asked this week, with the minimum count it shows. */
export async function askedFor(
  tx: Queryable,
  clock: Clock,
  cache: BundleCache,
): Promise<{ asked: Asked; minimum: number }> {
  const bundle = await liveBundle(tx, cache)
  const today = clock.today()
  const {
    listed,
    minimum,
    start,
    asked: askedTotal,
    askedAtLeast,
    hidden,
  } = await askedCounts(tx, clock)
  const gaps = await openGaps(tx)
  const asked: Asked = {
    week: start,
    rows: listed.map((subject) => {
      const month = subject.months[0] ?? today.slice(0, 7)
      const scope = topicScope({
        metrics: subject.metrics,
        values: subject.values,
        dimensions: subject.dimensions,
        month: `${month}-01`,
      })
      const now = answer(bundle, { scope }, { today })
      const gap =
        now.state === 'missing'
          ? gaps.find((g) => partsKey(g) === partsKey({ ...subject, area: subject.domain }))
          : undefined
      return {
        title: topicWords(bundle, scope),
        area: subject.domain,
        scope,
        months: subject.months.map((m) => `${m}-01`),
        count: subject.count,
        atLeast: subject.count ?? subject.atLeast,
        state: now.state,
        items: now.items.length,
        nothing: subject.nothing,
        gap: gap ? { card: `gap:${gap.id}`, draft: gap.draft } : null,
      }
    }),
    hidden,
    // The total beside the rows: shown only when what it adds over the counts the rows show is
    // zero or at least the minimum, so it never gives a small count away by subtraction.
    asked: askedTotal,
    askedAtLeast,
    starters: startersOf(bundle, today).map((scope) => ({
      title: topicWords(bundle, scope),
      scope,
    })),
  }
  return { asked, minimum }
}

/**
 * The answer panel's replay (FR-620): a topic answered now, or before the last publish, on the
 * edition before the live one, step by step and with no model. A topic is read by administrators
 * and the owners of its domains only, as its gap is (`cl_manages_topic`); anyone else is told it
 * does not exist.
 */
export async function replayTopic(
  tx: Queryable,
  clock: Clock,
  cache: BundleCache,
  input: { topic: string; when: 'now' | 'before' },
): Promise<Replay> {
  const [topic] = await tx.query<Omit<TopicCount, 'id' | 'calls'> & { manages: boolean }>(
    `select t.area_id as area, t.metric_keys as metrics, t.value_keys as values,
            t.dimension_keys as dimensions, t.month::text as month,
            cl_manages_topic(t.area_id, t.metric_keys) as manages
       from topics t where t.id = $1`,
    [input.topic],
  )
  if (!topic?.manages) throw new ORPCError('NOT_FOUND', { message: missing('this topic') })
  const head = input.when === 'now' ? await liveHead(tx) : await headBefore(tx)
  if (!head)
    throw input.when === 'now'
      ? nothingLive()
      : new ORPCError('PRECONDITION_FAILED', {
          message:
            'Agents got nothing before what they get today, so there is nothing to compare with yet.',
        })
  const bundle = await cache.bundle(tx, head)
  const scope = topicScope(topic)
  return {
    when: input.when,
    answer: result(
      answer(bundle, { scope }, { today: clock.today(), now: clockMs }),
      input.when === 'now' ? { kind: 'live' } : { kind: 'edition' },
    ),
  }
}

/**
 * The reach of a draft (the editor's and the review's "12 questions agents asked this week would
 * get it"): this week's topics answered on the live edition with the draft in it, counting the
 * questions of each topic whose answer gives the draft. Only topics asked at least the minimum
 * times count (FR-614).
 */
export async function reachOfDraft(
  tx: Queryable,
  clock: Clock,
  cache: BundleCache,
  p: ProposalRecord,
): Promise<Reach> {
  const today = clock.today()
  const drafted = await draftBundle(tx, p, (head) => cache.bundle(tx, head))
  const { week, topics } = await topicsOfWeek(tx, today)
  return {
    questions: reach(drafted.bundle, drafted.item, topics, today, await minimumCount(tx)),
    week,
  }
}
