import * as React from 'react'
import { pageKey } from '@/lib/keys'
import { cameFrom, changeQuery, useRoute } from '@/lib/router'

// The state and keys every list shares: Context, Definitions, Overview's topics, the Inbox and a
// card's drafts.

/*
  A list's view lives in the address: its filters, search words, sort and group. A reload, a link
  and Back from an item page give the same list. A filter, sort or group chosen is a step in
  history, so Back undoes it; a search is one step however many keys it takes.
*/

/** A filter's values in the address, such as `domain=sales,finance`: those the list knows, in order. */
export function listOf<T extends string>(raw: string | null, known: readonly T[]): T[] {
  const asked = new Set(raw?.split(','))
  return known.filter((v) => asked.has(v))
}

/** A filter's values for the address: none leaves the key out. */
export const listTo = (values: readonly string[]) => (values.length ? values.join(',') : undefined)

/**
 * The search words (`q`), as typed. The box shows each key at once and the address follows; the
 * first word starts a step in history and the keys after it change that step, so Back leaves the
 * search in one press. A change of the address from elsewhere (Back, a link) wins.
 */
export function useSearchWords(): [string, (next: string) => void] {
  const { query } = useRoute()
  const inAddress = query.get('q') ?? ''
  // What was typed and is not in the address yet, oldest first.
  const [typed, setTyped] = React.useState({ seen: inAddress, waiting: [] as string[] })
  let waiting = typed.waiting
  if (typed.seen !== inAddress) {
    const at = waiting.indexOf(inAddress)
    waiting = at < 0 ? [] : waiting.slice(at + 1)
    setTyped({ seen: inAddress, waiting })
  }
  const text = waiting.at(-1) ?? inAddress
  const type = (next: string) => {
    if (next === text) return
    setTyped((t) => ({ ...t, waiting: [...t.waiting, next] }))
    void changeQuery({ q: next || undefined }, { replace: !!text })
  }
  return [text, type]
}

/** The list's address, kept for the way back to it from its items (their breadcrumb and back arrow). */
const listAddresses = new Map<string, string>()

/** Keeps the list's address while it is on screen. */
export function useListAddress(path: string) {
  const { query } = useRoute()
  const search = query.toString()
  React.useEffect(() => {
    listAddresses.set(path, search ? `${path}?${search}` : path)
  }, [path, search])
}

/** The list at `path` as it was last left in this tab, else the whole list. */
export const listHref = (path: string) => listAddresses.get(path) ?? path

/**
 * The row to focus once the rows are drawn: the item Back has just come back from (its page was
 * `${itemPath}<id>`), else the one open in the side panel, as after a reload. Once per visit.
 */
export function useArrivalRow({
  itemPath,
  idOf,
  peeked,
  ready,
  focus,
}: {
  itemPath: string
  idOf: (part: string) => string | undefined
  peeked: string | undefined
  ready: boolean
  focus: (id: string) => void
}) {
  const [from] = React.useState(() => {
    const left = cameFrom()
    return left.startsWith(itemPath) ? idOf(left.slice(itemPath.length).split('/')[0]!) : undefined
  })
  const done = React.useRef(false)
  const focusRow = React.useEffectEvent(focus)
  React.useEffect(() => {
    if (!ready || done.current) return
    done.current = true
    const id = from ?? peeked
    if (id) focusRow(id)
    // Once, when the rows first draw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])
}

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

/**
 * A list on screen. `moved` is the row the cursor was last sent to when no row took the focus to
 * carry it (none drawn yet, or the panel keeps the focus), and the rows `current` was on since:
 * the page draws a move later than the address changes, and until it does the next key steps on
 * from that row, not again from the one still drawn.
 */
type Keymap = {
  at: number
  keys: React.RefObject<ListKeys>
  moved: React.RefObject<{ to: string; past: string[] } | undefined>
}

/** The lists on screen, the one drawn last first. */
const keymaps: Keymap[] = []
let drawnLists = 0

function listKey(m: Keymap, e: KeyboardEvent) {
  const k = m.keys.current
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
  const moving = m.moved.current?.past.includes(k.current ?? '') ? m.moved.current : undefined
  const cursor = moving ? moving.to : k.current
  const at = ids.indexOf(on?.dataset.rowOpen ?? cursor ?? '')
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
    const stop = k.reveal ? undefined : stops.find((s) => s.dataset.rowOpen === id)
    if (stop) show(stop)
    m.moved.current =
      inPanel || (!k.reveal && !stop)
        ? { to: id, past: moving ? [...moving.past, moving.to] : [k.current ?? ''] }
        : undefined
    if (id !== cursor) k.onMove?.(id, { panel: inPanel })
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
  if (keymaps.some((m) => listKey(m, e))) e.preventDefault()
}

/** Gives a list the page's list keys while it is on screen. */
export function useListKeys(keys: ListKeys) {
  // Counted as lists draw, parent before child: a list inside another's pane comes later.
  const [at] = React.useState(() => ++drawnLists)
  const ref = React.useRef(keys)
  const moved: Keymap['moved'] = React.useRef(undefined)
  React.useLayoutEffect(() => {
    ref.current = keys
    // The page drew the move, or the cursor went elsewhere: its own `current` holds it again.
    const was = moved.current
    if (was && (keys.current === was.to || !was.past.includes(keys.current ?? '')))
      moved.current = undefined
  })
  React.useEffect(() => {
    const mine: Keymap = { at, keys: ref, moved }
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
