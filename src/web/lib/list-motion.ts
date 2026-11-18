import { flushSync } from 'react-dom'

// One list in Footnote changes its order the same way everywhere: Overview's topics, Context's items
// and the definitions. A pointer change of what is shown (a tab, a filter, a sort, a grouping)
// moves the rows on the screen to their new places in one view transition, those that arrive fade
// in and those that go fade out, while the rest of the page changes at once under them
// (styles/index.css, :root[data-vt='filters']). The keyboard and reduced motion are instant, as
// the contract says (docs/design/motion.md).

/** The view transition of a change of what a list shows, while it runs. */
let moving: ViewTransition | null = null

/**
 * A change of what a list shows. Unless it is instant, the rows on the screen move to their new
 * places in one view transition while the rest of the page changes under them. The page stops
 * drawing while a transition takes its pictures, so a change that has to be read (a step in the
 * address) is waited for a short while at most, and a change made while one runs is made at once.
 */
export function moveRows(change: () => void | Promise<unknown>, instant: boolean) {
  if (instant || moving || !document.startViewTransition) return void change()
  const root = document.documentElement
  root.dataset.vt = 'filters'
  inSight()
  const t = document.startViewTransition(async () => {
    await Promise.race([change(), new Promise((done) => setTimeout(done, DRAWN_IN))])
    flushSync(() => {})
    inSight()
  })
  moving = t
  void t.finished.finally(() => {
    if (moving !== t) return
    moving = null
    delete root.dataset.vt
  })
}

/**
 * Marks the rows and chips on the screen as those that move: a transition takes a picture of each
 * one it moves, and hundreds of rows out of sight would hold the page still for seconds.
 */
export function inSight() {
  const high = window.innerHeight
  for (const el of document.querySelectorAll<HTMLElement>('[data-vt-move]')) {
    const box = el.getBoundingClientRect()
    if (box.bottom > 0 && box.top < high) el.dataset.vtSeen = ''
    else delete el.dataset.vtSeen
  }
}

/**
 * What a control says about the press that changed it: a click (a pointer's or the keyboard's) or
 * a Base UI change's native event. The keys report no press at all.
 */
export type Press = Event | { detail?: number } | null | undefined

/**
 * Whether a press came from a pointer. A click the keyboard made (Enter or Space on a menu item,
 * a switch or a column header) counts no clicks, so the keyboard stays instant without the
 * control having to say which it was.
 */
export function byPointer(e?: Press) {
  const clicks = e && (e as { detail?: unknown }).detail
  return typeof clicks === 'number' && clicks > 0
}

/** How long a transition waits for a change that has to be read to be drawn, in ms. */
const DRAWN_IN = 200
