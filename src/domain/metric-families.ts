/*
  Families of metrics (FR-142): a model that keeps a metric per currency and channel ("Revenue
  (EUR) web", "Revenue (USD) app"...) holds one calculation many times. Footnote groups those
  variants into one family, a metric group whose members they are, so people and agents see one
  entry, "Revenue", and an item about it applies to all 250. An owner confirms each family on the
  Names card before it goes live. A family is found in this order of trust, never mixed up (D1):

  1. Declared in the source: the members whose `meta.footnote` names one family, read as written
     (D9), each told apart by its `by`. Two are a family.
  2. Found from the calculation: the metrics of one view whose source says they calculate the same
     thing apart from the literals their filters compare (a definition's `variant`), at least three
     told apart by the same columns; and the metrics worked out from one another with one column
     (D2): a metric converted from another (definition-relations.ts) by a column that converts
     other metrics of the source too, a rate, with that one, by Currency. Two are a family.
  3. Suggested from names: the metrics of one view whose names are one name in other currencies,
     whatever their calculations. Never a family by itself: the Names card shows them apart, as
     names that look alike, for the owner to publish as one family or apart.

  Pure: the names service and the mock binding find the same families in the same members.
*/
import { CURRENCIES } from './currencies.ts'
import type { DeclaredFamily, VariantValue } from './definition-helpers.ts'
import type { FamilyFound } from './family-found.ts'
import { conversionsOf, type BuiltFrom, type Conversion } from './definition-relations.ts'
import { keyPart } from './term-candidates.ts'
import { normalizeName } from './vocabulary.ts'
import { viewOf } from './source-views.ts'

/** The fewest variants a family of one calculation has: fewer are only metrics that look alike. */
export const FAMILY_MIN = 3
/**
 * The fewest of a family its source declares, or that one rate works out from another: one name in
 * two currencies, such as "Accrued share (EUR)" and an "Accrued share (USD)" converted from it.
 */
export const PAIR_FAMILY_MIN = 2
/** The fewest metrics whose names alone suggest a family: one name in two currencies or more. */
export const CURRENCY_FAMILY_MIN = 2
/**
 * The fewest conversions one column makes before it is a rate that makes families: a column one
 * conversion alone reads can be anything.
 */
export const RATE_CONVERSIONS_MIN = 2

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
  /** The family its source declares it is a variant of; absent or null when it declares none. */
  declared?: DeclaredFamily | null
  /** What it is built from, as its source names it; absent or null when the source does not say. */
  builtFrom?: BuiltFrom | null
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
  /** The fewest variants it needs: a declared or a converted family needs fewer than one calculation. */
  min: number
  /** How it was found: a family its names alone suggest is never one until an owner says so. */
  found: FamilyFound
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

/** A family's name as its source declares it: an identifier (`accrued_share`) in words. */
export function declaredName(name: string): string {
  const said = /^[a-z0-9_]+$/.test(name) ? name.replace(/_+/g, ' ').trim() : name.trim()
  return capitalized(said)
}

const byRef = (a: { ref: string }, b: { ref: string }) =>
  a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0

/** A declared family's `by` in one order whatever the order each member writes it in. */
const sortedBy = (by: readonly VariantValue[]) =>
  [...by].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

/**
 * The families the source declares: the members of one view whose `meta.footnote.family` names one
 * family, told apart by the same columns, each by other values. A view's copy of the declaration
 * is its own: a Cube measure that declares one is in each view that takes it. A declaration that
 * does not hold makes none, here and at the read, which says why (`declaredFamilyProblems`).
 */
function declaredFamilies(members: readonly VariantMember[]): Family[] {
  const groups = new Map<string, VariantMember[]>()
  for (const member of members) {
    if (!member.declared) continue
    const id = [member.source, viewOf(member.name) ?? '', normalizeName(member.declared.name)].join(
      '\u0000',
    )
    groups.set(id, [...(groups.get(id) ?? []), member])
  }
  const families: Family[] = []
  for (const group of groups.values()) {
    const as = group.map((member) => ({
      ...member,
      variant: { shape: '', by: sortedBy(member.declared!.by) },
    }))
    if (
      problemsOf(
        as.map((member) => ({ ...member, kind: 'metric' })),
        false,
      ).length
    )
      continue
    const ordered = axesOf(as)
    const name = declaredName(group[0]!.declared!.name)
    families.push({
      key: `group:${keyPart(name)}`,
      name,
      source: group[0]!.source,
      by: ordered.map(({ axis }) => axis),
      min: PAIR_FAMILY_MIN,
      found: 'declared',
      variants: as
        .map((member) => ({
          ref: member.ref,
          values: ordered.map(({ index }) => member.variant.by[index]!.value),
        }))
        .sort(byRef),
    })
  }
  return families
}

/** What tells a family of variants of one calculation apart: their filters' columns. */
function filterFamilies(members: readonly VariantMember[]): Family[] {
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
      found: 'calculation',
      variants: unique
        .map((member) => ({
          ref: member.ref,
          values: ordered.map(({ index }) => member.variant!.by[index]!.value),
        }))
        .sort(byRef),
    })
  }
  return families
}

/**
 * The families one rate works out (D2): the metrics of each source converted from one another by a
 * column that converts at least `RATE_CONVERSIONS_MIN` of them, each set joined by its conversions,
 * by Currency, its values the currency each name is in. A set where a metric would be in two
 * currencies, or two in one, is none.
 */
function convertedFamilies(members: readonly VariantMember[]): Family[] {
  const bySource = new Map<string, VariantMember[]>()
  for (const member of members)
    if (member.builtFrom)
      bySource.set(member.source, [...(bySource.get(member.source) ?? []), member])
  const families: Family[] = []
  for (const [source, own] of bySource) {
    const all = conversionsOf(
      own.map((member) => ({ ref: member.ref, name: member.name, builtFrom: member.builtFrom! })),
    )
    const uses = new Map<string, number>()
    for (const conversion of all) uses.set(conversion.by, (uses.get(conversion.by) ?? 0) + 1)
    const rated = all.filter((conversion) => uses.get(conversion.by)! >= RATE_CONVERSIONS_MIN)
    const top = new Map<string, string>()
    const root = (ref: string): string => {
      const up = top.get(ref) ?? ref
      return up === ref ? ref : root(up)
    }
    for (const { from, to } of rated) top.set(root(to), root(from))
    const sets = new Map<string, Conversion[]>()
    for (const conversion of rated)
      sets.set(root(conversion.from), [...(sets.get(root(conversion.from)) ?? []), conversion])
    const memberOf = new Map(own.map((member) => [member.ref, member]))
    for (const conversions of sets.values()) {
      const code = new Map<string, string>()
      let holds = true
      for (const { from, to, currencies } of conversions)
        for (const [ref, currency] of [
          [from, currencies[0]],
          [to, currencies[1]],
        ] as const) {
          if ((code.get(ref) ?? currency) !== currency) holds = false
          code.set(ref, currency)
        }
      if (!holds || new Set(code.values()).size !== code.size || code.size < PAIR_FAMILY_MIN)
        continue
      const variants = [...code].map(([ref, currency]) => ({ ref, values: [currency] })).sort(byRef)
      const name = familyName(
        variants.map(({ ref, values }) => ({ said: memberOf.get(ref)!.said, values })),
      )
      families.push({
        key: `group:${keyPart(name)}`,
        name,
        source,
        by: [CURRENCY_AXIS],
        min: PAIR_FAMILY_MIN,
        found: 'calculation',
        variants,
      })
    }
  }
  return families
}

/**
 * The metrics whose names alone suggest a family: those of one view whose names are one name in
 * other currencies, at least `CURRENCY_FAMILY_MIN` of them, each in another. Never a family until
 * an owner says so.
 */
function lookAlikes(members: readonly VariantMember[]): Family[] {
  const byName = new Map<string, { member: VariantMember; code: string }[]>()
  for (const member of members) {
    const code = currencyIn(member.said)
    const stem = code && normalizeName(nameWithout(member.said, [code]))
    if (!code || !stem || !keyPart(stem)) continue
    const id = [member.source, viewOf(member.name) ?? '', stem].join('\u0000')
    byName.set(id, [...(byName.get(id) ?? []), { member, code }])
  }
  const families: Family[] = []
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
      found: 'names',
      variants: group.map(({ member, code }) => ({ ref: member.ref, values: [code] })).sort(byRef),
    })
  }
  return families
}

/**
 * The families among a source's metrics, in the order of trust (D1): those its source declares,
 * then those found from the calculation (one calculation's filter variants, then the metrics one
 * rate converts), then those the names alone suggest (`found: 'names'`). A metric is in one family
 * at most: the first that takes it. Ordered by name.
 */
export function familiesOf(members: readonly VariantMember[]): Family[] {
  const families: Family[] = []
  const taken = new Set<string>()
  const rest = () => members.filter((member) => !taken.has(member.ref))
  for (const find of [declaredFamilies, filterFamilies, convertedFamilies, lookAlikes])
    for (const family of find(rest())) {
      families.push(family)
      for (const { ref } of family.variants) taken.add(ref)
    }
  return families.sort((a, b) => a.name.localeCompare(b.name, 'en') || (a.key < b.key ? -1 : 1))
}

/** Why a family a source declares does not hold, by code, as the read warns it. */
export type DeclaredFamilyProblem =
  | 'family_one_member'
  | 'family_two_views'
  | 'family_two_kinds'
  | 'family_axes_differ'
  | 'family_same_values'

/**
 * What is wrong with one view's members of a declared family; none when it holds. One member is
 * too few, and when the family has members in other views too, it is a family across views.
 */
function problemsOf(
  members: readonly {
    kind: string
    variant: { by: readonly VariantValue[] }
  }[],
  elsewhere: boolean,
): DeclaredFamilyProblem[] {
  const problems: DeclaredFamilyProblem[] = []
  if (members.length < PAIR_FAMILY_MIN)
    problems.push(elsewhere ? 'family_two_views' : 'family_one_member')
  if (members.some((member) => member.kind !== 'metric')) problems.push('family_two_kinds')
  const axes = new Set(
    members.map((member) => member.variant.by.map((by) => by.name).join('\u0000')),
  )
  if (axes.size > 1) problems.push('family_axes_differ')
  const values = new Set(
    members.map((member) => member.variant.by.map((by) => normalizeName(by.value)).join('\u0000')),
  )
  if (axes.size === 1 && values.size < members.length) problems.push('family_same_values')
  return problems
}

/**
 * The families a read's definitions declare that do not hold (D1, D8), each view's members apart:
 * a family of one member, of one member in a view when the rest are in others, of a dimension, of
 * members told apart by other columns, or of two members with the same values. Each problem is
 * warned once, by the family's name, and those members are read as of no family: their
 * declarations are left out (`dropped`, by ref), never guessed at.
 */
export function declaredFamilyProblems(
  definitions: readonly {
    ref: string
    name: string
    kind: string
    family?: DeclaredFamily | null | undefined
  }[],
): { warnings: { code: DeclaredFamilyProblem; target: string }[]; dropped: Set<string> } {
  const groups = new Map<string, Map<string, typeof definitions>>()
  for (const definition of definitions)
    if (definition.family) {
      const id = normalizeName(definition.family.name)
      const views = groups.get(id) ?? new Map<string, typeof definitions>()
      const view = viewOf(definition.name) ?? ''
      views.set(view, [...(views.get(view) ?? []), definition])
      groups.set(id, views)
    }
  const warnings: { code: DeclaredFamilyProblem; target: string }[] = []
  const dropped = new Set<string>()
  for (const views of groups.values()) {
    const said = new Set<DeclaredFamilyProblem>()
    for (const group of views.values()) {
      const problems = problemsOf(
        group.map((definition) => ({
          ...definition,
          variant: { by: sortedBy(definition.family!.by) },
        })),
        views.size > 1,
      )
      for (const code of problems)
        if (!said.has(code)) {
          said.add(code)
          warnings.push({ code, target: group[0]!.family!.name })
        }
      if (problems.length) for (const { ref } of group) dropped.add(ref)
    }
  }
  return { warnings, dropped }
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
