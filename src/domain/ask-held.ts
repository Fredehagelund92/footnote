import { readQuestion } from './scope.ts'
import { normalizeName, type Term } from './vocabulary.ts'

/*
  The word Ask's loop asks about before any model reads (FR-719.2): a question that names a metric
  only by a word several metrics share, read by fixed rules. Pure, so the service and its tests
  read a question alike.
*/

/** The most metrics a question back offers, as its choices take them. */
const VAGUE_CHOICES = 4

/**
 * The word of a question that names no one metric (A5 of the release judgement), wherever it
 * sits, alone or in a sentence: the name of a group of metrics (never of a family, FR-142, which
 * is one thing to answer about), or another name of one metric
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
    // A family is one thing to answer about, whichever variant is meant (FR-142).
    if (term.definitionRefs.length) return null
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
