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
  own names ("revenue", "tax") would look like the variants of each currency.
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
  /** Each way they are split, in the order the names have them: how many words, and the first. */
  splits: { words: number; examples: string[] }[]
}

type Entry = { words: string[]; variant: boolean }

/**
 * The words one side of the names splits them by: each word that ends (or starts) at least three
 * names, each of which shares the rest of its name with another word there; and the names it
 * splits. Null when no word does.
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
  const split = new Set([...names].filter(([, n]) => n >= NAMES_PER_WORD).map(([word]) => word))
  if (split.size < 2) return null
  const splits = entries.filter(
    ({ words }) =>
      words.length >= 2 &&
      split.has(wordOf(words)) &&
      (siblings.get(restOf(words))?.size ?? 0) >= 2,
  )
  // In the order the names give them: "eur, usd, gbp" as the tool lists the currencies.
  const order = [...new Set(splits.map(({ words }) => wordOf(words)))]
  return {
    splits,
    found: { words: order.length, examples: order.slice(0, EXAMPLES) },
    apply: () => {
      for (const entry of splits) {
        entry.words = side === 'end' ? entry.words.slice(0, -1) : entry.words.slice(1)
        entry.variant = true
      }
    },
  }
}

/**
 * Whether these metric names look like variants of a few, and how: null when too few do. A name
 * is read after its view or model (`sales.revenue_eur` is `revenue_eur`), in words split at `_`.
 */
export function variantShape(names: readonly string[]): VariantShape | null {
  const entries: Entry[] = names.map((name) => ({
    words: name
      .slice(name.lastIndexOf('.') + 1)
      .toLowerCase()
      .split(/[_\s-]+/)
      .filter(Boolean),
    variant: false,
  }))
  const splits: VariantShape['splits'] = []
  // Each time, the side whose words split more names: a measure's name splits fewer than the
  // words that follow every measure.
  for (;;) {
    const [split] = [splitOn(entries, 'end'), splitOn(entries, 'start')]
      .filter((found) => found !== null)
      .sort((a, b) => b.splits.length - a.splits.length)
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
