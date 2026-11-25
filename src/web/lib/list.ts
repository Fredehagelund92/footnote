import * as React from 'react'
import { pageKey } from '@/lib/keys'

// The state and keys every list shares: Context, Definitions, Overview's topics, the Inbox and a
// card's drafts.

/**
 * One keymap for every list, on the page rather than on the list: J and K work from page load,
 * whatever has the focus, and Esc reaches the list from anywhere. J and K move the cursor; the
 * arrows, Home and End do too while the focus is in the list or nowhere. Enter on the row on show
 * opens it, so a click and then Enter opens a card at once. Picking rows (X, Shift and an arrow)
 * is the selection's, in hooks/use-selection.ts, on the list itself, and runs first.
 *
 * The focus follows the cursor's row, unless the person steps from inside the list's panel: the
 * next row then opens there and the panel keeps the focus. Keys pressed in a dock that shows
 * something else (a conflict, a review, Ask) are that dock's own.
 *
 * Rows mark the button or link that opens them with data-row-open={id}. A list that draws only the
 * rows in view (components/footnote/window-rows.tsx) passes its whole `order` and `reveal`, so the
 * keys move through every row, drawn or not. A list drawn inside another (a card's drafts in the
 * Inbox's pane) is asked first; one that is `within` takes the keys only while the focus is in it.
 */
export type ListKeys = {
  /** Holds the rows. None for a list read one at a time, as a draft is. */
  list?: React.RefObject<HTMLElement | null>
  /** Every row's id as shown; without it, the rows drawn. */
  order?: readonly string[]
  /** The row on show: the one open in the panel, the Inbox's card, the draft being read. */
  current?: string
  /** The row on show is open in the dock: keys from inside it step this list. */
  docked?: boolean
  /** Holds the list's own panel, when it is on the page rather than in the dock (the Inbox's pane). */
  panel?: React.RefObject<HTMLElement | null>
  /** The cursor moved to this row; `panel` when the person stepped from inside the list's panel. */
  onMove?: (id: string, from: { panel: boolean }) => void
  /** Enter on the row on show. */
  onOpen?: (id: string) => void
  /** Esc: whether the list took it (closed its panel, cleared its selection). */
  onEscape?: () => boolean
  /** Draws a row not drawn yet, then hands it over. */
  reveal?: (id: string, then: (row: HTMLElement) => void) => void
  /** The keys are the list's only while the focus is in it. */
  within?: boolean
}

/** The lists on screen, the one drawn last first. */
const keymaps: { at: number; keys: React.RefObject<ListKeys> }[] = []
let drawnLists = 0

function listKey(k: ListKeys, e: KeyboardEvent) {
  const t = e.target as HTMLElement
  const list = k.list?.current ?? null
  const inList = !!list?.contains(t)
  if (k.within && !inList) return false
  if (!inList && !k.docked && t.closest('[data-slot=dock]')) return false
  const nowhere = t === document.body || t === document.documentElement
  const stops = list ? [...list.querySelectorAll<HTMLElement>('[data-row-open]')] : []
  const on = inList
    ? stops.find((s) => s === t || s.contains(t) || s.closest('tr, li')?.contains(t))
    : undefined
  const ids = k.order ?? stops.map((s) => s.dataset.rowOpen!)
  const at = ids.indexOf(on?.dataset.rowOpen ?? k.current ?? '')
  const inPanel =
    !inList && !nowhere && (!!t.closest('[data-slot=dock]') || !!k.panel?.current?.contains(t))
  const go = (i: number, dir: 1 | -1) => {
    let n = Math.max(0, Math.min(ids.length - 1, i))
    if (!inPanel && !k.reveal && stops.length > 0)
      while (ids[n] !== undefined && !stops.some((s) => s.dataset.rowOpen === ids[n])) n += dir
    const id = ids[n]
    if (id === undefined) return ids.length > 0 && !inPanel && !k.reveal
    const show = (row: HTMLElement) => {
      if (!inPanel) row.focus()
      row.scrollIntoView({ block: 'nearest' })
    }
    if (k.reveal)
      k.reveal(id, (row) => {
        const stop = row.querySelector<HTMLElement>('[data-row-open]')
        if (stop) show(stop)
      })
    else {
      const stop = stops.find((s) => s.dataset.rowOpen === id)
      if (stop) show(stop)
    }
    if (id !== k.current) k.onMove?.(id, { panel: inPanel })
    return true
  }
  const arrows = inList || (nowhere && !!list)
  if (e.key === 'j' || (e.key === 'ArrowDown' && arrows)) return go(at + 1, 1)
  if (e.key === 'k' || (e.key === 'ArrowUp' && arrows)) return go(at - 1, -1)
  if (e.key === 'Home' && arrows) return go(0, 1)
  if (e.key === 'End' && arrows) return go(ids.length - 1, -1)
  if (
    e.key === 'Enter' &&
    k.onOpen &&
    k.current &&
    (nowhere || on?.dataset.rowOpen === k.current)
  ) {
    k.onOpen(k.current)
    return true
  }
  return e.key === 'Escape' && !!k.onEscape?.()
}

// On the document: after a field's, a menu's or the dock's own keys, before the window's (the
// selection's Esc, a page's own keys), so Esc closes the panel before it clears the ticked rows.
function onListKey(e: KeyboardEvent) {
  if (e.defaultPrevented || e.shiftKey || !pageKey(e)) return
  if (keymaps.some((m) => listKey(m.keys.current, e))) e.preventDefault()
}

/** Gives a list the page's list keys while it is on screen. */
export function useListKeys(keys: ListKeys) {
  // Counted as lists draw, parent before child: a list inside another's pane comes later.
  const [at] = React.useState(() => ++drawnLists)
  const ref = React.useRef(keys)
  React.useLayoutEffect(() => {
    ref.current = keys
  })
  React.useEffect(() => {
    const mine = { at, keys: ref }
    keymaps.push(mine)
    keymaps.sort((a, b) => b.at - a.at)
    if (keymaps.length === 1) document.addEventListener('keydown', onListKey)
    return () => {
      keymaps.splice(keymaps.indexOf(mine), 1)
      if (!keymaps.length) document.removeEventListener('keydown', onListKey)
    }
  }, [at])
}

/** The search words, as typed. */
export const words = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean)

/** A text's words as a search reads them: lower case, split at anything but letters and digits. */
export const wordsIn = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u)

/**
 * As `matches`, on the query's words and a text's words read once (`words`, `wordsIn`): a long
 * list splits each row when the list changes, not on every key.
 */
export const matchesWords = (asked: readonly string[], hay: readonly string[]) =>
  asked.every((w) => hay.some((h) => h.startsWith(w)))

/** As in the Footnote app: every word must match the start of a word in the text. */
export function matches(query: string, text: string) {
  return matchesWords(words(query), wordsIn(text))
}

/* The order a list shows, so its peek can say "3 of 17" and step to the next row. */

const orders = new Map<string, string[]>()
const orderListeners = new Set<() => void>()

export function setListOrder(list: string, ids: string[] | null) {
  const before = orders.get(list)
  if (ids && before && before.length === ids.length && before.every((id, i) => id === ids[i]))
    return
  if (ids) orders.set(list, ids)
  else orders.delete(list)
  orderListeners.forEach((l) => l())
}

export function useListOrder(list: string) {
  return React.useSyncExternalStore(
    (l) => {
      orderListeners.add(l)
      return () => orderListeners.delete(l)
    },
    () => orders.get(list),
  )
}

/** Publishes a list's order while it is on screen. */
export function usePublishOrder(list: string, ids: string[]) {
  const key = ids.join('|')
  React.useEffect(() => {
    setListOrder(list, key ? key.split('|') : [])
  }, [list, key])
  React.useEffect(() => () => setListOrder(list, null), [list])
}
