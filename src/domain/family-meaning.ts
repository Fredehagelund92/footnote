/*
  What a family of metrics means (FR-142, M1): the family, not one of its variants by accident,
  decides which words Definitions and agents read for it. In this order:

  1. Declared in the source: the words the variants' `meta.footnote.family_description` writes
     for the family, read as written. Nothing written here replaces them.
  2. An owner's choice: one variant's own words, or words written here for the family, each kept
     with its history.
  3. The variants' common words: the description most of them share once each variant's values
     are written as what they stand for ("in {Currency} via {Channel}"), a note on how a value is
     converted from another ("in USD (EUR × the row's rate)") with it. When no description is
     most of theirs, the one most of them hold within their own words, saying more around it.
  4. The base variant's words: the one the others are converted from (D2), its values as slots.

  Else the family has no meaning yet. The variants whose own words say something else than the
  meaning are always named, never hidden: agents read their words beside the meaning. With no
  meaning, there is nothing to say something else than, and agents read every variant's words.

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
   * The family's meaning. The common words and the base variant's write each value as what it
   * stands for, in braces, by the family's `by` ("{Currency}"); every other source's words are as
   * written. Null for none.
   */
  words: string | null
  /** The variant whose words are the meaning, by key: of `member` and `base`; else null. */
  member: string | null
  /**
   * The words most variants share, values aside, and how many share them: the same words, else
   * words most of them hold within their own. Null when most don't.
   */
  common: { words: string; agree: number } | null
  /** The variant the others are converted from, by key; null when there is no one such variant. */
  base: string | null
  /**
   * The words the rule gives, any declared words or owner's choice aside: the common words, else
   * the base variant's with its values as slots. Null when it gives none.
   */
  automatic: string | null
  /** The variants whose own words say something else than the meaning, by key. */
  differing: string[]
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Words that say a value is worked out from another one at a rate. */
const RATE_WORDS =
  /(?<![\p{L}\p{N}])(?:rates?|fx|exchange|convert(?:ed|s)?|conversion)(?![\p{L}\p{N}])/iu

/**
 * A variant's words with each of its values written as what it stands for, in braces: "Money
 * taken in EUR via web" of the EUR web variant is "Money taken in {Currency} via {Channel}". A
 * value is a whole word, in any case, never part of a name such as `fees_eur`; the longest is
 * placed first, so "USD" never splits "USDT".
 * A note in brackets right after a value that names another value of its axis (`axes`, each
 * axis's values in the order of `by`) or a rate says how the value is converted, and goes with
 * it: "in USD (EUR × row exchange_rate_usd)" is "in {Currency}".
 */
export function slotted(
  description: string,
  values: readonly string[],
  by: readonly string[],
  axes: readonly (readonly string[])[] = [],
): string {
  const order = values
    .map((value, i) => ({ value: value.trim(), axis: by[i], others: axes[i] ?? [] }))
    .filter(
      (v): v is { value: string; axis: string; others: readonly string[] } =>
        !!v.value && v.axis !== undefined,
    )
    .sort((a, b) => b.value.length - a.value.length)
  let words = description.replace(/\s+/g, ' ').trim()
  for (const { value, axis, others } of order) {
    const converts = (note: string) =>
      RATE_WORDS.test(note) ||
      others.some((other) => other.trim() && other !== value && namesValue(note, other))
    words = words.replace(
      new RegExp(
        `(?<![\\p{L}\\p{N}_{])${escape(value)}(?![\\p{L}\\p{N}_}])(\\s*\\([^()]*\\))?`,
        'giu',
      ),
      (_all, note: string | undefined) =>
        note && !converts(note) ? `{${axis}}${note}` : `{${axis}}`,
    )
  }
  return words
}

/**
 * A variant's own words as its family's meaning compares them: slotted, and as compared (case,
 * spaces and accents aside, without the "…" of a copy cut short).
 */
type Said = { key: string; own: string; words: string; same: string; cut: boolean }

/**
 * Two variants say the same when their slotted words do, case, spaces and accents aside. A copy
 * cut short ("…", as Footnote keeps a long description) says the same as words that go on from
 * where it stops: a longer note in one moves where its copy stops.
 */
function sameAs(a: Said, b: Said) {
  const goesOn = (words: string, kept: string) =>
    words.startsWith(kept) && !/[\p{L}\p{N}]/u.test(words.charAt(kept.length))
  return a.same === b.same || (a.cut && goesOn(b.same, a.same)) || (b.cut && goesOn(a.same, b.same))
}

/** Words by their sentences. */
const sentences = (words: string) => words.split(/(?<=[.!?])\s+/)

/**
 * Whether some sentences hold others whole, in a row: "A. B. C." holds "B. C.", never "B" nor
 * "A. C.".
 */
const holds = (all: readonly string[], run: readonly string[]) =>
  all.some((_, at) => run.every((sentence, i) => all[at + i] === sentence))

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
  const axes = axisValues(family.by, family.variants)
  const described = family.variants.flatMap((variant): Said[] => {
    const own = variant.description?.trim()
    if (!own) return []
    const words = slotted(own, variant.values, family.by, axes)
    const cut = words.endsWith('…')
    return [
      { key: variant.key, own, words, same: normalizeName(cut ? words.slice(0, -1) : words), cut },
    ]
  })
  // Most variants: more than half of them all, so a family of two needs both.
  const most = (n: number) => n >= 2 && n * 2 > family.variants.length
  // Each wording once, with how many variants write it, a whole copy over one cut short: a family
  // of hundreds writes a few, so each wording is compared with each other one, not each variant.
  const wordings = new Map<string, { said: Said; count: number; sentences: string[] }>()
  for (const variant of described) {
    const seen = wordings.get(variant.same)
    if (seen) {
      seen.count++
      if (seen.said.cut && !variant.cut) seen.said = variant
    } else
      wordings.set(variant.same, { said: variant, count: 1, sentences: sentences(variant.same) })
  }
  const all = [...wordings.values()]
  const agreeing = (test: (a: (typeof all)[number], b: (typeof all)[number]) => boolean) =>
    all.map((a) => ({ ...a, agree: all.reduce((n, b) => n + (test(b, a) ? b.count : 0), 0) }))
  // The words most variants share; else the words most of them hold within their own, the fewest.
  const alike = agreeing((b, a) => sameAs(a.said, b.said)).sort(
    (a, b) => b.agree - a.agree || Number(a.said.cut) - Number(b.said.cut),
  )[0]
  const within = agreeing((b, a) => holds(b.sentences, a.sentences)).sort(
    (a, b) => b.agree - a.agree || a.said.same.length - b.said.same.length,
  )[0]
  const shared = alike && most(alike.agree) ? alike : within && most(within.agree) ? within : null
  const common = shared && { words: shared.said.words, agree: shared.agree }
  const base = baseVariant(family.conversions)
  const ownOf = (key: string | null) => described.find((variant) => variant.key === key)
  const chosen = family.chosen
  const picked = chosen?.choice === 'member' ? ownOf(chosen.member) : undefined
  const written = chosen?.choice === 'written' ? chosen.words?.trim() : undefined
  const declared = family.declared?.trim()
  const automatic: Pick<FamilyMeaning, 'source' | 'words' | 'member'> = common
    ? { source: 'common', words: common.words, member: null }
    : ownOf(base)
      ? { source: 'base', words: ownOf(base)!.words, member: base }
      : { source: 'none', words: null, member: null }
  const meaning: Pick<FamilyMeaning, 'source' | 'words' | 'member'> = declared
    ? { source: 'declared', words: declared, member: null }
    : picked
      ? { source: 'member', words: picked.own, member: picked.key }
      : written
        ? { source: 'written', words: written, member: null }
        : automatic
  // A variant says something else when its words, values aside, are not those of the variant that
  // speaks for the family, else not the common words. With no meaning, none does.
  const against = ownOf(meaning.member) ?? shared?.said
  const differing = meaning.words
    ? described
        .filter(
          (variant) => variant.key !== meaning.member && !(against && sameAs(variant, against)),
        )
        .map((variant) => variant.key)
    : []
  return { ...meaning, common, base, automatic: automatic.words, differing }
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
