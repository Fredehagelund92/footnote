/*
  One voice (FR-720, the hardening plan's H14): what an answer's own words may not say, whoever
  wrote them. Ask speaks of itself as Ask, never as I or me; it states what is written and never
  tells of the reads it made (the page shows what was read); it gives the days a period means
  once; and it says what the product does not record or hold only of business figures, the one
  fixed fact the answer is given, never of anything else a read did not return. Pure, so the
  loop's answer check (loop-check.ts) and the harness's grader read sentences the same way.
*/

/** Why one sentence breaks the voice. */
export type VoiceBreak = 'voice' | 'period' | 'claim'

/** Words quoted from an item or a definition: the item's voice, not Ask's. */
const QUOTED = /"[^"\n]*"|“[^”\n]*”/g

/** The speaker as I. Only English: the answer check holds English answers (copy.md). */
const FIRST_PERSON =
  /\b(?:I'm|I’m|I've|I’ve|I'd|I’d|I'll|I’ll|I)\b|\b(?:[Mm]e|[Mm]y|[Mm]yself|[Mm]ine)\b/

/**
 * A read, a search or a look-up as a thing that was made: "the first read", "a wider search".
 * Not the verb after "this" or "that": "this read every domain".
 */
const READ_MADE =
  /\b(?:the|this|that|these|those|each|every|both|one|another|an?|no|its|their)\s+(?:(?:first|second|third|last|earlier|later|wider|narrower|broader|new|same|other|next|previous|further|own|single|only)[,]?\s+)*(?:reads|read|searches|search|look-?ups?|lookups?)\b(?!\s+(?:the|a|an|every|each|all|any|both|this|that|these|those|it|them|as|only)\b)/i

/** Ask, or a tool by its name, as the one that read: "Ask read", "get_context found". */
const READER =
  /(?<!\bwhat\s)\bAsk\s+(?:also\s+|then\s+|first\s+)?(?:read|reads|searched|searches|looked|widened|checked)\b|\b(?:get|find|read)_context\b|\b(?:ask_back|show_overview|agent_questions)\b/

/** The product, or Ask, saying of itself what it does not hold. */
const holdsNo = (name: string) =>
  new RegExp(
    `\\b(?:${escape(name)}|Ask)\\s+(?:(?:does|did|do)\\s+not|doesn['’]t|didn['’]t|cannot|can['’]t|never)\\s+(?:record|records|hold|holds|keep|keeps|store|stores|track|tracks|log|logs|save|saves)\\b(.*)|\\b(?:${escape(name)}|Ask)\\s+(?:holds|keeps|records|stores|tracks|logs|saves)\\s+no\\b(.*)`,
    'i',
  )

/**
 * What a claim may be about: business figures, the fixed fact (the product keeps none, loop.ts),
 * and what the reads search, whose finding nothing is a read's own result.
 */
const MAY_CLAIM =
  /\b(?:figures?|numbers?|values?|amounts?|totals?|sums?|revenue|sales|forecasts?|counts?|business data|data from the business|metrics?|dimensions?|domains?|items?|definitions?|groups?|context|written)\b/i

/** The first words of what a claim is about, after a leading "a", "any" or "the". */
const objectOf = (words: string) =>
  (words.replace(/^\W*(?:(?:a|an|any|the|such)\s+)*/i, '').match(/[\p{L}\p{N}'’-]+/gu) ?? [])
    .slice(0, 3)
    .join(' ')

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?'
/** A span of days in words: "1 Apr to 30 Jun 2026", "1 to 31 October 2026", "from 1 January 2026 to 31 December 2026". */
const SPAN = new RegExp(
  `\\b(\\d{1,2})(?:\\s+(${MONTH}))?(?:,?\\s+(\\d{4}))?\\s*(?:to|until|through|-|–)\\s*(\\d{1,2})\\s+(${MONTH})(?:,?\\s+(\\d{4}))?`,
  'gi',
)
/** A span of days as dates: "2026-04-01 to 2026-06-30". */
const ISO_SPAN = /\b(\d{4})-(\d{2})-(\d{2})\s*(?:to|until|through|-|–)\s*(\d{4})-(\d{2})-(\d{2})\b/g

const monthOf = (m: string) => MONTHS.indexOf(m.slice(0, 3).toLowerCase()) + 1

/** Each span of days a sentence gives, by the days it means: "1-4-2026/30-6-2026". */
export function spansIn(sentence: string): string[] {
  const spans: string[] = []
  for (const m of sentence.matchAll(SPAN)) {
    const [, d1, m1, y1, d2, m2, y2] = m
    const to = monthOf(m2!)
    const year = y2 ?? y1 ?? ''
    spans.push(`${Number(d1)}-${m1 ? monthOf(m1) : to}-${y1 ?? year}/${Number(d2)}-${to}-${year}`)
  }
  for (const m of sentence.matchAll(ISO_SPAN)) {
    const [, y1, m1, d1, y2, m2, d2] = m
    spans.push(`${Number(d1)}-${Number(m1)}-${y1}/${Number(d2)}-${Number(m2)}-${y2}`)
  }
  return spans
}

/**
 * How one sentence of an answer breaks the voice, or null when it keeps it. `name` is the
 * product's name, as the answer gives it. Quoted words are the item's, and are not read.
 */
export function voiceBreak(sentence: string, name: string): VoiceBreak | null {
  return voiceBreakOf(sentence, name)?.kind ?? null
}

/**
 * How one sentence breaks the voice, with the words that break it ("Ask checked", "the read
 * gives", "I'll"), so a second writing is told exactly what to leave out; null when it keeps it.
 */
export function voiceBreakOf(
  sentence: string,
  name: string,
): { kind: VoiceBreak; words: string[] } | null {
  const own = sentence.replace(QUOTED, ' ')
  const speaks = [FIRST_PERSON, READ_MADE, READER]
    .flatMap((x) => [...own.matchAll(new RegExp(x.source, `${x.flags}g`))])
    .sort((a, b) => a.index - b.index)
    .map((m) => m[0])
  if (speaks.length) return { kind: 'voice', words: [...new Set(speaks)] }
  const spans = spansIn(own)
  if (new Set(spans).size < spans.length) return { kind: 'period', words: [own.trim()] }
  const claim = holdsNo(name).exec(own)
  if (claim && !MAY_CLAIM.test(objectOf(claim[1] ?? claim[2] ?? '')))
    return { kind: 'claim', words: [claim[0].trim()] }
  return null
}
