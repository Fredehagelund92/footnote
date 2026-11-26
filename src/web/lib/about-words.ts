import type { Definition } from '@/lib/definitions'

// About our business holds what the company does; the words people use and what they mean are
// terms in Definitions, which reach Ask and agents with the question that uses them. A line of the
// text written as a word, a colon and its meaning ("Net revenue: after VAT") for a word that
// already has a definition is said under the field, so the text never holds a second meaning.

/**
 * The word a line defines, as "Word: meaning" writes it in Markdown, the colon inside the bold or
 * outside it, or null when nothing follows the colon.
 */
function wordOf(line: string): string | null {
  const said =
    /^\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:\*\*|__)?([^\s:*_][^:*_\n]{0,59}?)(?:\*\*|__)?\s*:/.exec(line)
  if (!said) return null
  const meaning = line
    .slice(said[0].length)
    .trim()
    .replace(/^(?:\*\*|__)/, '')
  return meaning.trim() ? said[1]!.trim() : null
}

/** A definition by its name, a variant's name or its plural, either way ("Order" is Orders). */
const named = (word: string, find: (name: string) => Definition | undefined) =>
  find(word) ?? find(`${word}s`) ?? (/s$/i.test(word) ? find(word.slice(0, -1)) : undefined)

/**
 * The definitions the text's "Word: meaning" lines name again, in the order the text has them,
 * each once.
 */
export function definedInAbout(
  text: string,
  find: (name: string) => Definition | undefined,
): Definition[] {
  const found: Definition[] = []
  for (const line of text.split('\n')) {
    const word = wordOf(line)
    const definition = word ? named(word, find) : undefined
    if (definition && !found.includes(definition)) found.push(definition)
  }
  return found
}

/** What the line under the field says after the definition's name, by where its words are. */
export const definedWords = (d: Definition) =>
  d.sameAs
    ? `is already in Definitions, as another name for ${d.sameAs}.`
    : d.synced
      ? `already has a definition${d.tool ? `, from ${d.tool}` : ''}.`
      : 'is already a term in Definitions.'
