/*
  What Ask's loop is sent of a chat (FR-719.1): the last turns, each a compact record of how it was
  asked and answered and the reads it made, never a data value. The browser builds them and sends
  them with each question; the service reads them in memory and keeps them nowhere (FR-602,
  FR-717). Past `CHAT_TURNS`, or past `CHAT_CHARS` together, the oldest turn drops out whole.
*/

/** The most turns of a chat the browser sends. */
export const CHAT_TURNS = 6
/** The most sources one turn carries. */
export const CHAT_SOURCES = 10
/** The longest a turn's line of what it was read as, or of what it answered, may be. */
export const CHAT_LINE = 200
/** The most meanings Ask's question names: one sentence can say no more, and counts the rest. */
export const SAID_MEANINGS = 8
/** The most characters a chat's turns may hold together; one turn at its largest always fits. */
export const CHAT_CHARS = 4_000
/** The longest of Ask's earlier replies the browser sends its loop back, and the most reads of one turn. */
export const LOOP_REPLY = 4_000
export const LOOP_READS = 8

/** One turn of a chat, as the browser sends it with the next question. Never stored. */
export type ChatTurn = {
  /** Its question, as asked. */
  question: string
  /** Its sources, by item id, in the order the answer numbered them; at most 10. */
  sources: string[]
  /** The question Ask asked back, when the turn was one. */
  asked?: string | undefined
  /** How it was read, in words. */
  understood?: string | null | undefined
  /** What it answered in one sentence, from a template: never an item's words or a data value. */
  headline?: string | null | undefined
  /**
   * What Ask said, as the person read it, and the reads the turn made, by tool and input
   * (FR-719.1). The service makes each read again before the model sees its result.
   */
  reply?: string | undefined
  reads?: { tool: string; input: Record<string, unknown> }[] | undefined
}

/** What a turn holds toward `CHAT_CHARS`; the loop's reply has its own cap. */
const charsOf = (t: ChatTurn) =>
  t.question.length +
  (t.understood?.length ?? 0) +
  (t.headline?.length ?? 0) +
  (t.asked?.length ?? 0) +
  t.sources.join('').length

/** The turns the browser sends, oldest first: the newest that fit both caps. */
export function fitChat<T extends ChatTurn>(turns: readonly T[]): T[] {
  const fitted = turns.slice(-CHAT_TURNS)
  let chars = fitted.reduce((sum, t) => sum + charsOf(t), 0)
  while (chars > CHAT_CHARS && fitted.length > 1) chars -= charsOf(fitted.shift()!)
  return fitted
}
