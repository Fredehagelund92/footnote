/*
  A family's meaning as people read it (FR-142, M1): where it comes from, what an owner may choose,
  and the meaning as one plain line. How it is worked out from the variants is family-meaning.ts,
  which the first load of the web app leaves out.
*/

/**
 * Where a family's meaning comes from, in the order family-meaning.ts gives it: its source's words,
 * an owner's, its variants' common words; `none` when nothing gives one.
 */
export const familyMeaningSources = ['declared', 'written', 'common', 'none'] as const
export type FamilyMeaningSource = (typeof familyMeaningSources)[number]

/**
 * What an owner chose a family's meaning to be: worked out from its variants (`auto`), or words
 * written here for the family.
 */
export const familyMeaningChoices = ['auto', 'written'] as const
export type FamilyMeaningChoice = (typeof familyMeaningChoices)[number]

/** The longest meaning an owner may write for a family. */
export const FAMILY_WORDS_MAX = 1000

/** What an owner chose last; null when no owner has chosen. */
export type MeaningChosen = {
  choice: FamilyMeaningChoice
  /** The words written for the family. */
  words: string | null
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A family's meaning as one plain line, each value it varies by said as what it stands for:
 * "Money taken in each currency via each channel", "through each channel" of "through the
 * {Channel} channel". Braces that name no axis stay as written.
 */
export function meaningLine(words: string, by: readonly string[]): string {
  return by.reduce(
    (line, axis) =>
      line.replace(
        new RegExp(
          `(?:(?<![\\p{L}\\p{N}])(the)\\s+)?\\{${escape(axis)}\\}(?:\\s+${escape(axis)}(?![\\p{L}\\p{N}]))?`,
          'giu',
        ),
        (_all, the: string | undefined) =>
          `${the === 'The' ? 'Each' : 'each'} ${axis.toLowerCase()}`,
      ),
    words,
  )
}
