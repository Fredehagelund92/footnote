// The sidebar folds to its icon rail by itself for two reasons: a dock or a review is on screen, or
// the window is under 1024 px wide, where the open sidebar leaves a page too little room. Each
// reason remembers what the sidebar was before it, so it comes back as the person left it once the
// reason is gone. The person's own fold (Command B, the header's toggle) still works all the while.

/** What folds the sidebar by itself, at one moment. */
export type FoldReasons = { dock: boolean; narrow: boolean }

/** Whether the sidebar is open, and what it was before each reason folded it (null: not folded by it). */
export type SidebarFold = {
  open: boolean
  beforeDock: boolean | null
  beforeNarrow: boolean | null
}

/** A page that loads with a reason on starts folded, and opens once every reason is gone. */
export function startFold({ dock, narrow }: FoldReasons): SidebarFold {
  return {
    open: !dock && !narrow,
    beforeDock: dock ? !narrow : null,
    beforeNarrow: narrow ? true : null,
  }
}

/** The fold after the reasons changed from `was` to `now`. */
export function foldStep(fold: SidebarFold, was: FoldReasons, now: FoldReasons): SidebarFold {
  let { open, beforeDock, beforeNarrow } = fold
  if (now.narrow && !was.narrow) {
    // Under a dock the sidebar is folded already: what counts is what it was before the dock.
    beforeNarrow = beforeDock ?? open
    if (beforeDock !== null) beforeDock = false
    open = false
  }
  if (!now.narrow && was.narrow && beforeNarrow !== null) {
    // A dock still holds the fold, and gives the sidebar back when it closes.
    if (beforeDock !== null) beforeDock = beforeNarrow
    else open = beforeNarrow
    beforeNarrow = null
  }
  if (now.dock && !was.dock) {
    beforeDock = open
    open = false
  }
  if (!now.dock && was.dock && beforeDock !== null) {
    open = beforeDock
    beforeDock = null
  }
  return { open, beforeDock, beforeNarrow }
}
