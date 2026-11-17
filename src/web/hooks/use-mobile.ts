import * as React from 'react'

const MOBILE_BREAKPOINT = 768

// shadcn's hook, read with useSyncExternalStore so the first render already knows the width
// (the original starts as desktop and corrects itself in an effect, which flashes on a phone).
export function useIsMobile() {
  return useMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
}

/** Whether a media query matches, known on the first render and kept current. */
export function useMedia(query: string) {
  return React.useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
  )
}
