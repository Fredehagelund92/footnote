import type { Answer, AskInput, Example, Thread } from './ask'
import { effectsOf, isLive, outcomeOf, type Turn } from './ask-turn'

// Which chat a thread in Ask is, and whether it has joined the history. One value per mounted
// thread: it is made when the thread mounts and goes with it, so a thread that was left and comes
// back (Back, a reload, a chat opened from the history) is worked out again from the address and
// the kept chats alone. Pure: the page feeds it the address and the answers as they come
// (src/web/pages/ask.tsx).
//
//   fresh   an empty thread: nothing is answered yet
//   example an example, opened on its own answer; it is in the history already
//   history a chat opened from the history, a reload, Back or Forward: its kept answers, or else
//           (one past the newest kept) its first question, which asks nothing until the person
//           asks it again: opening a chat never calls a model (H20)
//   live    a thread in which a turn was answered: the thread shows itself, nothing is read for it

/** Where the address points: an example, a chat, or neither (a new chat). */
export type Place = { example: string | null; chat: string | null }

export type Session =
  | { kind: 'fresh' }
  | { kind: 'example'; example: string }
  | {
      kind: 'history'
      chat: string
      question: string
      /** What was kept with the chat; none, and its first question is asked again. */
      answers: Answer[] | null
    }
  | { kind: 'live'; chat: string }

/** The place a chat opens at: an example's own address, or the chat's. */
export const placeOf = (thread: Pick<Thread, 'id' | 'example'>): Place =>
  thread.example ? { example: thread.example, chat: null } : { example: null, chat: thread.id }

/** What the thread is when it mounts, from where the address points and the chats kept. */
export function sessionOf(place: Place, threads: readonly Thread[]): Session {
  if (place.example) return { kind: 'example', example: place.example }
  const thread = threads.find((t) => t.id === place.chat)
  if (!thread) return { kind: 'fresh' }
  if (thread.example) return { kind: 'example', example: thread.example }
  return {
    kind: 'history',
    chat: thread.id,
    question: thread.question,
    answers: thread.answers?.length ? thread.answers : null,
  }
}

/**
 * What Ask is asked for the thread's first answer: an example's own. A chat from the history is
 * never asked again by opening it; with nothing kept it opens on its question (`NOT_KEPT`).
 */
export function firstRead(session: Session): AskInput | null {
  if (session.kind === 'example') return { example: session.example }
  return null
}

/** What a chat opened with no answers kept says under its question, beside Ask again. */
export const NOT_KEPT =
  'Its answers are no longer kept in this browser, so nothing was asked. Ask again to answer it now.'

/** Whether the thread opens on a chat whose answers were not kept: its question, to ask again. */
export const notKept = (session: Session): session is Extract<Session, { kind: 'history' }> =>
  session.kind === 'history' && !session.answers

/** The answers a thread opens on, given its first read; none until that has come. */
export function openingAnswers(session: Session, first: Answer | undefined): Answer[] {
  if (session.kind === 'history' && session.answers) return session.answers
  return first ? [first] : []
}

/** The question a thread opens on when its first read failed: the chat's own, or the example's. */
export function openingQuestion(
  session: Session,
  examples: readonly Pick<Example, 'id' | 'question'>[],
) {
  if (session.kind === 'history') return session.question
  if (session.kind === 'example')
    return examples.find((e) => e.id === session.example)?.question ?? ''
  return ''
}

export type SessionEvent = {
  /** A turn was answered, whichever button asked it: the first question, Ask again, a follow-up. */
  type: 'answered'
  /** The question of that turn. */
  question: string
  /** The id a chat that starts here gets. */
  mint: string
}

/** A chat joining the history: its id and its first question. */
export type Join = { chat: string; question: string }

/**
 * The session after an event, and the chat it joins to the history, if any. A thread joins once:
 * on its first answered turn, and not before, so a first question that was stopped or failed
 * leaves it fresh. A new chat is always a chat of its own, even when an earlier chat began with
 * the same question: it never takes that chat's place. The same session comes back when nothing
 * changed.
 */
export function reduce(
  session: Session,
  event: SessionEvent,
): { session: Session; join: Join | null } {
  switch (session.kind) {
    case 'fresh':
      return {
        session: { kind: 'live', chat: event.mint },
        join: { chat: event.mint, question: event.question },
      }
    case 'history':
      return { session: { kind: 'live', chat: session.chat }, join: null }
    case 'example':
    case 'live':
      return { session, join: null }
  }
}

/**
 * A chat keeps its answers with it, so it opens again as it was and asks nothing: every turn whose
 * outcome is kept, once none is on its way. A stopped, refused or Not checked turn is left out and
 * does not stop the rest being kept. None when no turn is kept.
 */
export function keptAnswers(turns: readonly Turn[]): Answer[] | null {
  if (turns.some(isLive)) return null
  const kept = turns.filter((t) => {
    const outcome = outcomeOf(t)
    return !!outcome && effectsOf(outcome).kept
  })
  return kept.length > 0 ? kept.map((t) => t.answer) : null
}

/** The id for the next turn: `t<n>`, past every id the chat already holds (kept turns can skip). */
export function nextTurnId(turns: readonly Pick<Turn, 'answer'>[]) {
  const taken = new Set(turns.map((t) => t.answer.id))
  let n = turns.length
  while (taken.has(`t${n}`)) n++
  return `t${n}`
}
