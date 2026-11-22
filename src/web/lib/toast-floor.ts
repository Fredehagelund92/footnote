import * as React from 'react'

// What a toast must never cover: the bars and boxes at the foot of the window (a card's decisions,
// a list's count or selection bar, the Ask box). Each marks itself with `useToastFloor`, and the
// toaster (App.tsx) sits just above the highest one that reaches the foot of the window under its
// column, or in the corner when none does.

const floors = new Set<Element>()
let version = 0
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const changed = () => {
  version++
  listeners.forEach((l) => l())
}

/** A ref that marks an element as a floor toasts stay above while it is on screen. */
export function useToastFloor<T extends Element>(): React.RefCallback<T> {
  return React.useCallback((el: T | null) => {
    if (!el) return
    floors.add(el)
    changed()
    return () => {
      floors.delete(el)
      changed()
    }
  }, [])
}

/** The floors on screen now, as a number that changes whenever one comes or goes. */
export function useFloorsVersion(): number {
  return React.useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  )
}

/** Every floor on screen, to watch for a change of size. */
export const allFloors = (): Element[] => [...floors]

/**
 * How far above the foot of the window the floors under a column reach, in px: 0 with none. A
 * floor counts only while it reaches the foot (a list's count row under a short list does not).
 */
export function floorUnder(column: { left: number; right: number }): number {
  const foot = window.innerHeight
  let lift = 0
  for (const el of floors) {
    const r = el.getBoundingClientRect()
    if (!r.height || r.top >= foot || r.bottom < foot - 32) continue
    if (r.right <= column.left || r.left >= column.right) continue
    lift = Math.max(lift, foot - r.top)
  }
  return Math.round(lift)
}
