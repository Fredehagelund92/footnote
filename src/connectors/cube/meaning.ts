/*
  What a compiled Cube member means, for its change mark (mark version 2). Mark version 1 hashed
  the whole compiled member, so the compiler's own bookkeeping was part of every mark: 1.8 adds
  `included: true` to each view member, and changed every mark although no model did. Version 2
  keeps the parts that say what the member means, by Cube's names, and leaves the rest out, so a
  compiler that adds a field of its own changes no mark.
*/

/**
 * A member's calculation, type, words and metadata. Left out: Cube's bookkeeping (`ownedByCube`,
 * `included`, `drillMemberReferences`), its other names (`aliases`), its visibility (the mark has
 * it apart) and what only steers its display or suggestions (`links`, `enableSuggestions`,
 * `suggestFilterValues`, `valuesAsSegments`, `order`, `key`).
 */
const meaningKeys = [
  'type',
  'aggType',
  'sql',
  'case',
  'latitude',
  'longitude',
  'subQuery',
  'propagateFiltersToSubQuery',
  'primaryKey',
  'granularities',
  'filters',
  'rollingWindow',
  'cumulative',
  'multiStage',
  'timeShift',
  'reduceBy',
  'addGroupBy',
  'groupBy',
  'orderBy',
  'mask',
  'currency',
  'format',
  'drillMembers',
  'drillFilters',
  'title',
  'description',
  'meta',
  'aliasMember',
] as const

/** The meaning keys a compiled member has, in a fixed order; absent ones stay absent. */
export function compiledMeaning(
  member: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const meaning: Record<string, unknown> = {}
  for (const key of meaningKeys) if (Object.hasOwn(member, key)) meaning[key] = member[key]
  return meaning
}
