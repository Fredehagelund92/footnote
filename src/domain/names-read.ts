import { businessNouns, isEverydayWord, isOfAValueKind } from './everyday-words.ts'
import { initialsOf, normalizeName, type Term } from './vocabulary.ts'

/*
  The one reader of names in a loose form, for every tool that reads a person's or an agent's words
  (decided 23 November 2026): Ask's get_context, find_context and definitions, and the agents'
  get_context and find_context. A name and its other names are read whole first (`phrasesIn`);
  what is left is read here, in this order:

  - another form of a whole name: a plural or a singular, or its words in another order ("customer
    active" for Active customers, "order" for Orders); one word alone reads only as a metric
    ("stores" is no Store, "customer" no Customers);
  - a short name made of its initials ("ROAS" for Return on ad spend, `initialsOf`);
  - a whole word of the name of one metric only, when no other name holds the word and it names no
    domain ("churn" for Churn rate, "margin" for Gross margin). A word in several names ("rate",
    "customer") names none of them, and "sales", a word of Gross sales, also names the Sales domain.

  Values of dimensions are read by their names only: there may be thousands. A reader says what it
  read loosely, and how, so a reply never reads a word as a name silently. And when the words name
  no metric, the words that could have named one are said as unread, with the names that hold them
  (`unreadWords`), so a reply never drops one silently because another word was read.
*/

// Words that carry no meaning in a search of short governed facts: function words, question
// words and the product's own nouns ("item", "domain"), so "what does the Sales domain
// cover" reads as Sales and "cover".
export const searchStopWords = new Set(
  (
    'a about across after all also am an and any are as at be been before being between both but by ' +
    'can could did do does doing done during each for from had has have having how i if in into is it ' +
    'its me my no not of on or our over per please should so some than that the their them then there ' +
    'these they this those through to under until up us very was we were what when where which while ' +
    'who whom why will with within would you your ' +
    'area areas context domain domains item items tell show find list search look know'
  ).split(' '),
)

/** A word reduced to a plain form: "accounts" and "account" match, "orders" and "order". */
export function stem(word: string): string {
  let w = word.replace(/'s$/, '').replace(/'/g, '')
  if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y'
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us'))
    w = w.slice(0, -1)
  return w
}

/** A name read in a loose form: the words as they stand in the text, and how they were read. */
export type LooseName = {
  start: number
  end: number
  /** The words, normalised, as the text has them. */
  words: string
  key: string
  by: 'form' | 'initials' | 'part'
}
/**
 * A word that could have named a metric and named none: the metrics, groups and dimensions whose
 * names hold it as a word, by key, and the domain it names, if any; where it is in the text.
 */
export type UnreadWord = {
  word: string
  closest: string[]
  domain?: string
  start: number
  end: number
}

/** The kinds a loose form reads as: a metric, a group of metrics or a dimension, never a value. */
const looseKinds = new Set<Term['kind']>(['metric', 'metric_group', 'dimension'])

/** Words of a question that ask what a name means or how much, never which one: "definition". */
const plainWords = new Set(
  (
    'mean means meaning meant measure measures measured define defined defines definition ' +
    'definitions calculate calculated calculates calculation formula stand stands refer refers ' +
    'number numbers figure figures data anything something everything thing things like known ' +
    'written one ones happen happened today yesterday week weeks month months quarter quarters ' +
    'year years day days'
  ).split(' '),
)

const wordPattern = /[\p{L}\p{N}_']+(?:[-‐‑][\p{L}\p{N}_']+)*/gu
/** The words of a normalised text, each with where it is: a hyphen compound is one word. */
const wordsAt = (text: string) =>
  [...text.matchAll(wordPattern)].map((m) => ({
    word: m[0],
    start: m.index,
    end: m.index + m[0].length,
  }))
const wordsOf = (text: string) => wordsAt(normalizeName(text)).map((w) => w.word)

type Vocabulary = {
  /** Each name's word stems, sorted: another form or order of the name reads the same. */
  forms: Map<string, Set<string>>
  /** Every name and other name, normalised: a window that is one is read whole, not here. */
  exact: Set<string>
  /** The most words a name has. */
  longest: number
  initials: Map<string, Set<string>>
  /** Each word stem of a name, with every term that holds it, values too. */
  holders: Map<string, Set<string>>
  kinds: Map<string, Term['kind']>
  parents: Map<string, string | null>
  names: Map<string, string>
}
const vocabularies = new WeakMap<readonly Term[], Vocabulary>()
function vocabularyOf(terms: readonly Term[]): Vocabulary {
  let v = vocabularies.get(terms)
  if (v) return v
  v = {
    forms: new Map(),
    exact: new Set(terms.flatMap((t) => [t.name, ...t.aliases].map(normalizeName))),
    longest: 1,
    initials: new Map(),
    holders: new Map(),
    kinds: new Map(terms.map((t) => [t.key, t.kind])),
    parents: new Map(terms.map((t) => [t.key, t.parentKey])),
    names: new Map(terms.map((t) => [t.key, t.name])),
  }
  const add = (map: Map<string, Set<string>>, at: string, key: string) =>
    map.set(at, (map.get(at) ?? new Set()).add(key))
  for (const term of terms)
    for (const name of [term.name, ...term.aliases]) {
      const stems = wordsOf(name).map(stem)
      for (const s of stems) add(v.holders, s, term.key)
      if (!looseKinds.has(term.kind) || !stems.length) continue
      add(v.forms, [...stems].sort().join(' '), term.key)
      v.longest = Math.max(v.longest, stems.length)
      for (const short of initialsOf(name)) add(v.initials, short, term.key)
    }
  vocabularies.set(terms, v)
  return v
}

/** A word that says what the question is, or how much, never which thing: "what", "definition". */
const isPlain = (word: string) =>
  word.length < 3 || /^\p{N}/u.test(word) || searchStopWords.has(word) || plainWords.has(word)
/**
 * A word that may stand for a name it is part of: no everyday word, unless it is a noun of a
 * business ("margin", "shipping"), so "new" is never New customers nor "average" Average order
 * value; and no word of a kind of value, so "eur" is never Revenue EUR.
 */
const namesAlone = (word: string) =>
  !isPlain(word) && !isOfAValueKind(word) && (!isEverydayWord(word) || businessNouns.has(word))

/** The free words of a normalised text, and whether words side by side are one run. */
function freeOf(text: string, occupied: ReadonlySet<number>) {
  return wordsAt(text).filter(
    (w) =>
      !Array.from({ length: w.end - w.start }, (_, i) => w.start + i).some((i) => occupied.has(i)),
  )
}
const apart = (text: string, run: readonly { start: number; end: number }[]) =>
  run.some((w, k) => k > 0 && /\S/u.test(text.slice(run[k - 1]!.end, w.start)))

/**
 * The names of two words or more a normalised text holds in another form or order ("customers
 * active" for Active customers, "margins gross"), read before whole names, as a longer phrase is:
 * so "customers" alone is not read as the Customers group there. A run that is a name as written is
 * left to the reader of whole names, with every word of it.
 */
export function looseForms(
  text: string,
  terms: readonly Term[],
  occupied: ReadonlySet<number>,
): LooseName[] {
  const v = vocabularyOf(terms)
  const free = freeOf(text, occupied)
  const used = new Set<number>()
  const found: LooseName[] = []
  for (let size = Math.min(v.longest, free.length); size >= 2; size--)
    for (let i = 0; i + size <= free.length; i++) {
      const run = free.slice(i, i + size)
      if (run.some((_, k) => used.has(i + k)) || apart(text, run)) continue
      const words = text.slice(run[0]!.start, run.at(-1)!.end)
      const keys = v.forms.get(
        run
          .map((w) => stem(w.word))
          .sort()
          .join(' '),
      )
      // A name as written is the whole-name reader's, words and all: no form is read inside it.
      if (v.exact.has(words)) {
        for (let k = i; k < i + size; k++) used.add(k)
        continue
      }
      if (keys?.size !== 1) continue
      for (let k = i; k < i + size; k++) used.add(k)
      found.push({
        start: run[0]!.start,
        end: run.at(-1)!.end,
        words,
        key: [...keys][0]!,
        by: 'form',
      })
    }
  return found.sort((a, b) => a.start - b.start)
}

/**
 * The names of one word a normalised text holds in a loose form, in the places `occupied` leaves
 * free, each once: another form of a one-word name, its initials, or a word only one metric's
 * name holds.
 * `domains` are the domains' names: a word that names one is never read as a metric's word. A group
 * read beside one of its own metrics only says which metric it is ("customer churn" is Churn rate),
 * so it is not read.
 */
export function looseNames(
  text: string,
  terms: readonly Term[],
  occupied: ReadonlySet<number>,
  domains: readonly string[] = [],
  /** The metrics the text names by a whole name, read before this. */
  named: readonly string[] = [],
): LooseName[] {
  const v = vocabularyOf(terms)
  const free = freeOf(text, occupied)
  const used = new Set<number>()
  const found: LooseName[] = []
  const take = (from: number, to: number, key: string, by: LooseName['by']) => {
    for (let i = from; i <= to; i++) used.add(i)
    const start = free[from]!.start
    const end = free[to]!.end
    found.push({ start, end, words: text.slice(start, end), key, by })
  }
  // Another form of a one-word metric's name ("order" for Orders): longer ones are read before
  // whole names (`looseForms`). One word alone is no other form of a group's or a dimension's name:
  // "customer" in "customer happiness score" is no Customers, and "stores" and "campaigns" stay
  // words (value linking, 10 November 2026).
  for (const [i, w] of free.entries()) {
    if (isPlain(w.word)) continue
    const keys = v.forms.get(stem(w.word))
    const [key] = keys?.size === 1 ? [...keys] : []
    if (key && v.kinds.get(key) === 'metric') take(i, i, key, 'form')
  }
  const domainStems = new Set(domains.flatMap(wordsOf).map(stem))
  for (const [i, w] of free.entries()) {
    if (used.has(i) || !namesAlone(w.word)) continue
    const short = v.initials.get(w.word)
    if (short?.size === 1) {
      take(i, i, [...short][0]!, 'initials')
      continue
    }
    const s = stem(w.word)
    // Only the names of metrics, groups and dimensions count: a value's name may hold any word.
    const holders = [...(v.holders.get(s) ?? [])].filter((k) => looseKinds.has(v.kinds.get(k)!))
    const [key] = holders.length === 1 ? holders : []
    if (w.word.length >= 4 && key && v.kinds.get(key) === 'metric' && !domainStems.has(s))
      take(i, i, key, 'part')
  }
  // A group beside one of its own metrics only says which metric is meant.
  const metrics = new Set([
    ...named,
    ...found.filter((f) => v.kinds.get(f.key) === 'metric').map((f) => f.key),
  ])
  return found
    .filter(
      (f) =>
        v.kinds.get(f.key) !== 'metric_group' ||
        ![...metrics].some((m) => v.parents.get(m) === f.key),
    )
    .sort((a, b) => a.start - b.start)
}

/**
 * The words of a normalised text, in the places `occupied` leaves free, that could have named a
 * metric: none that says how, when or how much. Each with the metrics, groups and dimensions
 * whose names hold it as a word ("sales": Gross sales), or none ("EBITDA"), and the domain it
 * names. Said when the words name no metric, so a reply never drops one silently.
 */
export function unreadWords(
  text: string,
  terms: readonly Term[],
  occupied: ReadonlySet<number>,
  domains: readonly string[] = [],
): UnreadWord[] {
  const v = vocabularyOf(terms)
  const seen = new Set<string>()
  return wordsAt(text).flatMap(({ word, start, end }) => {
    const named = [...(v.holders.get(stem(word)) ?? [])].some((k) =>
      looseKinds.has(v.kinds.get(k)!),
    )
    if (isPlain(word) || seen.has(word) || (!named && !namesAlone(word))) return []
    if (Array.from({ length: end - start }, (_, i) => start + i).some((i) => occupied.has(i)))
      return []
    seen.add(word)
    const s = stem(word)
    const closest = [...(v.holders.get(s) ?? [])]
      .filter((key) => looseKinds.has(v.kinds.get(key)!))
      // The plainest first: Revenue before Net revenue, then A to Z.
      .sort((a, b) => {
        const [x, y] = [v.names.get(a)!, v.names.get(b)!]
        return x.length - y.length || x.localeCompare(y, 'en')
      })
    const domain = domains.find((d) => wordsOf(d).map(stem).includes(s))
    return [{ word, closest, ...(domain ? { domain } : {}), start, end }]
  })
}
