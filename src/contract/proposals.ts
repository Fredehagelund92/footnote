import * as z from 'zod/mini'
import { draftSchema } from '../domain/draft.ts'
import { fieldStampsSchema } from '../domain/draft-stamps.ts'
import { provenanceSchema } from '../domain/provenance.ts'
import { proposalStates } from '../domain/proposal-state.ts'
import { creationChannels, itemKinds, personChannels } from '../domain/item.ts'
import { proposalActions } from '../domain/proposal.ts'
import { limits } from '../domain/proposal-rules.ts'
import { newValuesSchema } from '../domain/values.ts'
import { termSchema } from '../domain/vocabulary.ts'

export const findingSchema = z.object({
  code: z.string(),
  field: z.string(),
  message: z.string(),
  severity: z.enum(['error', 'warning']),
})
export const proposalIdSchema = z.strictObject({ id: z.string().check(z.uuid()) })
export const proposalMutationSchema = z.strictObject({
  ...proposalIdSchema.shape,
  revision: z.number().check(z.int(), z.minimum(1)),
})
/**
 * What the proposer says is wrong with the current version, on a change to an item (UX review B5):
 * optional plain text, which the reviewer reads as a quote. Empty or null clears it.
 */
const changeReasonSchema = z.nullable(z.string().check(z.maxLength(limits.changeReason)))
export const createProposalSchema = z.strictObject({
  draft: draftSchema,
  reason: z.optional(changeReasonSchema),
  /** Values its writer added in "Applies to" that the vocabulary has no term for yet. */
  newValues: z.optional(newValuesSchema),
  itemId: z.optional(z.string().check(z.regex(/^itm_[a-z0-9]{8,16}$/))),
  /** The version of that item the words were written from; left out, the version agents get now. */
  version: z.optional(z.number().check(z.int(), z.minimum(1))),
  derivedFrom: z.optional(z.string().check(z.uuid())),
  channel: z.optional(z.enum(personChannels)),
})
export const proposalRecordSchema = z.object({
  id: z.string(),
  number: z.number(),
  subject: z.enum(['item', 'vocabulary']),
  action: z.enum(proposalActions),
  state: z.enum(proposalStates),
  areaId: z.nullable(z.string()),
  itemId: z.nullable(z.string()),
  itemVersionId: z.nullable(z.string()),
  vocabularyVersionId: z.nullable(z.string()),
  title: z.string(),
  /**
   * Why: a retirement's or re-check's reason, a withdrawal's, or what is wrong with the current
   * version on a change to an item.
   */
  reason: z.nullable(z.string()),
  vocabulary: z.nullable(termSchema),
  /** Who proposed it; null when a content source's read made it (CON-603). */
  proposerId: z.nullable(z.string()),
  channel: z.enum(creationChannels),
  revision: z.number(),
  /** Item form content only; empty for proposals without an item draft. */
  draft: draftSchema,
  /**
   * Values its writer added in "Applies to" that the vocabulary has no term for yet: published
   * with it (values without figures). Empty for most.
   */
  newValues: newValuesSchema,
  /**
   * Where each field came from when an AI agent or writing help wrote in the draft for the person
   * (FR-121); null for a draft only a person wrote.
   */
  provenance: z.nullable(provenanceSchema),
  /**
   * Who last changed each field, the person, their agent or writing help, at which revision and
   * when (Route 1): the editor tells the person what a writer changed. Empty for a field nobody changed since
   * Footnote kept who does.
   */
  fieldStamps: fieldStampsSchema,
  /**
   * The agent that sent it for the person (FR-420), by its name when it did; null for anything
   * else.
   */
  agent: z.nullable(z.object({ id: z.string(), name: z.string() })),
  findings: z.array(findingSchema),
  claimedBy: z.nullable(z.string()),
  dueAt: z.nullable(z.string()),
  /** When it was last sent for review: how long it has waited. Null for a draft never sent. */
  submittedAt: z.nullable(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ProposalRecord = z.infer<typeof proposalRecordSchema>
export const proposalListResultSchema = z.object({
  rows: z.array(proposalRecordSchema),
  /** Readable proposals matching the filters, before pagination. */
  total: z.number().check(z.int(), z.minimum(0)),
  limit: z.number().check(z.int(), z.minimum(1), z.maximum(100)),
  offset: z.number().check(z.int(), z.minimum(0)),
})
export type ProposalListResult = z.infer<typeof proposalListResultSchema>
export const proposalListSchema = z.strictObject({
  areaId: z.optional(z.string()),
  state: z.optional(z.enum(proposalStates)),
  own: z.optional(z.boolean()),
  /** The changes to one item, such as the open corrections Health offers to attach a test to. */
  itemId: z.optional(z.string().check(z.regex(/^itm_[a-z0-9]{8,16}$/))),
  limit: z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(100))),
  offset: z.optional(z.number().check(z.int(), z.minimum(0))),
})
export const withdrawSchema = z.strictObject({
  ...proposalMutationSchema.shape,
  reason: z.string().check(z.minLength(1), z.maxLength(500)),
})
/**
 * A test question of the proposal's area attached to its check (FR-524): its results are reported
 * with the change and never block it. Only a development question is ever attached (FR-503).
 */
export const proposalTestSchema = z.object({
  question: z.string(),
  /** A retired or saturated question is no longer checked. */
  active: z.boolean(),
  attachedHour: z.string(),
})
export type ProposalTest = z.infer<typeof proposalTestSchema>
/** A proposal that overlaps: its number, title and kind of context, and where it stands. */
const overlappingProposalSchema = z.object({
  id: z.string(),
  number: z.number(),
  title: z.string(),
  kind: z.enum(itemKinds),
  state: z.enum(proposalStates),
})
/** Duplicates and conflicts (FR-109, FR-209): what else covers the same scope and dates. */
export const overlapSchema = z.object({
  /** Accepted items in service. */
  accepted: z.array(z.object({ id: z.string(), title: z.string(), kind: z.enum(itemKinds) })),
  /** The person's own open proposals. */
  ownProposals: z.array(overlappingProposalSchema),
  /**
   * Other people's open proposals that the person reviews: an owner of their area, or an
   * administrator. Empty for anyone else, who gets only `otherProposalExists`.
   */
  otherProposals: z.array(overlappingProposalSchema),
  /** Whether anyone else has an open proposal that overlaps, including ones not listed. */
  otherProposalExists: z.boolean(),
})
