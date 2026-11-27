// Touch targets for the review and the Inbox quick view: under a finger no button, link or field
// is smaller than 44px, the size a fingertip needs.

export const TOUCH =
  'pointer-coarse:**:[button]:min-h-11 pointer-coarse:**:[button]:min-w-11 pointer-coarse:**:[a[href]]:min-h-11 pointer-coarse:**:[input]:min-h-11'

/**
 * A link in a line of words: under a finger its tap area grows to 44px around it, while the link
 * keeps its place and the size it is drawn, so the line does not move. TOUCH makes a 44px box of a
 * link that is a box itself (a row, a button, a flex child), so this link stays inline: in a span,
 * where its parent lays out its children.
 */
export const TOUCH_LINK =
  'relative pointer-coarse:after:absolute pointer-coarse:after:inset-(--touch-inset)'
