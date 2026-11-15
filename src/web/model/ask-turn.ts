import type { LookupEvent } from '@contract/answer'
import type { Answer } from './ask'

// One question and its answer in Ask's chat, as the look-up's events arrive (docs/product.md,
// section 5): the question shows the moment it is sent, the look-up's real steps say what it is
// doing, the state and the sources come with the engine's answer, and the words grow a checked
// sentence at a time. Pure: the page feeds it the events (src/web/pages/ask.tsx).

/** Where an answer has got to: looking up, reading what it found, writing its words, or done. */
export type Stage = 'looking' | 'reading' | 'writing' | 'done'

/** What a look-up tells the chat as it runs. */
export type AskEvent =
  /** Ask's planner chose what to look up (FR-719): what the working line says while it runs. */
  | { type: 'plan'; working: string }
  /** The look-up found its context items: how many. */
  | { type: 'found'; items: number }
  /** The engine's answer, with its own words: the state and the sources are final from here. */
  | { type: 'answer'; answer: Answer }
  /** A sentence of a model's words that passed the check. */
  | { type: 'sentence'; text: string }
  /** Ask's loop: each read so far, by code, and the nouns they named. */
  | { type: 'reads'; reads: LoopReads }

/** What Ask's loop has read so far in a turn: each read's step, and the nouns its chips draw. */
export type LoopReads = Required<
  Pick<Extract<LookupEvent, { type: 'progress' }>, 'steps' | 'nouns'>
>

/** The calls a live answer gets: its events as they come, and a signal that stops it. */
export type AskLive = { signal?: AbortSignal; onEvent?: (event: AskEvent) => void }

export type Turn = {
  /** The question, and once it is in, the engine's answer to it. */
  answer: Answer
  /** When it was asked, in this page's time (0 for an answer already in): asked again, it starts over. */
  asked: number
  /** Whether `answer` is the engine's answer yet, or only the question. */
  answered: boolean
  stage: Stage
  /** Stopped by the person: it keeps what it showed and says it is not finished. */
  stopped: boolean
  /** Nothing came back: why, in a sentence. The question stays, to ask again. */
  error: string | null
  /** How many context items the look-up found, once it has. */
  found: number | null
  /** What the planner chose to look up, in the working line's words, once it has. */
  working: string | null
  /** A model's words so far, a sentence at a time; with none, the answer's own words show. */
  sentences: string[]
  /** What Ask's loop has read so far, while it reads. */
  reads?: LoopReads
}

/** A question just sent: it shows at once, looking up. */
export const askedTurn = (
  id: string,
  question: string,
  extra: Pick<Answer, 'parts' | 'scope' | 'again'> = {},
): Turn => ({
  answer: {
    id,
    question,
    metric: '',
    markets: [],
    state: null,
    text: '',
    sources: [],
    said: '',
    ...extra,
  },
  asked: performance.now(),
  answered: false,
  stage: 'looking',
  stopped: false,
  error: null,
  found: null,
  working: null,
  sentences: [],
})

/** An answer that is already in, shown finished: a chat opened again, or a draft's. */
export const doneTurn = (answer: Answer): Turn => ({
  answer,
  asked: 0,
  answered: true,
  stage: 'done',
  stopped: false,
  error: null,
  found: answer.sources.length,
  working: null,
  sentences: [],
})

/**
 * What a question that got no answer says in the thread. Offline it says that, and what to do; online
 * it says why after the colon, an ordinary capitalised first word lower-cased and an acronym not.
 */
export function unansweredIn(message: string, online: boolean): string {
  if (!online) return "You're offline. Ask again when you're back."
  const reason = message.trim().replace(/[.!?]+$/, '') || "The service didn't reply"
  const ordinary = /^[A-Z][a-z]/.test(reason)
  return `Couldn't get an answer: ${ordinary ? reason.charAt(0).toLowerCase() : reason.charAt(0)}${reason.slice(1)}.`
}

/** Whether the turn is still on its way: neither done, stopped nor failed. */
export const isLive = (turn: Turn) => turn.stage !== 'done' && !turn.stopped && !turn.error

export type TurnAction =
  | AskEvent
  /** The look-up is over: its finished answer, the words a model wrote or the engine's own. */
  | { type: 'done'; answer: Answer }
  /** The person pressed Stop. */
  | { type: 'stop' }
  /** Nothing came back: why, in a sentence. */
  | { type: 'error'; message: string }

/**
 * The turn after one more event. Nothing changes a stopped or failed turn, and a finished one
 * takes only Stop: its last words can still be on their way to the screen.
 */
export function turnReducer(turn: Turn, action: TurnAction): Turn {
  if (turn.stopped || turn.error) return turn
  if (action.type === 'stop') return { ...turn, stopped: true }
  if (turn.stage === 'done') return turn
  // The question as it was sent: its id in the chat, and the mentions it was asked with. Asked
  // again in words, the chat keeps what was typed and what it repeated.
  const { id, parts, scope, again, question } = turn.answer
  const keep = {
    id,
    ...(again ? { question, parts, again } : {}),
    ...(parts ? { parts } : {}),
    ...(scope ? { scope } : {}),
  }
  switch (action.type) {
    case 'plan':
      return { ...turn, working: action.working }
    case 'found':
      return { ...turn, stage: 'reading', found: action.items }
    case 'answer':
      return {
        ...turn,
        answer: { ...action.answer, ...keep },
        answered: true,
        stage: 'writing',
        found: action.answer.sources.length,
      }
    case 'sentence':
      return { ...turn, stage: 'writing', sentences: [...turn.sentences, action.text] }
    case 'reads':
      return { ...turn, reads: action.reads }
    case 'done':
      return {
        ...turn,
        answer: { ...action.answer, ...keep },
        answered: true,
        stage: 'done',
        found: action.answer.sources.length,
      }
    case 'error':
      return { ...turn, error: action.message }
  }
}

/**
 * The words the turn shows: the finished answer's once it is done, else the sentences a model has
 * written so far (a stopped answer keeps only those).
 */
export const shownText = (turn: Turn) =>
  turn.stage === 'done' ? turn.answer.text : turn.sentences.join(' ')

/**
 * How a turn ended, once it has: the one value that says whether it joins the history, is kept
 * with the chat, is carried to the next question, which body draws it, and what Ask again does to
 * the answer it had (`effectsOf`). Null while the turn is on its way.
 *
 *   answered     the engine's answer, or the loop's
 *   not_checked  the check could not run: the service failed, or nothing came back (Not checked)
 *   limit        Ask's loop stopped at a limit, with its fixed sentence
 *   stopped      the person pressed Stop; `answered` when the engine's answer was already in
 *   refused      Ask refused the question: why, in a sentence
 */
export type Outcome =
  | { kind: 'answered' }
  | { kind: 'not_checked' }
  | { kind: 'limit' }
  | { kind: 'stopped'; answered: boolean }
  | { kind: 'refused'; message: string }

/** How a finished answer ended: answered, Not checked, or the loop's limit. */
export function outcomeOfAnswer(answer: Answer): Outcome {
  if (answer.stopped) return { kind: 'limit' }
  // A loop answer that says Not checked has its own words and reads: it is an answer.
  if (answer.state === 'failed' && !answer.loop) return { kind: 'not_checked' }
  return { kind: 'answered' }
}

export function outcomeOf(turn: Turn): Outcome | null {
  if (turn.error) return { kind: 'refused', message: turn.error }
  if (turn.stopped) return { kind: 'stopped', answered: turn.answered }
  if (turn.stage !== 'done') return null
  return outcomeOfAnswer(turn.answer)
}

export type Effects = {
  /** It starts the chat in the history. */
  joins: boolean
  /** It is kept with the chat, so the chat opens again on it. */
  kept: boolean
  /** It goes with the next question, as the chat before it. */
  carried: boolean
  /** Asked again, it gives back the answer the turn had before. */
  restores: boolean
}

/** What a turn's outcome does: the one table the page reads. */
export function effectsOf(outcome: Outcome): Effects {
  switch (outcome.kind) {
    case 'answered':
    case 'limit':
      return { joins: true, kept: true, carried: true, restores: false }
    case 'not_checked':
    case 'refused':
      return { joins: false, kept: false, carried: false, restores: true }
    // Stopped once the engine's answer was in, it shows the new answer's words; before, nothing new.
    case 'stopped':
      return {
        joins: outcome.answered,
        kept: false,
        carried: outcome.answered,
        restores: !outcome.answered,
      }
  }
}

/**
 * Whether Ask's loop body draws the turn: a loop answer, or one still reading or stopped while it
 * read. A Not checked turn is drawn as the check that could not run, whatever it read first.
 */
export const drawnByLoop = (turn: Turn) =>
  !!turn.answer.loop || (!!turn.reads && outcomeOf(turn)?.kind !== 'not_checked')
