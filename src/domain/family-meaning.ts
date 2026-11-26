/*
  What a family of metrics means (FR-142, M1): the family, not one of its variants by accident,
  decides which words Definitions and agents read for it. In this order:

  1. Declared in the source: the words the variants' `meta.footnote.family_description` writes
     for the family, read as written. Nothing written here replaces them.
  2. Written by an owner: words written here for the family, as written.
  3. Worked out from its variants: the description more than half of them share once each
     variant's values are written as what they stand for ("in {Currency} via {Channel}"), a
     currency's name like its code, a note on how a value is converted from another ("in USD
     (EUR × the row's rate)") with it. When no description is most of theirs, the one most of
     them hold within their own words, saying more around it. A value is a slot only where the
     variants' words differ: a word another variant, holding another value, writes beside the
     same word is a word ("a free trial" beside a plan named Free).
     A variant that says how it is worked out from another (it is converted from one, or its
     words name a rate and another variant's value, or, by Currency, it is the only one whose words
     name a rate, and they name its own currency) has no say: when one variant is left, the
     one the others are converted from, its words are the meaning. Words that still name a value
     read as one variant, so they are never the family's ("in euros" of a EUR and USD family).

  Else the family has no meaning yet. The variants whose own words say something else than the
  meaning are always named, never hidden: agents read their words beside the meaning. With no
  meaning, there is nothing to say something else than, and agents read every variant's words.

  Pure: the catalogue and the mock binding work out the same meaning from the same variants.
*/
import { isCurrencyCode } from './currencies.ts'
import { meaningLine, type FamilyMeaningSource, type MeaningChosen } from './family-meaning-line.ts'
import { normalizeName } from './normalize-name.ts'

/** A variant as its family's meaning reads it: its key, its values and its source's own words. */
export type MeaningVariant = {
  key: string
  /** What tells it apart, in the order of its family's `by`: `["EUR", "web"]`. */
  values: readonly string[]
  description: string | null
}

export type FamilyMeaning = {
  source: FamilyMeaningSource
  /**
   * The family's meaning. The common words write each value as what it stands for, in braces, by
   * the family's `by` ("{Currency}"); every other source's words are as written. Null for none.
   */
  words: string | null
  /**
   * The words most variants share, values aside, and how many share them: the same words, else
   * words most of them hold within their own. Null when most don't, or the words name a value.
   */
  common: { words: string; agree: number } | null
  /**
   * The variant the others are converted from, by key, when the common words are its alone: each
   * other variant is converted from one or says how it is worked out from another. Else null.
   */
  base: string | null
  /** The words the rule gives, any declared words or owner's choice aside. Null when none. */
  automatic: string | null
  /** The variants whose own words say something else than the meaning, by key. */
  differing: string[]
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Words that say a value is worked out from another one at a rate. */
export const RATE_WORDS =
  /(?<![\p{L}\p{N}])(?:rates?|fx|exchange|convert(?:ed|s)?|conversion)(?![\p{L}\p{N}])/iu

/** Words that say a variant is converted from another, which a bare "rate" does not. */
const CONVERTED_WORDS = /(?<![\p{L}\p{N}])(?:convert(?:ed|s)?|fx|exchange)(?![\p{L}\p{N}])/iu

/** Words people write for a currency in place of its code: a question that says one names it. */
const CURRENCY_WORDS: Readonly<Record<string, readonly string[]>> = {
  EUR: ['euro', 'euros', '€'],
  USD: ['dollar', 'dollars', 'us dollar', 'us dollars', '$'],
  GBP: ['pound', 'pounds', 'pounds sterling', 'sterling', '£'],
  JPY: ['yen', '¥'],
  CHF: ['franc', 'francs'],
  SEK: ['krona', 'kronor'],
  NOK: ['krone', 'kroner'],
  DKK: ['krone', 'kroner'],
  AED: ['dirham', 'dirhams'],
}

/** A currency's names in words ("euros" of EUR), longest first; none for any other value. */
const namesOf = (value: string) =>
  (CURRENCY_WORDS[value.trim().toUpperCase()] ?? []).filter((name) => /^\p{L}/u.test(name))

/** A value written as a code, in capitals: "EUR", "IN", "EMEA". */
const isCode = (value: string) => /^\p{Lu}[\p{Lu}\p{N}]+$/u.test(value.trim())

/** A whole word or words, never part of a longer word; `_` joins words into an id. */
const whole = (text: string, flags: string, ids = false) =>
  new RegExp(
    ids
      ? `(?<![\\p{L}\\p{N}])${escape(text)}(?![\\p{L}\\p{N}])`
      : `(?<![\\p{L}\\p{N}_{])${escape(text)}(?![\\p{L}\\p{N}_}])`,
    flags,
  )

/**
 * Whether words name a value of another variant, as a variant that says how it is worked out from
 * that one does: a code as written ("EUR"), or in lower case in an id (`amount_eur`); any other
 * value in any case; a currency by its name ("from euros").
 */
function mentions(words: string, value: string) {
  const v = value.trim()
  if (!v) return false
  const code = isCode(v)
  return (
    whole(v, code ? 'u' : 'iu', true).test(words) ||
    (code && new RegExp(`_${escape(v.toLowerCase())}(?![\\p{L}\\p{N}])`, 'u').test(words)) ||
    namesOf(v).some((name) => whole(name, 'iu', true).test(words))
  )
}

/**
 * Whether words still name a value, so they would read as one variant: a code as written, or a
 * currency's name, outside an id such as `refunds_eur`. A word that is a value too ("free", "in")
 * is a word.
 */
const namesOne = (words: string, value: string) =>
  (isCode(value) && whole(value.trim(), 'u').test(words)) ||
  namesOf(value).some((name) => whole(name, 'iu').test(words))

/**
 * The variants whose words say how they are worked out from another: a rate, and a value another
 * variant holds ("The EUR amount multiplied by the row's exchange rate", of the USD one). The
 * source's words, never Footnote's guess. `axes` are each axis's values (`axisValues`).
 */
export function worksOut(
  variant: { values: readonly string[]; description: string | null },
  axes: readonly (readonly string[])[],
): boolean {
  const words = variant.description?.trim()
  if (!words || !RATE_WORDS.test(words)) return false
  return axes.some((values, i) =>
    values.some(
      (value) =>
        normalizeName(value) !== normalizeName(variant.values[i] ?? '') && mentions(words, value),
    ),
  )
}

/**
 * The variants of a family worked out from another, which have no say in its meaning: those
 * converted from one (`conversions`), those whose words name a rate and another variant's value
 * (`worksOut`), and, in a family by Currency (an axis whose values are all currency codes), the one
 * variant whose own words say it is converted and name its own currency when no other's do ("Payouts converted to USD at each month's rate", C3).
 * `axes` are each axis's values (`axisValues`).
 */
export function workedOut(
  family: {
    by: readonly string[]
    variants: readonly { key: string; values: readonly string[]; description: string | null }[]
    conversions: readonly { to: string }[]
  },
  axes: readonly (readonly string[])[] = axisValues(family.by, family.variants),
): Set<string> {
  const converted = new Set(family.conversions.map((c) => c.to))
  const derived = new Set(
    family.variants
      .filter((variant) => converted.has(variant.key) || worksOut(variant, axes))
      .map((variant) => variant.key),
  )
  const currency = axes.findIndex((values) => values.length > 0 && values.every(isCurrencyCode))
  if (currency < 0) return derived
  const free = family.variants.filter((variant) => !derived.has(variant.key))
  const rated = free.filter((variant) => CONVERTED_WORDS.test(variant.description ?? ''))
  const [own] = rated
  if (free.length >= 2 && rated.length === 1 && own?.values[currency])
    if (mentions(own.description!, own.values[currency])) derived.add(own.key)
  return derived
}

/** A text's words as runs, each run the words written one after another with only spaces between. */
const runsOf = (text: string) =>
  text
    .split(/[^\p{L}\p{N}_\s]+/u)
    .map((run) => run.toLowerCase().split(/\s+/).filter(Boolean))
    .filter((run) => run.length)

/**
 * The words variants write beside a value of each axis, and which values those variants hold:
 * "a free" of a plan named Plus, whose words say "including those on a free trial", is written
 * by a variant holding Plus. A value its variant writes beside a word another one writes beside
 * it, holding another value, is a word, not a slot.
 */
type Beside = Map<string, Set<string>>[]

function besideOf(
  by: readonly string[],
  variants: readonly MeaningVariant[],
  axes: readonly (readonly string[])[],
): Beside {
  return by.map((_, i) => {
    // Each form of the axis's values by its first word, as words in lower case.
    const forms = new Map<string, string[][]>()
    for (const value of axes[i] ?? [])
      for (const form of [value, ...namesOf(value)]) {
        const words = form.trim().toLowerCase().split(/\s+/).filter(Boolean)
        if (words.length) forms.set(words[0]!, [...(forms.get(words[0]!) ?? []), words])
      }
    const beside = new Map<string, Set<string>>()
    const add = (phrase: string, holds: string) =>
      beside.set(phrase, (beside.get(phrase) ?? new Set()).add(holds))
    for (const variant of variants) {
      if (!variant.description?.trim()) continue
      const holds = normalizeName(variant.values[i] ?? '')
      for (const run of runsOf(variant.description))
        run.forEach((word, at) => {
          for (const form of forms.get(word) ?? []) {
            if (!form.every((w, k) => run[at + k] === w)) continue
            const said = form.join(' ')
            if (at > 0) add(`${run[at - 1]} ${said}`, holds)
            if (at + form.length < run.length) add(`${said} ${run[at + form.length]}`, holds)
          }
        })
    }
    return beside
  })
}

/**
 * A variant's words with each of its values written as what it stands for, in braces: "Money
 * taken in EUR via web" of the EUR web variant is "Money taken in {Currency} via {Channel}". A
 * value is a whole word, in any case, or a currency's name ("in euros"), never part of a name such
 * as `fees_eur`; the longest is placed first, so "USD" never splits "USDT".
 * A note in brackets right after a value that names another value of its axis (`axes`, each
 * axis's values in the order of `by`) or a rate says how the value is converted, and goes with
 * it: "in USD (EUR × row exchange_rate_usd)" is "in {Currency}".
 * Given what the family's variants write beside each axis's values (`beside`), a value another
 * variant holding another value writes beside the same word stays a word.
 */
export function slotted(
  description: string,
  values: readonly string[],
  by: readonly string[],
  axes: readonly (readonly string[])[] = [],
  beside: Beside = [],
): string {
  const order = values
    .flatMap((value, i) =>
      value.trim() && by[i] !== undefined
        ? [value.trim(), ...namesOf(value)].map((form) => ({
            form,
            value: value.trim(),
            axis: by[i]!,
            i,
          }))
        : [],
    )
    .sort((a, b) => b.form.length - a.form.length)
  let words = description.replace(/\s+/g, ' ').trim()
  for (const { form, value, axis, i } of order) {
    const others = axes[i] ?? []
    const converts = (note: string) =>
      RATE_WORDS.test(note) ||
      others.some((other) => other.trim() && other !== value && namesValue(note, other))
    const holds = normalizeName(value)
    const elsewhere = (phrase: string) =>
      [...(beside[i]?.get(phrase.toLowerCase()) ?? [])].some((other) => other !== holds)
    words = words.replace(
      new RegExp(
        `(?<![\\p{L}\\p{N}_{])${escape(form)}(?![\\p{L}\\p{N}_}])(\\s*\\([^()]*\\))?`,
        'giu',
      ),
      (all: string, note: string | undefined, at: number, text: string) => {
        const said = all.slice(0, all.length - (note?.length ?? 0))
        const before = /([\p{L}\p{N}_]+)\s+$/u.exec(text.slice(0, at))?.[1]
        const after = /^\s+([\p{L}\p{N}_]+)/u.exec(text.slice(at + said.length))?.[1]
        if ((before && elsewhere(`${before} ${said}`)) || (after && elsewhere(`${said} ${after}`)))
          return all
        return note && !converts(note) ? `{${axis}}${note}` : `{${axis}}`
      },
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

/** Each variant with words of its own, its values as slots. */
function saidOf(
  family: { by: readonly string[]; variants: readonly MeaningVariant[] },
  axes = axisValues(family.by, family.variants),
): Said[] {
  const beside = besideOf(family.by, family.variants, axes)
  return family.variants.flatMap((variant): Said[] => {
    const own = variant.description?.trim()
    if (!own) return []
    const words = slotted(own, variant.values, family.by, axes, beside)
    const cut = words.endsWith('…')
    return [
      { key: variant.key, own, words, same: normalizeName(cut ? words.slice(0, -1) : words), cut },
    ]
  })
}

/**
 * A family's meaning (M1) from its variants and what tells them apart: declared in the source,
 * else words an owner wrote, else the words most variants share. `declared` is the source's words
 * for the family; null when it writes none.
 */
export function familyMeaning(family: {
  by: readonly string[]
  variants: readonly MeaningVariant[]
  conversions: readonly { from: string; to: string }[]
  declared: string | null
  chosen: MeaningChosen | null
}): FamilyMeaning {
  const axes = axisValues(family.by, family.variants)
  // A variant converted from another, or whose words say how it is worked out from one, has no say.
  const derived = workedOut(family, axes)
  const described = saidOf(family, axes).filter((variant) => !derived.has(variant.key))
  // The variants that have a say: all but those worked out from another.
  const pool = family.variants.length - derived.size
  // The one left when every other is worked out from another speaks for the family.
  const alone = pool === 1 && derived.size > 0
  // Most variants: more than half of those that have a say, so a family of two needs both.
  const most = (n: number) => (n >= 2 || alone) && n * 2 > pool
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
  // Words that still name a value read as one variant: no meaning for the family.
  const named = shared && axes.flat().some((value) => namesOne(shared.said.words, value))
  const common = shared && !named ? { words: shared.said.words, agree: shared.agree } : null
  const written = family.chosen?.choice === 'written' ? family.chosen.words?.trim() : undefined
  const declared = family.declared?.trim()
  const meaning: Pick<FamilyMeaning, 'source' | 'words'> = declared
    ? { source: 'declared', words: declared }
    : written
      ? { source: 'written', words: written }
      : common
        ? { source: 'common', words: common.words }
        : { source: 'none', words: null }
  // A variant says something else when its words, values aside, are not those most of them share.
  // With no meaning, none does; nor with words declared or written for the family when most share
  // none: those words speak for every variant.
  const differing =
    meaning.words && shared
      ? described.filter((variant) => !sameAs(variant, shared.said)).map((variant) => variant.key)
      : []
  return {
    ...meaning,
    common,
    base: shared && common && alone ? shared.said.key : null,
    automatic: common?.words ?? null,
    differing,
  }
}

/**
 * What a family's variants say, each wording once, for an owner to start the family's own words
 * from: the first variant's values and own words, the words as one plain line, and how many
 * variants write them. Most first.
 */
export function familyWordings(family: {
  by: readonly string[]
  variants: readonly MeaningVariant[]
}): { values: readonly string[]; words: string; line: string; count: number }[] {
  const wordings = new Map<
    string,
    { values: readonly string[]; words: string; line: string; count: number }
  >()
  const values = new Map(family.variants.map((variant) => [variant.key, variant.values]))
  for (const said of saidOf(family)) {
    const seen = wordings.get(said.same)
    if (seen) seen.count++
    else
      wordings.set(said.same, {
        values: values.get(said.key) ?? [],
        words: said.own,
        line: meaningLine(said.words, family.by),
        count: 1,
      })
  }
  return [...wordings.values()].sort((a, b) => b.count - a.count)
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
