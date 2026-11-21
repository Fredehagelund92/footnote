/*
  What a metric is built from, and what is built from it (D3, D4): relations its source's
  structure says, never words in its description. A connector sends each metric's inputs by name
  (`builtFrom`: the definitions it takes, by ref, and the columns its own calculation reads); the
  core keeps them read only, replaced at each read, and works out from those names alone: built
  from, and used by, its reverse.

  No calculation is kept or read here (CON-207): only refs and column names. A relation never
  flags an item and never changes what an agent is given. Pure: the catalogue service and the mock
  binding work out the same relations from the same members.
*/

/** What a metric is built from, as its source names it: definitions by ref, columns by name. */
export type BuiltFrom = { refs: readonly string[]; columns: readonly string[] }

/** A metric as the relations need it. */
export type RelationMember = {
  ref: string
  /** Its name in the source: `orders.revenue_usd`. */
  name: string
  builtFrom: BuiltFrom | null
}

/** How a metric relates to another definition, or to a column of its view. */
export type RelationKind = 'built_from' | 'used_by'

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
}

/** A definition at the other end as the reader sees it; null when the reader may not see it. */
export type RelationTarget = { name: string; key: string | null; missing: boolean } | null

/**
 * What `own` is built from and what is built from it, among `members`: the live metrics of its
 * view and those built from it. Built from in the source's order
 * (definitions, then columns), then used by, by name. `targetOf` says how the reader sees a
 * definition; an input the source never listed is named by its ref alone.
 */
export function relationsOf(
  own: RelationMember,
  members: readonly RelationMember[],
  targetOf: (ref: string) => RelationTarget | undefined,
): Relation[] {
  const named = (ref: string, fallback: string): Omit<Relation, 'kind'> | null => {
    const target = targetOf(ref)
    if (target === null) return null
    return target ? { ref, ...target } : { ref, name: fallback, key: null, missing: false }
  }
  const nameOf = (ref: string) =>
    members.find((member) => member.ref === ref)?.name ?? ref.slice(ref.indexOf(':') + 1)
  const usedBy = members
    .filter((member) => member.ref !== own.ref && member.builtFrom?.refs.includes(own.ref))
    .flatMap((member) => {
      const target = named(member.ref, member.name)
      return target ? [{ kind: 'used_by' as const, ...target }] : []
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
  return [
    ...(own.builtFrom?.refs ?? []).flatMap((ref) => {
      const target = named(ref, nameOf(ref))
      return target ? [{ kind: 'built_from' as const, ...target }] : []
    }),
    ...(own.builtFrom?.columns ?? []).map((column) => ({
      kind: 'built_from' as const,
      ref: null,
      name: column,
      key: null,
      missing: false,
    })),
    ...usedBy,
  ]
}
