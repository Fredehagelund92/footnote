import * as React from 'react'

/**
 * Whether a container is wide enough for a side panel beside the page (64rem by default), measured
 * before paint and kept current as it resizes. Pages render their side panel once, where it fits,
 * instead of twice with one copy hidden: no duplicate ids, no double key listeners.
 */
export function useWide<T extends HTMLElement>(min = 1024) {
  const [el, setEl] = React.useState<T | null>(null)
  const [wide, setWide] = React.useState(false)
  React.useLayoutEffect(() => {
    if (!el) return
    const measure = () => setWide(el.getBoundingClientRect().width >= min)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el, min])
  return [setEl, wide] as const
}

/**
 * False until the first frame has been painted, then true for good. A panel that measures its room
 * on arrival changes its size once before the first paint; that change is the page taking its
 * place, so it must not animate. Gate the transition on this and only later changes move.
 */
export function useSettled() {
  const [settled, setSettled] = React.useState(false)
  React.useEffect(() => void requestAnimationFrame(() => setSettled(true)), [])
  return settled
}
