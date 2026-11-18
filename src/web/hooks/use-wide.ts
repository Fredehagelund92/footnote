import * as React from 'react'
import { flushSync } from 'react-dom'

/**
 * Whether a container is wide enough for a side panel beside the page (64rem by default), measured
 * before paint and kept current as it resizes. The measure is flushed as it is made, not left to
 * React to schedule: an update made while a page is committing (or from an observer callback) can
 * be rendered after the first frame is painted, and the panel then arrives a frame late and moves
 * the page. Pages render their side panel once, where it fits,
 * instead of twice with one copy hidden: no duplicate ids, no double key listeners.
 */
export function useWide<T extends HTMLElement>(min = 1024) {
  const [wide, setWide] = React.useState(false)
  const watching = React.useRef<ResizeObserver | null>(null)
  // A callback ref the caller may call with the element and with null, as a ref is.
  const ref = React.useCallback(
    (el: T | null) => {
      watching.current?.disconnect()
      watching.current = null
      if (!el) return
      const measure = () => flushSync(() => setWide(el.getBoundingClientRect().width >= min))
      // Right after this commit, before any paint; flushSync cannot run inside the commit itself.
      queueMicrotask(measure)
      watching.current = new ResizeObserver(measure)
      watching.current.observe(el)
    },
    [min],
  )
  return [ref, wide] as const
}

/**
 * False until the first frame has been painted, then true for good. A panel that measures its room
 * on arrival changes its size once before the first paint; that change is the page taking its
 * place, so it must not animate. Gate the transition on this and only later changes move.
 */
export function useSettled() {
  const [settled, setSettled] = React.useState(false)
  React.useEffect(() => {
    requestAnimationFrame(() => setSettled(true))
  }, [])
  return settled
}
