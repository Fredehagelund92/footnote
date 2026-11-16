/**
 * Undo (FR-227): a write that can be taken back answers with an offer, and `decisions.undo` takes
 * the offer's token.
 */
import * as z from 'zod/mini'

/** A token that takes one decision, or one step of several, back (FR-227). */
export const undoTokenSchema = z.string().check(z.regex(/^[a-z]+:[A-Za-z0-9_.:,-]{1,4000}$/))

/**
 * What a write that can be taken back answers with (FR-227): the token, and until when the service
 * takes it (`limits.undo_seconds` after the write), so a screen offers Undo for exactly that long.
 * `until` is null when it is taken at any time, as for a set-aside gap.
 */
export const undoOfferSchema = z.object({ token: undoTokenSchema, until: z.nullable(z.string()) })

export type UndoOffer = z.infer<typeof undoOfferSchema>
