import type { FamilyMeaningVersion } from '@contract/catalogue'
import type { Version } from '@/model/history'

// A family's History, loaded with its first History read: most definitions are no family, so the
// first load leaves it out. It imports nothing, so loading it splits nothing else off.

/**
 * The choices of what a family means as History reads them, newest first, after its tool's read:
 * version 1 is the read, so each choice is its revision and one.
 */
export function familyMeaningHistoryOf(
  versions: readonly FamilyMeaningVersion[],
  person: (id: string) => string,
  /** The day a service time falls on, as the app shows days (`serviceDay`). */
  day: (at: string) => string,
): Version[] {
  const sorted = [...versions].sort((a, b) => b.revision - a.revision)
  const said = (v: FamilyMeaningVersion | undefined) =>
    !v || v.choice === 'auto' ? 'Worked out from its variants' : (v.words ?? '')
  return sorted.map((version, index) => ({
    v: version.revision + 1,
    who: person(version.personId),
    on: day(version.at),
    kind: 'wording',
    summary:
      version.choice === 'auto'
        ? 'Its meaning is worked out from its variants again.'
        : 'Its meaning was written for the family.',
    field: 'Meaning',
    before: said(sorted[index + 1]),
    after: said(version),
  }))
}
