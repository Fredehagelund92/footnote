/*
  Families of metrics (FR-142): a model that keeps a metric per currency and channel ("Revenue
  (EUR) web", "Revenue (USD) app"...) holds one calculation many times, each with other literals
  in its filters. Footnote groups those variants into one family, a metric group whose members
  they are, so people and agents see one entry, "Revenue", and an item about it applies to all
  250. A family is found from the calculation's shape, never from names alone: its variants are
  the metrics of one view whose source says they calculate the same thing apart from the literals
  their filters compare (a definition's `variant`), told apart by the same columns. An owner
  confirms each family on the Names card before it goes live.

  Pure: the names service and the mock binding find the same families in the same members.
*/
import type { VariantValue } from './definition-helpers.ts'
import { keyPart } from './term-candidates.ts'
import { normalizeName } from './vocabulary.ts'
import { viewOf } from './source-views.ts'

/** The fewest variants a family of one calculation has: fewer are only metrics that look alike. */
export const FAMILY_MIN = 3
/**
 * The fewest of a family its names alone make: one name in two currencies or more, such as
 * "Accrued share (EUR)" and an "Accrued share (USD)" worked out from it with a rate.
 */
export const CURRENCY_FAMILY_MIN = 2

/** The currencies by their ISO 4217 codes: what a currency in a metric's name can be. */
const CURRENCIES = new Set(
  'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWL'.split(
    ' ',
  ),
)

/** Whether a word of a name in the tool is a currency's ISO 4217 code, in any case: `usd`. */
export const isCurrencyCode = (word: string) => CURRENCIES.has(word.toUpperCase())

/**
 * The one currency a metric's name is in: a code written in capitals ("Revenue USD" or
 * "Accrued share (EUR)"), so everyday words such as "all" or "top" are none. Null for none, and for
 * a name with two.
 */
export function currencyIn(said: string): string | null {
  const found = [...said.matchAll(/(?<![\p{L}\p{N}])([A-Za-z]{3})(?![\p{L}\p{N}])/gu)].filter(
    (match) => CURRENCIES.has(match[1]!),
  )
  return found.length === 1 ? found[0]![1]!.toUpperCase() : null
}

/** What tells a family's variants apart when only their names do: their currency. */
const CURRENCY_AXIS: FamilyAxis = { name: 'currency', ref: null }

/** What a source read of a metric as a variant: its calculation's shape and what tells it apart. */
export type MemberVariant = { shape: string; by: readonly VariantValue[] }

/** A metric as the family finder needs it: its ref, source, name and what it is a variant of. */
export type VariantMember = {
  ref: string
  source: string
  /** `sales.revenue_eur_web`. */
  name: string
  /** As people read it: "Revenue (EUR) web". */
  said: string
  variant: MemberVariant | null
}

/** One column or dimension a family's variants are told apart by. */
export type FamilyAxis = {
  /** Its name in the tool: `currency_code`. */
  name: string
  /** The dimension of that name the source reads, by ref; null when it reads none. */
  ref: string | null
}

export type Family = {
  /** `group:revenue`. */
  key: string
  /** "Revenue": what its variants' names say without the values that tell them apart. */
  name: string
  source: string
  /** What tells its variants apart, in the order their names give the values. */
  by: FamilyAxis[]
  /** Its variants, by ref, with their values in the order of `by`: `["EUR", "web"]`. */
  variants: { ref: string; values: string[] }[]
  /** The fewest variants it needs: a family its names alone made needs fewer than one calculation. */
  min: number
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const capitalized = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

/** Words a name keeps before a value it no longer has: "Revenue in EUR" is "Revenue". */
const before = /\s+(?:in|for|by|via|through|at|on|per|from|of)$/i

/** A variant's name without its values: "Revenue (EUR) web" is "Revenue". */
export function nameWithout(said: string, values: readonly string[]): string {
  let name = said.replace(/_+/g, ' ')
  for (const value of [...values].sort((a, b) => b.length - a.length))
    name = name.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${escape(value)}(?![\\p{L}\\p{N}])`, 'giu'),
      ' ',
    )
  name = name
    .replace(/[([{]\s*[,;/|&+-]?\s*[)\]}]/g, ' ')
    .replace(/\s+([,;:/|&+)-])/g, '$1')
    .replace(/(^|\s)[,;:/|&+-]+(?=\s|$)/g, ' ')
    .replace(/[\s,;:/|&+(-]+$/g, '')
    .replace(/^[\s,;:/|&+)-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(before, '')
  return capitalized(name)
}

/** Where each value sits in a name, for the order of the axes: -1 when the name lacks it. */
const placeIn = (said: string, value: string) => normalizeName(said).indexOf(normalizeName(value))

/**
 * What tells a family's variants apart, in the order their names give the values ("Revenue (EUR)
 * web": currency first), each with where its value sits in a variant's `by`.
 */
export function axesOf(
  variants: readonly { said: string; variant: MemberVariant | null }[],
): { index: number; axis: FamilyAxis }[] {
  const first = variants.find((member) => member.variant)
  if (!first) return []
  return first
    .variant!.by.map((by, index) => ({
      index,
      place: placeIn(first.said, by.value),
      axis: {
        name: by.name,
        ref: variants.find((m) => m.variant?.by[index]?.ref)?.variant!.by[index]!.ref ?? null,
      },
    }))
    .sort(
      (a, b) =>
        (a.place < 0 ? Infinity : a.place) - (b.place < 0 ? Infinity : b.place) ||
        a.index - b.index,
    )
    .map(({ index, axis }) => ({ index, axis }))
}

/**
 * What tells the variants of a family apart, and each one's values in that order: the columns its
 * source said its filters compare, or, for a family its names alone made, the currency each name
 * is in.
 */
export function familyAxes(variants: readonly { said: string; variant: MemberVariant | null }[]) {
  const axes = axesOf(variants)
  if (axes.length)
    return {
      by: axes.map(({ axis }) => axis),
      valuesOf: (member: { variant: MemberVariant | null }) =>
        axes.map(({ index }) => member.variant?.by[index]?.value ?? ''),
    }
  return {
    by: [CURRENCY_AXIS],
    valuesOf: (member: { said: string }) => [currencyIn(member.said) ?? ''],
  }
}

/** The name most of a family's variants give without their values, else the first's own. */
function familyName(group: readonly { said: string; values: readonly string[] }[]): string {
  const counts = new Map<string, number>()
  for (const member of group) {
    const name = nameWithout(member.said, member.values)
    if (keyPart(name)) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return (
    [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))[0]?.[0] ??
    group[0]!.said
  )
}

/**
 * The families among a source's metrics. First the variants of one calculation: those of one
 * view with one shape, told apart by the same columns, at least `FAMILY_MIN` of them, each by
 * other values. Then, of the rest, the metrics of one view whose names are one name in other
 * currencies, at least `CURRENCY_FAMILY_MIN` of them, whatever their calculations: a variant in
 * USD is often worked out from the one in EUR with a rate. Named by what their names share, the
 * name most of them give; ordered by name.
 */
export function familiesOf(members: readonly VariantMember[]): Family[] {
  const groups = new Map<string, VariantMember[]>()
  for (const member of members) {
    if (!member.variant) continue
    const columns = member.variant.by.map((by) => by.name)
    const id = [member.source, viewOf(member.name) ?? '', member.variant.shape, ...columns].join(
      '\u0000',
    )
    groups.set(id, [...(groups.get(id) ?? []), member])
  }
  const families: Family[] = []
  for (const group of groups.values()) {
    const stem = familyName(
      group.map((member) => ({
        said: member.said,
        values: member.variant!.by.map((b) => b.value),
      })),
    )
    const fits = (member: VariantMember) =>
      nameWithout(
        member.said,
        member.variant!.by.map((b) => b.value),
      ) === stem
    const seen = new Set<string>()
    const unique = [...group]
      .sort(
        (a, b) =>
          Number(!fits(a)) - Number(!fits(b)) || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0),
      )
      .filter((m) => {
        const values = m.variant!.by.map((by) => by.value).join('\u0000')
        return !seen.has(values) && !!seen.add(values)
      })
    if (unique.length < FAMILY_MIN) continue
    const first = unique[0]!
    const ordered = axesOf(unique)
    const name = familyName(
      unique.map((member) => ({
        said: member.said,
        values: member.variant!.by.map((b) => b.value),
      })),
    )
    families.push({
      key: `group:${keyPart(name)}`,
      name,
      source: first.source,
      by: ordered.map(({ axis }) => axis),
      min: FAMILY_MIN,
      variants: unique
        .map((member) => ({
          ref: member.ref,
          values: ordered.map(({ index }) => member.variant!.by[index]!.value),
        }))
        .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)),
    })
  }
  const taken = new Set(families.flatMap((family) => family.variants.map((v) => v.ref)))
  const byName = new Map<string, { member: VariantMember; code: string }[]>()
  for (const member of members) {
    const code = taken.has(member.ref) ? null : currencyIn(member.said)
    const stem = code && normalizeName(nameWithout(member.said, [code]))
    if (!code || !stem || !keyPart(stem)) continue
    const id = [member.source, viewOf(member.name) ?? '', stem].join('\u0000')
    byName.set(id, [...(byName.get(id) ?? []), { member, code }])
  }
  for (const group of byName.values()) {
    if (
      group.length < CURRENCY_FAMILY_MIN ||
      new Set(group.map(({ code }) => code)).size !== group.length
    )
      continue
    const name = familyName(
      group.map(({ member, code }) => ({ said: member.said, values: [code] })),
    )
    families.push({
      key: `group:${keyPart(name)}`,
      name,
      source: group[0]!.member.source,
      by: [CURRENCY_AXIS],
      min: CURRENCY_FAMILY_MIN,
      variants: group
        .map(({ member, code }) => ({ ref: member.ref, values: [code] }))
        .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)),
    })
  }
  return families.sort((a, b) => a.name.localeCompare(b.name, 'en') || (a.key < b.key ? -1 : 1))
}

/** The most lines a family's page gives on how its variants are worked out from one another. */
const DERIVATIONS_MAX = 3

/**
 * What a family's source says of how one variant is worked out from another, as plain lines for
 * its page: each variant whose description names another variant's value ("The EUR amount
 * multiplied by the row's exchange rate", of the USD one), with its name. The source's words,
 * never Footnote's guess; none when no description does.
 */
export function derivationsOf(
  variants: readonly { said: string; values: readonly string[]; description: string | null }[],
): string[] {
  // Every value of the family, by its words: a description names one when it holds them all.
  const wordsOf = (text: string) =>
    normalizeName(text)
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
  const values = new Set(variants.flatMap((variant) => variant.values.map((v) => normalizeName(v))))
  const lines: string[] = []
  for (const variant of variants) {
    const words = variant.description?.trim()
    if (!words || lines.length === DERIVATIONS_MAX) continue
    const own = new Set(variant.values.map((v) => normalizeName(v)))
    if (wordsOf(words).some((word) => values.has(word) && !own.has(word)))
      lines.push(`${variant.said}: ${words}`)
  }
  return lines
}

/** An axis as people read it, when no dimension names it: `currency_code` is "Currency code". */
export const axisWords = (axis: FamilyAxis) => capitalized(axis.name.replace(/_+/g, ' ').trim())

/** "Currency and Channel", "Currency, Channel and Store". */
export function byWords(names: readonly string[]): string {
  return names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}
