import type { Definition } from '@/lib/definitions'

// About our business holds what the company does; the words people use and what they mean are
// terms in Definitions, which reach Ask and agents with the question that uses them. A line of the
// text written as a word, a colon and its meaning ("Net revenue: after VAT") for a word that
// already has a definition is said under the field, so the text never holds a second meaning.

/** The word a line defines, as "Word: meaning" writes it in Markdown, or null. */
function wordOf(line: string): string | null {
  const said =
    /^\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:\*\*|__)?([^:*_\n]{1,60}?)(?:\*\*|__)?\s*:\s*\S/.exec(line)
  return said ? said[1]!.trim() || null : null
}

/**
 * The definitions the text's "Word: meaning" lines name again, in the order the text has them,
 * each once: by the word's name, a variant's name or its plural ("Order" is Orders).
 */
export function definedInAbout(
  text: string,
  find: (name: string) => Definition | undefined,
): Definition[] {
  const found: Definition[] = []
  for (const line of text.split('\n')) {
    const word = wordOf(line)
    const definition = word ? (find(word) ?? find(`${word}s`)) : undefined
    if (definition && !found.includes(definition)) found.push(definition)
  }
  return found
}

/** What the line under the field says after the definition's name, by where its words are. */
export const definedWords = (d: Definition) =>
  d.synced
    ? `already has a definition${d.tool ? `, from ${d.tool}` : ''}.`
    : 'is already a term in Definitions.'
