import { termWord } from './terms.ts'
import type { SourceName } from './source-names.ts'

/**
 * The flagged names an owner can publish as suggested at one press: those that wait only because
 * another definition has the same name, as one dimension a project keeps in many semantic models
 * does, each with the name `termCandidates` told it apart by. A name whose word another meaning
 * holds, that is no name, or that is a family, still needs a look, and so do two that would share a word.
 */
export function asSuggested<
  T extends Pick<SourceName, 'state' | 'kind' | 'flags' | 'linked' | 'name' | 'aliases'>,
>(names: readonly T[]): T[] {
  const sameNameOnly = names.filter(
    (name) =>
      name.state === 'flagged' &&
      name.kind !== 'metric_group' &&
      !name.linked.length &&
      name.flags.some((flag) => flag.code === 'same_name') &&
      name.flags.every((flag) => flag.code === 'same_name' || flag.code === 'titles_differ'),
  )
  const wordsOf = (name: T) => new Set([name.name, ...name.aliases].map(termWord))
  const uses = new Map<string, number>()
  for (const name of sameNameOnly)
    for (const word of wordsOf(name)) uses.set(word, (uses.get(word) ?? 0) + 1)
  return sameNameOnly.filter((name) => [...wordsOf(name)].every((word) => uses.get(word) === 1))
}
