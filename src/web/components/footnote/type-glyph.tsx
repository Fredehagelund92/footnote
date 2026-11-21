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
