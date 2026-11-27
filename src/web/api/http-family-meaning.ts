import type { FamilyChange, FamilyMeaningVersion } from '@contract/catalogue'
import type { Version } from '@/model/history'

// A family's History, loaded with its first History read: most definitions are no family, so the
// first load leaves it out. It imports nothing, so loading it splits nothing else off.

/** What a family's metrics were before and after a change to what it holds. */
const HELD: Record<FamilyChange['kind'], Pick<Version, 'kind' | 'summary' | 'before' | 'after'>> = {
  published: {
    kind: 'family',
    summary: 'From then on it was one entry in Definitions and for agents, with its variants.',
    before: 'Metrics waiting to be published',
    after: 'One family',
  },
  split: {
    kind: 'split',
    summary: 'Each of its metrics stood on its own, in Definitions and for agents.',
    before: 'One family',
    after: 'Separate metrics',
  },
  joined: {
    kind: 'joined',
    summary: 'From then on it was one entry in Definitions and for agents, with its variants.',
    before: 'Separate metrics',
    after: 'One family',
  },
}

/**
 * A family's History, newest first (FR-142): who published its metrics as one family, split it and
 * made it one again, and what owners chose it to mean, each by the person who did it; then what its
 * tool says, when its tool declares the family (`read`). A family Footnote found is never credited
 * to the tool that reads its metrics.
 */
export function familyHistoryOf(
  meanings: readonly FamilyMeaningVersion[],
  changes: readonly FamilyChange[],
  read: readonly Version[],
  person: (id: string) => string,
  /** The day a service time falls on, as the app shows days (`serviceDay`). */
  day: (at: string) => string,
): Version[] {
  const sorted = [...meanings].sort((a, b) => b.revision - a.revision)
  const said = (v: FamilyMeaningVersion | undefined) =>
    !v || v.choice === 'auto' ? 'Worked out from its variants' : (v.words ?? '')
  const all: { at: string; version: Omit<Version, 'v'> }[] = [
    ...sorted.map((version, index) => ({
      at: version.at,
      version: {
        who: person(version.personId),
        on: day(version.at),
        kind: 'wording' as const,
        summary:
          version.choice === 'auto'
            ? 'Its meaning is worked out from its variants again.'
            : 'Its meaning was written for the family.',
        field: 'Meaning',
        before: said(sorted[index + 1]),
        after: said(version),
      },
    })),
    ...changes.map((change) => ({
      at: change.at,
      version: {
        ...HELD[change.kind],
        who: person(change.personId),
        on: day(change.at),
        field: 'Its metrics',
      },
    })),
    ...read.map((version) => ({ at: version.on, version })),
  ]
  return all
    .sort((a, b) => b.at.localeCompare(a.at))
    .map(({ version }, index) => ({ ...version, v: all.length - index }))
}
