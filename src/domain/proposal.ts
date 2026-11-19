import * as z from 'zod/mini'
import { creationChannels } from './item.ts'
import { proposalStates } from './proposal-state.ts'

export const proposalActions = ['create', 'change', 'retire', 'recheck'] as const
/** The capacities a recorded decision names: an owner of the domain, or an administrator. */
export const decisionCapacities = ['owner', 'administrator'] as const
export type DecisionCapacity = (typeof decisionCapacities)[number]
const id = z.string().check(z.minLength(1))
export const proposalSchema = z
  .strictObject({
    id,
    number: z.number().check(z.int(), z.minimum(1)),
    subject: z.enum(['item', 'vocabulary']),
    action: z.enum(proposalActions),
    state: z.enum(proposalStates),
    areaId: id,
    itemId: z.nullable(id),
    itemVersionId: z.nullable(id),
    vocabularyVersionId: z.nullable(id),
    proposerId: id,
    createdVia: z.enum(creationChannels),
    revision: z.number().check(z.int(), z.minimum(1)),
    reason: z.nullable(z.string().check(z.maxLength(500))),
    closedAt: z.nullable(z.string().check(z.iso.datetime())),
  })
  .check(
    z.refine(
      (p) =>
        p.subject === 'item'
          ? p.vocabularyVersionId === null
          : p.itemId === null && p.itemVersionId === null,
      'Version must match the suggestion subject',
    ),
    z.refine(
      (p) =>
        p.state === 'draft' ||
        p.itemVersionId !== null ||
        p.vocabularyVersionId !== null ||
        p.action === 'retire',
      'A submitted suggestion needs a version',
    ),
    z.refine(
      (p) =>
        p.action !== 'retire' || (p.subject === 'item' && p.itemId !== null && !!p.reason?.trim()),
      'Retirement needs an item and a reason',
    ),
    z.refine(
      (p) => ['accepted', 'rejected', 'withdrawn'].includes(p.state) === (p.closedAt !== null),
      'Closed states need a closing time',
    ),
  )
export type Proposal = z.infer<typeof proposalSchema>
