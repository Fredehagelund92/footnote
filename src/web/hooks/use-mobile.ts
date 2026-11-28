import * as React from 'react'

const MOBILE_BREAKPOINT = 768
const NARROW_BREAKPOINT = 1024
const DOCK_BESIDE_BREAKPOINT = 1100

// shadcn's hook, read with useSyncExternalStore so the first render already knows the width
// (the original starts as desktop and corrects itself in an effect, which flashes on a phone).
export function useIsMobile() {
  return useMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
}

/** A window with no room for the open sidebar beside a page: under 1024 px it starts as its icon rail. */
export function useIsNarrow() {
  return useMedia(`(max-width: ${NARROW_BREAKPOINT - 1}px)`)
}

/**
 * A window with no room for the dock beside a page: under 1100 px the dock is a sheet over the page,
 * so the page keeps its width (on a phone the sheet fills the screen).
 */
export function useDockOverPage() {
  return useMedia(`(max-width: ${DOCK_BESIDE_BREAKPOINT - 1}px)`)
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
