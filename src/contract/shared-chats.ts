import * as z from 'zod/mini'
import { answerStates } from '../domain/answer-state.ts'

/**
 * A chat shared as a link (FR-721): a person sends a copy of one Ask chat on purpose, under their
 * name. Each turn keeps its question, what Ask read, its state, its words and its sources by id,
 * never a figure. A turn that rests on a draft is kept as left out, with no words. Anyone signed in
 * opens a live link; each source is read as the reader when it opens, and a turn that rests on one
 * they may not read keeps its question and state without its words. A link lasts 90 days and its
 * sender stops it, which deletes the copy. Agents never read any of it.
 */

/** How long a link lasts. */
export const SHARED_CHAT_DAYS = 90

const words = (max: number) => z.string().check(z.trim(), z.minLength(1), z.maxLength(max))
const itemRef = z.string().check(z.regex(/^itm_[a-z0-9]{8,16}$/))
/** A chat's id in its sender's browser. */
const chatRef = z.string().check(z.regex(/^[A-Za-z0-9_-]{1,80}$/))

/** One turn as the browser sends it: [n] in its words points at sources[n - 1]. */
export const shareTurnSchema = z.strictObject({
  question: words(2000),
  /** What Ask read, a line each, as the answer said it. */
  read: z.array(z.string().check(z.maxLength(500))).check(z.maxLength(20)),
  /** Null when nothing was looked up. */
  state: z.nullable(z.enum(answerStates)),
  words: z.string().check(z.maxLength(20_000)),
  sources: z.array(itemRef).check(z.maxLength(50)),
})
export type ShareTurn = z.infer<typeof shareTurnSchema>

export const shareChatInputSchema = z.strictObject({
  chat: chatRef,
  title: words(500),
  turns: z.array(shareTurnSchema).check(z.minLength(1), z.maxLength(100)),
})
export type ShareChatInput = z.infer<typeof shareChatInputSchema>

/** One of the person's own links: which chat, until when, and how many turns it keeps. */
export const myShareSchema = z.object({
  id: z.string(),
  chat: z.string(),
  title: z.string(),
  at: z.string(),
  until: z.string(),
  /** Every turn of the chat when it was shared, those left out too. */
  turns: z.number(),
  /** The turns left out, as they rest on a draft. */
  left: z.number(),
})
export type MyShare = z.infer<typeof myShareSchema>

/** Whether chats may be shared now, and the person's own live links, newest first. */
export const mySharesSchema = z.object({ on: z.boolean(), links: z.array(myShareSchema) })
export type MyShares = z.infer<typeof mySharesSchema>

export const sharedChatIdSchema = z.strictObject({ id: z.string().check(z.uuid()) })

/**
 * A turn as a reader opens it. A source they may not read is null, in its place, so [n] still
 * counts; a turn that rests on one has no words. A turn left out keeps nothing but why.
 */
export const sharedTurnSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('turn'),
    question: z.string(),
    read: z.array(z.string()),
    state: z.nullable(z.enum(answerStates)),
    words: z.nullable(z.string()),
    sources: z.array(z.nullable(z.string())),
  }),
  z.object({ kind: z.literal('left'), why: z.literal('draft') }),
])
export type SharedTurn = z.infer<typeof sharedTurnSchema>

export const sharedChatSchema = z.object({
  id: z.string(),
  title: z.string(),
  by: z.object({ personId: z.string(), name: z.nullable(z.string()) }),
  at: z.string(),
  until: z.string(),
  /** The reader is its sender. */
  mine: z.boolean(),
  turns: z.array(sharedTurnSchema),
})
export type SharedChat = z.infer<typeof sharedChatSchema>
