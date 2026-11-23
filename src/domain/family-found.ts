/**
 * How a family of metrics was found, in the order of trust (FR-142, D1): declared in its source
 * (`meta.footnote`), found from the calculation, found from a rate that converts one variant from
 * another (D2), or suggested by the names alone, which is never a family until an owner says so. A
 * module of its own, so a screen that names it loads no finder.
 */
export const familyFoundKinds = ['declared', 'calculation', 'rate', 'names'] as const
export type FamilyFound = (typeof familyFoundKinds)[number]

/**
 * Each kind as a count or a group names it, in its tool's name: "declared in dbt", "from a rate".
 * Names alone are "look alike": never a family until someone says so.
 */
export const foundKindWords = (found: FamilyFound, tool: string) =>
  found === 'declared'
    ? `declared in ${tool}`
    : found === 'calculation'
      ? 'from the calculation'
      : found === 'rate'
        ? 'from a rate'
        : 'look alike'

/** How a family was found, as one line of its page or panel: "Found from a rate in dbt". */
export const foundLine = (found: Exclude<FamilyFound, 'names'>, tool: string) =>
  found === 'declared'
    ? `Declared as one family in ${tool}`
    : `Found ${found === 'rate' ? 'from a rate' : 'from the calculation'} in ${tool}`

/** How a published family was found, as its page says it; null when nothing says. */
export const foundSaid = (found: FamilyFound | undefined, tool: string) =>
  found === 'names'
    ? 'Its names look alike, and an owner published them as one family'
    : found
      ? foundLine(found, tool)
      : null
