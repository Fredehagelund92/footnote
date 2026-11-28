import * as React from 'react'
import { toApiError } from '@/api/errors'
import { storageKey } from '@/lib/brand'
import { joinChanges, type AgentChange, type SessionField } from '@/model/draft-session'
import {
  askedTurn,
  doneTurn,
  earlierTurns,
  failedTurn,
  heardTurn,
  stoppedTurn,
  suggestedTurn,
  type HelpLive,
  type HelpReply,
  type HelpTurn,
} from '@/model/writing-help'

// Writing help between the editor and the dock beside it (Route 3). The dock is drawn by the
// app's shell and the draft by the page, so they meet here: the editor says which draft it holds
// and how to reach it (its desk), and the dock shows the chat about that draft and sends what the
// person says. A turn, its chat and what it changed are kept here, not in the page, so they
// outlast the page being drawn again, as it is when the address moves from a new item to its
// draft. All of it is the browser's memory for the visit: the service stores no word of a chat.

/** What the editor gives writing help to work with: the draft it holds, and how to reach it. */
export type HelpDesk = {
  /** The page itself, as its address names it: the chat of a page with no draft yet is its own. */
  page: string
  /** The person's own draft the page edits; null on a page whose words are no draft yet. */
  draftId: string | null
  /**
   * Makes the draft ready to write in: what the person wrote is stored first. On a page with no
   * draft yet, its words are kept as one and the page moves to it: then the answer is null, and
   * the turn starts once that page is there.
   */
  ready: () => Promise<string | null>
  /** One turn on the draft, through the app's own write. */
  ask: (
    input: { draftId: string; message: string; turns: { said: string; reply: string }[] },
    live: HelpLive,
  ) => Promise<HelpReply>
  /** Reads the draft again now, so what a turn wrote shows at once. */
  refresh: () => Promise<void>
  /** Takes a change back in the form: each field as it was, unless the person changed it since. */
  revert: (change: AgentChange) => void
  /** What the page knew when the person came from a card, said at the top of the chat. */
  opening?: HelpOpening | null
}

/** A chat's opening line: what the card the person came from knew, and what it asks of them. */
export type HelpOpening = { known: string; ask: string }

/** What one turn changed in the draft, as one change: `turn` is empty for one made elsewhere. */
type TurnChange = { turn: string; change: AgentChange }

/** The chat of no page at all: where the dock reads when none is there. */
const NEW = ''
/** The chat about a page with no draft yet, by the page: it becomes the draft's once it is there. */
const pageChat = (desk: HelpDesk) => `page:${desk.page}`

type State = {
  desk: HelpDesk | null
  /** Each draft's chat, by the draft's id. */
  chats: ReadonlyMap<string, readonly HelpTurn[]>
  /** What writing help changed in each draft, a turn at a time, the latest last. */
  changes: ReadonlyMap<string, readonly TurnChange[]>
  /** The turn that waits for its draft's page to be there, by the draft's id. */
  waiting: { draft: string; turn: string } | null
  /** Each chat's opening line, by the chat: it moves with the chat to its draft. */
  openings: ReadonlyMap<string, HelpOpening>
}

let state: State = {
  desk: null,
  chats: new Map(),
  changes: new Map(),
  waiting: null,
  openings: new Map(),
}
const listeners = new Set<() => void>()
/** The turn running on each draft, to gather its changes and to stop it. */
const running = new Map<string, { turn: string; controller: AbortController }>()
/** The turn that ended on each draft while the page reads what it wrote: its changes join its Undo. */
const settling = new Map<string, string>()
/** What stops the turn being made ready, before it is running on a draft. */
let starting: AbortController | null = null

function set(next: Partial<State>) {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

const chatOf = (draft: string) => state.chats.get(draft) ?? []

function setChat(draft: string, turns: readonly HelpTurn[]) {
  const chats = new Map(state.chats)
  chats.set(draft, turns)
  set({ chats })
}

function update(draft: string, id: string, change: (turn: HelpTurn) => HelpTurn) {
  setChat(
    draft,
    chatOf(draft).map((turn) => (turn.id === id ? change(turn) : turn)),
  )
}

let count = 0
const nextId = () => `help-${Date.now().toString(36)}-${++count}`

/** The page that holds this draft now, if one does: a page drawn again is another desk. */
const deskOf = (draft: string) => (state.desk?.draftId === draft ? state.desk : null)
const refresh = (draft: string) =>
  deskOf(draft)
    ?.refresh()
    .catch(() => undefined)

/** One turn on a draft that is there: it runs to its end, a Stop or a failure. */
async function run(ask: HelpDesk['ask'], draft: string, id: string) {
  const turn = chatOf(draft).find((t) => t.id === id)
  if (!turn) return
  const controller = new AbortController()
  running.set(draft, { turn: id, controller })
  try {
    const reply = await ask(
      {
        draftId: draft,
        message: turn.said,
        turns: earlierTurns(chatOf(draft).filter((t) => t.id !== id)),
      },
      {
        signal: controller.signal,
        onEvent: (event) => {
          update(draft, id, (t) => heardTurn(t, event))
          // A field landed: the draft is read again now, not at its next read on its own.
          if (event.type === 'written') void refresh(draft)
        },
      },
    )
    update(draft, id, (t) => doneTurn(t, reply))
  } catch (error) {
    if (controller.signal.aborted) update(draft, id, stoppedTurn)
    else {
      const failure = toApiError(error)
      update(draft, id, (t) =>
        failedTurn(t, failure.kind === 'unanswered' ? null : failure.message),
      )
    }
  } finally {
    // The turn has ended, and can be undone now. The page reads the draft again for what it wrote;
    // offline that read waits, and what it brings in still joins this turn's Undo.
    if (running.get(draft)?.controller === controller) running.delete(draft)
    settling.set(draft, id)
    set({})
    await refresh(draft)
    if (settling.get(draft) === id) settling.delete(draft)
  }
}

/** The turn that waits for its draft's page now: ready() may have set it since a guard read it. */
const waitingNow = () => state.waiting

/** The person says something to writing help about the draft on the page. */
export async function askHelp(message: string) {
  const desk = state.desk
  const said = message.trim()
  if (!desk || !said) return
  const from = desk.draftId ?? pageChat(desk)
  // One turn at a time: a turn asked and not yet ended, or one waiting for its draft's page.
  if (chatOf(from).at(-1)?.state === 'asking' || state.waiting) return
  const id = nextId()
  setChat(from, [...chatOf(from), askedTurn(id, said)])
  const controller = new AbortController()
  starting = controller
  let draft: string | null
  try {
    draft = await desk.ready()
  } catch (error) {
    const failure = toApiError(error)
    update(from, id, (t) => failedTurn(t, failure.kind === 'unanswered' ? null : failure.message))
    return
  } finally {
    if (starting === controller) starting = null
  }
  // Stopped before it started: it is never asked.
  if (controller.signal.aborted) {
    const waiting = waitingNow()
    if (waiting?.turn === id) set({ waiting: null })
    update(draft ?? waiting?.draft ?? from, id, stoppedTurn)
    return
  }
  // The page is moving to the draft it just kept: the turn starts there (`setHelpDesk`).
  if (draft === null) return
  await run(desk.ask, draft, id)
}

/** Starts the turn that waited for its draft's page, once a page holds that draft. */
function startWaiting() {
  const { desk, waiting } = state
  if (!desk?.draftId || waiting?.draft !== desk.draftId) return
  set({ waiting: null })
  void run(desk.ask, waiting.draft, waiting.turn)
}

/** The turn that waited for a draft's page ends as failed: no page came to hold the draft. */
function failWaiting() {
  const { waiting } = state
  if (!waiting) return
  set({ waiting: null })
  update(waiting.draft, waiting.turn, (t) => failedTurn(t, 'The draft did not open.'))
}

/**
 * The chat of a page with no draft yet becomes its draft's, and its last turn waits for the
 * draft's page: the editor calls this once the draft is kept. The page may move to the draft or
 * go on as it, and may hold it already.
 */
export function moveHelpChat(draft: string) {
  const from = state.desk ? pageChat(state.desk) : NEW
  const turns = chatOf(from)
  const last = turns.at(-1)
  const chats = new Map(state.chats)
  chats.delete(from)
  chats.set(draft, turns)
  const openings = new Map(state.openings)
  const opening = openings.get(from)
  openings.delete(from)
  if (opening) openings.set(draft, opening)
  const stopped = last?.state === 'asking' && !!starting?.signal.aborted
  set({
    chats,
    openings,
    waiting: last?.state === 'asking' && !stopped ? { draft, turn: last.id } : null,
  })
  if (stopped) update(draft, last.id, stoppedTurn)
  else startWaiting()
}

/**
 * Writing help changed fields of a draft, and they came into the page's form: kept as the change
 * of the turn running on it, so one Undo takes back the whole turn. A change that comes with no
 * turn running here, as one made in another window, is a change of its own.
 */
export function noteHelpChange(draft: string, change: AgentChange) {
  const turn = running.get(draft)?.turn ?? settling.get(draft) ?? ''
  const kept = state.changes.get(draft) ?? []
  const last = kept.at(-1)
  const changes = new Map(state.changes)
  changes.set(
    draft,
    turn && last?.turn === turn
      ? [...kept.slice(0, -1), { turn, change: joinChanges(last.change, change) }]
      : [...kept, { turn, change }],
  )
  set({ changes })
}

/**
 * Writing help wrote fields the person was writing in: the page kept their words, and its own wait
 * under each field to be used or dismissed. Kept with the turn that wrote them, so its reply says so.
 */
export function noteHelpSuggestion(draft: string, fields: readonly SessionField[]) {
  const turn = running.get(draft)?.turn ?? settling.get(draft)
  if (turn && fields.length) update(draft, turn, (t) => suggestedTurn(t, fields))
}

/**
 * Stops the turn of the page: one still being made ready is never asked, one waiting for its
 * draft's page never starts, and one running keeps what it wrote so far.
 */
export function stopHelp() {
  const draft = state.desk?.draftId
  starting?.abort()
  const { waiting } = state
  if (waiting) {
    set({ waiting: null })
    update(waiting.draft, waiting.turn, stoppedTurn)
  }
  if (draft) running.get(draft)?.controller.abort()
}

/**
 * Takes back what the latest turn changed in the page's draft; then the turn before it is the
 * latest. A field the person changed since stays as they wrote it.
 */
export function undoHelp() {
  const desk = state.desk
  const draft = desk?.draftId
  const kept = draft ? (state.changes.get(draft) ?? []) : []
  const last = kept.at(-1)
  if (!desk || !draft || !last || running.has(draft)) return
  desk.revert(last.change)
  const changes = new Map(state.changes)
  changes.set(draft, kept.slice(0, -1))
  set({ changes })
  if (last.turn) update(draft, last.turn, (t) => ({ ...t, undone: true }))
}

/**
 * The editor says which draft it holds, or, leaving, that it holds none. A turn that waited for
 * this draft's page starts now. A turn still running once no page holds its draft is stopped:
 * nobody is there to see what it writes.
 */
export function setHelpDesk(desk: HelpDesk | null) {
  // A page with no draft yet opens with the line of how it was reached, or with none. A draft's
  // chat keeps the line it started with, as the page it moved to was reached from no card.
  let openings = state.openings
  if (desk && !desk.draftId) {
    const page = new Map(openings)
    if (desk.opening) page.set(pageChat(desk), desk.opening)
    else page.delete(pageChat(desk))
    openings = page
  } else if (desk?.draftId && desk.opening && !openings.has(desk.draftId))
    openings = new Map(openings).set(desk.draftId, desk.opening)
  set({ desk, openings })
  // A page that holds another draft is not the one the turn waits for.
  if (desk?.draftId && state.waiting && state.waiting.draft !== desk.draftId) failWaiting()
  startWaiting()
  if (desk) return
  // After the page has settled: a page that was only drawn again is there once more by then.
  setTimeout(() => {
    for (const [draft, turn] of running) if (!deskOf(draft)) turn.controller.abort()
    if (state.waiting && !deskOf(state.waiting.draft)) failWaiting()
  }, 0)
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** Writing help for the draft on the page, from what is kept here. */
function viewOf(now: State) {
  // A page with no draft yet shows the chat of the draft it is moving to, while a turn waits there.
  const draft = now.desk?.draftId ?? now.waiting?.draft ?? (now.desk ? pageChat(now.desk) : NEW)
  const turns = now.chats.get(draft) ?? []
  const last = (now.changes.get(draft) ?? []).at(-1)
  const busy = !!now.waiting || turns.at(-1)?.state === 'asking'
  // The fields that kept the person's words in the latest turn, said with its change.
  const kept = last?.turn ? turns.find((t) => t.id === last.turn)?.reply?.kept : undefined
  return {
    /** Whether a page is there to write in: the dock says so when it is not. */
    there: !!now.desk,
    opening: now.openings.get(draft) ?? null,
    turns,
    /** A turn is running, or waits for its draft's page. */
    busy,
    /** What the latest turn changed, for the strip and its Undo; none while one runs. */
    latest:
      last && !busy ? { ...last, change: { ...last.change, ...(kept ? { kept } : {}) } } : null,
  }
}

/** Writing help as it stands now, outside a component. */
export const helpNow = () => viewOf(state)

/** Writing help as the dock and the editor's strip read it, for the draft on the page. */
export const useHelp = () => viewOf(React.useSyncExternalStore(subscribe, () => state))

/*
  The dock opens beside every new item until the person closes it; then it stays closed for them
  in this browser, until they open it again.
*/
const closedKey = (person: string) => storageKey(`writing-help-closed:${person}`)

/** Whether the person closed writing help last, so a new item opens without it. */
export function helpKeptClosed(person: string) {
  try {
    return localStorage.getItem(closedKey(person)) === '1'
  } catch {
    return false
  }
}

/** Keeps that the person closed writing help, or opened it again. */
export function keepHelpClosed(person: string, closed: boolean) {
  try {
    if (closed) localStorage.setItem(closedKey(person), '1')
    else localStorage.removeItem(closedKey(person))
  } catch {
    // Storage can be blocked; the dock still opens and closes for this page.
  }
}
