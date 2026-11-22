import { EqualIcon, SigmaIcon, SplitIcon, WholeWordIcon, type LucideIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import type { Definition, DefinitionType } from '@/lib/definitions'

// The marks of a definition: a lucide glyph in a neutral tile for a catalogue term's type (sigma
// for a metric, split for a dimension). A term with its own meaning takes whole-word and a
// synonym takes equals, from the same set.

export const glyphs: Record<DefinitionType | 'synonym', LucideIcon> = {
  metric: SigmaIcon,
  dimension: SplitIcon,
  term: WholeWordIcon,
  synonym: EqualIcon,
}

export const kindOf = (d: Pick<Definition, 'type' | 'sameAs'>) => (d.sameAs ? 'synonym' : d.type)

/** The type as a plain glyph, for chips and menus where the words beside it say what it is. */
export function TypeGlyph({
  d,
  className,
}: {
  d: Pick<Definition, 'type' | 'sameAs'>
  className?: string
}) {
  const Glyph = glyphs[kindOf(d)]
  return <Glyph aria-hidden className={cn('size-3.5 shrink-0 text-muted-foreground', className)} />
}

/**
 * A family's glyph where a metric's is a bare sigma (search, menus): the same sigma, a little
 * smaller, with two sheets behind it up and to the right. The sigma's width, so a name beside it
 * starts where a metric's does.
 */
export function FamilyGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('size-3.5 shrink-0 text-muted-foreground', className)}
    >
      <SigmaIcon x={-0.5} y={3.5} width={19.68} height={19.68} />
      <path d="M7.5 3.5h11a1.5 1.5 0 0 1 1.5 1.5v11" opacity={0.75} />
      <path d="M10.5 1h10a2 2 0 0 1 2 2v10" opacity={0.45} />
    </svg>
  )
}
