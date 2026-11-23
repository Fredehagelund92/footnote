import { searchStopWords, stem } from './context-search.ts'
import { namesOf, normalizeName, phrasesIn, type Term } from './vocabulary.ts'

/*
  The order of what applies, by the question's own words (decided 23 November 2026: one engine and
  one order, for Ask and for agents alike). Among the items that apply, those whose title, summary
  and not-to-conclude line hold the words of the question that name no metric, value or domain
  come first (its dates' words count: an item titled with the question's month is often the one
  meant), a rarer word weighing more; between equals the engine keeps its order (whole
  matches first, higher risk, newer start, then id). "Is the gross margin number reliable?" then
  gives the items titled "not reliable" first, where risk and date alone left them 39th and 48th.

  A pure function of the words and the edition: the same question gets the same items for everyone
  who may read them. The words are read in memory only and are never part of what is returned
  (FR-602).
*/

/** An item as its words are read: its title, summary and what not to conclude from it. */
export type WordedItem = {
  id: string
  title?: string
  summary: string
  notToConclude?: string | null
}

/** Words of a question that say nothing about which item is meant. */
const questionWordsOnly = new Set(
  'anything something everything number numbers figure figures data like known written one ones thing things'.split(
    ' ',
  ),
)

const wordsOf = (text: string) =>
  normalizeName(text).match(/[\p{L}\p{N}_']+(?:[-‐‑][\p{L}\p{N}_']+)*/gu) ?? []

/**
 * The words of a question that order what applies, as stems: those outside the names it holds
 * (metrics, groups, dimensions, values, domains), that are no word of a metric's, group's or
 * dimension's name and no common word. "Is the gross margin number reliable in June?" gives
 * "reliable" and "june".
 */
export function questionWords(
  question: string,
  terms: readonly Term[],
  areas: readonly { name: string }[],
): string[] {
  const text = normalizeName(question)
  if (!text) return []
  const { occupied } = phrasesIn(text, [
    ...terms.flatMap(namesOf),
    ...areas.map((area) => normalizeName(area.name)),
  ])
  const named = vocabularyStems(terms)
  const rest = [...text].map((char, i) => (occupied.has(i) ? ' ' : char)).join('')
  return [
    ...new Set(
      wordsOf(rest)
        .filter(
          (word) => word.length > 1 && !searchStopWords.has(word) && !questionWordsOnly.has(word),
        )
        .map(stem)
        .filter((word) => !named.has(word)),
    ),
  ]
}

/** The stems of the words of every metric's, group's and dimension's name: vocabulary words. */
const namedStems = new WeakMap<readonly Term[], Set<string>>()
function vocabularyStems(terms: readonly Term[]) {
  let stems = namedStems.get(terms)
  if (!stems) {
    stems = new Set(
      terms
        .filter((term) => term.kind !== 'dimension_value')
        .flatMap((term) => [term.name, ...term.aliases])
        .flatMap(wordsOf)
        .map(stem),
    )
    namedStems.set(terms, stems)
  }
  return stems
}

type Index = { stems: Map<string, Set<string>>; rarity: (stem: string) => number }
const indexes = new WeakMap<readonly WordedItem[], Index>()
/** Each item's word stems, and how rare a stem is among the items of the edition. */
function indexOf(items: readonly WordedItem[]): Index {
  let index = indexes.get(items)
  if (!index) {
    const stems = new Map(
      items.map((item) => [
        item.id,
        new Set(
          wordsOf(`${item.title ?? ''} ${item.summary} ${item.notToConclude ?? ''}`).map(stem),
        ),
      ]),
    )
    const counts = new Map<string, number>()
    for (const set of stems.values())
      for (const word of set) counts.set(word, (counts.get(word) ?? 0) + 1)
    const n = items.length
    index = {
      stems,
      rarity: (word) => Math.log(1 + n / (1 + (counts.get(word) ?? 0))),
    }
    indexes.set(items, index)
  }
  return index
}

/**
 * How much of the question's words an item of the edition holds: each word it holds, weighed by
 * how rare the word is among the edition's items. 0 for an item that holds none.
 */
export function questionScore(
  items: readonly WordedItem[],
  words: readonly string[],
): (id: string) => number {
  if (!words.length) return () => 0
  const { stems, rarity } = indexOf(items)
  return (id) => {
    const own = stems.get(id)
    return own ? words.reduce((sum, word) => sum + (own.has(word) ? rarity(word) : 0), 0) : 0
  }
}
