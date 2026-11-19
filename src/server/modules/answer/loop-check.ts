import { voiceBreak, type VoiceBreak } from '../../../domain/answer-voice.ts'
import { productName } from '../../brand.ts'
import { SENTENCE_END } from './loop-body.ts'
import { askToolDefinitions } from './tools.ts'

/*
  The answer check of Ask's loop (FR-720.10), by code: before an answer is shown, each sentence
  the model wrote is held to what the chat read. A sentence fails when it gives a number in digits
  of its own that no read returned, the person did not write and no tool says of itself ("the last
  7 full days") (FR-720.3), cites an item no read
  returned (FR-720.2), or gives a count of what agents asked that the reader may not see: a floor
  ("13+") as an exact count, or any count of a topic the reader sees none of (FR-614). It fails
  too when it breaks Ask's one voice (src/domain/answer-voice.ts): it speaks as I or tells of the
  reads, gives the same days twice, or says what the product does not record that no read
  returned. An answer that fails is written again once, out of the person's sight, and a sentence
  that still fails is replaced by a fixed sentence that says so, never left out without a word
  (loop.ts); one that still breaks only the voice or the period says something true, and stays.

  The judges of FR-720.2, FR-720.6 and FR-720.7 do not read the answer here yet: a judge may gate
  only once it is measured on at least 60 answers labelled by hand, and the harness's labelled set
  is smaller (docs/evaluations.md, "Ask's loop").
*/

/** One sentence that failed, and why, in words the model reads when it writes the answer again. */
export type CheckFinding = {
  kind: 'number' | 'citation' | 'hidden' | VoiceBreak
  sentence: string
  why: string
}

/**
 * A topic of what agents asked whose count the reader sees only as a floor, or not at all, with
 * the numbers it may be given: the minimum ("fewer than 5"), and the exact ones its read gives,
 * such as how many calls found nothing.
 */
type HiddenTopic = { title: string; floor: number | null; given: ReadonlySet<string> }

/** What a sentence is held to: the chat's reads and the person's own words. */
export type CheckContext = {
  /** Every id the chat's reads returned. */
  known: ReadonlySet<string>
  /** Every number the reads returned or the person wrote, by value. */
  grounded: ReadonlySet<string>
  hidden: readonly HiddenTopic[]
}

/** The sentence shown in place of one that failed the check twice. */
export const UNCHECKED = 'This part of the answer did not match what Ask read, so it is not shown.'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const ITEM_ID = /^itm_[a-z0-9]{8,16}$/

/** A mention, a reference to a read, or a list of a read: the model's markup, no citation. */
const MARKUP = /\[@[^\]\n]{1,200}\]|\[#r\d+(?:\.[A-Za-z0-9_]+)+\]|\[list:r\d+\]/g
/** A mark in brackets, or a bare item id. */
const MARK = /\[([^[\]\n]{1,200})\]|\b(itm_[a-z0-9]{8,16})\b/g
/** A number the words give in digits, not part of a word: "4", "1,240", "2.5", "13+". */
const NUMBER = /(?<![\p{L}\p{N}_])\d(?:[\d,]*\d)?(?:\.\d+)?\+?/gu
const BULLET = /^\s*(?:[-*•]|\d{1,2}[.)])\s+/
const LIST_LINE = /^\s*\[list:r\d+\]\s*$/

/** A number by its value, so "07" is 7 and "1,240" is 1240. */
const valueOf = (n: string) => String(Number(n.replace(/[,+]/g, '')))

/** Every number in some text, by value, and each part of one written with commas or a point. */
function valuesIn(text: string): Set<string> {
  const values = new Set<string>()
  for (const [n] of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    values.add(valueOf(n))
    for (const part of n.split(/[,.]/)) if (part) values.add(valueOf(part))
  }
  return values
}

/** The sentences of one line of the model's words, without a list line's dash. */
const lineSentences = (line: string) =>
  line
    .replace(BULLET, '')
    .trim()
    .split(SENTENCE_END)
    .map((s) => s.trim())
    .filter(Boolean)

/**
 * The sentences of the model's words, as the page splits them: by line, a list line without its
 * dash, then at each sentence's end. A line that only asks for a read's list is no sentence.
 */
export function sentencesOf(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => line.trim() && !LIST_LINE.test(line))
    .flatMap(lineSentences)
}

function hiddenTopics(results: readonly unknown[]): HiddenTopic[] {
  const topics: HiddenTopic[] = []
  for (const r of results) {
    if (!isObj(r) || !Array.isArray(r.topics) || typeof r.minimum !== 'number') continue
    const minimum = String(r.minimum)
    for (const t of r.topics)
      if (isObj(t) && typeof t.title === 'string' && t.exact === null)
        topics.push({
          title: t.title,
          floor: typeof t.atLeast === 'number' ? t.atLeast : null,
          given: new Set([minimum, ...valuesIn(`${String(t.foundNothing)} ${String(t.itemsNow)}`)]),
        })
    if (Array.isArray(r.notListed))
      for (const title of r.notListed)
        if (typeof title === 'string')
          topics.push({ title, floor: null, given: new Set([minimum]) })
  }
  return topics
}

/** What the tools say of themselves, whose numbers are fixed facts ("the last 7 full days"). */
const toolWords = Object.values(askToolDefinitions)
  .map((d) => d.description)
  .join('\n')

const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?'
/** Days, spans of days and lengths of time: numbers that count no calls. */
const WHEN = new RegExp(
  [
    `\\b\\d{1,2}(?:\\s*(?:to|-|–)\\s*\\d{1,2})?\\s+${MONTH}(?:\\s+\\d{4})?`,
    `\\b${MONTH}\\s+\\d{1,2}\\b(?:,?\\s+\\d{4})?`,
    '\\b\\d{4}-\\d{2}-\\d{2}\\b',
    '\\b(?:19|20)\\d{2}\\b',
    '\\b\\d+\\s+(?:full\\s+)?(?:days?|weeks?|months?|years?)\\b',
  ].join('|'),
  'gi',
)

/**
 * What the check holds the words to, from the results of the chat's reads (this turn's and the
 * earlier ones made again) and what the person wrote in the chat, with today's date.
 */
export function checkContext(
  results: readonly unknown[],
  said: readonly string[],
  idsOf: (result: unknown) => readonly string[],
): CheckContext {
  return {
    known: new Set(results.flatMap(idsOf)),
    grounded: valuesIn(`${JSON.stringify(results)}\n${said.join('\n')}\n${toolWords}`),
    hidden: hiddenTopics(results),
  }
}

/** Each sentence of the model's words that fails the check, with why. */
export function answerCheck(text: string, ctx: CheckContext): CheckFinding[] {
  const findings: CheckFinding[] = []
  for (const sentence of sentencesOf(text)) {
    const plain = sentence.replace(MARKUP, (m) => ' '.repeat(m.length))
    // A citation is an item's id, or a number in brackets as the page writes one.
    const cites = [...plain.matchAll(MARK)].flatMap(([, inner, bare]) =>
      bare ? [bare] : inner!.split(/[,;]\s*|\s+/).filter((x) => ITEM_ID.test(x) || /^\d+$/.test(x)),
    )
    const unknown = cites.filter((id) => !ctx.known.has(id))
    if (unknown.length)
      findings.push({
        kind: 'citation',
        sentence,
        why: `it cites ${unknown.join(', ')}, which no read in this chat returned`,
      })
    const numbers = [...plain.replace(MARK, (m) => ' '.repeat(m.length)).matchAll(NUMBER)].map(
      ([n]) => n,
    )
    const own = numbers.filter((n) => !ctx.grounded.has(valueOf(n)))
    if (own.length)
      findings.push({
        kind: 'number',
        sentence,
        why: `it gives ${own.join(', ')} in digits of its own, which no read returned and the person did not write`,
      })
    const voice = voiceBreak(plain, productName)
    if (voice) findings.push({ kind: voice, sentence, why: VOICE[voice] })
    const lower = sentence.toLowerCase()
    const counts = [
      ...plain
        .replace(MARK, (m) => ' '.repeat(m.length))
        .replace(WHEN, (m) => ' '.repeat(m.length))
        .matchAll(NUMBER),
    ].map(([n]) => n)
    for (const topic of ctx.hidden) {
      if (!lower.includes(topic.title.toLowerCase())) continue
      const over = counts.filter(
        (n) =>
          !(n.endsWith('+') && valueOf(n) === String(topic.floor)) &&
          !(!n.endsWith('+') && topic.given.has(valueOf(n))),
      )
      if (over.length)
        findings.push({
          kind: 'hidden',
          sentence,
          why:
            topic.floor === null
              ? `it gives a count for ${topic.title}, which the person may not see`
              : `it gives ${topic.title} as ${over.join(', ')}, where the person sees only ${topic.floor}+`,
        })
    }
  }
  return findings
}

/** Why a sentence breaks the voice, as the model is told when it writes the answer again. */
const VOICE: Record<VoiceBreak, string> = {
  voice:
    'it speaks as I or me, or tells of the reads made; speak of yourself as Ask, and state what is written',
  period: 'it gives the same days twice; give them once',
  claim: `it says what ${productName} does not record or hold, which no read returned; say only what a read returned`,
}

/** What the model is told when its answer failed the check: each sentence, why, and what to do. */
export function checkRequest(findings: readonly CheckFinding[]): string {
  return [
    CHECK_REQUEST,
    ...new Set(findings.map((f) => `- "${f.sentence}": ${f.why}.`)),
    'Write the whole answer again, under the same rules. Write every number a read returned as a reference to it, cite only ids a read returned, and give a count of what agents asked only as the read gives it. Speak as Ask, never as I, and say nothing of the reads. Leave out what no read supports. Keep the other sentences as they were.',
  ].join('\n')
}

/** The first line of what the model is told when its answer failed the check. */
export const CHECK_REQUEST =
  'Ask checked your answer against what was read before showing it, and these sentences failed:'

/** Failures whose sentence is still true, so it is shown as written the second time; the harness counts them and no merge may raise that count. */
const KEPT: ReadonlySet<CheckFinding['kind']> = new Set(['voice', 'period'])

/**
 * The words with each sentence that failed replaced by the fixed sentence, once for sentences that
 * follow one another, so the answer says where a part is missing (FR-720.10).
 */
export function withUnchecked(text: string, findings: readonly CheckFinding[]): string {
  const failed = new Set(findings.filter((f) => !KEPT.has(f.kind)).map((f) => f.sentence))
  if (!failed.size) return text
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      if (!line.trim() || LIST_LINE.test(line)) return line
      const out: string[] = []
      for (const said of lineSentences(line))
        if (!failed.has(said)) out.push(said)
        else if (out.at(-1) !== UNCHECKED) out.push(UNCHECKED)
      return `${BULLET.exec(line)?.[0] ?? ''}${out.join(' ')}`
    })
    .join('\n')
}

/**
 * The longest start of some finished words whose sentences all pass the check: what the page may
 * show while the model still writes (FR-719.7). Empty when the first sentence fails.
 */
export function checkedStart(done: string, ctx: CheckContext): string {
  const failed = answerCheck(done, ctx)
  if (!failed.length) return done
  const at = Math.min(...failed.map((f) => done.indexOf(f.sentence)).filter((i) => i >= 0))
  if (!Number.isFinite(at)) return ''
  // A list line's dash goes with the sentence the line starts with.
  const line = done.lastIndexOf('\n', at - 1) + 1
  const cut = /^\s*(?:[-*•]|\d{1,2}[.)])\s+$/.test(done.slice(line, at)) ? line : at
  return done.slice(0, cut).trimEnd()
}
