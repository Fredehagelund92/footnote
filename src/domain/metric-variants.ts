/*
  Metrics that look like variants of a few: a model with a metric per currency or per channel
  ("revenue_eur_web", "revenue_usd_web", "tax_eur_web"...) instead of one metric with currency
  and channel as dimensions. Test connection says so before the names are published, as Footnote
  works best with the dimensions (docs/help/metric-variants.md). It reads only the members' names,
  so it is a guess: it can be wrong now and then, and it only warns.

  A word at the end of a name is a variant when the same words follow many other names: "eur",
  "usd" and "gbp" each end "revenue_", "tax_" and "refunds_". Those words are taken off, and the
  next ones are tried, so "revenue_eur_web" is Revenue split by channel and by currency. The start
  of the names is read the same way, for a model that names its variants first ("eur_revenue").
  Each time the side whose words split more names goes first: read the other way, the measures'
  own names ("revenue", "tax") would look like the variants of each currency. One split is one
  way of splitting: words that stand in for each other after the same names, so a currency and a
  product line that both end names ("revenue_eur", "revenue_eur_tents") are two splits.

  A group whose names all start with the same words, often its own name ("paid_search_clicks",
  "paid_search_spend_eur"), has them taken off first: across groups, the measures after them
  ("clicks", "impressions") would read as variants of each group. The words that split the most
  names are named first, and a split of currencies names their codes in capitals.
*/

/** A word in this many names, each with siblings, is a variant: fewer is a coincidence. */
const NAMES_PER_WORD = 3
/** The fewest metrics that look like variants before Test connection says so. */
const VARIANTS_MIN = 20
/** And the least share of the metrics they are. */
const SHARE_MIN = 0.25
/** The words of a split a warning names. */
const EXAMPLES = 3

/** What a source's metrics look like, when many look like variants of a few. */
export type VariantShape = {
  /** Metrics that look like variants. */
  variants: number
  /** Every metric read. */
  metrics: number
  /** How many metrics the variants are of. */
  bases: number
  /** Each way they are split: how many words, and those that split the most names, as said. */
  splits: { words: number; examples: string[] }[]
}

type Entry = { words: string[]; variant: boolean }

/** The currency codes, as a split of currencies writes them. */
const currencies = new Set(Intl.supportedValuesOf('currency').map((code) => code.toLowerCase()))

/** A split's words as said: currency codes in capitals when most of its words are codes. */
function said(words: readonly string[], all: ReadonlySet<string>) {
  const codes = [...all].filter((word) => currencies.has(word)).length
  return codes * 2 >= all.size
    ? words.map((word) => (currencies.has(word) ? word.toUpperCase() : word))
    : [...words]
}

/**
 * The words one side of the names splits them by: each word that ends (or starts) at least three
 * names, each of which shares the rest of its name with another word there, and of those, the
 * ones that stand in for each other, as one split; and the names it splits. Null when no two
 * words do.
 */
function splitOn(entries: Entry[], side: 'end' | 'start') {
  const restOf = (words: string[]) =>
    (side === 'end' ? words.slice(0, -1) : words.slice(1)).join('_')
  const wordOf = (words: string[]) => (side === 'end' ? words.at(-1)! : words[0]!)
  const siblings = new Map<string, Set<string>>()
  for (const { words } of entries) {
    if (words.length < 2) continue
    const rest = restOf(words)
    const seen = siblings.get(rest) ?? new Set<string>()
    seen.add(wordOf(words))
    siblings.set(rest, seen)
  }
  const names = new Map<string, number>()
  for (const words of siblings.values())
    if (words.size >= 2) for (const word of words) names.set(word, (names.get(word) ?? 0) + 1)
  const often = new Set([...names].filter(([, n]) => n >= NAMES_PER_WORD).map(([word]) => word))
  // The words that follow the same names stand in for each other: each such set is one split.
  const together = new Map<string, string>([...often].map((word) => [word, word]))
  const top = (word: string): string => {
    const up = together.get(word)!
    return up === word ? word : top(up)
  }
  for (const words of siblings.values()) {
    const [first, ...rest] = [...words].filter((word) => often.has(word))
    for (const word of rest) together.set(top(word), top(first!))
  }
  const ways = new Map<string, Set<string>>()
  for (const word of often) ways.set(top(word), (ways.get(top(word)) ?? new Set()).add(word))
  const splitBy = (split: Set<string>) =>
    entries.filter(
      ({ words }) =>
        words.length >= 2 &&
        split.has(wordOf(words)) &&
        (siblings.get(restOf(words))?.size ?? 0) >= 2,
    )
  // The way that splits the most names.
  const [split, splits] = [...ways.values()]
    .filter((way) => way.size >= 2)
    .map((way) => [way, splitBy(way)] as const)
    .reduce<readonly [Set<string>, Entry[]] | [null, []]>(
      (best, way) => (way[1].length > best[1].length ? way : best),
      [null, []],
    )
  if (!split) return null
  // The side is weighed by every name its words split, as one split could leave the measures'
  // own names the bigger side.
  const weight = splitBy(often).length
  // The words that split the most names first, then in the order the names give them: "eur,
  // usd, gbp" as the tool lists the currencies.
  const order = [...new Set(splits.map(({ words }) => wordOf(words)))].sort(
    (a, b) => names.get(b)! - names.get(a)!,
  )
  return {
    weight,
    found: { words: order.length, examples: said(order.slice(0, EXAMPLES), split) },
    apply: () => {
      for (const entry of splits) {
        entry.words = side === 'end' ? entry.words.slice(0, -1) : entry.words.slice(1)
        entry.variant = true
      }
    },
  }
}

/**
 * How many words every name of a group starts with, to be taken off: those of the group's own
 * name ("paid_search_clicks" in "paid_search"), and none for a measure the names share
 * ("revenue_eur", "revenue_net_eur"), which stays to tell the measures apart.
 */
function sharedStart(group: string, entries: readonly { words: string[] }[]) {
  const own = group
    .slice(group.lastIndexOf('.') + 1)
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
  const shared = entries.every((entry) => own.every((word, at) => entry.words[at] === word))
  return shared ? own.length : 0
}

/**
 * Whether these metric names look like variants of a few, and how: null when too few do. A name
 * is read after its view or model (`sales.revenue_eur` is `revenue_eur`), in words split at `_`.
 */
export function variantShape(names: readonly string[]): VariantShape | null {
  const read = names.map((name) => ({
    group: name.slice(0, Math.max(0, name.lastIndexOf('.'))),
    words: name
      .slice(name.lastIndexOf('.') + 1)
      .toLowerCase()
      .split(/[_\s-]+/)
      .filter(Boolean),
  }))
  const groups = new Map<string, typeof read>()
  for (const entry of read) {
    const group = groups.get(entry.group)
    if (group) group.push(entry)
    else groups.set(entry.group, [entry])
  }
  const entries: Entry[] = read.map(({ group, words }) => {
    const shared = sharedStart(group, groups.get(group)!)
    return { words: shared ? words.slice(shared) : words, variant: false }
  })
  const splits: VariantShape['splits'] = []
  // Each time, the side whose words split more names: a measure's name splits fewer than the
  // words that follow every measure.
  for (;;) {
    const [split] = [splitOn(entries, 'end'), splitOn(entries, 'start')]
      .filter((found) => found !== null)
      .sort((a, b) => b.weight - a.weight)
    if (!split) break
    split.apply()
    splits.push(split.found)
  }
  const variants = entries.filter((entry) => entry.variant)
  if (variants.length < VARIANTS_MIN || variants.length < names.length * SHARE_MIN) return null
  return {
    variants: variants.length,
    metrics: names.length,
    bases: new Set(variants.map((entry) => entry.words.join('_'))).size,
    splits,
  }
}
