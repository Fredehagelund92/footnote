import * as z from 'zod/mini'
import {
  catalogueStatuses,
  catalogueTermKinds,
  definitionStates,
  termDomainSources,
} from '../domain/catalogue.ts'
import { familyFoundKinds } from '../domain/family-found.ts'
import type { ItemKind } from '../domain/item.ts'
import { calendarDateSchema } from '../domain/validity.ts'

/**
 * The catalogue (FR-136): every metric and dimension of the live vocabulary, with a labelled
 * copy of what the definition source last read and what the library holds about it. Footnote keeps
 * no calculation (CON-207): a page links to the source for the formula.
 */

/** What the definition source last read about a term's definition. Never a calculation. */
export const catalogueDefinitionSchema = z.object({
  /** The stable id in the source tool, for example `cube:payments.orders`. */
  ref: z.string(),
  /** The member's name in the source, for example `payments.orders`. */
  name: z.string(),
  title: z.nullable(z.string()),
  /**
   * The source's short description, a copy of at most 500 characters refreshed at every read
   * (CON-207). Show it labelled as a copy; null when the source has none.
   */
  descriptionCopy: z.nullable(z.string()),
  valueType: z.nullable(z.string()),
  state: z.enum(definitionStates),
  /** The new id of a definition that is gone, when the source names it (CON-512). */
  renamedTo: z.nullable(z.string()),
  /** When the source last changed it after Footnote first read it; null when it never did. */
  changedAt: z.nullable(z.string()),
  /** The newest read that listed it (ISO 8601): the age of the copy. */
  readAt: z.nullable(z.string()),
  /** The connector that reads it, one of `sources`. */
  sourceId: z.string(),
  /** The tool that connector reads, as people say it ("Cube"), for the words on screen. */
  tool: z.string(),
  /** The kind of connector that reads it: its manifest id, such as `cube-cloud`. */
  connector: z.string(),
  /**
   * The address of the model file that defines it, in the source's web view: the source's model
   * folder address followed by the file its read named. Null when the source has no folder
   * address or the read named no file, as a dbt file never does.
   */
  fileUrl: z.nullable(z.string()),
})

const kindCounts = z.object({
  note: z.number(),
  event: z.number(),
  guide: z.number(),
  issue: z.number(),
} satisfies Record<ItemKind, unknown>)

/** What the library holds about a term: the same items and statuses the library shows. */
export const catalogueShelfSchema = z.object({
  /** Accepted items whose scope names the term. */
  items: z.number(),
  byKind: kindCounts,
  /** Re-check due, source changed or source missing. */
  needsALook: z.number(),
  /** Issues about the term that still apply. */
  activeIssues: z.number(),
  /** Accepted items whose last day has passed. */
  ended: z.number(),
  /** Open gaps whose topic names the term. */
  gaps: z.number(),
  /** Items whose text mentions the term: the total `items.list` with `mentions` returns. */
  mentionedBy: z.number(),
  /** The newest change to an accepted item about the term, or null. */
  lastUpdated: z.nullable(z.string()),
})

/** A variant of a family (FR-142): a metric the family's page lists, never Definitions. */
export const catalogueVariantSchema = z.object({
  /** `metric:revenue_eur_web`. */
  key: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  /** What tells it apart, in the order of its family's `by`: `["EUR", "web"]`. */
  values: z.array(z.string()),
  /** Its source's own words for it, or null when the source gives none. */
  description: z.nullable(z.string()),
  /** What its source last read of it; null when the source never listed it. */
  state: z.nullable(z.enum(definitionStates)),
  /** Accepted items whose scope names the variant itself. */
  items: z.number(),
})

export const catalogueTermSchema = z.object({
  /** The vocabulary key: `metric:orders`, `dim:market`. */
  key: z.string(),
  kind: z.enum(catalogueTermKinds),
  /** The key without its prefix, as `vocabulary.get` names it. */
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  /** The metric group; null for a dimension and a metric outside a group. */
  group: z.nullable(z.object({ key: z.string(), name: z.string() })),
  /**
   * A family of metrics (FR-142): one entry, `group:revenue`, for its variants, which are listed
   * here and nowhere else in the catalogue; `by` is what tells them apart, in words ("Currency",
   * "Channel"). Its `definition` is the variant that speaks for it, without that variant's words.
   * Null for any other term.
   */
  family: z.nullable(
    z.object({
      by: z.array(z.string()),
      /**
       * How it was found (D1): declared in the tool (`meta.footnote`), found from the calculation,
       * or published by an owner from names that look alike.
       */
      found: z.enum(familyFoundKinds),
      /**
       * What the source says of how a variant is worked out from another, its own words with the
       * variant's name ("Accrued share (USD): the EUR amount multiplied by the row's rate").
       */
      derivations: z.array(z.string()),
      /**
       * The variants worked out from another with one column more, as the source's structure says
       * (D2): the variant converted to and the one it is converted from, by key, and the column.
       */
      conversions: z.array(z.object({ from: z.string(), to: z.string(), by: z.string() })),
      variants: z.array(catalogueVariantSchema),
    }),
  ),
  /** The vocabulary's area first, the source's hint second, no domain third. */
  domain: z.object({ areaId: z.nullable(z.string()), source: z.enum(termDomainSources) }),
  /**
   * The definition that speaks for the term (`speakingDefinition`): of a dimension in several
   * views, the first one gone, else the first one changed, else the first. Null when the term
   * names no definition, or the source has never listed one.
   */
  definition: z.nullable(catalogueDefinitionSchema),
  /** Every definition the term names that the source has listed, by ref (CON-208). */
  definitions: z.array(catalogueDefinitionSchema),
  status: z.enum(catalogueStatuses),
  shelf: catalogueShelfSchema,
})

/** A definition source and its newest read. While it fails, the copies are the last known ones. */
export const catalogueSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The tool the source reads, as people say it ("Cube"), for the words on screen. */
  tool: z.string(),
  /** The kind of connector it is: its manifest id, such as `cube-cloud`. */
  connector: z.string(),
  /** The newest read that succeeded (ISO 8601), or null before the first. */
  readAt: z.nullable(z.string()),
  /** The model version that read saw, for example a Git tag. */
  sourceVersion: z.nullable(z.string()),
  /** The newest attempt failed (CON-213). */
  failing: z.boolean(),
})

export const catalogueSchema = z.object({
  /** Metrics and families first, then dimensions, each by name; a family's variants are in it. */
  terms: z.array(catalogueTermSchema),
  sources: z.array(catalogueSourceSchema),
  /** Metrics with no domain, against all metrics (CON-516). */
  coverage: z.object({ metrics: z.number(), withoutDomain: z.number() }),
  today: calendarDateSchema,
})

export const catalogueValueSchema = z.object({
  /** `val:market/norway`. */
  key: z.string(),
  id: z.string(),
  name: z.string(),
  /** Other names for the value (FR-107). */
  aliases: z.array(z.string()),
  /** Accepted items whose scope names the value. */
  items: z.number(),
  /** Items whose text mentions the value. */
  mentionedBy: z.number(),
})

/** How a definition relates to another, or to a column, as its source's structure says (D3). */
export const definitionRelationKinds = [
  'converted_from',
  'converted_to',
  'built_from',
  'used_by',
] as const

/**
 * What a metric is built from and what is built from it (FR-143): the source's structure, kept by
 * name only (CON-207). Refs, column names and a kind: never an expression, an operator or a query.
 */
export const definitionRelationSchema = z.object({
  kind: z.enum(definitionRelationKinds),
  /** The definition at the other end, by ref; null for a column. */
  ref: z.nullable(z.string()),
  /**
   * A column's name in the source (`exchange_rate_usd`), or the definition's: the live term's
   * name when one names it, else its name in the source.
   */
  name: z.string(),
  /** The live term that names the definition, whose page it opens; null for a column, or none. */
  key: z.nullable(z.string()),
  /** The definition is no longer in the source; false for a column. */
  missing: z.boolean(),
  /** A conversion's column, the one the converted metric reads beyond the other (D2); else null. */
  by: z.nullable(z.string()),
})

export const definitionRelationsInputSchema = z.strictObject({
  key: z.string().check(z.regex(/^metric:[a-z0-9_]+$/)),
})

export const definitionRelationsSchema = z.object({
  /** Converted from and to first, then built from in the source's order, then used by, by name. */
  relations: z.array(definitionRelationSchema),
})

export type Catalogue = z.infer<typeof catalogueSchema>
export type CatalogueTerm = z.infer<typeof catalogueTermSchema>
export type CatalogueVariant = z.infer<typeof catalogueVariantSchema>
export type CatalogueDefinition = z.infer<typeof catalogueDefinitionSchema>
export type CatalogueSource = z.infer<typeof catalogueSourceSchema>
export type CatalogueValue = z.infer<typeof catalogueValueSchema>
export type DefinitionRelation = z.infer<typeof definitionRelationSchema>
export type DefinitionRelations = z.infer<typeof definitionRelationsSchema>
