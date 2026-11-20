import { findDefinition, synonymIn, type Definition } from '@/lib/definitions'
import { servedToAgents, type DomainId, type Fact } from '@/model/items'
import { facts, markets, metrics } from './world'
import { definitionSeed } from '../definitions'
import { unreadSaid } from '@domain/say'
import { asksDefinition } from '@domain/scope'
import { plainText } from '@/lib/mentions'
import {
  NAMES_NOTHING,
  scopeText,
  stateLabel,
  type Answer,
  type AskedDefinition,
  type Example,
} from '@/model/ask'

/** The definitions the matcher reads synonyms from: the mock's, as they stand (mock/index.ts). */
let definitionsNow: () => Definition[] = () => definitionSeed
export const readDefinitionsFrom = (read: () => Definition[]) => {
  definitionsNow = read
}

/** Limits a question can carry beyond its metric and markets: a domain, or named context items. `pool` is the context as it is now. */
type Limit = { domain?: DomainId; only?: string[]; pool?: Fact[] }

/** The question whose answer the mock gives to a question it holds no answer for: nothing covers it. */
export const NOTHING_COVERS = 'What is the weather in Oslo today?'

/**
 * The questions the mock offers, each answered as Ask's loop answers it on the demo week with no
 * model key (loop-answers.json); `failed` is the answer when the service could not answer at all.
 */
export const examples: Example[] = [
  {
    id: 'grounded',
    label: stateLabel.grounded,
    starter: true,
    question: 'How many test accounts does units sold leave out in Norway?',
  },
  {
    id: 'missing',
    label: stateLabel.missing,
    starter: true,
    question: 'How did orders in Spain change in October 2026?',
  },
  {
    id: 'conflict',
    label: stateLabel.conflict,
    starter: true,
    question: 'Do Norway orders include gift-card money?',
  },
  {
    id: 'stale',
    label: stateLabel.stale,
    starter: true,
    question: 'Why did Norway returns drop at the end of April?',
  },
  {
    id: 'definition',
    label: 'Definition',
    question: 'What is net revenue?',
  },
  {
    id: 'failed',
    label: stateLabel.failed,
    question: 'What changed in returns in the United Kingdom this week?',
  },
]

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

/**
 * What an answer owes the asker besides the context: when no item is dated the month asked about,
 * and that the change the question assumes (a drop, a rise) isn't checked here.
 */
function explain(a: Answer): Answer {
  if (a.state === 'failed' || a.state === 'missing' || !a.sources.length) return a
  const lower = a.question.toLowerCase()
  const notes = [a.note]
  const month = MONTH_NAMES.findIndex((m) => new RegExp(`\\b${m}\\b`).test(lower))
  if (month >= 0) {
    const year = Number(lower.match(/\b(20\d\d)\b/)?.[1] ?? 2026)
    const start = `${year}-${String(month + 1).padStart(2, '0')}-01`
    const end = `${year}-${String(month + 1).padStart(2, '0')}-31`
    const dated = a.sources
      .map((id) => facts.find((f) => f.id === id))
      .filter((f): f is Fact => !!f)
      .some((f) => {
        const v = f.valid
        if (!v.from && !v.until) return true
        // An item with only a start date is about that time, not every month after it, unless it is still going on.
        const until =
          v.until ??
          (v.ongoing
            ? '9999-12-31'
            : new Date(Date.parse(v.from!) + 31 * 86400000).toISOString().slice(0, 10))
        return (v.from ?? '0000-01-01') <= end && until >= start
      })
    if (!dated)
      notes.push(
        `No item is dated ${MONTH_NAMES[month]![0]!.toUpperCase()}${MONTH_NAMES[month]!.slice(1)}; these are the nearest that apply.`,
      )
  }
  const change = lower.match(
    /\b(drop|dropped|fall|fell|rise|rose|jump|jumped|spike|increase|increased|decrease|decreased|decline|declined)\b/,
  )?.[1]
  if (change)
    notes.push(
      `The numbers aren't shown here, so the ${/^(drop|dropped|fall|fell|decline|declined|decrease|decreased)$/.test(change) ? 'drop' : 'change'} itself isn't confirmed.`,
    )
  return { ...a, note: notes.filter(Boolean).join(' ') || undefined }
}

// A metric's own word stands for it ("conversion" is Conversion rate), unless the word is shared
// or too common to mean one metric.
const COMMON = new Set(['return', 'online', 'customer', 'marketing', 'first-time'])
const stems = metrics.flatMap((m) => {
  const first = m.name.toLowerCase().split(' ')[0]!
  const shared = metrics.filter((x) => x.name.toLowerCase().split(' ')[0] === first).length > 1
  return m.name.includes(' ') && first.length >= 5 && !shared && !COMMON.has(first)
    ? [{ stem: first, metric: m.name }]
    : []
})

/** The metrics as the engine names them when a question names none, in the engine's order. */
const metricTerms = metrics
  .map((m) => ({ key: `metric:${m.name.toLowerCase().replace(/\W+/g, '_')}`, name: m.name }))
  .sort((a, b) => (a.key < b.key ? -1 : 1))

/**
 * Reads a metric and markets from plain words, the way get_context does, with no model. Either may
 * be missing: a question that names neither is not looked up, and gets no answer state.
 */
export function readQuestion(q: string) {
  const lower = q.toLowerCase()
  // A synonym counts as the metric it means: "turnover" is read as Net revenue.
  const synonym = synonymIn(definitionsNow(), q)
  const alias =
    synonym && synonym.is.type !== 'term'
      ? { asked: synonym.asked, is: synonym.is.name, type: synonym.is.type }
      : undefined
  const named = metrics
    .flatMap((m) => [m.name, ...(m.otherNames ?? [])].map((n) => ({ n, metric: m.name })))
    .sort((a, b) => b.n.length - a.n.length)
    .find(({ n }) =>
      new RegExp(`\\b${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower),
    )?.metric
  const metric =
    (alias?.type === 'metric' ? alias.is : undefined) ??
    named ??
    stems.find((s) => new RegExp(`\\b${s.stem}`).test(lower))?.metric ??
    (/\borders?\b/.test(lower) ? 'Orders' : /\breturns?\b/.test(lower) ? 'Returns' : '')
  const found = markets.filter((m) => lower.includes(m.toLowerCase()))
  return { metric, markets: found, alias, matched: !!metric || found.length > 0 }
}

function sentence(f: Fact) {
  return plainText(f.summary).split(/(?<=\.)\s/)[0]
}

/** Builds an answer from the context for any metric and markets: the mock matcher behind Ask. */
export function answerFor(
  question: string,
  metric: string,
  ms: string[],
  dates?: string,
  limit: Limit = {},
): Answer {
  return explain(answerCore(question, metric, ms, dates, limit))
}

// Words that say what an item is about beyond its metric and market: "store credit", "card and cash".
const QUIET = new Set([
  'the',
  'and',
  'or',
  'of',
  'in',
  'on',
  'to',
  'for',
  'from',
  'are',
  'is',
  'only',
  'count',
  'counts',
  'orders',
  'order',
  'with',
  'by',
  'a',
  'an',
  'its',
  'it',
])
const topicOf = (f: Fact) =>
  plainText(f.title)
    .toLowerCase()
    .split(/[^a-z-]+/)
    .filter(
      (w) =>
        w.length > 2 &&
        !QUIET.has(w) &&
        !markets.some((m) => m.toLowerCase() === w) &&
        !/^\d/.test(w),
    )

/** Whether a question is about what an item says, beyond sharing its metric and market. */
const bearsOn = (f: Fact, question: string) => {
  const words = question.toLowerCase().split(/[^a-z-]+/)
  return topicOf(f).some((t) =>
    words.some((w) => w === t || w.startsWith(t.replace(/s$/, '')) || t.split('-').includes(w)),
  )
}

function answerCore(
  question: string,
  metric: string,
  ms: string[],
  dates?: string,
  limit: Limit = {},
): Answer {
  const live = (limit.pool ?? facts).filter(
    (f) => servedToAgents(f) && (!limit.domain || f.domain === limit.domain),
  )
  // Scoped to named context items, those are what applies; otherwise the metric and each market
  // decide. A question with no metric reads every metric in its markets, and one with no market
  // every market for its metric. A question that names neither matches nothing.
  // An item with no "Applies to" is read from its own words, as the editor says.
  const covers = (f: Fact, name: string) =>
    f.where.length
      ? f.where.includes(name)
      : new RegExp(`\\b${name.toLowerCase()}`).test(
          plainText(`${f.title} ${f.summary}`).toLowerCase(),
        )
  const apply = (m?: string) =>
    limit.only
      ? live.filter((f) => limit.only!.includes(f.id))
      : live.filter(
          (f) => (!metric || covers(f, metric)) && (!m || covers(f, m) || f.where.length === 1),
        )
  const matched = !!(metric || ms.length || limit.only || limit.domain)
  const per = matched
    ? (ms.length ? ms : [undefined]).map((m) => ({ market: m, facts: apply(m) }))
    : []
  const found = [...new Map(per.flatMap((p) => p.facts).map((f) => [f.id, f])).values()]
  // Two items that disagree count only when the question is about what they disagree on; otherwise
  // they are listed as related, not used, so the state doesn't change because of something else.
  const offTopic = found.filter((f) => {
    const pair = f.disagreesWith ?? found.find((x) => x.disagreesWith === f.id)?.id
    if (!pair) return false
    const other = found.find((x) => x.id === pair)
    return !bearsOn(f, question) && !(other && bearsOn(other, question))
  })
  const all = found.filter((f) => !offTopic.includes(f))
  const related = offTopic.length ? offTopic.map((f) => f.id) : undefined
  const scope = scopeText({ metric, markets: ms, dates }) || 'this question'
  const base = { id: 'custom', question, metric, markets: ms, dates, related }

  // Nothing was looked up: no answer state. Agents get the engine's own sentence about why; the
  // person what Ask can answer, with the names closest to their words.
  if (!matched) {
    const said = unreadSaid(
      { terms: metricTerms },
      [{ field: 'scope', input: question, options: metricTerms.map((t) => t.key) }],
      question,
    ).say
    return {
      ...base,
      state: null,
      text: NAMES_NOTHING,
      sources: [],
      said,
    }
  }

  if (all.length === 0) {
    return {
      ...base,
      state: 'missing',
      text: `Nobody has written down anything about ${scope}. That doesn't mean there's no explanation, only that none is written down yet.`,
      sources: [],
      said: `Nothing is written down for ${scope}. No match does not prove that nothing applies.`,
    }
  }
  const sources = all.map((f) => f.id)
  const text = all.map((f, i) => `${sentence(f)} [${i + 1}]`).join(' ')
  if (all.some((f) => f.disagreesWith)) {
    return {
      ...base,
      state: 'conflict',
      text: `${text} Both are kept until an owner chooses.`,
      sources,
      // The pairs that disagree, not every item that applies.
      conflict: all
        .filter(
          (f) =>
            all.some((x) => x.id === f.disagreesWith) || all.some((x) => x.disagreesWith === f.id),
        )
        .map((f) => f.id),
      said: `${all.length} context items apply to ${scope}, and they disagree. Give both sides.`,
    }
  }
  const covered = per.filter((p) => p.facts.length)
  if (ms.length && covered.length < per.length) {
    const none = per.filter((p) => !p.facts.length).map((p) => p.market)
    return {
      ...base,
      state: 'partial',
      note: `There's context for ${covered.map((p) => p.market).join(' and ')} and nothing for ${none.join(' and ')}.`,
      text,
      sources,
      said: `Context applies to ${metric} in ${covered.map((p) => p.market).join(' and ')}. Nothing is written down for ${none.join(' and ')}.`,
    }
  }
  const stale = all.find((f) => f.outOfDate)
  if (stale) {
    return {
      ...base,
      state: 'stale',
      note: `Based on ${all.length === 1 ? '1 context item' : `${all.length} context items, one of them`} that may be out of date. ${stale.outOfDate}`,
      text,
      sources,
      said: `${all.length} ${all.length === 1 ? 'context item applies' : 'context items apply'} to ${scope}. One may be out of date.`,
    }
  }
  return {
    ...base,
    state: 'grounded',
    text: `${text} The context doesn't say what caused it.`,
    sources,
    said: `${all.length} ${all.length === 1 ? 'context item applies' : 'context items apply'} to ${scope}. Nothing else was looked up.`,
  }
}

/** What get_context would give for a question, from the context as it is now (`pool`): the matcher's answer. */
export function askQuestion(question: string, pool?: Fact[]): Answer {
  const read = readQuestion(question)
  const defined = definitionOf(question, read.metric)
  return {
    ...answerFor(question, read.metric, read.markets, undefined, { pool }),
    ...(defined ? { definitions: [defined] } : {}),
  }
}

/**
 * For a question about what a metric means: what its definition source says about it, as the
 * service gives it (FR-703). A metric the source does not describe has none.
 */
function definitionOf(question: string, metric: string): AskedDefinition | null {
  if (!metric || !asksDefinition(question)) return null
  const d = findDefinition(definitionsNow(), metric)
  if (!d?.synced || !d.tool) return null
  return {
    name: d.name,
    words: d.definition && !/^No description/.test(d.definition) ? d.definition : null,
    tool: d.tool,
  }
}

/** Every question the mock answers with a recorded turn of Ask's loop (loop-answers.json). */
export const mockQuestions: readonly string[] = [
  ...examples.flatMap((e) => (e.id === 'failed' ? [] : [e.question])),
  'How did orders in Norway change in October 2026?',
  'Why did orders in Norway drop in August?',
  'Did discount cost in Norway fall after 9 May?',
  'Do United Kingdom orders include store credit or not?',
  'Define our customer happiness index.',
  NOTHING_COVERS,
  'Before the weekly note goes out: has anything changed in how gross margin is counted for Spain since the price promotions came back?',
]
