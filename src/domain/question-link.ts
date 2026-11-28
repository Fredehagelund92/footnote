/*
  The parts of Ask someone who knows (questions.ts) that the app's first load needs: the address a
  question link opens, the answers to a Needs a recheck card's question, and how much a person
  writes there. A leaf module: it imports nothing, so the Inbox carries no schema for it.
*/

/** The answers to "Is this still true?" on a Needs a recheck card's link. */
export const checkAnswers = ['still_true', 'ended', 'unknown'] as const
export type CheckAnswer = (typeof checkAnswers)[number]

/** The page a question link opens, by its id. */
export const questionPath = (id: string) => `/question/${id}`

/**
 * The most a person writes on the page for a Nothing written yet card: what agents read first,
 * `limits.summary` (proposal-rules.ts), which tests/server/domain/questions.test.ts keeps equal.
 */
export const QUESTION_WORDS = 280
/** The most a person writes beside an answer to "Is this still true?". */
export const CHECK_WORDS = 2000
