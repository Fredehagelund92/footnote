import * as React from 'react'

/**
 * While `active` (a write is on its way), leaving the page asks first. It warns and never blocks:
 * the browser's own question, with its own words, and the person may leave anyway. A write that
 * is cut off by a reload still finishes on the service, but the screen then never hears of it.
 */
export function useLeaveGuard(active: boolean) {
  React.useEffect(() => {
    if (!active) return
    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Older browsers read the return value.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', ask)
    return () => window.removeEventListener('beforeunload', ask)
  }, [active])
}
