import { describe, expect, it } from 'vitest'
import { foldStep, startFold, type FoldReasons, type SidebarFold } from '@/lib/sidebar-fold'

// The sidebar folds to its rail by itself for a dock or a review, and in a window under 1024 px,
// and comes back as the person left it once the reason is gone.

const none: FoldReasons = { dock: false, narrow: false }
const dock: FoldReasons = { dock: true, narrow: false }
const narrow: FoldReasons = { dock: false, narrow: true }
const both: FoldReasons = { dock: true, narrow: true }

/** The fold after the reasons went through `steps`, starting from `first`. */
const walk = (first: FoldReasons, ...steps: FoldReasons[]) => {
  let fold = startFold(first)
  let was = first
  for (const now of steps) {
    fold = foldStep(fold, was, now)
    was = now
  }
  return fold
}
/** The person's own fold or unfold, by the toggle or Command B. */
const toggled = (fold: SidebarFold): SidebarFold => ({ ...fold, open: !fold.open })

describe('the sidebar at the start', () => {
  it('is open in a wide window with no dock', () => {
    expect(startFold(none).open).toBe(true)
  })

  it('is its rail in a window under 1024 px, beside a dock and in a review', () => {
    expect(startFold(narrow).open).toBe(false)
    expect(startFold(dock).open).toBe(false)
    expect(startFold(both).open).toBe(false)
  })

  it('opens once the reason it started folded for is gone', () => {
    expect(walk(narrow, none).open).toBe(true)
    expect(walk(dock, none).open).toBe(true)
    expect(walk(both, narrow).open).toBe(false)
    expect(walk(both, narrow, none).open).toBe(true)
    expect(walk(both, dock).open).toBe(false)
    expect(walk(both, dock, none).open).toBe(true)
  })
})

describe('the sidebar as the window and the dock change', () => {
  it('folds when the window narrows and comes back when it widens', () => {
    expect(walk(none, narrow).open).toBe(false)
    expect(walk(none, narrow, none).open).toBe(true)
  })

  it('folds for a dock and comes back when it closes', () => {
    expect(walk(none, dock).open).toBe(false)
    expect(walk(none, dock, none).open).toBe(true)
  })

  it('stays folded while either reason holds', () => {
    expect(walk(none, narrow, both, narrow).open).toBe(false)
    expect(walk(none, dock, both, dock).open).toBe(false)
    expect(walk(none, narrow, both, dock).open).toBe(false)
    expect(walk(none, narrow, both, dock, none).open).toBe(true)
  })

  it("keeps the person's own fold: a sidebar they folded stays folded", () => {
    const folded = toggled(startFold(none))
    const narrowed = foldStep(folded, none, narrow)
    expect(narrowed.open).toBe(false)
    expect(foldStep(narrowed, narrow, none).open).toBe(false)
    const docked = foldStep(folded, none, dock)
    expect(foldStep(docked, dock, none).open).toBe(false)
  })

  it('lets the person open it in a narrow window, folds it for a dock and gives it back', () => {
    const opened = toggled(startFold(narrow))
    expect(opened.open).toBe(true)
    const docked = foldStep(opened, narrow, both)
    expect(docked.open).toBe(false)
    expect(foldStep(docked, both, narrow).open).toBe(true)
  })

  it('is a rail again in a narrow window after a dock that opened in a wide one', () => {
    // Wide and open, a dock opens, the window narrows, the dock closes: still narrow, so the rail.
    const fold = walk(none, dock, both, narrow)
    expect(fold.open).toBe(false)
    expect(foldStep(fold, narrow, none).open).toBe(true)
  })
})
