import * as React from 'react'
import { LEAVE_MS } from '@/lib/presence'

// The dock leaving the way it came: the panel is gone from the layout in one frame and the page
// widens at once, while a copy of the panel's last picture fades and moves 16px to the right over
// it (the dock-leave utility in index.css). It is a still picture: inert, and without ids.

export type DockPicture = {
  node: HTMLElement
  width: number
  /** Scroll offsets to restore on the copy once it is in the page (a detached node cannot scroll). */
  scrolls: Array<[HTMLElement, number, number]>
}

/** The picture of a dock that has just closed: a copy of its panel, still showing what it showed. */
export function pictureOf(
  node: HTMLElement,
  width: number,
  /** Scroll offsets seen while the dock was on screen: a detached node reports 0. */
  offsets: Map<HTMLElement, [number, number]>,
): DockPicture {
  const copy = node.cloneNode(true) as HTMLElement
  const from = [node, ...node.querySelectorAll<HTMLElement>('*')]
  const to = [copy, ...copy.querySelectorAll<HTMLElement>('*')]
  const scrolls: DockPicture['scrolls'] = []
  from.forEach((src, i) => {
    const dst = to[i]
    if (!dst) return
    const at = offsets.get(src)
    if (at && (at[0] || at[1])) scrolls.push([dst, at[0], at[1]])
    if (src instanceof HTMLInputElement && dst instanceof HTMLInputElement) {
      dst.value = src.value
      dst.checked = src.checked
    } else if (src instanceof HTMLTextAreaElement && dst instanceof HTMLTextAreaElement) {
      dst.value = src.value
    } else if (src instanceof HTMLSelectElement && dst instanceof HTMLSelectElement) {
      dst.selectedIndex = src.selectedIndex
    }
  })
  copy.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'))
  copy.removeAttribute('id')
  copy.classList.remove('dock-enter')
  copy.setAttribute('inert', '')
  copy.setAttribute('aria-hidden', 'true')
  return { node: copy, width, scrolls }
}

function restoreScrolls({ scrolls }: DockPicture) {
  for (const [dst, top, left] of scrolls) {
    dst.scrollTop = top
    dst.scrollLeft = left
  }
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
    restoreScrolls(picture)
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
