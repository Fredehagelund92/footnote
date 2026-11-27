import * as z from 'zod/mini'
import type { Draft } from './draft.ts'
import { changedFields } from './provenance.ts'
import { markedFields, type MarkedField } from './proposal-rules.ts'

/*
  Who last changed each field of a draft (Route 1, slice R1a): the person, in Footnote, or their
  agent, through write_draft, at which revision and when. A draft is one object the person and
  their agent both edit; the agent sees the person's edits only when it reads the draft again, so
  a write from an agent that read an older revision must never overwrite a field the person
  changed since. Each field is checked on its own: what the person did not touch still changes.
*/

/** The fields of a draft an agent reads and writes, by the names it uses, and the field each is. */
export const draftFields = {
  title: 'title',
  summary: 'summary',
  text: 'body',
  kind: 'kind',
  area: 'areaId',
  scope: 'scope',
  window: 'validity',
  evidence: 'evidence',
  not_to_conclude: 'notToConclude',
} as const satisfies Record<string, MarkedField>
export type DraftFieldName = keyof typeof draftFields
export const draftFieldNames = Object.keys(draftFields) as DraftFieldName[]

export const fieldStampSchema = z.strictObject({
  by: z.enum(['person', 'agent']),
  revision: z.number().check(z.int(), z.minimum(1)),
  at: z.string(),
})
export type FieldStamp = z.infer<typeof fieldStampSchema>
export const fieldStampsSchema = z.partialRecord(z.enum(markedFields), fieldStampSchema)
export type FieldStamps = z.infer<typeof fieldStampsSchema>

/**
 * The stamps after `after` was saved over `before` as `revision`: each field whose value changed
 * is stamped with who changed it and when; the rest keep theirs.
 */
export function stampsAfter(
  stamps: FieldStamps,
  before: Draft,
  after: Draft,
  stamp: FieldStamp,
): FieldStamps {
  const next: FieldStamps = { ...stamps }
  for (const field of changedFields(before, after)) next[field] = stamp
  return next
}

/**
 * The fields of `fields` the person changed after the revision an agent read: a write from that
 * agent leaves them as they are.
 */
export const personChangedSince = (
  stamps: FieldStamps,
  fields: readonly DraftFieldName[],
  revision: number,
): DraftFieldName[] =>
  fields.filter((name) => {
    const stamp = stamps[draftFields[name]]
    return stamp?.by === 'person' && stamp.revision > revision
  })

/** The fields changed after a revision, by anyone: what an agent reads as changed since it looked. */
export const changedSince = (stamps: FieldStamps, revision: number): DraftFieldName[] =>
  draftFieldNames.filter((name) => (stamps[draftFields[name]]?.revision ?? 0) > revision)
