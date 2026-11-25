import * as React from 'react'
import { setQuery, useRoute } from '@/lib/router'

// The dock's content lives in the address (?dock=kind.id), so Back closes it and every state has a link.

export type DockKind =
  'review' | 'context' | 'def' | 'family' | 'ask' | 'try' | 'topic' | 'share' | 'where' | 'conflict'
export type DockState = { kind: DockKind; id?: string; width: number }

/** Each dock's title, for its frame before its own content draws: while its code loads, or after it fails. */
export const DOCK_TITLE: Record<DockKind, string> = {
  review: 'Review',
  context: 'Context',
  def: 'Definition',
  family: 'Suggested family',
  ask: 'Ask',
  try: 'Try it',
  topic: 'Answer',
  share: 'Share chat',
  where: 'Where it says that',
  conflict: 'Conflict',
}

export function useDock(): DockState | null {
  const { query } = useRoute()
  const raw = query.get('dock')
  if (!raw) return null
  // The id is everything after the first dot: a conflict's is its pair, `conflict.itm_a.itm_b`.
  const dot = raw.indexOf('.')
  const kind = (dot < 0 ? raw : raw.slice(0, dot)) as DockKind
  const id = dot < 0 ? undefined : raw.slice(dot + 1)
  return {
    kind,
    id,
    width: kind === 'review' || kind === 'conflict' ? 720 : kind === 'topic' ? 560 : 480,
  }
}

export function openDock(kind: DockKind, id?: string, extra?: Record<string, string | undefined>) {
  setTyped(null)
  setQuery({
    dock: id ? `${kind}.${id}` : kind,
    tab: undefined,
    flag: undefined,
    ptab: undefined,
    when: undefined,
    variant: undefined,
    meaning: undefined,
    ...extra,
  })
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
  title, and closing it gives focus back to that row, unless the person has moved on to something else.
*/
let fromRow: string | undefined
let intoPanel = false

/** Opens a list row's peek and takes focus into it. */
export function openFromRow(
  kind: DockKind,
  id: string,
  extra?: Record<string, string | undefined>,
) {
  const already = new URLSearchParams(window.location.search).get('dock') === `${kind}.${id}`
  fromRow = id
  intoPanel = !already
  openDock(kind, id, extra)
}

/** A panel that has just drawn asks once whether focus should go into it. */
export function takeDockFocus() {
  const take = intoPanel
  intoPanel = false
  return take
}

/** After the dock has closed: focus is back on the row it opened from, if it was left with nothing. */
export function returnFromDock() {
  const id = fromRow
  fromRow = undefined
  intoPanel = false
  if (!id || (document.activeElement && document.activeElement !== document.body)) return
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
