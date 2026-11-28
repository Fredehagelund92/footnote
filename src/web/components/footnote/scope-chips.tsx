import { SigmaIcon, SplitIcon, TagIcon } from '@/components/icons'
import { TagChip, WhereChip } from '@/components/footnote/tag-chip'
import { termLabel, termWords } from '@/lib/scope'
import type { Tone } from '@/lib/tones'
import type { Fact, ScopeTerm } from '@/model/items'

// What an item applies to, as chips (FR-107). Apart from the picker (scope-field.tsx), which only
// the editor draws, so an item's page and its peek do not load the picker up front.

/**
 * A term's look: the tag chip's tone and icon for what it is. Every value looks the same, a tag of
 * its dimension, whichever dimension it is of: none is special.
 */
export function lookOf(t: ScopeTerm): { tone: Tone; Icon: typeof SigmaIcon } {
  if (t.kind === 'metric') return { tone: 'metric', Icon: SigmaIcon }
  if (t.kind === 'dimension') return { tone: 'dimension', Icon: SplitIcon }
  return { tone: 'dimension', Icon: TagIcon }
}

/** One chosen term as its chip. */
export function ScopeChip({ term, onRemove }: { term: ScopeTerm; onRemove?: () => void }) {
  const { tone, Icon } = lookOf(term)
  return (
    <TagChip
      tone={tone}
      icon={<Icon aria-hidden />}
      onRemove={onRemove}
      removeLabel={onRemove ? `Remove ${termWords(term)}` : undefined}
      title={termWords(term)}
    >
      {termLabel(term)}
      {/* A value the writer added, which goes to the owner with the item (values without figures). */}
      {term.added && <span className="ml-1 opacity-70">new</span>}
    </TagChip>
  )
}

/**
 * What an item applies to, read-only: its terms by key when the binding read them, so a value
 * shows as a value of its dimension; otherwise its names.
 */
export function ScopeChips({ fact }: { fact: Pick<Fact, 'where' | 'scope'> }) {
  return fact.scope
    ? fact.scope.map((t) => <ScopeChip key={t.key || `${t.kind}:${t.name}`} term={t} />)
    : fact.where.map((w) => <WhereChip key={w} w={w} />)
}
