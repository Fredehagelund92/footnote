import * as z from 'zod/mini'
import {
  catalogueStatuses,
  catalogueTermKinds,
  definitionStates,
  termDomainSources,
} from '../domain/catalogue.ts'
import { familyFoundKinds } from '../domain/family-found.ts'
import {
  FAMILY_WORDS_MAX,
  familyMeaningChoices,
  familyMeaningSources,
} from '../domain/family-meaning-line.ts'
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
  /** Its id in the source tool, for example `cube:orders.revenue_eur_web`; null when never listed. */
  ref: z.nullable(z.string()),
  /** What its source last read of it; null when the source never listed it. */
  state: z.nullable(z.enum(definitionStates)),
  /** Accepted items whose scope names the variant itself. */
  items: z.number(),
})

/**
 * What a family means (FR-142, M1), worked out at each read: the words its source declares for it,
 * else words an owner wrote, else the words most of its variants share.
 */
export const familyMeaningSchema = z.object({
  source: z.enum(familyMeaningSources),
  /**
   * Its meaning; null for none. The variants' common words write each value as what it stands
   * for, in braces, by a name of the family's `by`: "Money taken in {Currency} via {Channel}".
   * Any other source's words are as written.
   */
  words: z.nullable(z.string()),
  /**
   * The words most variants share, values aside, and how many share them: the same words, else
   * words most of them hold within their own. Null when most don't, or the words name a value.
   */
  common: z.nullable(z.object({ words: z.string(), agree: z.number() })),
  /**
   * The variant the others are converted from, by key, when the common words are its alone: each
   * other variant is converted from one or says how it is worked out from another. Else null.
   */
  base: z.nullable(z.string()),
  /**
   * The words the rule gives, any declared words or owner's choice aside, values as slots: the
   * common words. Null when it gives none.
   */
  automatic: z.nullable(z.string()),
  /** The variants whose own words say something else than the meaning, by key. */
  differing: z.array(z.string()),
  /** What an owner chose last, and who and when; null when no owner has chosen. */
  chosen: z.nullable(
    z.object({
      choice: z.enum(familyMeaningChoices),
      words: z.nullable(z.string()),
      personId: z.string(),
      at: z.string(),
    }),
  ),
  /** How many times owners chose: send it back with a change, 0 before the first. */
  revision: z.number(),
})

/**
 * The variant agents read when a question names none of the values a family's variants are told
 * apart by (FR-142, F3), as an owner of its domain or an admin picked it. With none, agents ask.
 */
export const familyUsualSchema = z.object({
  /** The usual variant, by key; null when no owner picked one or it left the family. */
  member: z.nullable(z.string()),
  /** Who picked last, and when; null before the first pick. */
  chosen: z.nullable(z.object({ personId: z.string(), at: z.string() })),
  /** How many times owners picked: send it back with a change, 0 before the first. */
  revision: z.number(),
})

/** A value of a dimension (FR-136): a name people and owners published, never read from data. */
export const catalogueValueSchema = z.object({
  /** `val:market/norway`. */
  key: z.string(),
  name: z.string(),
  /** Other names for the value (FR-107). */
  aliases: z.array(z.string()),
  /** How the data writes it ("NO"), as an agent's filter passes it. */
  writtenAs: z.array(z.string()),
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
   * "Channel"). Its `definition` is the variant that speaks for it, without that variant's words:
   * the family says what it means in `meaning`. Null for any other term.
   */
  family: z.nullable(
    z.object({
      by: z.array(z.string()),
      /**
       * How it was found (D1, D6): declared in the tool (`meta.footnote`), found from the
       * calculation, found from a rate that converts one variant from another, or published by an
       * owner from names that look alike.
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
      meaning: familyMeaningSchema,
      usual: familyUsualSchema,
      /**
       * The family's name as its tool declares it (`meta.footnote.family: active_buyers`), for a
       * family found so (D4): it is changed or split there. Null for any other.
       */
      declared: z.nullable(z.string()),
    }),
  ),
  /** A dimension's values, by name; empty for a metric and a family. */
  values: z.array(catalogueValueSchema),
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

/** A family split back into its metrics, while it stands (FR-142): Definitions lists it. */
export const catalogueSplitSchema = z.object({
  /** The family's key, `group:accrued_share`, which joins it again. */
  key: z.string(),
  /** Its name when it was split. */
  name: z.string(),
  /** The domain it was in; its owners and admins may make it one family again. */
  areaId: z.nullable(z.string()),
  /** Its former variants, each a metric of its own now. */
  metrics: z.array(z.object({ key: z.string(), name: z.string() })),
  /** Live context items still about the family, which reach agents through its metrics. */
  items: z.number(),
  personId: z.string(),
  at: z.string(),
})

export const catalogueSchema = z.object({
  /** Metrics and families first, then dimensions, each by name; a family's variants are in it. */
  terms: z.array(catalogueTermSchema),
  /** The families split back into their metrics, newest first. */
  splits: z.array(catalogueSplitSchema),
  sources: z.array(catalogueSourceSchema),
  /** Metrics with no domain, against all metrics (CON-516). */
  coverage: z.object({ metrics: z.number(), withoutDomain: z.number() }),
  today: calendarDateSchema,
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

/** A metric in what another is built from: refs and names, never a calculation (FR-143). */
export const builtFromMetricSchema = z.object({
  ref: z.string(),
  /** The live term's name when one names it, else its name in the source. */
  name: z.string(),
  /** The live term that names it, whose page it opens; null when none does. */
  key: z.nullable(z.string()),
  /** No longer in the source: what it was built from is not read. */
  missing: z.boolean(),
  /** The metrics it is built from, by ref, in the source's order. */
  from: z.array(z.string()),
})

export const definitionBuiltFromSchema = z.object({
  /** The metric first, then each metric below it once, in the order they are first reached. */
  metrics: z.array(builtFromMetricSchema),
})

const familyKey = z.string().check(z.regex(/^group:[a-z0-9_]+$/))

/**
 * An owner's choice of what a family means: worked out from its variants again (`auto`), or words
 * written for the family (`words`). `revision` is the meaning's as the person last read it.
 */
export const familyMeaningInputSchema = z.strictObject({
  key: familyKey,
  choice: z.enum(familyMeaningChoices),
  words: z.optional(
    z
      .string()
      .check(
        z.refine(
          (words) => words.trim().length >= 1 && [...words.trim()].length <= FAMILY_WORDS_MAX,
        ),
      ),
  ),
  revision: z.number().check(z.int(), z.minimum(0)),
})

export const familyKeyInputSchema = z.strictObject({ key: familyKey })

/**
 * An owner's pick of a family's usual variant, by key, or none (`member: null`). `revision` is the
 * pick's as the person last read it.
 */
export const familyUsualInputSchema = z.strictObject({
  key: familyKey,
  member: z.nullable(z.string().check(z.regex(/^metric:[a-z0-9_]+$/))),
  revision: z.number().check(z.int(), z.minimum(0)),
})

/** A family split back into its metrics (FR-142): the edition, the metrics, the items about it. */
export const familySplitSchema = z.object({
  edition: z.string(),
  /** Its former variants, each a metric of its own now, by name. */
  metrics: z.array(z.object({ key: z.string(), name: z.string() })),
  /** The context items about the family, each flagged for its owner to check. */
  items: z.number(),
})

/** A split family made one again, of the metrics it had. */
export const familyJoinedSchema = z.object({ edition: z.string(), name: z.string() })

/** One choice of what a family means, as it was made. */
export const familyMeaningVersionSchema = z.object({
  revision: z.number(),
  choice: z.enum(familyMeaningChoices),
  words: z.nullable(z.string()),
  personId: z.string(),
  at: z.string(),
})

export type Catalogue = z.infer<typeof catalogueSchema>
export type CatalogueTerm = z.infer<typeof catalogueTermSchema>
export type CatalogueVariant = z.infer<typeof catalogueVariantSchema>
export type CatalogueDefinition = z.infer<typeof catalogueDefinitionSchema>
export type CatalogueSource = z.infer<typeof catalogueSourceSchema>
export type CatalogueSplit = z.infer<typeof catalogueSplitSchema>
export type CatalogueValue = z.infer<typeof catalogueValueSchema>
export type DefinitionRelation = z.infer<typeof definitionRelationSchema>
export type DefinitionRelations = z.infer<typeof definitionRelationsSchema>
export type DefinitionBuiltFrom = z.infer<typeof definitionBuiltFromSchema>
export type FamilyMeaningData = z.infer<typeof familyMeaningSchema>
export type FamilyMeaningInput = z.infer<typeof familyMeaningInputSchema>
export type FamilyMeaningVersion = z.infer<typeof familyMeaningVersionSchema>
export type FamilyUsualData = z.infer<typeof familyUsualSchema>
export type FamilyUsualInput = z.infer<typeof familyUsualInputSchema>
export type FamilySplit = z.infer<typeof familySplitSchema>
export type FamilyJoined = z.infer<typeof familyJoinedSchema>
