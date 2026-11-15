import * as React from 'react'
import { LEAVE_MS } from '@/lib/presence'

// The dock leaving the way it came: the panel is gone from the layout in one frame and the page
// widens at once, while a copy of the panel's last picture fades and moves 16px to the right over
// it (the dock-leave utility in index.css). It is a still picture: inert, and without ids.

export type DockPicture = { node: HTMLElement; width: number }

/** The picture of a dock that has just closed: a copy of its panel, still showing what it showed. */
export function pictureOf(node: HTMLElement, width: number): DockPicture {
  const copy = node.cloneNode(true) as HTMLElement
  copy.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'))
  copy.removeAttribute('id')
  copy.classList.remove('dock-enter')
  copy.setAttribute('inert', '')
  copy.setAttribute('aria-hidden', 'true')
  return { node: copy, width }
}

let current: DockPicture | null = null
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Puts a dock's picture on screen to leave (or takes it away: null). */
export function setLeavingDock(picture: DockPicture | null) {
  current = picture
  listeners.forEach((l) => l())
}

/** The picture of the dock that is on its way out, if any. */
export function useLeavingDock() {
  return React.useSyncExternalStore(subscribe, () => current)
}

export function DockLeaving({ picture }: { picture: DockPicture }) {
  const host = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    el.appendChild(picture.node)
    // Painted once where the dock was, then sent on its way: the transition needs a first frame.
    void el.offsetWidth
    el.setAttribute('data-leaving', '')
    const timer = window.setTimeout(() => setLeavingDock(null), LEAVE_MS)
    return () => window.clearTimeout(timer)
  }, [picture])
  return (
    <div
      ref={host}
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 right-0 z-dock dock-leave bg-background"
      style={{ width: picture.width }}
    />
  )
}
