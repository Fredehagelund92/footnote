import { normalizeName } from './vocabulary.ts'

/*
  What is settled about a message before any model is called (FR-719): one that only asks to repeat
  the last question, which the browser asks again as Ask again does. Pure, so the page and its
  tests read a message alike.
*/

/** A message's words, as they are matched here: lower case, no marks, no courtesies around them. */
function bareWords(message: string) {
  const words = normalizeName(message)
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return words
    .replace(/^(?:(?:please|pls|ok|okay|hey|hi|sorry|just|can you|could you|would you|lets) )+/, '')
    .replace(/(?: (?:please|pls|thanks|thank you|now))+$/, '')
}

/** A message that only asks for the last question again. English is the language Ask reads. */
const ONLY_AGAIN =
  /^(?:(?:try|ask|run|do|go|check|look|search)(?: (?:it|that|this|the question))? (?:again|once more|one more time)|again|retry|re try|rerun|re run|reask|re ask|redo|re do|repeat(?: (?:it|that|the question))?|once more|one more time|(?:the )?same (?:question|again|thing)(?: again)?|(?:another|one more) (?:try|go|attempt))$/

/** Whether a message only asks for the last question again ("try again", "same question"). */
export const asksAgain = (message: string) => ONLY_AGAIN.test(bareWords(message))
