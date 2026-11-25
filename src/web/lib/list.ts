import * as React from 'react'
import { cameFrom, changeQuery, useRoute } from '@/lib/router'

// The state and keys the Context and Definitions lists share.

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
 * Arrow keys (or J and K) move between rows, Home and End jump. The rows' open buttons are the
 * stops; when a peek is open, moving the cursor opens the next row in it, as in a mail list. Picking
 * rows (X, Shift and an arrow) is the selection's, in hooks/use-selection.ts, and runs first.
 *
 * A list that draws only the rows in view (components/footnote/window-rows.tsx) passes `rows`: its
 * whole order and how to bring a row into view, so the keys move through every row, drawn or not.
 */
export function useRowKeys({
  onMove,
  onEscape,
  rows,
}: {
  onMove?: (id: string) => void
  onEscape?: () => boolean
  rows?: {
    order: readonly string[]
    reveal: (id: string, then: (row: HTMLElement) => void) => void
  }
}) {
  return (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
    const target = e.target as HTMLElement
    if (target.closest('input, textarea')) return
    const stops = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-row-open]')]
    const here = stops.findIndex(
      (s) => s === target || s.contains(target) || s.closest('tr')?.contains(target),
    )
    const ids = rows?.order ?? stops.map((s) => s.dataset.rowOpen!)
    const at = here < 0 ? -1 : ids.indexOf(stops[here]!.dataset.rowOpen!)
    const go = (i: number) => {
      const id = ids[Math.max(0, Math.min(ids.length - 1, i))]
      if (id === undefined) return
      e.preventDefault()
      const focus = (next: HTMLElement) => {
        next.focus()
        next.scrollIntoView({ block: 'nearest' })
      }
      if (rows)
        rows.reveal(id, (row) => {
          const next = row.querySelector<HTMLElement>('[data-row-open]')
          if (next) focus(next)
        })
      else focus(stops.find((s) => s.dataset.rowOpen === id)!)
      onMove?.(id)
    }
    if (e.key === 'ArrowDown' || e.key === 'j') go(at + 1)
    else if (e.key === 'ArrowUp' || e.key === 'k') go(at - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(ids.length - 1)
    else if (e.key === 'Escape' && onEscape?.()) e.preventDefault()
  }
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
