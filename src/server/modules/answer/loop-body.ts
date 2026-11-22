import type {
  LoopBlock,
  LoopItem,
  LoopLink,
  LoopOverview,
  LoopRun,
  LoopTurn,
} from '../../../contract/answer.ts'
import { dimensionOf, nounKindOf } from '../../../domain/ask-nouns.ts'
import { inlineSegments, marks } from '../../../domain/markdown-blocks.ts'
import { isCalendarDate } from '../../../domain/validity.ts'

/*
  The answer's words as the page draws them (FR-720), written by code from what the model wrote
  and what the reads returned. The model writes each noun as a typed mention whose id a read
  returned (`[@metric:orders]`, `[@value:channel/web_shop]`), each count or day a read gave as a
  reference to it (`[#r1.count]`), cites items by id as before, asks for a read's items as a list
  (`[list:r1]`), and may write a short list as lines that start with "- ". What it marks in
  Markdown is drawn so (bold, italics, code, a link, a numbered list, a short table), never as
  its asterisks and pipes, and a link goes only to a web or mail address or a help page. Code
  checks every one against the reads of this chat: a mention no read named is plain words, never
  a chip; a reference to a read's words is those words, and one no read holds is left out of its sentence,
  which stays (code repairs the words and never deletes a sentence); and what the check found is
  kept in `checks`, never shown as the answer's words. A set the person asked for as a whole is an overview: the
  groups of one read, by code.

  Nothing here knows a dimension, a domain or a person by name: the nouns come from the reads.
*/

/** One read of the chat as the words may cite it: its number (`r1`), its tool and its result. */
export type NumberedRead = { ref: string; tool: string; result: unknown }

type Obj = Record<string, unknown>
type Noun = LoopTurn['nouns'][number]
type Check = LoopTurn['checks'][number]
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : [])
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const strs = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
const ITEM_ID = /^itm_[a-z0-9]{8,16}$/

/** The nouns the reads named, by id (each result's `names`), with each value's dimension too. */
export function nounsRead(results: readonly unknown[]): Map<string, Noun> {
  const nouns = new Map<string, Noun>()
  for (const r of results)
    for (const n of isObj(r) ? arr(r.names) : []) {
      const id = str(n.id)
      if (!id || !nounKindOf(id) || nouns.has(id)) continue
      const dimension = dimensionOf(id)
      const of = dimension && str(n.of) ? { id: dimension, name: str(n.of) } : null
      const type = typeof n.type === 'string' ? n.type : null
      nouns.set(id, { id, name: str(n.name) || id, of, type })
      if (of && !nouns.has(of.id)) nouns.set(of.id, { id: of.id, name: of.name, of: null, type })
    }
  return nouns
}

const statusOf = (words: string, outOfDate: unknown): LoopItem['status'] =>
  words === 'archived' ? 'archived' : words.startsWith('due') || outOfDate ? 'due' : 'live'

/** The reason the records give when an item is due because its check date passed (tool-records.ts). */
const DATE_PASSED = 'its check date passed'

/**
 * Why a row is due, in the read's own words: an item's `outOfDate`, or the records' `why`, with
 * the day only when the reason is that day passing ("its check date passed on 2 Oct 2026"). A due
 * row whose read gives no reason says none: a check date may still be ahead of an item whose
 * definition or source changed.
 */
function dueWords(o: Obj): string | null {
  if (typeof o.outOfDate === 'string') return o.outOfDate
  if (!str(o.status).startsWith('due')) return null
  const why = str(o.why)
  const day = str(o.checkDate)
  return why === DATE_PASSED && isCalendarDate(day) ? `${why} on ${shortDay(day)}` : why || null
}

/** The context items the reads returned, as a row shows each: the first read that gave it wins. */
export function itemRows(results: readonly unknown[]): Map<string, Omit<LoopItem, 'n'>> {
  const rows = new Map<string, Omit<LoopItem, 'n'>>()
  const add = (o: Obj) => {
    const id = str(o.id)
    if (!ITEM_ID.test(id) || rows.has(id)) return
    const checked = isObj(o.checked) ? str(o.checked.date) : str(o.lastChecked)
    rows.set(id, {
      id,
      title: str(o.title),
      kind: str(o.kind),
      domain: str(o.domainId) || null,
      about: strs(o.about),
      status: statusOf(str(o.status), o.outOfDate),
      checked: checked || null,
      outOfDate: dueWords(o),
    })
  }
  for (const r of results) {
    if (!isObj(r)) continue
    arr(r.items).forEach(add)
    if (isObj(r.item)) add(r.item)
    if (isObj(r.wider)) arr(r.wider.items).forEach(add)
    arr(r.nearby).forEach(add)
    for (const p of arr(r.pairs)) [p.holder, p.other].filter(isObj).forEach(add)
    if (isObj(r.groups)) for (const g of arr(r.groups.rows)) arr(g.items).forEach(add)
  }
  return rows
}

/** A day as the answer says it: "4 August 2026". */
export const dayWords = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

/** A day as a row says it, as the page writes every row's day: "4 Aug 2026", "2 Sep 2026". */
const shortDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return `${d} ${dayWords(day).split(' ')[1]?.slice(0, 3) ?? m} ${y}`
}

/** The plain words of runs: a noun by its name, a citation as [n], a count with what it is out of. */
export function runWords(runs: readonly LoopRun[], nouns: ReadonlyMap<string, Noun>): string {
  return runs
    .map((r) => {
      switch (r.t) {
        case 'text':
          return r.text
        case 'noun':
          return nouns.get(r.id)?.name ?? r.id
        case 'cite':
          return `[${r.n}]`
        case 'count':
          return r.of ? `${r.value} ${r.of}` : r.value
        case 'date':
          return dayWords(r.day)
      }
    })
    .join('')
}

/** What the words may name and cite, from the reads of this chat. */
export type WordsContext = {
  nouns: ReadonlyMap<string, Noun>
  /** Every id the reads returned: what a citation may be. */
  known: ReadonlySet<string>
  reads: readonly NumberedRead[]
  /** The digits in the reads, the question and the chat: a digit elsewhere is the model's own. */
  digits: ReadonlySet<string>
  items: ReadonlyMap<string, Omit<LoopItem, 'n'>>
}

/** The words written by the model, as checked blocks, with what they cite and what the check found. */
export type Words = {
  body: LoopBlock[]
  /** The items cited, in the order first cited: [n] is the nth. */
  cited: string[]
  /** The definitions the words mark as what answers the question, by id: `… daily rate [metric:x].` */
  marked: string[]
  checks: Check[]
}

/** A mention, a number reference, a list, a citation mark, or a bare item id. */
const TOKEN =
  /\[@([a-z]+:[^\]\s]{1,200})\]|\[#(r\d+)((?:\.[A-Za-z0-9_]+)+)\]|\[list:(r\d+)\]|\[([^[\]\n]{1,200})\]|\b(itm_[a-z0-9]{8,16})\b/g
/** A line of a list: a dash, a star or a bullet, or a number (its own group) and a stop. */
const BULLET = /^\s*(?:[-*•]|(\d{1,2})[.)])\s+/
const LIST_LINE = /^\s*\[list:(r\d+)\]\s*$/
/** A line that only rules off what is above it ("---"), a heading's, a quote's and a fence's. */
const RULE = /^\s{0,3}([-*_])(?:[ \t]*\1){2,}\s*$/
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/
const QUOTE = /^\s{0,3}>[ \t]?/
const FENCE = /^\s{0,3}(`{3,}|~{3,})/
/** A table's line under its heads: a dash or more between each pipe, with colons to align. */
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/
/** A sentence's end, with any marks after it: where one sentence stops and the next begins. */
export const SENTENCE_END = /(?<=[.!?][*_~`\uE100-\uE1FF]*(?:\s*\[[^[\]\n]{1,200}\])*)\s+/

/**
 * The words a model has written so far, up to the end of their last sentence or line that is
 * final: one that more words follow, so no citation or mark after it can still come, and that
 * closes each mark it opens, so no asterisk shows that is bold once its words are in. Empty when
 * no sentence is final yet.
 */
export function finishedWords(draft: string): string {
  const ends = [
    ...draft.matchAll(
      /(?:(?<=[.!?][*_~`]*(?:\s*\[[^[\]\n]{1,200}\])*)[ \t]+|[ \t]*\n\s*)(?=[^\s[])/g,
    ),
  ]
  const last = ends.at(-1)
  const done = last ? draft.slice(0, last.index).trimEnd() : ''
  return done && opensMark(lastBlockOf(done)) ? finishedWords(done) : done
}

/** The words of the block some words end in, as `styled` reads them: a list's line, or a paragraph's lines. */
function lastBlockOf(words: string): string {
  const lines = words
    .split(/\n\s*\n/)
    .at(-1)!
    .split('\n')
  const from = lines.findLastIndex((l) => BULLET.test(l))
  return from < 0 || from === lines.length - 1
    ? lines.slice(Math.max(from, 0)).join(' ')
    : lines.slice(from + 1).join(' ')
}

/** Whether some words open a mark they do not close yet: closing it would set words in it. */
const opensMark = (words: string) => {
  const set = (w: string) =>
    inlineSegments(w).reduce((n, s) => n + (s.marks.size ? s.text.length : 0), 0)
  const now = set(words)
  return ['**', '__', '~~', '*', '_', '`'].some((close) => set(words + close) > now)
}

/*
  How the model's words are set while code reads them (`styled`): one character before some words
  sets their marks and their link until the next one, so every check reads the words as they are
  and a mark goes wherever its words go; `drawn` reads them back as the runs' marks and links.
*/

/** The first character that sets words' marks: bold, italic, strike and code as bits, the link's number above them. */
const STYLE = 0xe100
const STYLED = /[\uE100-\uE1FF]/
/** The most links one block of words carries. */
const LINKS_HELD = 15
/** Square brackets in words set as code, which mark nothing: set aside while the words are read. */
const CODE_OPEN = '\uE001'
const CODE_CLOSE = '\uE002'
/** The first of the characters that stand in for a mention, reference or mark while Markdown is read. */
const HELD = 0xe200

/**
 * Where a link the model wrote may go: a web or mail address, or a part of a help page as the help
 * read gives it (`write-context.md#the-four-kinds`); nowhere else, so never a script.
 */
export function linkOf(href: string): LoopLink | null {
  const help = /^(?:\.\/)?([a-z0-9]+(?:-[a-z0-9]+)*)(?:\.md)?(?:#([a-z0-9-]+))?$/.exec(href)
  if (help) return { slug: help[1]!, id: help[2] ?? '' }
  try {
    const url = new URL(href)
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? { url: url.href } : null
  } catch {
    return null
  }
}

/**
 * Some words with their Markdown marks and links as the characters that set them (`STYLE`), and
 * the links in `links`: the model's mentions, references and marks stay as written, and words set
 * as code mark nothing. Words that mark nothing come back as they are, but for what a backslash
 * keeps from being a mark (`\*`).
 */
function styled(words: string, links: LoopLink[]): string {
  const held: string[] = []
  const hold = words.replace(TOKEN, (m: string, ...rest: unknown[]) => {
    const at = rest.at(-2) as number
    // A mark's brackets that a link's address follows are the link's.
    if (m.startsWith('[') && !/^\[[@#]|^\[list:/.test(m) && words[at + m.length] === '(') return m
    held.push(m)
    return String.fromCharCode(HELD + held.length - 1)
  })
  const back = (text: string) =>
    text.replace(/[\uE200-\uEFFF]/g, (c) => held[c.charCodeAt(0) - HELD] ?? '')
  const segments = inlineSegments(hold)
  if (segments.every((x) => !x.marks.size && x.href === null))
    return back(segments.map((x) => x.text).join(''))
  let style = 0
  const out = segments.map((x) => {
    const link = x.href === null ? null : linkOf(x.href)
    let n = link ? links.findIndex((l) => JSON.stringify(l) === JSON.stringify(link)) + 1 : 0
    if (link && !n && links.length < LINKS_HELD) n = links.push(link)
    const set = STYLE + marks.reduce((b, m, i) => (x.marks.has(m) ? b | (1 << i) : b), 0) + n * 16
    const text = x.marks.has('code')
      ? back(x.text).replaceAll('[', CODE_OPEN).replaceAll(']', CODE_CLOSE)
      : back(x.text)
    const lead = set === STYLE + style ? '' : String.fromCharCode(set)
    style = set - STYLE
    return lead + text
  })
  return out.join('') + (style ? String.fromCharCode(STYLE) : '')
}

/** A block's runs with the marks and links its words were set with (`styled`), as the page draws them. */
function drawn(runs: readonly LoopRun[], links: readonly LoopLink[]): LoopRun[] {
  const out: LoopRun[] = []
  let style = 0
  for (const r of runs) {
    if (r.t !== 'text') {
      out.push(r)
      continue
    }
    for (const part of r.text.split(/(?=[\uE100-\uE1FF])/)) {
      if (STYLED.test(part[0] ?? '')) style = part.charCodeAt(0) - STYLE
      const text = part.replace(STYLED, '').replaceAll(CODE_OPEN, '[').replaceAll(CODE_CLOSE, ']')
      const set = marks.filter((_, i) => style & (1 << i))
      const link = links[(style >> 4) - 1]
      pushRun(out, {
        t: 'text',
        text,
        ...(set.length ? { marks: [...set] } : {}),
        ...(link ? { link } : {}),
      })
    }
  }
  return trimRuns(out)
}

/** A block's runs with every plain word in it bold too: a heading's. */
const bolded = (runs: readonly LoopRun[]): LoopRun[] =>
  runs.map((r) =>
    r.t === 'text' && !r.marks?.includes('bold')
      ? { ...r, marks: marks.filter((m) => m === 'bold' || r.marks?.includes(m)) }
      : r,
  )

/** Whether two runs of words are set the same: their marks and their link. */
const sameStyle = (a: Extract<LoopRun, { t: 'text' }>, b: Extract<LoopRun, { t: 'text' }>) =>
  (a.marks ?? []).join() === (b.marks ?? []).join() &&
  JSON.stringify(a.link) === JSON.stringify(b.link)

/**
 * An id's words when no read named it: the name of a noun a read named that the id spells
 * (`person:ada_okafor` for Ada Okafor), else its last part as words. Never a chip.
 */
const plainName = (id: string, nouns: ReadonlyMap<string, Noun>) => {
  const tail =
    id
      .slice(id.indexOf(':') + 1)
      .split('/')
      .at(-1) ?? id
  const words = tail.replace(/[_-]+/g, ' ').trim()
  const same = [...nouns.values()].find((n) => n.name.toLowerCase() === words.toLowerCase())
  return same?.name ?? words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * A typed id as a read gives it, when the model wrote its kind twice: `domain:domain:area_x`, or
 * `domain:domain_area_x` for a noun a read named as `domain:area_x`, or a family's key as a
 * metric's (`metric:group:revenue`).
 */
export const typedId = (id: string, nouns?: ReadonlyMap<string, Noun>) => {
  const once = id.replace(/^([a-z]+):\1:/, '$1:').replace(/^metric:(?=group:)/, '')
  const joined = once.replace(/^([a-z]+):\1_/, '$1:')
  return joined !== once && nouns?.has(joined) && !nouns.has(once) ? joined : once
}

/** A name as words, not inside another word, in any case. */
const nameIn = (name: string) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`,
    'iu',
  )

/** A path into a read's result: `count`, `outOf`, `groups.rows.0.count`. */
function valueAt(result: unknown, path: readonly string[]): unknown {
  let at: unknown = result
  for (const part of path) {
    if (Array.isArray(at) && /^\d+$/.test(part)) at = at[Number(part)]
    else if (Array.isArray(at) && part === 'length') at = at.length
    else if (isObj(at) && Object.hasOwn(at, part)) at = at[part]
    else return undefined
  }
  return at
}

/**
 * The value a reference names in a read's result: at its path; for the `count` of a read that
 * gives none, how many items it gives; else at a path of two or more parts one level in, when
 * only one part of the result holds it (`days.from` for get_context's `read.days.from`).
 */
function readValue(result: unknown, path: readonly string[]): unknown {
  const at = valueAt(result, path)
  if (at !== undefined || !isObj(result)) return at
  if (path.length === 1)
    return path[0] === 'count' && Array.isArray(result.items) ? result.items.length : undefined
  const inside = Object.values(result)
    .filter(isObj)
    .map((part) => valueAt(part, path))
    .filter((v) => v !== undefined)
  return inside.length === 1 ? inside[0] : undefined
}

/** A read's value as a run: a count, a count with what it is out of, a floor ("13+") or a day. */
function numberRun(value: unknown): LoopRun | null {
  if (typeof value === 'number' && Number.isFinite(value))
    return { t: 'count', value: value.toLocaleString('en-GB'), of: null }
  if (isObj(value) && typeof value.count === 'number' && typeof value.of === 'string')
    return { t: 'count', value: value.count.toLocaleString('en-GB'), of: value.of }
  if (typeof value === 'string' && /^\d[\d,]*\+?$/.test(value))
    return { t: 'count', value, of: null }
  if (typeof value === 'string' && isCalendarDate(value)) return { t: 'date', day: value }
  return null
}

const MONTHS =
  'January February March April May June July August September October November December'
    .split(' ')
    .map((m) => m.slice(0, 3))
/** A day in words or as a date ("2 October 2026", "19 May", "2026-10-02"); a month by its capital. */
const DAY = new RegExp(
  `\\b(\\d{1,2})\\s+(${MONTHS.join('|')})[a-z]*\\.?(?:,?\\s+(\\d{4}))?(?!\\d)|\\b(\\d{4})-(\\d{2})-(\\d{2})\\b`,
  'g',
)
/** A number in words, not a part of a word or of another number: "4", "1,240", "13+". */
const NUMBER = /(?<![\p{L}\p{N}_.,])\d(?:[\d,]*\d)?(?:\.\d+)?\+?/gu
const valueOf = (number: string) => Number(number.replace(/[,+]/g, ''))
/** The counts people write in words, one to twelve, by value. */
const NUMBER_WORDS = 'one two three four five six seven eight nine ten eleven twelve'.split(' ')
const NUMBER_WORD = new RegExp(`\\b(?:${NUMBER_WORDS.join('|')})\\b`, 'gi')
/** The words that say a count of nothing. */
const ZERO_WORD = /\b(?:none|zero)\b/i

/** The words of the clause so far, as the model wrote them: since the sentence's last , ; or : */
function clauseSoFar(runs: readonly LoopRun[]): string {
  let words = ''
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i]!
    if (r.t !== 'text') continue
    const cut = [...r.text.matchAll(/[,;:](?=\s|$)/g)].at(-1)
    if (cut) return r.text.slice(cut.index + 1) + words
    words = r.text + words
  }
  return words
}

/**
 * Whether the model's own words already say a number reference's value (FR-720.3): the words of
 * its clause give the same value, by value ("4 items [#r1.count]", "on 3 October 2026 [#r2…]"),
 * or the words right before it give a value of its kind, another one run into it ("on 19 May
 * [#r1…]"). Either way the reference is the value said twice and is left out; when it is a floor
 * ("13+") and the words give its number bare, the words' number becomes the floor.
 */
function saidAlready(runs: LoopRun[], run: LoopRun): boolean {
  const clause = clauseSoFar(runs)
  if (run.t === 'date') {
    const [y, m, d] = run.day.split('-').map(Number)
    const same = [...clause.matchAll(DAY)].some((x) =>
      x[4]
        ? x[4] === String(y) && Number(x[5]) === m && Number(x[6]) === d
        : Number(x[1]) === d &&
          MONTHS.indexOf(x[2]!) + 1 === m &&
          (x[3] === undefined || Number(x[3]) === y),
    )
    if (same) return true
  } else if (run.t === 'count') {
    const value = valueOf(run.value)
    const stated = [...clause.replace(DAY, (x) => ' '.repeat(x.length)).matchAll(NUMBER)]
      .filter((x) => valueOf(x[0]) === value)
      .at(-1)
    if (stated) {
      if (run.value.endsWith('+') && !stated[0].endsWith('+')) floorIn(runs, stated[0])
      return true
    }
    // A count the words give in words ("Nine of the 23 … 9"); a floor's number stays a floor.
    const spelled = [...clause.matchAll(NUMBER_WORD)].some(
      (x) => NUMBER_WORDS.indexOf(x[0].toLowerCase()) + 1 === value,
    )
    if (spelled && !run.value.endsWith('+')) return true
    if (value === 0 && ZERO_WORD.test(clause)) return true
  } else return false
  const last = runs.at(-1)
  const before = last?.t === 'text' ? last.text.trimEnd() : ''
  const day = [...before.matchAll(DAY)].at(-1)
  const ends = (x: RegExpExecArray | undefined) => !!x && x.index + x[0].length === before.length
  if (ends(day)) return run.t === 'date'
  // A year the words end with ("written in 2026") is no count run into the reference.
  const number = [...before.matchAll(NUMBER)].at(-1)
  return run.t === 'count' && ends(number) && !/^(?:19|20)\d{2}$/.test(number![0])
}

/** A number the words gave bare, the last time they gave it, written as the floor it is: "13+". */
function floorIn(runs: LoopRun[], number: string) {
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i]!
    if (r.t !== 'text') continue
    const at = [...r.text.matchAll(NUMBER)].filter((x) => x[0] === number).at(-1)
    if (at) {
      r.text = `${r.text.slice(0, at.index + number.length)}+${r.text.slice(at.index + number.length)}`
      return
    }
  }
}

/** Words a count may end a sentence after: a verb or a word that leads into a number, or a colon. */
const LEADS_TO_COUNT =
  /(?:\b(?:is|are|was|were|be|been|of|to|from|by|at|than|about|around|over|under|nearly|almost|exactly|only|just|totals?|reach(?:ed|es)?|makes?|made|gives?|gave|gives|equals?|has|have|had|having|finds?|found|with|without|shows?|showed|lists?|listed|counts?|counted|numbers?|holds?|gets|got|sees|saw|returned|returns|contains?|includes?)|[:=])\s*$/i

/** Whether a value is needed after these words: they lead into a count, or come before a day. */
const leadsToValue = (words: string) =>
  LEADS_TO_COUNT.test(words) || /\b(?:on|in|since|until|after|before|between)\s*$/i.test(words)

/**
 * Whether a count the words end a sentence with, right after a noun ("… changed in that period
 * [#r2.count]."), only says again a number an earlier sentence gave ("Two written items …"): it is
 * the value said twice, and is left out.
 */
function strayAtEnd(runs: readonly LoopRun[], run: LoopRun, rest: string, earlier: string) {
  if (run.t !== 'count' || run.of || run.value.endsWith('+')) return false
  if (!/^[\s.!?]*$/.test(rest.replace(/\[[^[\]\n]{1,200}\]/g, ''))) return false
  const last = runs.at(-1)
  if (last?.t !== 'text' || !/\p{L}\s*$/u.test(last.text) || LEADS_TO_COUNT.test(last.text))
    return false
  const value = valueOf(run.value)
  const words = earlier.replace(DAY, (x) => ' '.repeat(x.length))
  return (
    [...words.matchAll(NUMBER)].some((x) => valueOf(x[0]) === value) ||
    [...words.matchAll(NUMBER_WORD)].some(
      (x) => NUMBER_WORDS.indexOf(x[0].toLowerCase()) + 1 === value,
    )
  )
}

/** Runs of words, a run of plain words merged with the one before it when they are set the same. */
function pushRun(runs: LoopRun[], run: LoopRun) {
  const last = runs.at(-1)
  if (run.t === 'text' && last?.t === 'text' && sameStyle(last, run)) last.text += run.text
  else if (run.t !== 'text' || run.text) runs.push(run)
}

/**
 * How many characters at the start of `after` repeat what a count is out of, which its run
 * already says: the words right after it that its `of` gives, in its order, up to the last one,
 * when they name its noun ("[#r1.outOf] context items changed": "23 published context items you
 * can see" then "changed"; "[#r1.outOf] published items you can see mention it": "… you can
 * see" then "mention it").
 */
function ownNoun(run: LoopRun, after: string): number {
  if (run.t !== 'count' || !run.of) return 0
  const words = run.of.toLowerCase().split(/\s+/)
  const noun = words.indexOf(
    run.of
      .split(/\s+(?:you|in|of|that|which)\b/)[0]!
      .split(/\s+/)
      .at(-1)!
      .toLowerCase(),
  )
  let at = 0
  let from = 0
  let named = false
  let end = 0
  for (;;) {
    const m = /^\s+([\p{L}\p{N}]+)(?![\p{L}\p{N}])/u.exec(after.slice(at))
    const found = m ? words.indexOf(m[1]!.toLowerCase(), from) : -1
    if (!m || found < 0) break
    at += m[0].length
    from = found + 1
    if (found === noun) named = true
    if (named) end = at
  }
  return end
}

/** A read's words after the runs so far, without a first word the runs end with ("from From 1 May"). */
function withoutRepeat(runs: readonly LoopRun[], words: string): string {
  const last = runs.at(-1)
  const before = last?.t === 'text' ? /([\p{L}]+)\s*$/u.exec(last.text)?.[1] : undefined
  const first = /^([\p{L}]+)\s+/u.exec(words)
  return before && first && first[1]!.toLowerCase() === before.toLowerCase()
    ? words.slice(first[0].length)
    : words
}

/**
 * A sentence's runs with its full stop before the citations the model wrote ahead of it: "owned
 * by Ada [1]." reads "owned by Ada.[1]", so the number never sits before a stop of its own. A list
 * of citations the words lead into ("such as [1], [2] and [3].") ends the sentence itself: its stop
 * stays after it, with no space before it.
 */
function stopBeforeCites(runs: readonly LoopRun[]): LoopRun[] {
  const out = runs.map((r) => ({ ...r }))
  for (let i = 0; i < out.length; i++) {
    const r = out[i]!
    if (r.t !== 'text' || i === 0 || out[i - 1]!.t !== 'cite') continue
    const stop = /^[ \t]*([.!?]+)/.exec(r.text)
    if (!stop) continue
    // The citations it follows, with only spaces between them.
    let first = i - 1
    for (let j = first - 1; j >= 0; j--) {
      const x = out[j]!
      if (x.t === 'cite') first = j
      else if (x.t !== 'text' || x.text.trim()) break
    }
    const before = out[first - 1]
    if (before?.t === 'text' && /(?:[,;&]|\b(?:and|or))\s*$/i.test(before.text)) {
      r.text = r.text.trimStart()
      continue
    }
    if (before?.t !== 'text') continue
    r.text = r.text.slice(stop[0].length)
    before.text = before.text.trimEnd() + stop[1]
  }
  return out.filter((r) => r.t !== 'text' || r.text)
}

/** Stands in for a "()" the model wrote while a sentence is read. */
const LITERAL_BRACKETS = '\uE000'

/** Where a reference that held nothing was, in the runs of its sentence, until its clause goes. */
const HOLE = '\u0000'
/** Where one was that its clause did not need: it goes alone, and still counts as one. */
const SPARE = '\u0001'
/** A place in a sentence's runs: a run, and a character of it when it is words. */
type At = { run: number; char: number }
/** Words that open a sentence with a place or a set, which says nothing on its own. */
const OPENING =
  /^\s*(?:of|in|for|from|with|among|across|out of|at|on|by|after|before|since|until|during)\b/i
/** The words a clause joins the next one with, left out with a first clause that goes. */
const JOINS = /^\s*(?:and|but|or|so|while|whereas|yet)\b\s*/i

/** The runs with the characters from `from` up to `to` left out. */
function cutOut(runs: readonly LoopRun[], from: At, to: At): LoopRun[] {
  return runs.flatMap((r, i): LoopRun[] => {
    if (i < from.run || i > to.run) return [{ ...r }]
    if (r.t !== 'text') return []
    const text =
      (i === from.run ? r.text.slice(0, from.char) : '') +
      (i === to.run ? r.text.slice(to.char) : '')
    return text ? [{ t: 'text', text }] : []
  })
}

/**
 * A sentence's runs without the clause that held a reference to nothing a read holds (F4 of the Ask
 * re-run: "Footnote holds [#r4.counts.metrics] metrics, and the one with the fewest …" read
 * "Footnote holds metrics, and …"), so what is left reads whole: from the , or ; before it to
 * the next one, or to the sentence's stop. A first clause goes up to the next one with the word
 * that joins them, and the rest starts with a capital. Null when the clause is the whole sentence.
 */
function withoutClause(runs: readonly LoopRun[]): LoopRun[] | null {
  const count = (mark: string) =>
    runs.reduce((n, r) => n + (r.t === 'text' ? r.text.split(mark).length - 1 : 0), 0)
  // None its clause needs, or two and more, where which words go with which is not clear: only
  // the references go.
  if (count(HOLE) !== 1 || count(SPARE)) return [...runs]
  const hole = runs.findIndex((r) => r.t === 'text' && r.text.includes(HOLE))
  const holeAt = (runs[hole] as { text: string }).text.indexOf(HOLE)
  let start: At | null = null
  for (let i = hole; i >= 0 && !start; i--) {
    const r = runs[i]!
    if (r.t !== 'text') continue
    const cut = [...r.text.slice(0, i === hole ? holeAt : undefined).matchAll(/[,;](?=\s)/g)].at(-1)
    if (cut) start = { run: i, char: cut.index }
  }
  // What would be left is only an opening ("Of the 23 items you can see,"): the sentence goes.
  if (start) {
    const left = runWords(cutOut(runs, start, { run: runs.length, char: 0 }), new Map())
    if (OPENING.test(left) && !/[,;:]\s/.test(left)) return null
  }
  let end: At | null = null
  for (let i = hole; i < runs.length && !end; i++) {
    const r = runs[i]!
    if (r.t !== 'text') continue
    const from = i === hole ? holeAt : 0
    const next = /[,;](?=\s)/.exec(r.text.slice(from))
    if (next) end = { run: i, char: from + next.index }
  }
  if (start) {
    // To the next clause, or else to the sentence's stop, which stays.
    let stop: At = { run: runs.length, char: 0 }
    for (let i = runs.length - 1; i >= hole && !end; i--) {
      const r = runs[i]!
      const at = r.t === 'text' ? /[.!?]+\s*$/.exec(r.text) : null
      if (at && (i > hole || at.index > holeAt)) stop = { run: i, char: at.index }
      if (at) break
    }
    return cutOut(runs, start, end ?? stop)
  }
  if (!end) return null
  const rest = cutOut(runs, { run: 0, char: 0 }, { run: end.run, char: end.char + 1 })
  const first = rest[0]
  if (first?.t === 'text') {
    const text = first.text.replace(JOINS, '').trimStart()
    first.text = text.charAt(0).toUpperCase() + text.slice(1)
  }
  return rest
}

/**
 * The model's words checked and drawn (FR-720.2, FR-720.3): paragraphs, the short lists it wrote,
 * the lists of reads it asked for, and in each sentence its nouns, numbers and citations. Every
 * sentence is kept but one whose only clause held a number no read holds: such a number is left out
 * with its clause, flagged; a long enumeration after a
 * colon becomes a list. `cited` grows as items are cited, the first cited first, and the rows of a
 * list of a read are cited as they come.
 */
export function wordsOf(text: string, ctx: WordsContext, cited: string[] = []): Words {
  const checks: Check[] = []
  const marked: string[] = []
  const cite = (id: string) => {
    if (!cited.includes(id)) cited.push(id)
    return cited.indexOf(id) + 1
  }
  const check = (kind: string, words: string) => {
    if (!checks.some((c) => c.kind === kind && c.words === words)) checks.push({ kind, words })
  }
  /** The words of the sentences before the one being read. */
  let earlier = ''
  /** Whether the words are one sentence: it is never left out whole. */
  const alone = text.split(SENTENCE_END).filter((x) => x.trim()).length === 1
  /** A mention by its id, or by the name the model wrote in its place: a chip, else the name. */
  const mention = (runs: LoopRun[], written: string) => {
    const id = typedId(written, ctx.nouns)
    const kind = id.slice(0, id.indexOf(':'))
    const words = id.slice(id.indexOf(':') + 1)
    const named = /\s/.test(words)
      ? [...ctx.nouns.values()].find(
          (n) => n.id.startsWith(`${kind}:`) && n.name.toLowerCase() === words.toLowerCase(),
        )?.id
      : undefined
    if (ctx.nouns.has(named ?? id)) pushRun(runs, { t: 'noun', id: named ?? id })
    else if (ITEM_ID.test(id) && ctx.known.has(id)) pushRun(runs, { t: 'cite', n: cite(id) })
    else {
      check('mention', written)
      pushRun(runs, { t: 'text', text: /\s/.test(words) ? words : plainName(id, ctx.nouns) })
    }
  }
  /** One sentence's runs; `listed`, a line of a list, which keeps its clauses as they are. */
  const sentence = (written: string, listed = false): LoopRun[] => {
    // A "()" the model wrote itself ("refresh()") is no bracket a reference left empty: set aside.
    const words = written.replace(/\(\)/g, LITERAL_BRACKETS)
    const runs: LoopRun[] = []
    let at = 0
    for (const m of words.matchAll(TOKEN)) {
      pushRun(runs, { t: 'text', text: words.slice(at, m.index) })
      at = m.index + m[0].length
      const [whole, written, ref, path, list, inner, bare] = m
      // A typed id in a mark with no @ is a mention where the words need it: a person, or a noun
      // with words after it in its clause ("owned by [person:p_ada] and …"). At a clause's end,
      // a metric's or a value's (`… left out [metric:orders].`) marks a definition, no source,
      // and is left out, as is any that the sentence has named already.
      const typed = inner?.trim().match(/^([a-z]+:\S+)$/)?.[1]
      const kind = typed ? nounKindOf(typedId(typed, ctx.nouns)) : null
      const needed =
        kind === 'person' || /^\s*[\p{L}\p{N}]/u.test(words.slice(m.index + whole.length))
      // A mention with the name written in place of its id (`[@person:Ada Okafor]`).
      const byName = inner?.match(/^@([a-z]+:.*\S)$/)?.[1]
      const asWritten = written ?? (byName && nounKindOf(byName) ? byName : undefined)
      if (asWritten !== undefined) mention(runs, asWritten)
      else if (typed && kind && needed) {
        const id = typedId(typed, ctx.nouns)
        const name = ctx.nouns.get(id)?.name ?? plainName(id, ctx.nouns)
        if (!nameIn(name).test(words.slice(0, m.index))) mention(runs, typed)
      } else if (ref !== undefined && path !== undefined) {
        const read = ctx.reads.find((r) => r.ref === ref)
        const value = read ? readValue(read.result, path.slice(1).split('.')) : undefined
        const run = numberRun(value)
        // A reference to an item's id that a read returned is that item's citation, not a number.
        if (typeof value === 'string' && ITEM_ID.test(value) && ctx.known.has(value))
          pushRun(runs, { t: 'cite', n: cite(value) })
        // A reference to a read's own words (a period, a title) is those words, unless its
        // clause says them already ("fewer than 5 did [#r1.topics.0.foundNothing]").
        else if (!run && typeof value === 'string' && value.trim()) {
          if (nameIn(value.trim()).test(clauseSoFar(runs))) check('twice', whole)
          else {
            check('words', whole)
            pushRun(runs, { t: 'text', text: withoutRepeat(runs, value.trim()) })
          }
        }
        // One to nothing a read holds as words or a number is left out. Where its clause needs
        // it, after words that lead into a value ("holds [#…] metrics", "is on [#…]"), the clause
        // goes with it; elsewhere, and to an id, a citation no read holds, it goes alone, its
        // clause reading whole without it.
        else if (!run) {
          check('number', whole)
          const last = runs.at(-1)
          const needed = !path.endsWith('.id') && last?.t === 'text' && leadsToValue(last.text)
          if (!listed) pushRun(runs, { t: 'text', text: needed ? HOLE : SPARE })
        } else if (saidAlready(runs, run)) check('twice', whole)
        else if (strayAtEnd(runs, run, words.slice(at), earlier)) check('twice', whole)
        else {
          pushRun(runs, run)
          at += ownNoun(run, words.slice(at))
        }
      } else if (list !== undefined) check('list', whole)
      else if (inner !== undefined) {
        // A mark cites items; a definition's id in one is no source: it says the definition answers
        // the question, and is left out.
        for (const id of inner.split(/[,;]\s*|\s+/).map((x) => x.trim())) {
          const noun = typedId(id, ctx.nouns)
          if (ITEM_ID.test(id) && ctx.known.has(id)) pushRun(runs, { t: 'cite', n: cite(id) })
          else if (nounKindOf(noun) && !marked.includes(noun)) marked.push(noun)
        }
      } else if (bare !== undefined) {
        if (ctx.known.has(bare)) pushRun(runs, { t: 'cite', n: cite(bare) })
        else pushRun(runs, { t: 'text', text: bare })
      }
    }
    pushRun(runs, { t: 'text', text: words.slice(at) })
    // A clause left with a hole goes; a sentence that was only that clause, too, unless it is all.
    const holed = withoutClause(runs) ?? (alone ? [...runs] : [])
    runs.length = 0
    for (const r of holed)
      pushRun(
        runs,
        r.t === 'text' ? { t: 'text', text: r.text.replaceAll(HOLE, '').replaceAll(SPARE, '') } : r,
      )
    if (!runs.length) return runs
    // A reference left out of brackets leaves no empty brackets behind.
    for (const r of runs)
      if (r.t === 'text')
        r.text = r.text.replace(/[ \t]*\([ \t]*\)/g, '').replaceAll(LITERAL_BRACKETS, '()')
    // A citation sits right after what it supports: three or more at a sentence's end are a pile.
    let piled = 0
    for (let i = runs.length - 1; i >= 0; i--) {
      const r = runs[i]!
      if (r.t === 'cite') piled++
      else if (r.t === 'text' && /^[\s.!?]*$/.test(r.text)) continue
      else break
    }
    if (piled >= 3) check('piled', runWords(runs, ctx.nouns))
    for (const r of runs)
      if (r.t === 'text')
        for (const d of r.text.match(/\d+(?:[.,]\d+)*/g) ?? [])
          if (!ctx.digits.has(d.replace(/,/g, ''))) check('digits', d)
    // A name the words give is said once: a mention after it is drawn on it (FR-720.3).
    // Placing a mention can leave the brackets it sat in empty: they go too.
    const done = stopBeforeCites(placed(runs, ctx.nouns))
    earlier += ` ${runWords(done, ctx.nouns)}`
    return done
  }
  /** A paragraph's sentences; a long enumeration after a colon as a lead and a list. */
  const paragraph = (written: string): LoopBlock[] => {
    const blocks: LoopBlock[] = []
    const links: LoopLink[] = []
    const words = styled(written, links)
    let runs: LoopRun[] = []
    const flush = () => {
      runs = drawn(runs, links)
      if (runs.length) blocks.push({ t: 'p', runs })
      runs = []
    }
    for (const said of words.split(SENTENCE_END).filter((x) => x.trim())) {
      const parts = enumeration(said)
      if (parts) {
        const lead = sentence(parts.lead)
        const items = parts.items.map((item) => sentence(item, true))
        if (runs.length) pushRun(runs, { t: 'text', text: ' ' })
        for (const r of lead) pushRun(runs, r)
        flush()
        blocks.push({ t: 'ul', items: items.map((item) => drawn(item, links)) })
        continue
      }
      const one = sentence(said)
      if (said.split(',').length >= 6) check('enumeration', runWords(one, ctx.nouns))
      if (runs.length) pushRun(runs, { t: 'text', text: ' ' })
      for (const r of one) pushRun(runs, r)
    }
    flush()
    return blocks
  }
  /** A line of words that stands alone, a list's or a table's: its sentence, as set. */
  const line = (written: string): LoopRun[] => {
    const links: LoopLink[] = []
    return drawn(sentence(styled(written, links), true), links)
  }
  const body: LoopBlock[] = []
  let prose: string[] = []
  let bullets: string[] = []
  /** The number a numbered list starts from; null for a list of dashes. */
  let start: number | null = null
  const endProse = () => {
    if (prose.length) body.push(...paragraph(prose.join(' ')))
    prose = []
  }
  const endBullets = () => {
    if (bullets.length)
      body.push({ t: 'ul', items: bullets.map(line), ...(start === null ? {} : { start }) })
    bullets = []
  }
  // A blank line ends a paragraph; a list goes on past one to its next line of the same kind.
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const quoted = lines[i]!.replace(QUOTE, '')
    if (!quoted.trim()) {
      endProse()
      continue
    }
    const rule = RULE.test(quoted)
    const fence = quoted.match(FENCE)?.[1]
    const bullet = rule ? null : quoted.match(BULLET)
    const list = quoted.match(LIST_LINE)?.[1]
    const heading = quoted.match(HEADING)?.[1]
    // A table: a line with a pipe, then the line of dashes under its heads.
    const under = lines[i + 1]?.replace(QUOTE, '') ?? ''
    const table = quoted.includes('|') && under.includes('|') && TABLE_RULE.test(under)
    if (bullets.length && !bullet && /^\s{2,}/.test(quoted)) {
      bullets[bullets.length - 1] += ` ${quoted.trim()}`
      continue
    }
    if (bullets.length && (!bullet || (start === null) !== (bullet[1] === undefined))) endBullets()
    if (rule || fence || bullet || table || list || heading !== undefined) endProse()
    if (fence) {
      // What the model wrote as code is its lines as written, to the fence that closes it; a
      // quote's marks only when the fence is in the quote.
      const inQuote = (l: string) => (QUOTE.test(lines[i]!) ? l.replace(QUOTE, '') : l)
      const end = lines.findIndex((l, j) => j > i && inQuote(l).trim().startsWith(fence))
      const code = lines.slice(i + 1, end < 0 ? undefined : end).map(inQuote)
      if (code.some((l) => l.trim())) body.push({ t: 'code', text: code.join('\n').trimEnd() })
      i = end < 0 ? lines.length : end
    } else if (table) {
      const rows: string[] = [quoted]
      for (i += 2; i < lines.length && lines[i]!.includes('|'); i++)
        rows.push(lines[i]!.replace(QUOTE, ''))
      i--
      // Each row has the heads' cells, as many as there are heads.
      const width = cellsOf(quoted).length
      body.push({
        t: 'table',
        rows: rows.map((r) => {
          const cells = cellsOf(r)
          return Array.from({ length: width }, (_, j) => line(cells[j] ?? ''))
        }),
      })
    } else if (list) {
      const block = listOf(list, ctx, cite)
      if (block) body.push(block)
      else check('list', quoted.trim())
    } else if (rule) continue
    else if (heading !== undefined) {
      // A heading is a line of its own, in bold: an answer has no headings of its own.
      const runs = bolded(line(heading))
      if (runs.length) body.push({ t: 'p', runs })
    } else if (bullet) {
      if (!bullets.length) start = bullet[1] === undefined ? null : Number(bullet[1])
      bullets.push(quoted.replace(BULLET, ''))
    } else prose.push(quoted.trim())
  }
  endProse()
  endBullets()
  return { body, cited, marked, checks }
}

/** A table's row as the words of its cells: between its pipes, but not one a backslash or code holds. */
function cellsOf(row: string): string[] {
  const cells: string[] = []
  let cell = ''
  let code = false
  for (let i = 0; i < row.length; i++) {
    const c = row[i]!
    if (c === '\\' && row[i + 1] === '|') {
      cell += '|'
      i++
    } else if (c === '`') {
      code = !code
      cell += c
    } else if (c === '|' && !code) {
      cells.push(cell)
      cell = ''
    } else cell += c
  }
  cells.push(cell)
  // The pipes at the row's ends hold no cell.
  if (!cells[0]!.trim()) cells.shift()
  if (cells.length > 1 && !cells.at(-1)!.trim()) cells.pop()
  return cells.map((x) => x.trim())
}

/** Runs with no space at their start or end. */
function trimRuns(runs: LoopRun[]): LoopRun[] {
  const first = runs[0]
  if (first?.t === 'text') first.text = first.text.replace(/^\s+/, '')
  const last = runs.at(-1)
  if (last?.t === 'text') last.text = last.text.replace(/\s+$/, '')
  return runs.filter((r) => r.t !== 'text' || r.text)
}

/** How deep in brackets, square or round, each character of some words sits; the brackets at their outer depth. */
function depths(words: string): number[] {
  const at: number[] = []
  let depth = 0
  for (let i = 0; i < words.length; i++) {
    const c = words[i]
    if (c === ']' || c === ')') depth = Math.max(0, depth - 1)
    at.push(depth)
    if (c === '[' || c === '(') depth++
  }
  return at
}

/** Where a pattern matches outside every bracket. */
const outside = (words: string, pattern: RegExp) => {
  const depth = depths(words)
  return [...words.matchAll(new RegExp(pattern.source, 'g'))].filter((m) => depth[m.index] === 0)
}

/**
 * Words that make a part of a sentence a clause, or a part of the thing named before it, not the
 * name of a thing: a verb ("18 are live", "it is owned by …"), "whose" or "which", or a
 * preposition it starts with ("France, in May 2026, and Spain, in October 2025").
 */
const CLAUSE =
  /\b(?:is|are|was|were|has|have|had|it's|whose|which|who)\b|^(?:in|on|at|for|from|with|by|of|to|since|until|after|before|during|as|into|about|over|under|across|between|than)\b/i

/**
 * A sentence that names four or more things after a colon ("They cover: a, b, c and d."), as its
 * lead and its items; null for any other sentence. Only a colon outside brackets ends a lead (a
 * "(source: …)" ends none), only commas and an "and" outside brackets split, and each item is a
 * thing named in a few words, never a clause ("it is owned by …", "whose owners are …"): any
 * other sentence stays whole.
 */
export function enumeration(said: string): { lead: string; items: string[] } | null {
  if (depths(`${said} `).at(-1)) return null
  const colon = outside(said, /: /)[0]?.index
  if (colon === undefined) return null
  const lead = said.slice(0, colon + 1)
  const rest = said
    .slice(colon + 2)
    .replace(/[.!]\s*((?:\[[^[\]\n]{1,200}\]\s*)*)$/, ' $1')
    .trim()
  const parts: string[] = []
  let from = 0
  for (const comma of outside(rest, /,/)) {
    parts.push(rest.slice(from, comma.index))
    from = comma.index + 1
  }
  parts.push(rest.slice(from))
  // The last part's last "and" joins the last two things named; no other "and" splits.
  const last = parts.pop() ?? ''
  const and = outside(last, /\s+and\s+/).at(-1)
  const tail = and ? [last.slice(0, and.index), last.slice(and.index + and[0].length)] : [last]
  const items = [...parts, ...tail].map((p) => p.replace(/^\s*and\s+/, '').trim()).filter(Boolean)
  // Things named, not clauses: four or more, each a few words.
  const named = items.every((i) => {
    const words = i.replace(/\[[^[\]]*\]/g, '').trim()
    return words.split(/\s+/).length <= 8 && !CLAUSE.test(words)
  })
  return items.length >= 4 && named ? { lead, items } : null
}

/** The items of a read the words asked for as a list (`[list:r1]`): each row cited as it comes. */
function listOf(
  ref: string,
  ctx: WordsContext,
  cite: (id: string) => number,
): Extract<LoopBlock, { t: 'list' }> | null {
  const read = ctx.reads.find((r) => r.ref === ref)
  if (!read || !isObj(read.result)) return null
  const r = read.result
  const ids = [
    ...arr(r.items).map((i) => str(i.id)),
    ...(isObj(r.item) ? [str(r.item.id)] : []),
    ...arr(r.pairs).flatMap((p) => [p.holder, p.other].filter(isObj).map((x) => str(x.id))),
  ].filter((id, i, all) => ctx.items.has(id) && all.indexOf(id) === i)
  if (!ids.length) return null
  for (const id of ids) cite(id)
  return { t: 'list', rows: ids, more: typeof r.more === 'number' ? r.more : 0 }
}

/** What an overview asks for: the read it shows, the groups of it, and a closing line. */
export type OverviewAsk = { from: string; groups?: readonly string[]; note?: string }

/** Why an overview cannot be drawn from what was asked, said to the model; null when it can. */
export function overviewProblem(ask: OverviewAsk, reads: readonly NumberedRead[]): string | null {
  const read = reads.find((r) => r.ref === ask.from)
  if (!read)
    return `No read is ${ask.from}: name one of ${reads.map((r) => r.ref).join(', ') || 'none'}.`
  const groups = groupsOf(read)
  if (!groups)
    return `${ask.from} has no groups. An overview shows the inbox read, or a records read with group_by.`
  const unknown = (ask.groups ?? []).filter((g) => !groups.some((x) => x.key === g || x.name === g))
  if (unknown.length)
    return `${ask.from} has no group ${unknown.join(', ')}. Its groups are ${groups.map((g) => g.key ?? g.name).join(', ')}.`
  return null
}

type Group = { key: string | null; name: string; count: number; rows: Obj[]; more: number }

/** A read's groups: the Inbox's, or the records' by one part; null when it has none. */
function groupsOf(read: NumberedRead): Group[] | null {
  const r = read.result
  if (!isObj(r)) return null
  if (read.tool === 'inbox')
    return arr(r.groups).map((g) => ({
      key: str(g.group),
      name: str(g.name),
      count: typeof g.count === 'number' ? g.count : 0,
      rows: arr(g.cards),
      more: typeof g.more === 'number' ? g.more : 0,
    }))
  if (read.tool === 'records' && isObj(r.groups))
    return arr(r.groups.rows).map((g) => ({
      key: typeof g.key === 'string' ? g.key : null,
      name: str(g.name),
      count: typeof g.count === 'number' ? g.count : 0,
      rows: arr(g.items),
      more: typeof g.more === 'number' ? g.more : 0,
    }))
  return null
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/**
 * An overview (FR-720), by code from the read the model named: its groups in the read's own
 * order, each with its count and rows, the total the groups add up to, and the page's own count
 * when it differs, with why. Each row about an item the person may read cites it, in order.
 */
export function overviewOf(
  ask: OverviewAsk,
  ctx: WordsContext,
  cited: string[],
): { overview: LoopOverview; checks: Check[] } | null {
  const read = ctx.reads.find((r) => r.ref === ask.from)
  const all = read ? groupsOf(read) : null
  if (!read || !all || !isObj(read.result)) return null
  const r = read.result
  const chosen = ask.groups?.length
    ? all.filter((g) => ask.groups!.some((x) => x === g.key || x === g.name))
    : all
  const groups = chosen.filter((g) => g.count > 0)
  const total = groups.reduce((n, g) => n + g.count, 0)
  const cite = (id: string) => {
    if (!cited.includes(id)) cited.push(id)
  }
  const shown = groups.map((g) => ({
    key: g.key,
    name: g.name,
    count: g.count,
    more: g.more,
    rows: g.rows.map((row) => {
      const item =
        read.tool === 'inbox'
          ? typeof row.item === 'string' && ctx.known.has(row.item)
            ? row.item
            : null
          : ctx.known.has(str(row.id))
            ? str(row.id)
            : null
      if (item) cite(item)
      return {
        title: str(row.title),
        item,
        about: strs(row.about),
        domain: str(row.domainId) || null,
        status: str(row.why) || str(row.status),
        // The day that says why: a passed check date, else the last check.
        date:
          read.tool === 'inbox'
            ? str(row.date) || null
            : row.why === 'its check date passed'
              ? str(row.checkDate) || null
              : str(row.lastChecked) || null,
        card: read.tool === 'inbox' ? str(row.id) || null : null,
      }
    }),
  }))
  const count = (n: number): LoopRun => ({ t: 'count', value: n.toLocaleString('en-GB'), of: null })
  const whole = !ask.groups?.length
  let headline: LoopRun[]
  let page: LoopOverview['page'] = null
  if (read.tool === 'inbox') {
    headline = [
      count(total),
      {
        t: 'text',
        text: ` ${plural(total, 'card waits', 'cards wait')} on you in your Inbox, in `,
      },
      count(groups.length),
      { t: 'text', text: ` ${plural(groups.length, 'group', 'groups')}.` },
    ]
    const own = typeof r.count === 'number' ? r.count : total
    if (whole && own !== total) page = { count: own, why: str(r.differs) }
  } else {
    const outOf = isObj(r.outOf) ? r.outOf : {}
    const counted = typeof r.count === 'number' ? r.count : total
    const by = isObj(r.groups) ? str(r.groups.by) : ''
    headline = [
      count(counted),
      { t: 'text', text: ' of ' },
      {
        t: 'count',
        value: (typeof outOf.count === 'number' ? outOf.count : counted).toLocaleString('en-GB'),
        of: str(outOf.of) || null,
      },
      { t: 'text', text: `, by ${by}.` },
    ]
    if (whole && counted !== total)
      page = {
        count: counted,
        why: isObj(r.groups) ? str(r.groups.note) : '',
      }
  }
  const checks: Check[] = []
  let note: LoopRun[] | null = null
  if (ask.note?.trim()) {
    const words = wordsOf(ask.note, ctx, cited)
    checks.push(...words.checks)
    const runs = words.body.flatMap((b) => (b.t === 'p' ? b.runs : []))
    // A closing line is kept only when it carries a fact: something a read named, cited or counted.
    if (runs.some((x) => x.t !== 'text')) note = runs
    else checks.push({ kind: 'note', words: ask.note.trim() })
  }
  return {
    overview: {
      from: read.tool === 'inbox' ? 'inbox' : 'records',
      by: read.tool === 'inbox' ? 'group' : isObj(r.groups) ? str(r.groups.by) : '',
      total,
      headline,
      page,
      order: read.tool === 'inbox' ? str(r.order) : isObj(r.groups) ? str(r.groups.order) : '',
      groups: shown,
      note,
    },
    checks,
  }
}

/** An overview in plain words: what the chat sends back, copies and shows in History. */
export function overviewWords(
  o: LoopOverview,
  nouns: ReadonlyMap<string, Noun>,
  cited: readonly string[],
) {
  const lines = [runWords(o.headline, nouns)]
  if (o.page)
    lines.push(`${o.page.count.toLocaleString('en-GB')} as the page counts them: ${o.page.why}`)
  for (const g of o.groups) {
    lines.push(`${g.name} (${g.count.toLocaleString('en-GB')}):`)
    for (const row of g.rows)
      lines.push(`- ${row.title}${row.item ? ` [${cited.indexOf(row.item) + 1}]` : ''}`)
    if (g.more) lines.push(`- and ${g.more.toLocaleString('en-GB')} more`)
  }
  if (o.note) lines.push(runWords(o.note, nouns))
  return lines.join('\n')
}

/**
 * The blocks as the model writes them: each noun as its typed mention, each citation as the id it
 * cites, each number and day in words. What the chat sends back as Ask's earlier reply, so the
 * model reads its own words as it wrote them.
 */
export function bodyMarkup(
  body: readonly LoopBlock[],
  nouns: ReadonlyMap<string, Noun>,
  items: ReadonlyMap<string, Omit<LoopItem, 'n'>>,
  cited: readonly string[],
): string {
  const mark = (n: number) => `[${cited[n - 1] ?? n}]`
  const marked = (runs: readonly LoopRun[]) =>
    runWords(
      runs.map((r) =>
        r.t === 'noun'
          ? { t: 'text' as const, text: `[@${r.id}]` }
          : r.t === 'cite'
            ? { t: 'text' as const, text: mark(r.n) }
            : r.t === 'text'
              ? { t: 'text' as const, text: markdownOf(r) }
              : r,
      ),
      nouns,
    )
  return body
    .map((b) => {
      switch (b.t) {
        case 'p':
          return marked(b.runs)
        case 'ul':
          return b.items.map((i, n) => `${lineMark(b, n)}${marked(i)}`).join('\n')
        case 'table':
          return b.rows
            .flatMap((row, n) => {
              const line = `| ${row.map((c) => marked(c).replaceAll('|', '\\|')).join(' | ')} |`
              return n ? [line] : [line, `|${row.map(() => ' --- |').join('')}`]
            })
            .join('\n')
        case 'code':
          return `\`\`\`\n${b.text}\n\`\`\``
        case 'list':
          return b.rows.map((id) => `- ${items.get(id)?.title ?? id} [${id}]`).join('\n')
      }
    })
    .join('\n\n')
}

/** What starts a list's line: a dash, or its number. */
const lineMark = (b: Extract<LoopBlock, { t: 'ul' }>, n: number) =>
  b.start === undefined ? '- ' : `${b.start + n}. `

/** A run of words as Markdown: its marks around its words, the spaces at its ends outside them, and its link. */
function markdownOf(r: Extract<LoopRun, { t: 'text' }>): string {
  const [, lead, words, trail] = /^(\s*)([^]*?)(\s*)$/.exec(r.text)!
  if (!words || (!r.marks?.length && !r.link)) return r.text
  const set = r.marks ?? []
  let md = words
  if (set.includes('code')) md = `\`${md}\``
  if (set.includes('strike')) md = `~~${md}~~`
  if (set.includes('italic')) md = `*${md}*`
  if (set.includes('bold')) md = `**${md}**`
  if (r.link)
    md = `[${md}](${'url' in r.link ? r.link.url : `${r.link.slug}.md${r.link.id && `#${r.link.id}`}`})`
  return `${lead}${md}${trail}`
}

/** Every run of a block's words: a paragraph's, a list's lines', a table's cells'. */
export const blockRuns = (b: LoopBlock): LoopRun[] =>
  b.t === 'p' ? b.runs : b.t === 'ul' ? b.items.flat() : b.t === 'table' ? b.rows.flat(2) : []

/** Where the last sentence in some words begins, just after the space that ends the one before; -1 when none ends in them. */
const lastSentenceStart = (text: string) => {
  let at = -1
  for (const m of text.matchAll(/[.!?]["'”’)\uE100-\uE1FF]*\s+/g)) at = m.index + m[0].length
  return at
}

/**
 * Which runs only trail their clause: marks after the words, with nothing but more marks, space
 * and the clause's end after them ("… the Poland market [@metric:orders] [@value:market/poland].").
 */
function trailingRuns(runs: readonly LoopRun[]): boolean[] {
  const trailing = runs.map(() => false)
  let tail = true
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i]!
    if (r.t === 'text') tail = /^[\s"'”’)]*(?:[.,;:!?]|$)/.test(r.text)
    else if (r.t === 'noun' || r.t === 'cite') trailing[i] = tail
    else tail = false
  }
  return trailing
}

/** Words that need what comes after them: a preposition, an article or "and" at their end. */
const LEADS_ON =
  /\b(?:in|on|at|for|from|to|of|by|with|about|across|than|between|into|within|per|via|the|a|an|and|or)\s*$/i

/**
 * A sentence's runs with each noun's chip where the sentence names it: a mention that follows its
 * own name, or that only trails its clause after words that give its name, is drawn on those words
 * instead ("the [Poland] market", not "the Poland market [Poland]"), and a trailing mention of a
 * noun the sentence has drawn already is left out. A mention the words lead into ("spend in
 * [Norway]") and a mention anywhere else stay where they are.
 */
function placed(runs: readonly LoopRun[], nouns: ReadonlyMap<string, Noun>): LoopRun[] {
  const out: LoopRun[] = []
  const trailing = trailingRuns(runs)
  // Where the sentence being read starts: a run, and the place in it when it is words.
  let from = { run: 0, at: 0 }
  // A mention left its place: the brackets it sat in ("Germany ([#germany]):") are left empty.
  let vacated = false
  const inSentence = (i: number, at: number) => i > from.run || (i === from.run && at >= from.at)
  /** Where the words so far give a name: where they end with it, or its first place this sentence. */
  const find = (name: RegExp, ending: boolean) => {
    if (ending) {
      const i = out.length - 1
      const x = out[i]
      const m = x?.t === 'text' ? new RegExp(`${name.source}\\s*$`, 'iu').exec(x.text) : null
      return m && inSentence(i, m.index) ? { i, at: m.index, length: m[0].trimEnd().length } : null
    }
    for (let i = from.run; i < out.length; i++) {
      const x = out[i]!
      if (x.t !== 'text') continue
      const start = i === from.run ? from.at : 0
      const m = name.exec(x.text.slice(start))
      if (m) return { i, at: start + m.index, length: m[0].length }
    }
    return null
  }
  runs.forEach((r, n) => {
    if (r.t === 'noun') {
      // A mark the words lead into ("… ad spend in [Norway].") is what they say there: it stays.
      const last = out.at(-1)
      const led = last?.t === 'text' && LEADS_ON.test(last.text)
      const trails = trailing[n] && !led
      const id = r.id
      if (trails && out.slice(from.run).some((x) => x.t === 'noun' && x.id === id)) {
        vacated = true
        return
      }
      const name = nouns.get(r.id)?.name
      const found = name
        ? (find(nameIn(name), true) ?? (trails ? find(nameIn(name), false) : null))
        : null
      if (!found) {
        out.push(r)
        vacated = false
        return
      }
      vacated = true
      const x = out[found.i] as Extract<LoopRun, { t: 'text' }>
      const after = x.text.slice(found.at + found.length)
      out.splice(
        found.i,
        1,
        ...(found.at ? [{ ...x, text: x.text.slice(0, found.at) }] : []),
        r,
        ...(after ? [{ ...x, text: after }] : []),
      )
    } else if (r.t === 'text') {
      let last = out.at(-1)
      if (vacated && last?.t === 'text') {
        const open = /[ \t]*\([ \t]*$/.exec(last.text)
        const close = /^[ \t]*\)/.exec(r.text)
        if (open && close) {
          last = { ...last, text: last.text.slice(0, open.index) }
          out[out.length - 1] = last
          r = { ...r, text: r.text.slice(close[0].length) }
        }
      }
      vacated = false
      const start = lastSentenceStart(r.text)
      if (last?.t === 'text' && sameStyle(last, r)) {
        if (start >= 0) from = { run: out.length - 1, at: last.text.length + start }
        out[out.length - 1] = { ...last, text: last.text + r.text }
      } else {
        if (start >= 0) from = { run: out.length, at: start }
        out.push({ ...r })
      }
    } else {
      out.push(r)
      vacated = false
    }
  })
  return out.flatMap((x): LoopRun[] => {
    if (x.t !== 'text') return [x]
    // A mention drawn on its name elsewhere leaves the commas it sat between: one is kept.
    const text = x.text
      .replace(/[,;](?=[ \t]*[,;.!?])/g, '')
      .replace(/[ \t]+([.,;:!?)])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
    return text ? [{ ...x, text }] : []
  })
}

/** A paragraph without its last sentence; null when it is that one sentence. */
export function withoutLastSentence(runs: readonly LoopRun[]): LoopRun[] | null {
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i]!
    if (r.t !== 'text') continue
    // The colon that leads into the list ends the sentence: look before it.
    const at = lastSentenceStart(i === runs.length - 1 ? r.text.replace(/:\s*$/, '') : r.text)
    if (at < 0) continue
    const kept = trimRuns([
      ...runs.slice(0, i).map((x) => ({ ...x })),
      { ...r, text: r.text.slice(0, at) },
    ])
    return kept.length ? kept : null
  }
  return null
}

/** The words that only lead into a list of citations, at the end of some words. */
const LEAD_WORDS =
  /(?:such as|including|for example|for instance|namely|like|see(?: also)?|as in|e\.g\.)$/i

/**
 * Where the words that lead into a list at the end of `text` start, read from its end one part
 * at a time (so no pattern backtracks): ", such as ", " (see ", ": "; and whether they open a
 * bracket. `at` is the end of `text` when nothing leads into it.
 */
function leadInto(text: string): { at: number; paren: boolean } {
  let at = text.length
  const space = () => {
    while (at > 0 && /\s/.test(text[at - 1]!)) at--
  }
  const take = (c: string) => text[at - 1] === c && at-- > 0
  space()
  take(':')
  space()
  const word = LEAD_WORDS.exec(text.slice(Math.max(0, at - 16), at))
  if (word && !/[\p{L}\p{N}]/u.test(text[at - word[0].length - 1] ?? '')) at -= word[0].length
  space()
  const paren = take('(')
  space()
  if (!take(',')) take(';')
  return text.slice(at).trim() ? { at, paren } : { at: text.length, paren: false }
}

/** Between two citations of one list: commas, "and" or "or". */
const BETWEEN = /^[\s,;]*(?:(?:and|or|&)[\s,;]*)?$/i

/**
 * A sentence's runs without its citations, as under Not found, with the words that only listed
 * them: "own items, such as [1], [2] and [3]." reads "own items.", not "own items, such as, and.".
 */
export function withoutCites(runs: readonly LoopRun[]): LoopRun[] {
  const out: LoopRun[] = []
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]!
    if (r.t !== 'cite') {
      out.push({ ...r })
      continue
    }
    // The whole list of citations: those after it with only commas, "and" or "or" between.
    let end = i
    for (let j = i + 1; j < runs.length; j++) {
      const x = runs[j]!
      if (x.t === 'cite') end = j
      else if (x.t !== 'text' || !BETWEEN.test(x.text)) break
    }
    i = end
    const before = out.at(-1)
    // Only a list the words led into goes with them; one that sits after its claim leaves it be.
    const lead = before?.t === 'text' ? leadInto(before.text) : null
    if (before?.t === 'text' && lead && lead.at < before.text.length) {
      before.text = before.text.slice(0, lead.at)
      const next = runs[i + 1]
      if (lead.paren && next?.t === 'text') {
        out.push({ ...next, text: next.text.replace(/^\s*\)/, '') })
        i++
      }
    }
  }
  return out.filter((r) => r.t !== 'text' || r.text)
}

/**
 * The words as the page shows them beside code's evidence (FR-720), from the blocks as written:
 * each noun's chip where its sentence names it first; under Not found, no citation, since nothing
 * cited is a source, and no list of the items the closest written show below it, nor the line
 * that leads into one. What the chat sends back and what is graded keep the words as written.
 */
export function shownBody(
  written: readonly LoopBlock[],
  nouns: ReadonlyMap<string, Noun>,
  notFound: { cited: readonly string[]; closest: ReadonlySet<string> } | null,
): LoopBlock[] {
  const out: LoopBlock[] = []
  const closest = (runs: readonly LoopRun[]) =>
    runs.some((r) => r.t === 'cite' && notFound?.closest.has(notFound.cited[r.n - 1] ?? ''))
  for (const b of written) {
    if (
      notFound &&
      (b.t === 'list' || (b.t === 'ul' && b.items.filter(closest).length * 2 >= b.items.length))
    ) {
      const lead = out.at(-1)
      const last = lead?.t === 'p' ? lead.runs.at(-1) : undefined
      if (lead?.t === 'p' && last?.t === 'text' && /:\s*$/.test(last.text)) {
        const rest = withoutLastSentence(lead.runs)
        if (rest) lead.runs = rest
        else out.pop()
      }
      continue
    }
    const shown = (runs: readonly LoopRun[]) => placed(notFound ? withoutCites(runs) : runs, nouns)
    if (b.t === 'p') out.push({ ...b, runs: shown(b.runs) })
    else if (b.t === 'ul') out.push({ ...b, items: b.items.map(shown) })
    else if (b.t === 'table') out.push({ ...b, rows: b.rows.map((row) => row.map(shown)) })
    else out.push(b)
  }
  return out
}

/**
 * The blocks in plain words, no Markdown: paragraphs, each list's lines with "- " or their
 * number, a table's rows with its cells between pipes, and what was written as code as it is.
 */
export function bodyWords(
  body: readonly LoopBlock[],
  nouns: ReadonlyMap<string, Noun>,
  items: ReadonlyMap<string, Omit<LoopItem, 'n'>>,
  cited: readonly string[],
): string {
  return body
    .map((b) => {
      switch (b.t) {
        case 'p':
          return runWords(b.runs, nouns)
        case 'ul':
          return b.items.map((i, n) => `${lineMark(b, n)}${runWords(i, nouns)}`).join('\n')
        case 'table':
          return b.rows.map((row) => row.map((c) => runWords(c, nouns)).join(' | ')).join('\n')
        case 'code':
          return b.text
        case 'list':
          return b.rows
            .map((id) => `- ${items.get(id)?.title ?? id} [${cited.indexOf(id) + 1}]`)
            .join('\n')
      }
    })
    .join('\n\n')
}
