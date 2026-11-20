import { cn } from '@/lib/utils'
import { changeIcons } from '@/components/footnote/change-icons'
import { countWord, type ChangeKind } from '@/model/review'

// The quiet label of a kind of change, as a review's counts say them: a swatch in the kind's mark
// colour, its glyph and its word, so the colour is never alone. The changes themselves are drawn
// by the comparison (source-review.tsx).

/** Each kind's mark colour; the colour is always paired with the glyph and the word. */
const tones: Record<ChangeKind, string> = {
  Wording: 'bg-[var(--mark-add)]',
  Added: 'bg-[var(--mark-add)]',
  Removed: 'bg-[var(--mark-del)]',
  Formatting: 'bg-[var(--mark-fmt)]',
  Link: 'bg-[var(--mark-link)]',
  Order: 'bg-[var(--mark-move)]',
  Dates: 'bg-[var(--mark-link)]',
}

/** The quiet label of a kind of change: a small swatch, the glyph and the word. */
export function KindLabel({
  kind,
  n,
  className,
}: {
  kind: ChangeKind
  n?: number
  className?: string
}) {
  const Icon = changeIcons[kind]
  const tone = tones[kind]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium text-foreground',
        className,
      )}
    >
      <span aria-hidden className={cn('size-2 rounded-xs', tone)} />
      <Icon aria-hidden className="size-3.5 text-muted-foreground" />
      {n !== undefined && <span className="tabular-nums">{n}</span>}
      {n !== undefined ? countWord(kind, n) : kind}
    </span>
  )
}
