/**
 * Writing help (domain/writing-help.ts): the editor's dock, where a person says what happened or
 * what to change and a model changes the fields of their own draft, as them. One turn is one
 * request, answered as events while it runs. The service keeps no word of a chat: the browser
 * sends the earlier turns again with each one, and the draft is read where it is stored.
 */
import * as z from 'zod/mini'
import {
  helpFieldNames,
  helpStops,
  WRITING_HELP_ANSWERS,
  WRITING_HELP_EARLIER_CHARACTERS,
  WRITING_HELP_EARLIER_TURNS,
  WRITING_HELP_MESSAGE_MAX,
} from '../domain/writing-help.ts'
import { newDraftShape } from './context.ts'

const helpField = z.enum(helpFieldNames)

/**
 * A draft started in writing help, from what the editor holds when the person first asks: a new
 * item, or a change to a published one. It is kept as the person's own draft, as Save as draft
 * keeps one, and its history says where it started.
 */
export const startWritingHelpInputSchema = z.strictObject(newDraftShape)

/** What the person said earlier in this chat and what writing help replied, as the browser kept them. */
const earlierTurnSchema = z.strictObject({
  said: z.string().check(z.maxLength(WRITING_HELP_EARLIER_CHARACTERS)),
  reply: z.string().check(z.maxLength(WRITING_HELP_EARLIER_CHARACTERS)),
})

export const writingHelpTurnInputSchema = z.strictObject({
  /** The person's own draft to write in. */
  draftId: z.string().check(z.uuid()),
  /** What happened, or what to change: their words, a pasted message, a link. */
  message: z.string().check(z.minLength(1), z.maxLength(WRITING_HELP_MESSAGE_MAX)),
  turns: z.optional(z.array(earlierTurnSchema).check(z.maxLength(WRITING_HELP_EARLIER_TURNS))),
})
export type WritingHelpTurnInput = z.infer<typeof writingHelpTurnInputSchema>

/** A field the checks refused, with why in a sentence: the rest of the turn's fields still land. */
const refusedFieldSchema = z.object({ field: helpField, why: z.string() })

/** What one write did, field by field. */
const writtenSchema = z.object({
  /** The fields changed. */
  applied: z.array(helpField),
  /** The fields the person changed since the turn started: they keep the person's words. */
  kept: z.array(helpField),
  refused: z.array(refusedFieldSchema),
  /** The draft's revision after it. */
  revision: z.number(),
})

/** A turn as it ended. */
export const writingHelpTurnSchema = z.object({
  /** What writing help says, in its own words; empty when it stopped before it said anything. */
  reply: z.string(),
  /** Every field the turn changed, in the order it changed them. */
  changed: z.array(helpField),
  kept: z.array(helpField),
  refused: z.array(refusedFieldSchema),
  /** One question back, with up to two answers to tap; null when it asks nothing. */
  question: z.nullable(
    z.object({
      text: z.string(),
      answers: z.array(z.string()).check(z.maxLength(WRITING_HELP_ANSWERS)),
    }),
  ),
  /** How many links of the message were read, and why one was not, in a sentence. */
  links: z.object({ read: z.number(), problem: z.nullable(z.string()) }),
  revision: z.number(),
  /** Why it ended before it answered; null when it answered. */
  stopped: z.nullable(z.enum(helpStops)),
  /** A spending limit that stopped it, in its own sentence. */
  limit: z.nullable(z.string()),
})
export type WritingHelpTurn = z.infer<typeof writingHelpTurnSchema>

/**
 * A turn as it runs: what it is doing, each write as its field lands (a field is written whole,
 * never part way), the reply's words so far, then the turn.
 */
export const writingHelpEventSchema = z.union([
  z.object({
    type: z.literal('progress'),
    /** `reading`: the message and its link. `looking`: what is published. `writing`: a field. */
    doing: z.enum(['reading', 'looking', 'writing']),
    /** The links being read, for `reading`. */
    links: z.optional(z.number()),
    /** The field being written, for `writing`. */
    field: z.optional(helpField),
  }),
  z.object({ type: z.literal('written'), ...writtenSchema.shape }),
  z.object({ type: z.literal('words'), text: z.string() }),
  z.object({ type: z.literal('turn'), turn: writingHelpTurnSchema }),
])
export type WritingHelpEvent = z.infer<typeof writingHelpEventSchema>
