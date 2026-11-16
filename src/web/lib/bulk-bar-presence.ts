import * as React from 'react'

// Whether a list's selection bar is on screen. The bar takes a band at the foot of its list, so the
// toaster (App.tsx) lifts above it only while it is there, and sits in the corner the rest of the time.

let shown = 0
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const change = (by: number) => {
  shown += by
  listeners.forEach((l) => l())
}

/** Says a selection bar is on screen for as long as `present`. */
export function useReportBulkBar(present: boolean) {
  React.useEffect(() => {
    if (!present) return
    change(1)
    return () => change(-1)
  }, [present])
}

/** Whether any selection bar is on screen. */
export function useBulkBarShown(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => shown > 0,
    () => false,
  )
}
