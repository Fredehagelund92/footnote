import type { LoopRun, LoopTurn } from '../../../contract/answer.ts'
import { DRAFTS_READ } from '../../../domain/ask-chat.ts'
import { SENTENCE_END } from './loop-body.ts'

/*
  The block of what is not published yet (FR-718.2, as amended 25 Nov 2026), by code from a turn's
  searches. When nothing published matches every word of a search, `find_context` gives what does
  among the person's own drafts and the suggestions waiting for review they may open, read as them
  through row security. The answer stays about what is published: what is not published yet is
  never a source and never said as a fact. Under it, one block lists those items, and holds the one
  sentence the model may write about them: conditional ("If it is published as written, ..."), and
  citing each item it is about by its ref (`[draft:12]`). Every other sentence that cites one, names
  one by its title, or is that conditional without a ref the turn's searches gave is taken out of
  the answer, and the check keeps it.

  Agents never get any of it: the block is Ask's alone (FR-718.5).
*/

type Obj = Record<string, unknown>
type Check = LoopTurn['checks'][number]
type Drafts = NonNullable<LoopTurn['drafts']>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : [])
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const strs = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
const num = (v: unknown) => (typeof v === 'number' ? v : 0)

/** An item not published yet as this turn's searches gave it, with the ref the words cite it by. */
export type DraftRead = Omit<Drafts['rows'][number], 'action'> & { ref: string; owners: string[] }

/** What a turn's searches found that is not published yet: every item once, the first few shown. */
export type DraftsRead = { words: string[]; found: number; rows: DraftRead[] }

/** The most rows the block shows. */
const ROWS_SHOWN = 3

/**
 * What the turn's searches found not published yet, each item once, in the order found, with how
 * many they found in all; null when they found none.
 */
export function draftsRead(made: readonly { tool: string; result: unknown }[]): DraftsRead | null {
  const rows = new Map<string, DraftRead>()
  const words: string[] = []
  let found = 0
  for (const m of made) {
    if (m.tool !== 'find_context' || !isObj(m.result) || !isObj(m.result.drafts)) continue
    const d = m.result.drafts
    found = Math.max(found, num(d.found))
    for (const w of strs(d.words)) if (!words.includes(w)) words.push(w)
    for (const i of arr(d.items)) {
      const id = str(i.id)
      if (!id || rows.has(id)) continue
      rows.set(id, {
        id,
        ref: str(i.ref),
        state: i.state === 'waiting' ? 'waiting' : 'draft',
        change: i.change === true,
        title: str(i.title),
        domain: str(i.domainId) || null,
        by: typeof i.by === 'string' ? i.by : null,
        on: str(i.on),
        owners: strs(i.owners),
      })
    }
  }
  if (!rows.size) return null
  return { words, found: Math.max(found, rows.size), rows: [...rows.values()] }
}

/** A mark that cites an item not published yet: `[draft:12]`, alone or beside other ids. */
const DRAFT_MARK = /\[[^[\]\n]*?\bdraft:\d+[^[\]\n]*\]/g
const DRAFT_REF = /\bdraft:\d+\b/g
/** The one sentence the block may hold starts so, whatever markup leads it. */
const CONDITIONAL =
  /^[\s*_~]*if\s+(?:it\s+is|it's|they\s+are|they're|this\s+is|these\s+are)\s+published\s+as\s+written\b/i
const BULLET = /^\s*(?:[-*•]|\d{1,2}[.)])\s+/
/** A title short enough to be words of an answer by chance is never read as naming its item. */
const TITLE_NAMES = 16

/**
 * The model's words apart from what is not published yet: the words without any sentence that is
 * about an item not published yet, and the one sentence the block holds, without its marks, when
 * the words wrote one that is conditional and cites only items this turn's searches gave.
 */
export function apartFromDrafts(
  text: string,
  drafts: DraftsRead | null,
): { text: string; sentence: string | null; checks: Check[] } {
  const refs = new Set(drafts?.rows.map((r) => r.ref) ?? [])
  const titles = (drafts?.rows ?? [])
    .map((r) => r.title.toLowerCase())
    .filter((t) => t.length >= TITLE_NAMES)
  const checks: Check[] = []
  let sentence: string | null = null
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const kept = lines.flatMap((line) => {
    if (!line.trim()) return [line]
    const bullet = BULLET.exec(line)?.[0] ?? ''
    const said = line.slice(bullet.length).split(SENTENCE_END)
    const out: string[] = []
    let dropped = false
    for (const one of said) {
      const cited = [...one.matchAll(DRAFT_MARK)].flatMap((m) => m[0].match(DRAFT_REF) ?? [])
      const lower = one.toLowerCase()
      const conditional = CONDITIONAL.test(one)
      const named = titles.some((t) => lower.includes(t))
      if (!cited.length && !conditional && !named) {
        out.push(one)
        continue
      }
      dropped = true
      const fits =
        sentence === null &&
        conditional &&
        cited.length > 0 &&
        cited.every((ref) => refs.has(ref)) &&
        !/\bitm_[a-z0-9]{8,16}\b/.test(one)
      if (fits)
        sentence = one
          .replace(DRAFT_MARK, '')
          .replace(/[ \t]+([.,;:!?])/g, '$1')
          .trim()
      else checks.push({ kind: 'draft', words: one.trim() })
    }
    if (dropped && !out.some((x) => x.trim())) return []
    return [`${bullet}${out.join(' ')}`]
  })
  return {
    text: kept
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    sentence,
    checks,
  }
}

/**
 * The block the turn carries: its rows, at most a few, each with what opens it (a draft is its
 * writer's own, so the reader wrote every draft they may open), and its sentence drawn.
 */
export function draftsBlock(read: DraftsRead, sentence: LoopRun[] | null): Drafts {
  const rows = read.rows.slice(0, ROWS_SHOWN)
  return {
    words: read.words,
    found: read.found,
    more: Math.max(0, read.found - rows.length),
    rows: rows.map(({ ref: _, owners, ...row }) => ({
      ...row,
      action: {
        id: row.state === 'draft' ? 'open_draft' : 'review_suggestion',
        draft: { id: row.id, domain: row.domain, mine: row.state === 'draft', owners },
      },
    })),
    sentence: sentence?.length ? sentence : null,
  }
}

/** What was read, by code: the search of what is not published yet, when it found any (FR-720.9). */
export const draftsLine = (read: DraftsRead) =>
  `${DRAFTS_READ} for ${read.words.map((w) => `“${w}”`).join(' or ')}: ${read.found.toLocaleString('en-GB')} found, not published.`
