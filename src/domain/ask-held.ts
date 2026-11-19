import { HELD_MEANINGS, type HeldReading } from './ask-chat.ts'
import type { PlannedRead, PlanPeriod } from './ask-plan.ts'
import { readQuestion, type ScopeIssue, type ScopeResult } from './scope.ts'
import { anyDate, shiftDate, type DateWindow } from './validity.ts'
import { normalizeName, type Term, type WordMeaning } from './vocabulary.ts'

/*
  What Ask holds while it waits for a person to say which meaning of a word they mean. The turn
  that asks keeps how it read the rest of the question and the meanings (`HeldReading`), and the
  next message is read against them by fixed rules, before any model: a name, a word of a name, a
  place in the list or "both". The planner sees only what these rules cannot read. Pure, so the
  service, the mock and the planner cases read an answer alike.
*/

/** The contested words of a read question, each one to ask about in turn. */
const contestedOf = (issues: readonly ScopeIssue[]) => {
  const seen = new Set<string>()
  return issues.flatMap((issue) => {
    const word = issue.word ?? issue.input
    if (!issue.meanings || seen.has(normalizeName(word))) return []
    seen.add(normalizeName(word))
    return [{ word, meanings: issue.meanings.slice(0, HELD_MEANINGS) }]
  })
}

/** What a question that stopped at a word holds on to, or null when it stopped for another reason. */
export function heldOf(read: ScopeResult): HeldReading | null {
  if (read.status !== 'need_more_detail' || !read.held) return null
  const [first, ...more] = contestedOf(read.issues)
  if (!first) return null
  return { ...first, ...read.held, ...(more.length ? { more } : {}) }
}

/** Words that say nothing about which meaning: "the second one, please". */
const PASSING = new Set(
  "a an and at by for i in it its is it's just me mean meant of ok okay on one ones or please pls prefer the thanks that to want we with yes".split(
    ' ',
  ),
)

/** The place a word points at in the list, from its start; `last` from its end. */
const PLACES: Record<string, number | 'last'> = {
  first: 0,
  '1st': 0,
  '1': 0,
  former: 0,
  second: 1,
  '2nd': 1,
  '2': 1,
  third: 2,
  '3rd': 2,
  '3': 2,
  fourth: 3,
  '4th': 3,
  '4': 3,
  fifth: 4,
  '5th': 4,
  '5': 4,
  last: 'last',
  latter: 'last',
}
const EVERY = new Set(['both', 'all', 'each'])

const wordsOf = (text: string) =>
  normalizeName(text.replaceAll('\u2019', "'"))
    .split(/[^\p{L}\p{N}']+/u)
    .filter(Boolean)

/** The meaning every word points at: "net" and "net revenue" are Net revenue; "term" is the term. */
function meaningOfWords(words: readonly string[], meanings: readonly WordMeaning[]) {
  const fits = meanings.filter((m) => {
    const own = new Set(wordsOf(m.name))
    if (m.key.startsWith('term:')) own.add('term')
    return words.every((word) => own.has(word))
  })
  return fits.length === 1 ? fits : []
}

/**
 * Which meanings a message chooses, read by fixed rules, or null when it does not say. A message
 * that names something else as well keeps it: "net, in Spain last week" is Net revenue with those
 * filters and dates. A metric that is no meaning of the word, or a dimension named with no value,
 * is another question, and a word with more than one meaning of its own is read as its own
 * question.
 */
export function chosenMeanings(
  message: string,
  held: Pick<HeldReading, 'meanings'>,
  terms: readonly Term[],
  today: string,
) {
  const termWords = wordsOf(message).filter((word) => !PASSING.has(word))
  if (termWords.length > 1 && termWords.includes('term')) {
    const termMeanings = held.meanings.filter((m) => m.key.startsWith('term:'))
    const [term] = meaningOfWords(termWords, termMeanings)
    if (term) return { picked: [term], others: [] as Term[], window: null }
  }
  const own = readQuestion(message, terms, today)
  if (own.issues.some((issue) => issue.meanings)) return null
  const keys = new Set(own.terms.map((term) => term.key))
  // A value's dimension names it among the meanings: "brand" is Alder the brand.
  const dimensionOf = (key: string) =>
    key.startsWith('val:') ? `dim:${key.slice(4).split('/')[0]}` : ''
  const named = held.meanings.filter((m) => keys.has(m.key) || keys.has(dimensionOf(m.key)))
  const others = own.terms.filter(
    (term) => !named.some((m) => m.key === term.key || dimensionOf(m.key) === term.key),
  )
  const another = ['metric', 'metric_group', 'dimension']
  if (others.some((t) => another.includes(t.kind))) return null
  // Only the words nothing else read: names and dates are taken out where they stand.
  const spans = [...own.spans].sort((a, b) => b.start - a.start)
  const rest = spans.reduce((t, s) => `${t.slice(0, s.start)} ${t.slice(s.end)}`, message)
  const words = wordsOf(rest).filter((word) => !PASSING.has(word))
  const picked = named.length
    ? words.length
      ? []
      : named
    : words.length === 1 && EVERY.has(words[0]!)
      ? held.meanings
      : words.length === 1 && words[0]! in PLACES
        ? placed(words[0]!, held.meanings)
        : words.length
          ? meaningOfWords(words, held.meanings)
          : []
  return picked.length ? { picked, others, window: own.window } : null
}

function placed(word: string, meanings: readonly WordMeaning[]) {
  const place = PLACES[word]!
  const meaning = meanings[place === 'last' ? meanings.length - 1 : place]
  return meaning ? [meaning] : []
}

/** What a chosen meaning adds to the rest of the question. */
function withMeanings(
  held: Pick<HeldReading, 'metrics' | 'filters'>,
  picked: readonly WordMeaning[],
  others: readonly Term[],
  terms: readonly Term[],
) {
  const metrics = [...held.metrics]
  const filters: Record<string, string[]> = Object.fromEntries(
    Object.entries(held.filters).map(([dimension, values]) => [dimension, [...values]]),
  )
  const byKey = new Map(terms.map((term) => [term.key, term]))
  for (const term of [...picked.flatMap((m) => byKey.get(m.key) ?? []), ...others]) {
    if (term.kind === 'dimension_value') (filters[term.parentKey!] ??= []).push(term.key)
    else if (term.kind === 'dimension') filters[term.key] ??= []
    else metrics.push(term.key)
  }
  return {
    metrics: [...new Set(metrics)].sort(),
    filters: Object.fromEntries(
      Object.entries(filters)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([dimension, values]) => [dimension, [...new Set(values)].sort()]),
    ),
  }
}

/** What a settled word leads to: another word to ask about, one read, or nothing to look up. */
export type Settled =
  | { kind: 'ask'; held: HeldReading }
  | { kind: 'read'; read: PlannedRead; others: WordMeaning[]; word: string }
  | { kind: 'nothing'; word: string }

/** The reading once a person chose: the rest of the question with the meanings it chose. */
export function settled(
  held: HeldReading,
  chosen: NonNullable<ReturnType<typeof chosenMeanings>>,
  terms: readonly Term[],
  today: string,
): Settled {
  const { metrics, filters } = withMeanings(held, chosen.picked, chosen.others, terms)
  const window = chosen.window ?? held.window
  const [next, ...more] = held.more ?? []
  if (next)
    return {
      kind: 'ask',
      held: {
        ...next,
        metrics,
        filters,
        window,
        ...(held.why ? { why: true } : {}),
        ...(held.defines ? { defines: true } : {}),
        ...(more.length ? { more } : {}),
      },
    }
  if (!metrics.length && !Object.keys(filters).length) return { kind: 'nothing', word: held.word }
  const why = !!held.why
  const period: PlanPeriod = chosen.window
    ? 'asked'
    : held.window
      ? 'carried'
      : why
        ? 'any'
        : 'today'
  const days: DateWindow = window ?? (why ? anyDate : { start: today, end: shiftDate(today, 1) })
  const read: PlannedRead =
    held.defines && metrics.length
      ? { kind: 'definition', metrics }
      : { kind: 'lookup', scope: { metrics, filters, window: days }, period, why }
  return {
    kind: 'read',
    read,
    others: held.meanings.filter((m) => !chosen.picked.includes(m)),
    word: held.word,
  }
}

/** The most metrics a question back offers, as its choices take them. */
const VAGUE_CHOICES = 4

/**
 * The word of a question that names no one metric (A5 of the release judgement), wherever it
 * sits, alone or in a sentence: the name of a group of metrics, or another name of one metric
 * that is also a word of other metrics' own names ("sales", written for Net revenue, beside Gross
 * sales), or a word written for more than one metric. With the metrics it may mean, the first
 * four; null when the question names a metric by
 * its own name, names more than one name of a metric, or the word means one metric only. A word
 * that, with the word before it, is a phrase of a title in `titles` belongs to that phrase ("what
 * stopped online sales to Norway?" beside "Online sales to Norway stopped"), not to a metric; a
 * domain's name written as the domain ("in Marketing", "the sales inbox") is the domain; and a
 * question that names someone in the workspace is left to the model, which declines it or not.
 * Ask's loop asks back with them before any model reads (FR-719.2).
 */
export function vagueMetricWord(
  question: string,
  terms: readonly Term[],
  today: string,
  around: {
    /** The titles of the context items the person may read. */
    titles?: readonly string[]
    /** The domains' names. */
    domains?: readonly string[]
    /** The names of the people in the workspace. */
    people?: readonly string[]
  } = {},
): { word: string; metrics: Term[] } | null {
  const { titles = [], domains = [], people = [] } = around
  // A question about someone is not about a metric: who it is about is the model's to read.
  const asked = new Set(wordsIn(question))
  if (people.some((name) => wordsIn(name).some((w) => asked.has(w)))) return null
  const read = readQuestion(question, terms, today, { loose: true })
  const byKey = new Map(terms.map((term) => [term.key, term]))
  const named = read.spans.flatMap((span) => {
    const found = span.dates
      ? []
      : (span.keys ?? []).flatMap((key) => {
          const term = byKey.get(key)
          return term && (term.kind === 'metric' || term.kind === 'metric_group') ? [term] : []
        })
    return found.length ? [{ span, found }] : []
  })
  if (named.length !== 1) return null
  const { span, found } = named[0]!
  const word = question.slice(span.start, span.end)
  if (inPhrase(question, span, titles) || asDomain(question, span, word, domains)) return null
  const metrics = terms.filter((t) => t.kind === 'metric')
  // A word written for more than one metric.
  if (found.length > 1)
    return found.every((t) => t.kind === 'metric')
      ? { word, metrics: found.slice(0, VAGUE_CHOICES) }
      : null
  const term = found[0]!
  if (term.kind === 'metric_group') {
    const members = metrics.filter((m) => m.parentKey === term.key)
    return members.length > 1 ? { word, metrics: members.slice(0, VAGUE_CHOICES) } : null
  }
  const said = normalizeName(word)
  if (said === normalizeName(term.name)) return null
  const inName = new RegExp(
    `(?<![\\p{L}\\p{N}])${said.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`,
    'u',
  )
  const others = metrics.filter((m) => m.key !== term.key && inName.test(normalizeName(m.name)))
  return others.length ? { word, metrics: [term, ...others].slice(0, VAGUE_CHOICES) } : null
}

const wordsIn = (text: string) =>
  normalizeName(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

/**
 * Whether the words at `span`, with the word before them, stand in one of `titles`: a word that
 * qualifies them ("online sales") makes them that phrase.
 */
function inPhrase(
  question: string,
  span: { start: number; end: number },
  titles: readonly string[],
) {
  const before = wordsIn(question.slice(0, span.start)).at(-1)
  if (!before) return false
  const phrase = ` ${[before, ...wordsIn(question.slice(span.start, span.end))].join(' ')} `
  return titles.some((title) => ` ${wordsIn(title).join(' ')} `.includes(phrase))
}

/** Words after a domain's name that make it the domain: what Footnote keeps about a domain. */
const DOMAIN_NOUN =
  /^(?:inbox|domains?|owners?|items?|context|definitions?|metrics|dimensions|library)$/

/**
 * Whether a domain's name in the question is written as the domain: capitalised after the first
 * word, as a name is, or before a word for what Footnote keeps about a domain.
 */
function asDomain(
  question: string,
  span: { start: number; end: number },
  word: string,
  domains: readonly string[],
) {
  if (!domains.some((d) => normalizeName(d) === normalizeName(word))) return false
  const capitalised = /^\p{Lu}/u.test(word) && wordsIn(question.slice(0, span.start)).length > 0
  const after = wordsIn(question.slice(span.end))[0]
  return capitalised || (!!after && DOMAIN_NOUN.test(after))
}
