/**
 * How a family of metrics was found, in the order of trust (FR-142, D1): declared in its source
 * (`meta.footnote`), found from the calculation, or suggested by the names alone, which is never a
 * family until an owner says so. A module of its own, so a screen that names it loads no finder.
 */
export const familyFoundKinds = ['declared', 'calculation', 'names'] as const
export type FamilyFound = (typeof familyFoundKinds)[number]
