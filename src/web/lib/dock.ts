import * as React from 'react'
import { pageKey } from '@/lib/keys'
import {
  changeQuery,
  entryIndex,
  setQuery,
  stepHistory,
  useLocationNow,
  useRoute,
} from '@/lib/router'

// The dock's content lives in the address (?dock=kind.id), so Back closes it and every state has a link.
// A panel reached from another panel (a definition in a context item) keeps where it came from in
// its history entry: the panel's Back link and the key go back there, and the browser's Back button
// walks the same entries.

export type DockKind =
  | 'review'
  | 'context'
  | 'def'
  | 'family'
  | 'ask'
  | 'try'
  | 'write'
  | 'topic'
  | 'share'
  | 'report'
  | 'where'
  | 'conflict'
export type DockState = { kind: DockKind; id?: string; width: number }

/** Each dock's title, for its frame before its own content draws: while its code loads, or after it fails. */
export const DOCK_TITLE: Record<DockKind, string> = {
  review: 'Review',
  context: 'Context',
  def: 'Definition',
  family: 'Suggested family',
  ask: 'Ask',
  try: 'Try it',
  write: 'Writing help',
  topic: 'Answer',
  share: 'Share chat',
  report: 'Something wrong?',
  where: 'Where it says that',
  conflict: 'Conflict',
}

/** Where a panel was reached from: its `dock` value, and the history entry it was on. */
export type Trail = { dockFrom: string; dockAt: number }

/**
 * The trail for a panel opened as `next` from the one open now (`now`, a `dock` value) on history
 * entry `at`: none when nothing was open, or the same panel is asked for again.
 */
export function trailTo(now: string | null, next: string, at: number): Trail | undefined {
  return now && now !== next ? { dockFrom: now, dockAt: at } : undefined
}

/** A `dock` value, as the address holds it, split into its kind and id. */
export function parseDock(raw: string): { kind: DockKind; id?: string } {
  const dot = raw.indexOf('.')
  return dot < 0
    ? { kind: raw as DockKind }
    : { kind: raw.slice(0, dot) as DockKind, id: raw.slice(dot + 1) }
}

export function useDock(): DockState | null {
  const { query } = useRoute()
  const raw = query.get('dock')
  if (!raw) return null
  // The id is everything after the first dot: a conflict's is its pair, `conflict.itm_a.itm_b`.
  const { kind, id } = parseDock(raw)
  return {
    kind,
    id,
    width: kind === 'review' || kind === 'conflict' ? 720 : kind === 'topic' ? 560 : 480,
  }
}

/**
 * Opens a panel, settling once it is in the address: for what must start with the panel open, as
 * the first thing said to writing help from the editor's first box does.
 */
export function dockOpened(
  kind: DockKind,
  id?: string,
  extra?: Record<string, string | undefined>,
  opts?: { replace?: boolean; trail?: boolean },
) {
  setTyped(null)
  fromRow = undefined
  fromButton = null
  fromButtonId = undefined
  const next = id ? `${kind}.${id}` : kind
  // A step to another panel keeps where it came from. A cursor moving through a list (`replace`)
  // or a list's own row (`trail` false) is a new place, not a step.
  const now = new URLSearchParams(window.location.search).get('dock')
  const trail =
    opts?.replace || opts?.trail === false ? undefined : trailTo(now, next, entryIndex())
  // Focus follows into the panel it opened, since the link that was pressed is gone with the old one.
  intoPanel = !!trail
  return changeQuery(
    {
      dock: next,
      tab: undefined,
      flag: undefined,
      ptab: undefined,
      when: undefined,
      variant: undefined,
      meaning: undefined,
      ...extra,
    },
    { replace: opts?.replace, state: trail },
  )
}

/** Opens a panel; with `replace`, as a cursor moving through a list does, in the place of the address now. */
export function openDock(
  kind: DockKind,
  id?: string,
  extra?: Record<string, string | undefined>,
  opts?: { replace?: boolean; trail?: boolean },
) {
  void dockOpened(kind, id, extra, opts)
}

export function closeDock() {
  setTyped(null)
  setQuery({
    dock: undefined,
    tab: undefined,
    flag: undefined,
    ptab: undefined,
    when: undefined,
    variant: undefined,
    meaning: undefined,
  })
}

/*
  The keyboard's hand-off for a list row's peek: opening it from a row sends focus into the panel's
  title, and closing it gives focus back to the row last open in it, unless the person has moved on
  to something else.
*/
let fromRow: string | undefined
let fromButton: HTMLElement | null = null
let fromButtonId: string | undefined
let intoPanel = false

/**
 * Opens a list row's peek and takes focus into it; with `focus` false (the cursor moved on in the
 * list) the focus stays on the row. With `replace`, as a cursor stepping through the list does, the
 * peek takes the place of the address now.
 */
export function openFromRow(
  kind: DockKind,
  id: string,
  extra?: Record<string, string | undefined>,
  { focus = true, replace = false } = {},
) {
  const already = new URLSearchParams(window.location.search).get('dock') === `${kind}.${id}`
  openDock(kind, id, extra, { replace, trail: false })
  fromRow = id
  intoPanel = focus && !already
}

/**
 * The panel's way back, when it was reached from another panel: where it came from and how many
 * history entries away that is. Null on a panel opened from the page, or after the entry was
 * made another way (a link, a reload into a fresh tab).
 */
export function useDockBack(): { from: { kind: DockKind; id?: string }; steps: number } | null {
  const { state } = useLocationNow()
  const { dockFrom, dockAt } = state as Partial<Trail> & typeof state
  const here = state.__TSR_index
  if (typeof dockFrom !== 'string' || typeof dockAt !== 'number' || dockAt >= here) return null
  return { from: parseDock(dockFrom), steps: dockAt - here }
}

/** One step back to the panel this one was reached from, as the browser's Back button goes. */
export function dockBack(steps: number) {
  intoPanel = true
  stepHistory(steps)
}

/**
 * H goes back one step in the side panel, from anywhere nobody is typing, with the focus in the
 * panel or out of it (on a list row, as J and K leave it). Once, in the shell.
 */
export function useDockBackKey() {
  const back = useDockBack()
  const steps = back?.steps
  React.useEffect(() => {
    if (steps === undefined) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'h' || e.shiftKey || e.repeat || e.defaultPrevented || !pageKey(e)) return
      e.preventDefault()
      dockBack(steps)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [steps])
}

/**
 * Opens a panel from a button, which gets focus back when the panel closes. If the button is gone by
 * then (a reported answer hides its More), focus goes to the answer's report line instead.
 */
export function openFromButton(kind: DockKind, id: string, from: HTMLElement | null) {
  openDock(kind, id)
  fromButton = from
  fromButtonId = id
}

/** A panel that has just drawn asks once whether focus should go into it. */
export function takeDockFocus() {
  const take = intoPanel
  intoPanel = false
  return take
}

/**
 * After the dock has closed: focus is back on the row or the button it opened from, if it was left
 * with nothing.
 */
export function returnFromDock() {
  const id = fromRow
  const button = fromButton
  const buttonId = fromButtonId
  fromRow = undefined
  fromButton = null
  fromButtonId = undefined
  intoPanel = false
  if (document.activeElement && document.activeElement !== document.body) return
  if (button?.isConnected) return button.focus({ preventScroll: true })
  if (buttonId) {
    const lines = document.querySelectorAll<HTMLElement>('[data-report-line]')
    const line = [...lines].find((l) => l.dataset.reportLine === buttonId)
    if (line) return line.focus({ preventScroll: true })
  }
  if (!id) return
  const rows = document.querySelectorAll<HTMLElement>('[data-row-open]')
  ;[...rows].find((r) => r.dataset.rowOpen === id)?.focus({ preventScroll: true })
}

/*
  A person's own question, typed into Ask's dock from another page (a report's question in the
  Inbox): held in memory, never in the address, which history and logs keep. Opening or closing any
  dock lets it go, so it is typed in once, not yet sent.
*/
type Typed = { question: string; n: number }
let typed: Typed | null = null
let typedCount = 0
const typedListeners = new Set<() => void>()
function setTyped(next: Typed | null) {
  if (next === typed) return
  typed = next
  for (const l of typedListeners) l()
}

/** Opens Ask beside the page with the question typed in. */
export function askInDock(question: string) {
  openDock('ask', undefined, { q: undefined })
  setTyped({ question, n: ++typedCount })
}

/** The question typed into Ask's dock from another page, while the dock it opened is open. */
export function useTyped(): Typed | null {
  return React.useSyncExternalStore(
    (l) => (typedListeners.add(l), () => void typedListeners.delete(l)),
    () => typed,
  )
}
