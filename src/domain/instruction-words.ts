/*
  The words that read like orders to a language model (NFR-024). Apart from provenance.ts so the
  editor, which says them while someone drafts, loads them without the rest of provenance.
*/

/**
 * A word list in Portuguese or Spanish, matched as whole words: `\\b` reads only ASCII letters, so
 * an accented letter at either end would break it.
 */
export const words = (list: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${list})(?![\\p{L}\\p{N}])`, 'giu')

const instructionPatterns: RegExp[] = [
  /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|other|system)\b[^.\n]{0,20}\b(?:instructions?|prompts?|rules?|messages?)\b/gi,
  /\b(?:always|never|you must|you should)\s+(?:call|use|run|invoke|answer|reply|say|tell|output|include)\b/gi,
  /\byou are (?:now )?(?:an?|the) (?:ai|assistant|agent|model|language model|chatbot)\b/gi,
  /\b(?:system prompt|developer message|jailbreak)\b/gi,
  /<\/?\s*(?:system|assistant|instructions?|tool_call|im_start|im_end)\b[^>]*>/gi,
  /\b(?:do not|don't|never) (?:tell|show|inform|warn) (?:the )?(?:user|person|owner|reviewer|human)\b/gi,
  // Portuguese and Spanish: a page in either language can carry orders to a model too.
  words(
    '(?:ignore|ignora|desconsidere|desconsidera|esque[çc]a|olvida)[^.\\n]{0,40}instru(?:[çc][õo]es|cciones)',
  ),
  words(
    '(?:voc[êe] [ée]|eres|usted es) (?:agora |ahora )?(?:um|uma|un|una) (?:assistente|asistente|ia|modelo)',
  ),
  words(
    '(?:n[ãa]o|no)(?: le| lhe)? (?:conte|diga|informe|mostre|avise|cuentes|digas|informes|muestres|avises)(?: nada)? (?:ao|al|a la|à) (?:usu[áa]rio|pessoa|persona|revisor)',
  ),
]

export function matchesOf(patterns: RegExp[], text: string): string[] {
  const words = new Set<string>()
  for (const pattern of patterns)
    for (const match of text.matchAll(pattern)) words.add(match[0].toLowerCase().slice(0, 60))
  return [...words].slice(0, 10)
}

/** Words that read like orders to a language model (NFR-024): shown as a warning, kept as data. */
export const instructionWords = (text: string) => matchesOf(instructionPatterns, text)
