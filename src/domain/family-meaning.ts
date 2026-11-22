/*
  What a family of metrics means (FR-142, M1): the family, not one of its variants by accident,
  decides which words Definitions and agents read for it. In this order:

  1. Declared in the source: the words the variants' `meta.footnote.family_description` writes
     for the family, read as written. Nothing written here replaces them.
  2. An owner's choice: one variant's own words, or words written here for the family, each kept
     with its history.
  3. The variants' common words: the description most of them share once each variant's values
     are written as what they stand for ("in {Currency} via {Channel}").
  4. The base variant's words: the one the others are converted from (D2).

  Else the family has no meaning yet. The variants whose own words say something else are always
  named, never hidden: agents read their words beside the meaning.

  Pure: the catalogue and the mock binding work out the same meaning from the same variants.
*/
import { normalizeName } from './vocabulary.ts'

/** Where a family's meaning comes from, in the order above; `none` when nothing gives one. */
export const familyMeaningSources = [
  'declared',
  'member',
  'written',
  'common',
  'base',
  'none',
] as const
export type FamilyMeaningSource = (typeof familyMeaningSources)[number]

/**
 * What an owner chose a family's meaning to be: worked out by the rule (`auto`), one variant's own
 * words, or words written here for the family.
 */
export const familyMeaningChoices = ['auto', 'member', 'written'] as const
export type FamilyMeaningChoice = (typeof familyMeaningChoices)[number]

/** The longest meaning an owner may write for a family. */
export const FAMILY_WORDS_MAX = 1000

/** A variant as its family's meaning reads it: its key, its values and its source's own words. */
export type MeaningVariant = {
  key: string
  /** What tells it apart, in the order of its family's `by`: `["EUR", "web"]`. */
  values: readonly string[]
  description: string | null
}

/** What an owner chose last; null when no owner has chosen. */
export type MeaningChosen = {
  choice: FamilyMeaningChoice
  /** The variant whose words were chosen, by key. */
  member: string | null
  /** The words written for the family. */
  words: string | null
}

export type FamilyMeaning = {
  source: FamilyMeaningSource
  /**
   * The family's meaning. The common words write each value as what it stands for, in braces, by
   * the family's `by` ("{Currency}"); every other source's words are as written. Null for none.
   */
  words: string | null
  /** The variant whose words are the meaning, by key: of `member` and `base`; else null. */
  member: string | null
  /** The words most variants share, values aside, and how many share them; null when most don't. */
  common: { words: string; agree: number } | null
  /** The variant the others are converted from, by key; null when there is no one such variant. */
  base: string | null
  /** The variants whose own words say something else than the meaning, by key. */
  differing: string[]
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A variant's words with each of its values written as what it stands for, in braces: "Money
 * taken in EUR via web" of the EUR web variant is "Money taken in {Currency} via {Channel}". A
 * value is a whole word, in any case; the longest is placed first, so "USD" never splits "USDT".
 */
export function slotted(
  description: string,
  values: readonly string[],
  by: readonly string[],
): string {
  const order = values
    .map((value, i) => ({ value: value.trim(), axis: by[i] }))
    .filter((v): v is { value: string; axis: string } => !!v.value && v.axis !== undefined)
    .sort((a, b) => b.value.length - a.value.length)
  let words = description.replace(/\s+/g, ' ').trim()
  for (const { value, axis } of order)
    words = words.replace(
      new RegExp(`(?<![\\p{L}\\p{N}{])${escape(value)}(?![\\p{L}\\p{N}}])`, 'giu'),
      () => `{${axis}}`,
    )
  return words
}

/** Two variants say the same when their slotted words do, case, spaces and accents aside. */
const sameWords = (words: string) => normalizeName(words)

/**
 * The variant the others are converted from: the one every conversion starts at, never converted
 * itself. Null when the family has no conversion, or they start at more than one variant.
 */
export function baseVariant(conversions: readonly { from: string; to: string }[]): string | null {
  const to = new Set(conversions.map((c) => c.to))
  const from = new Set(conversions.map((c) => c.from).filter((key) => !to.has(key)))
  return from.size === 1 ? [...from][0]! : null
}

/**
 * A family's meaning (M1) from its variants and what tells them apart: declared in the source,
 * else an owner's choice, else the words most variants share, else the base variant's words.
 * `declared` is the source's words for the family; null when it writes none.
 */
export function familyMeaning(family: {
  by: readonly string[]
  variants: readonly MeaningVariant[]
  conversions: readonly { from: string; to: string }[]
  declared: string | null
  chosen: MeaningChosen | null
}): FamilyMeaning {
  const described = family.variants.flatMap((variant) => {
    const own = variant.description?.trim()
    if (!own) return []
    const words = slotted(own, variant.values, family.by)
    return [{ key: variant.key, own, words, same: sameWords(words) }]
  })
  // The words most variants share: more than half of them all, so a family of two needs both.
  const shared = new Map<string, typeof described>()
  for (const variant of described)
    shared.set(variant.same, [...(shared.get(variant.same) ?? []), variant])
  const most = [...shared.values()].sort((a, b) => b.length - a.length)[0] ?? []
  const common =
    most.length >= 2 && most.length * 2 > family.variants.length
      ? { words: most[0]!.words, agree: most.length }
      : null
  const base = baseVariant(family.conversions)
  const ownOf = (key: string | null) => described.find((variant) => variant.key === key)
  const chosen = family.chosen
  const picked = chosen?.choice === 'member' ? ownOf(chosen.member) : undefined
  const written = chosen?.choice === 'written' ? chosen.words?.trim() : undefined
  const declared = family.declared?.trim()
  const meaning: Pick<FamilyMeaning, 'source' | 'words' | 'member'> = declared
    ? { source: 'declared', words: declared, member: null }
    : picked
      ? { source: 'member', words: picked.own, member: picked.key }
      : written
        ? { source: 'written', words: written, member: null }
        : common
          ? { source: 'common', words: common.words, member: null }
          : ownOf(base)
            ? { source: 'base', words: ownOf(base)!.own, member: base }
            : { source: 'none', words: null, member: null }
  // A variant says something else when its words, values aside, are not those of the variant that
  // speaks for the family, else not the common words. With neither, every variant with words of its
  // own says something else.
  const against = ownOf(meaning.member)?.same ?? (common ? sameWords(common.words) : null)
  const differing = described
    .filter((variant) => variant.key !== meaning.member && variant.same !== against)
    .map((variant) => variant.key)
  return { ...meaning, common, base, differing }
}

/**
 * A family's meaning as one plain line, each value it varies by said as what it stands for:
 * "Money taken in each currency via each channel". Braces that name no axis stay as written.
 */
export function meaningLine(words: string, by: readonly string[]): string {
  return words.replace(/\{([^{}]+)\}/g, (slot, axis: string) =>
    by.includes(axis) ? `each ${axis.toLowerCase()}` : slot,
  )
}

/**
 * The values a family's variants hold for each of what tells them apart, each once, in the order
 * the variants first give it: `[["EUR", "USD"], ["web", "app"]]` of a family by Currency and Channel.
 */
export function axisValues(
  by: readonly string[],
  variants: readonly { values: readonly string[] }[],
): string[][] {
  return by.map((_, i) => [
    ...new Set(variants.flatMap((variant) => (variant.values[i] ? [variant.values[i]] : []))),
  ])
}

/** Words people write for a currency in place of its code: a question that says one names it. */
const CURRENCY_WORDS: Readonly<Record<string, readonly string[]>> = {
  EUR: ['euro', 'euros', '€'],
  USD: ['dollar', 'dollars', 'us dollar', 'us dollars', '$'],
  GBP: ['pound', 'pounds', 'sterling', '£'],
  JPY: ['yen', '¥'],
  CHF: ['franc', 'francs'],
  SEK: ['krona', 'kronor'],
  NOK: ['krone', 'kroner'],
  DKK: ['krone', 'kroner'],
  AED: ['dirham', 'dirhams'],
}

/** Whether the words name a value: as written, a whole word in any case, or a currency's name. */
function namesValue(words: string, value: string) {
  const said = [value, ...(CURRENCY_WORDS[value.trim().toUpperCase()] ?? [])]
  return said.some((v) =>
    /^\p{L}/u.test(v)
      ? new RegExp(`(?<![\\p{L}\\p{N}])${escape(v.trim())}(?![\\p{L}\\p{N}])`, 'iu').test(words)
      : words.includes(v),
  )
}

/**
 * The variant a question that names a family means (F3): its usual variant, once an owner picked
 * one, when the words name none of the values its variants hold. Null when no usual variant is
 * picked, or the words name any value: a question about revenue in USD is about USD, whatever the
 * usual variant is.
 */
export function usualVariant<V extends { key: string; values: readonly string[] }>(
  words: string,
  family: { usual: string | null; variants: readonly V[] },
): V | null {
  const usual = family.variants.find((variant) => variant.key === family.usual)
  if (!usual) return null
  const named = family.variants.some((variant) =>
    variant.values.some((value) => !!value.trim() && namesValue(words, value)),
  )
  return named ? null : usual
}
