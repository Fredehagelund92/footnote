import { familyFoundKinds, foundKindWords, type FamilyFound } from '@domain/family-found'
import { cn } from '@/lib/utils'

// The families a read finds, by how each was found, in the order of trust (FR-142, D1, D6): a bar,
// and each kind's count in words. Test connection, the source's page and the Inbox's Families tab
// draw the same, so the kinds read alike wherever an admin or an owner meets them.

/** How many families of each kind. */
export type FoundCounts = Record<FamilyFound, number>

// The most trusted kind is the strongest grey in either theme: ink, then the muted ink, then a
// field's edge. Look alike is caution: never a family until someone says so.
const look: Record<FamilyFound, { bar: string; edge: string }> = {
  declared: { bar: 'bg-foreground', edge: 'border-foreground' },
  calculation: { bar: 'bg-muted-foreground', edge: 'border-muted-foreground' },
  rate: { bar: 'bg-input', edge: 'border-input' },
  names: { bar: 'bg-caution', edge: 'border-caution' },
}

/** Each kind with a count, in the order of trust, with its words: "8 declared in dbt". */
export function foundKinds(found: FoundCounts, tool: string) {
  return familyFoundKinds.flatMap((kind) =>
    found[kind] > 0 ? [{ kind, count: found[kind], words: foundKindWords(kind, tool) }] : [],
  )
}

/** The kinds in one sentence, for a screen reader and a summary: "8 declared in dbt, 5 look alike". */
export const foundSentence = (found: FoundCounts, tool: string) =>
  foundKinds(found, tool)
    .map((k) => `${k.count.toLocaleString('en-GB')} ${k.words}`)
    .join(', ')

/**
 * The bar and the counts. `counts` draws each kind's number large over its words, for Test
 * connection and the source's page; `line` draws them in one line of small words, for the card.
 * With `names` set, Look alike says it is never a family until someone says so.
 */
export function FamiliesFound({
  found,
  tool,
  as = 'counts',
  untilSaid = false,
  className,
}: {
  found: FoundCounts
  tool: string
  as?: 'counts' | 'line'
  untilSaid?: boolean
  className?: string
}) {
  const kinds = foundKinds(found, tool)
  if (!kinds.length) return null
  const words = (k: (typeof kinds)[number]) =>
    k.kind === 'names' && untilSaid ? `${k.words}, never a family until someone says so` : k.words
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div aria-hidden className="flex h-2 gap-0.5">
        {kinds.map((k) => (
          <span
            key={k.kind}
            data-found={k.kind}
            className={cn('h-full min-w-1', look[k.kind].bar)}
            style={{ flex: k.count }}
          />
        ))}
      </div>
      {as === 'counts' ? (
        <ul
          aria-label="Families by how they were found"
          className="flex flex-wrap gap-x-4 gap-y-3"
        >
          {/* Four in a row where they fit, two on a phone. */}
          {kinds.map((k) => (
            <li
              key={k.kind}
              className={cn('flex min-w-28 flex-1 flex-col border-l-2 pl-3', look[k.kind].edge)}
            >
              <span className="text-xl font-semibold tabular-nums">
                {k.count.toLocaleString('en-GB')}
              </span>
              <span className="text-xs text-muted-foreground">{words(k)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <ul
          aria-label="Families by how they were found"
          className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
        >
          {kinds.map((k) => (
            <li key={k.kind} className={cn(k.kind === 'names' && 'text-caution')}>
              <span className="tabular-nums">{k.count.toLocaleString('en-GB')}</span> {words(k)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
