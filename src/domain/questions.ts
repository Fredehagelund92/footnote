/*
  Ask someone who knows: an owner passes a Nothing written yet card, or a Due for a check card, on
  as a link that opens one page with one question. Footnote sends nothing: the owner copies the
  link and pastes it where the company talks, and the card keeps only the day it was copied, never
  who opened it. The page shows the topic (metric, market, dates), never the words of a question.

  On a Nothing written yet card the answer is a suggestion under the person's name, which may come
  without a source: its owner adds or confirms one before publishing (item-version.ts). On a Due for
  a check card it is one of three answers the owner reads on the card, and the owner still does the
  check. Nothing a person types reaches an agent before a publish. Pure.
*/
import type { Draft } from './draft.ts'
import { evidenceEntrySchema } from './item-version.ts'
import { limits } from './proposal-rules.ts'
import { shiftDate } from './validity.ts'

export {
  checkAnswers,
  CHECK_WORDS,
  QUESTION_WORDS,
  questionPath,
  type CheckAnswer,
} from './question-link.ts'

/** A topic's calendar month as the dates the page opens with: its first day to the next month's (end exclusive). */
export function monthWindow(month: string): { start: string; end: string } {
  const start = `${month.slice(0, 7)}-01`
  // 31 days on from a first day is always in the next month.
  return { start, end: `${shiftDate(start, 31).slice(0, 7)}-01` }
}

/**
 * A suggestion's title from the person's words: their first sentence, as long as a title may be.
 * The owner reads it as the title and changes it when they publish.
 */
export function titleOfWords(words: string): string {
  const text = words.trim().replace(/\s+/g, ' ')
  const first = /^(.+?[.!?])(?:\s|$)/.exec(text)?.[1] ?? text
  const chars = [...first]
  return chars.length <= limits.title ? first : `${chars.slice(0, limits.title - 1).join('')}…`
}

/**
 * The links a sender gave on the question page without a sentence from them: in the draft, for
 * the owner to confirm, never in the version agents could get.
 */
export const linksToConfirm = (draft: Pick<Draft, 'evidence'>): string[] =>
  (draft.evidence ?? []).flatMap((entry) =>
    entry.url && !evidenceEntrySchema.safeParse(entry).success ? [entry.url] : [],
  )
