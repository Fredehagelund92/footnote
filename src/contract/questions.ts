import * as z from 'zod/mini'
import { checkAnswers, CHECK_WORDS, QUESTION_WORDS } from '../domain/questions.ts'
import { calendarDateSchema } from '../domain/validity.ts'

/**
 * Ask someone who knows (src/domain/questions.ts): an owner copies a link for a Nothing written yet
 * card or a Needs a recheck card, and anyone signed in who opens it answers one question. The page
 * reads the topic, never the words of a question; a count under the minimum reads as hidden
 * (FR-614). An answer to a Nothing written yet card is a suggestion under the person's name, which
 * may come without a source; one to a Needs a recheck card is kept for the owner, who still does
 * the check. Nothing either keeps reaches an agent before a publish.
 */

const linkId = z.string().check(z.uuid())
const words = (max: number) => z.string().check(z.trim(), z.minLength(1), z.maxLength(max))
/** A link to where it is written, if the person has one. */
const sourceLink = z.string().check(z.trim(), z.maxLength(2000), z.regex(/^https?:\/\/\S+$/))
const days = z
  .object({ start: calendarDateSchema, end: calendarDateSchema })
  .check(z.refine(({ start, end }) => end > start, 'End must be after start (exclusive)'))

export const copyQuestionLinkSchema = z.strictObject({
  /** The card it is for: "gap:<gap id>" or "check:<item id>". */
  card: z.string().check(z.regex(/^(gap:[0-9a-f-]{36}|check:itm_[a-z0-9]{8,16})$/)),
})
/** The link's id, its address on the page, and the day it was copied, which the card shows. */
export const questionLinkSchema = z.object({ id: z.string(), copiedOn: z.string() })
export type QuestionLink = z.infer<typeof questionLinkSchema>

export const questionIdSchema = z.strictObject({ id: linkId })

/** The one question a link asks, as the page shows it. */
export const questionSchema = z.object({
  id: z.string(),
  kind: z.enum(['gap', 'check']),
  /**
   * What it is about, in words: the metric and the market for a gap ("Orders in Germany"), the
   * item's title for a check. Never the words of a question.
   */
  topic: z.string(),
  /** The days it is about, end exclusive: a gap's month, or the item's own dates (end null: still going). */
  dates: z.object({ start: z.string(), end: z.nullable(z.string()) }),
  /** How often agents found nothing for it this week: null under the minimum (FR-614); null for a check. */
  times: z.nullable(z.number()),
  /** The privacy minimum a count is hidden under: the page says "fewer than" this. */
  minimum: z.number(),
  /** For a check: what the item says. */
  item: z.nullable(z.object({ summary: z.string() })),
  /** The domain, and the owners who get the answer, by name. */
  domain: z.string(),
  owners: z.array(z.string()),
  /** Whether it still waits for an answer: a gap that is covered or set aside, an archived item, do not. */
  open: z.boolean(),
})
export type Question = z.infer<typeof questionSchema>

export const answerQuestionSchema = z.union([
  z.strictObject({
    id: linkId,
    kind: z.literal('gap'),
    /** What happened, in the person's words. */
    words: words(QUESTION_WORDS),
    dates: days,
    link: z.optional(sourceLink),
  }),
  z.strictObject({
    id: linkId,
    kind: z.literal('check'),
    answer: z.enum(checkAnswers),
    /** The day it ended: only with the answer `ended`. */
    endedOn: z.optional(calendarDateSchema),
    words: z.optional(words(CHECK_WORDS)),
    link: z.optional(sourceLink),
  }),
])
export type AnswerQuestion = z.infer<typeof answerQuestionSchema>
/** The suggestion an answer to a gap made; null for an answer to a check. */
export const answeredSchema = z.object({ proposalId: z.nullable(z.string()) })
