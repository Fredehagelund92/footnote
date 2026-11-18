import * as React from 'react'

// The state and keys the Context and Definitions lists share.

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

/** As in the Footnote app: every word must match the start of a word in the text. */
export function matches(query: string, text: string) {
  const ws = words(query)
  if (!ws.length) return true
  const hay = text.toLowerCase().split(/[^\p{L}\p{N}]+/u)
  return ws.every((w) => hay.some((h) => h.startsWith(w)))
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
