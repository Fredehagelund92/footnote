/*
  What a metric is built from, and what is built from it (D3, D4): relations its source's
  structure says, never words in its description. A connector sends each metric's inputs by name
  (`builtFrom`: the definitions it takes, by ref, and the columns its own calculation reads); the
  core keeps them read only, replaced at each read, and works out from those names alone:

  - built from, and used by, its reverse;
  - converted from: a metric of the same view that reads another's inputs and one column more,
    whose name is the other's in another currency (`revenue_usd`, reading `revenue_eur` and
    `exchange_rate_usd`, of `revenue_eur`, reading `revenue_eur`), by that column; and converted
    to, its reverse.

  No calculation is kept or read here (CON-207): only refs and column names. A relation never
  flags an item and never changes what an agent is given. Pure: the catalogue service and the mock
  binding work out the same relations from the same members.
*/
import { isCurrencyCode } from './metric-families.ts'
import { memberOf } from './term-candidates.ts'
import { viewOf } from './source-views.ts'

/** What a metric is built from, as its source names it: definitions by ref, columns by name. */
export type BuiltFrom = { refs: readonly string[]; columns: readonly string[] }

/** A metric as the relations need it. */
export type RelationMember = {
  ref: string
  /** Its name in the source: `orders.revenue_usd`. */
  name: string
  builtFrom: BuiltFrom | null
}

/** A conversion of one metric into another: the metric it is converted from, by which column. */
export type Conversion = { from: string; to: string; by: string }

/** The one word two names in the tool differ by, as `[a, b]`: `eur` and `usd`. Null otherwise. */
function differingWord(a: string, b: string): [string, string] | null {
  const left = memberOf(a).split('_')
  const right = memberOf(b).split('_')
  if (left.length !== right.length) return null
  const at = left.flatMap((word, i) => (word === right[i] ? [] : [i]))
  return at.length === 1 ? [left[at[0]!]!, right[at[0]!]!] : null
}

/** What a metric takes, as a key that is the same whatever the order its source names them in. */
const inputsKey = (view: string | null, refs: Iterable<string>, columns: Iterable<string>) =>
  JSON.stringify([view, [...new Set(refs)].sort(), [...new Set(columns)].sort()])

/** A source's metrics by what they take: each conversion is looked up, never searched for. */
function byInputs(members: readonly RelationMember[]) {
  const index = new Map<string, RelationMember[]>()
  for (const member of members) {
    const from = member.builtFrom
    if (!from || (!from.refs.length && !from.columns.length)) continue
    const key = inputsKey(viewOf(member.name), from.refs, from.columns)
    index.set(key, [...(index.get(key) ?? []), member])
  }
  return index
}

/**
 * The metrics `to` could be converted from, each with its column: one of the same view that takes
 * the same definitions and every column `to` reads but one, the column it is converted by, whose
 * name in the tool is `to`'s in another currency.
 */
function convertedFrom(to: RelationMember, index: ReturnType<typeof byInputs>) {
  if (!to.builtFrom) return []
  const columns = [...new Set(to.builtFrom.columns)]
  return columns.flatMap((by) =>
    (
      index.get(
        inputsKey(
          viewOf(to.name),
          to.builtFrom!.refs,
          columns.filter((column) => column !== by),
        ),
      ) ?? []
    ).flatMap((from) => {
      const words = from.ref === to.ref ? null : differingWord(from.name, to.name)
      return words?.every(isCurrencyCode) ? [{ from: from.ref, to: to.ref, by }] : []
    }),
  )
}

/**
 * The conversions among one source's metrics: each metric converted from exactly one other. A
 * metric two others could each be converted from is neither's, so a guess is never shown.
 */
export function conversionsOf(members: readonly RelationMember[]): Conversion[] {
  const index = byInputs(members)
  return members
    .flatMap((to) => {
      const found = convertedFrom(to, index)
      return found.length === 1 ? found : []
    })
    .sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0))
}

/** How a metric relates to another definition, or to a column of its view. */
export type RelationKind = 'converted_from' | 'converted_to' | 'built_from' | 'used_by'

/** One relation as a page shows it: refs, names and a kind, never a calculation. */
export type Relation = {
  kind: RelationKind
  /** The definition at the other end, by ref; null for a column. */
  ref: string | null
  /** A column's name, or the definition's: its live term's name, else its name in the source. */
  name: string
  /** The live term that names the definition; null for a column, or when none does. */
  key: string | null
  /** The definition is no longer in the source. */
  missing: boolean
  /** A conversion's column; null for the others. */
  by: string | null
}

/** A definition at the other end as the reader sees it; null when the reader may not see it. */
export type RelationTarget = { name: string; key: string | null; missing: boolean } | null

/**
 * What `own` is built from and what is built from it, among `members`: the live metrics of its
 * view and those built from it. Converted from and to first, then built from in the source's order
 * (definitions, then columns), then used by, by name. `targetOf` says how the reader sees a
 * definition; an input the source never listed is named by its ref alone.
 */
export function relationsOf(
  own: RelationMember,
  members: readonly RelationMember[],
  targetOf: (ref: string) => RelationTarget | undefined,
): Relation[] {
  const named = (ref: string, fallback: string): Omit<Relation, 'kind' | 'by'> | null => {
    const target = targetOf(ref)
    if (target === null) return null
    return target ? { ref, ...target } : { ref, name: fallback, key: null, missing: false }
  }
  const nameOf = (ref: string) =>
    members.find((member) => member.ref === ref)?.name ?? ref.slice(ref.indexOf(':') + 1)
  const conversions = conversionsOf([own, ...members.filter((member) => member.ref !== own.ref)])
  const conversion = (kind: RelationKind, ref: string, by: string) => {
    const target = named(ref, nameOf(ref))
    return target ? [{ kind, ...target, by }] : []
  }
  const usedBy = members
    .filter((member) => member.ref !== own.ref && member.builtFrom?.refs.includes(own.ref))
    .flatMap((member) => {
      const target = named(member.ref, member.name)
      return target ? [{ kind: 'used_by' as const, ...target, by: null }] : []
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
  return [
    ...conversions.flatMap((c) =>
      c.to === own.ref ? conversion('converted_from', c.from, c.by) : [],
    ),
    ...conversions.flatMap((c) =>
      c.from === own.ref ? conversion('converted_to', c.to, c.by) : [],
    ),
    ...(own.builtFrom?.refs ?? []).flatMap((ref) => {
      const target = named(ref, nameOf(ref))
      return target ? [{ kind: 'built_from' as const, ...target, by: null }] : []
    }),
    ...(own.builtFrom?.columns ?? []).map((column) => ({
      kind: 'built_from' as const,
      ref: null,
      name: column,
      key: null,
      missing: false,
      by: null,
    })),
    ...usedBy,
  ]
}
