import * as React from 'react'

/**
 * False until the first frame has been painted, then true for good. A panel that measures its room
 * on arrival changes its size once before the first paint; that change is the page taking its
 * place, so it must not animate. Gate the transition on this and only later changes move.
 */
export function useSettled() {
  const [settled, setSettled] = React.useState(false)
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setSettled(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  return settled
}
