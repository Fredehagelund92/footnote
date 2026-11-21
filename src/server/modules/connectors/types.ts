import * as z from 'zod'
import type { SettingKey } from '../../../contract/admin.ts'
import { sourceWarningCodes, type SourceServerSettingKey } from '../../../contract/operations.ts'
import type { SourceErrorClass } from '../../../domain/connector-runtime.ts'
import {
  BUILT_FROM_MAX,
  columnNamePattern,
  FAMILY_NAME_MAX,
} from '../../../domain/definition-helpers.ts'

/** What tells a variant of a family apart: each column or dimension, with its value and ref. */
const variantBy = z
  .array(
    z.object({
      name: z.string().min(1).max(500),
      ref: z
        .string()
        .regex(/^[a-z][a-z0-9_]*:[A-Za-z0-9_.:/-]+$/)
        .nullable(),
      value: z
        .string()
        .min(1)
        .refine((value) => Array.from(value).length <= 200),
    }),
  )
  .min(1)
  .max(5)

/**
 * The interface of the definitions pipeline's snapshot (docs/contributing/connector-contract.md,
 * "Interface 2"): the demo source is written to it, and an interface 3 runtime's read is gathered
 * into it.
 */
export const INTERFACE_VERSION = 2

/** The interfaces a source this build reads may be written to (CON-109). */
export type SourceInterfaceVersion = 2 | 3

/** The most other names Footnote keeps for one member: as many as a term may have (FR-107). */
export const DEFINITION_SYNONYMS_MAX = 20

export const definitionSchema = z.object({
  ref: z.string().regex(/^[a-z][a-z0-9_]*:[A-Za-z0-9_.:/-]+$/),
  kind: z.enum(['metric', 'dimension']),
  name: z.string().min(1),
  title: z.string().nullable(),
  descriptionCopy: z
    .string()
    .refine((value) => Array.from(value).length <= 500)
    .nullable(),
  valueType: z.string().nullable(),
  visibleGroups: z.null(),
  areaHint: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,39}$/)
    .nullable(),
  domainSource: z.enum(['source', 'override', 'none']),
  /**
   * The model file that defines the member's public view or cube, relative to the model folder
   * (`payments.yml`); null when the source has no files. Not part of the change mark: moving a
   * member to another file changes nothing it means.
   */
  modelFile: z.string().min(1).max(500).nullable(),
  /**
   * The other names the model's authors give the member (Cube's `meta.synonyms`), each once.
   * Absent from a connector that reads none.
   */
  synonyms: z.array(z.string().min(1).max(200)).max(DEFINITION_SYNONYMS_MAX).optional(),
  /**
   * The member's own name when a view joins it with a prefix (`store_name` of
   * `traffic.store_store_name`); null or absent when the name after the view is its own.
   */
  baseName: z.string().min(1).max(500).nullable().optional(),
  /**
   * A metric that is one variant of a family (FR-142): `shape`, the digest of its calculation with
   * the literals its filters compare left out, the same for every variant of the family; `by`,
   * those literals, each with the column or dimension it is compared with and the ref of that
   * dimension when the source reads it. Null or absent for any other definition.
   */
  variant: z
    .object({ shape: z.string().regex(/^[a-f0-9]{64}$/), by: variantBy })
    .nullable()
    .optional(),
  /**
   * The family the source declares a metric is a variant of (`meta.footnote`, FR-142, D9): its
   * name as the source writes it, what tells this variant apart, as `variant.by` does, and what
   * the family means, in the source's words for it (`family_description`), when it writes them.
   * Kept read only and replaced at each read; null or absent when it declares none, or when the
   * read left out a declaration that does not hold (`withDeclaredFamilies`).
   */
  family: z
    .object({
      name: z
        .string()
        .min(1)
        .refine((name) => Array.from(name).length <= FAMILY_NAME_MAX && !/[\n\r]/.test(name)),
      by: variantBy,
      description: z
        .string()
        .refine((value) => value.trim().length > 0 && Array.from(value).length <= 500)
        .optional(),
    })
    .nullable()
    .optional(),
  /**
   * What a metric is built from, as its source names it (CON-207): the definitions it takes as
   * inputs, by ref, and the columns of its view its own calculation reads, by name. Names only,
   * never the calculation; kept read only and replaced at each read. Null or absent when the
   * source does not say.
   */
  builtFrom: z
    .object({
      refs: z.array(z.string().regex(/^[a-z][a-z0-9_]*:[A-Za-z0-9_.:/-]+$/)).max(BUILT_FROM_MAX),
      columns: z.array(z.string().regex(columnNamePattern)).max(BUILT_FROM_MAX),
    })
    .nullable()
    .optional(),
  changeMark: z.string().regex(/^[a-f0-9]{64}$/),
})
export type Definition = z.infer<typeof definitionSchema>
export const warningSchema = z.object({
  /** One of the core's codes, or an interface 3 connector's own as `<connector>.<code>`. */
  code: z.union([
    z.enum(sourceWarningCodes),
    z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)?\.[a-z][a-z0-9_]{0,39}$/),
  ]),
  target: z.string(),
})
export type SourceWarning = z.infer<typeof warningSchema>
const refSchema = definitionSchema.shape.ref
/** A member the source renamed, from configuration (CON-512): flags and links name the new id. */
export const renameSchema = z.object({ from: refSchema, to: refSchema })
export type Rename = z.infer<typeof renameSchema>
export const snapshotSchema = z.object({
  sourceVersion: z.string().min(1),
  complete: z.boolean(),
  definitions: z.array(definitionSchema),
  warnings: z.array(warningSchema),
  renames: z.array(renameSchema).optional(),
  /** Where the next read may start (a commit, a change token); the core stores it. */
  cursor: z.string().min(1).max(500).optional(),
  /** What the cursor names is as it was: the core keeps what the last read found. */
  unchanged: z.literal(true).optional(),
  /** The groups the read was narrowed to, an allow list; absent when it read every group. */
  groups: z.array(z.string().min(1).max(500)).max(2_000).optional(),
  /** The groups the read found that its allow list leaves out; a choice, not a warning. */
  notSelected: z.array(z.string().min(1).max(500)).optional(),
})
export type SourceSnapshot = z.infer<typeof snapshotSchema>

/**
 * What a type of source the server's own configuration selects says about itself: its tool, for
 * the words on screen, and the administrator settings that belong to it. Core code names no
 * vendor (CON-101): the words on screen come from here or from a connector's manifest.
 */
export interface ConnectorType {
  readonly type: string
  /** The tool it reads, as people say it, for the words on screen: "Changed in Cube". */
  readonly tool: string
  /**
   * The administrator settings (FR-809) that belong to the source the server's configuration
   * selects, shown on its page in Sources.
   */
  readonly settingKeys: readonly SettingKey[]
  /**
   * Whether its dimensions of one name in different views are one dimension (the manifest's
   * `capabilities.mergeDimensions`, CON-201): `by-name` merges them into one proposed term.
   */
  readonly mergeDimensions: 'by-name' | 'never'
  /**
   * The administrator setting that holds the model folder's address in the host's web view, for
   * the source the server's configuration selects: what `capabilities.modelLinks` is for a source
   * an administrator adds.
   */
  readonly modelLinkSetting?: SettingKey
}

export type { FieldProblem } from '../../../domain/connector-config.ts'

/** A part of the server's configuration a source reads: set by whoever runs the server. */
export interface ServerSetting {
  readonly key: SourceServerSettingKey
  /** The environment variable that sets it. */
  readonly variable: string
  /** A path on the server, or null when it is not set. Never a secret. */
  readonly value: string | null
}

/** What the core hands a read: the cursor the newest good read returned, or null. */
export interface ReadContext {
  readonly cursor: string | null
}

export interface DefinitionSource {
  readonly id: string
  readonly type: string
  readonly name: string
  /** The interface its connector was written to: 3, or 2 for the demo. */
  readonly interfaceVersion: SourceInterfaceVersion
  /**
   * How its connector computes change marks (the manifest's `markVersion`). A read under another
   * version than the last one stores the new marks without flagging items (CON-116).
   */
  readonly markVersion: number
  /** The server's configuration it reads, shown read only in Sources. */
  readonly serverSettings: readonly ServerSetting[]
  /**
   * The groups the server's configuration lists for it (`CUBE_VIEWS_FILE`), read at each read: the
   * views it reads until an administrator chooses them in the app. Null when it lists none, and
   * absent from a source the server's configuration does not select.
   */
  listedGroups?(): Promise<readonly string[] | null>
  /**
   * One read: a snapshot, or a `SourceReadError` with warnings when the source cannot be read at
   * all. It changes nothing anywhere (CON-102), so the core also tests settings with it.
   */
  read(context?: ReadContext): Promise<SourceSnapshot>
}

export function domainCoverage(definitions: readonly Definition[]) {
  const coverage = { source: 0, override: 0, none: 0 }
  for (const definition of definitions) {
    if (definition.kind === 'metric') coverage[definition.domainSource]++
  }
  return coverage
}

export const sourceFailureSchema = z.object({
  error: z.literal('Cube model could not be compiled'),
  warnings: z.array(warningSchema),
})
export class SourceReadError extends Error {
  readonly warnings: SourceWarning[]
  /**
   * Why, for the schedule (CON-115): `transient` clears by itself and is tried again sooner, with
   * backoff; anything else waits for the next read, or for an administrator.
   */
  readonly errorClass: SourceErrorClass
  /** Seconds the tool asked to wait before it is read again. */
  readonly retryAfter: number | undefined
  constructor(
    warnings: SourceWarning[],
    failure: { class?: SourceErrorClass; retryAfter?: number } = {},
  ) {
    super('Source could not be read')
    this.warnings = warnings
    this.errorClass = failure.class ?? 'config'
    this.retryAfter = failure.retryAfter
  }
}
