import { alignBlocks, type BlockPair } from '@domain/block-pairs'
import {
  markdownBlocks,
  type BlockShape,
  type DocBlock,
  type Mark,
  type Token,
} from '@domain/markdown-blocks'
import { sequenceDiff } from '@domain/sequence-diff'

// The comparison's text: the stored text as a reader sees it, passage by passage (a paragraph, a
// heading, a quote, a list item), now beside suggested. Passages are paired as the review pairs
// its blocks (alignBlocks): the same passage, or one reworded, sits on one row with only its
// changed words marked, struck on the left and underlined on the right. A passage with no partner
// is marked whole on its own side, and between two unchanged passages what went and what came
// share rows, so the two sides line up. A mention ([@ id="..." label="..."]) is one word.
//
// The kinds the review's difference tells apart (src/domain/doc-diff.ts) that keep the words get
// marks of their own, never a word struck and added: the same words with other marks or another
// shape are a new look, the same words with a new link or address a link, and a passage with the
// same words in another place a move, shown where it was on the left and where it is on the
// right. Each passage keeps the lines of the stored text it takes, so a comment on a line finds it.

/** The marks the same words gained and lost: a new look. */
export type Look = { added: Mark[]; removed: Mark[] }

/** A run of a passage's words with the same marks, link and mention, changed or not. */
export type PassageRun = {
  text: string
  /** Words this side has and the other does not: struck on the left, underlined on the right. */
  changed: boolean
  /** The same words with other marks on the other side. */
  look: Look | null
  /** The same words with a link added, taken off or pointed elsewhere on the suggested side. */
  link: LinkChange | null
  marks: Mark[]
  href: string | null
  /** A mention as the editor's token, drawn as its chip. */
  mention: string | null
}

/** What became of the link on the same words: one added, one taken off, or a new address. */
export type LinkChange = 'added' | 'removed' | 'address'

/** The same passage in another place: up or down, and from and to which step of a numbered list. */
export type Move = { up: boolean; steps: { from: number; to: number } | null }

/** One passage of one side: its shape, its words, and the lines of the stored text it takes. */
export type Passage = {
  shape: BlockShape
  runs: PassageRun[]
  line: number
  last: number
  /** Its number, for a numbered step. */
  n?: number
  /** Its shape on the other side, when the same words take another shape there: a new look. */
  was?: BlockShape
  /** Its words stand in another place on the other side. */
  moved?: Move
}

/**
 * One row of the comparison: a passage now and suggested, either missing. `changed` when they
 * differ in any way; `words` when words differ, not only a look, a link or a place; `stop` when
 * the row is a change of its own to step to and count. A move is one change, counted where it
 * goes, so the place it left is marked but not a stop.
 */
export type PassageRow = {
  before: Passage | null
  after: Passage | null
  changed: boolean
  words: boolean
  stop: boolean
}

const MENTION = /\[@ [^\]]*\]/g

/**
 * A link's address when a reader may follow it (http, https or mailto, or one on this site);
 * null for any other, such as javascript:, so its words are drawn without a link. A suggestion's
 * text can come from an agent or a document.
 */
export function safeHref(href: string | null): string | null {
  if (!href) return null
  try {
    const url = new URL(href, 'https://footnote.invalid')
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? href : null
  } catch {
    return null
  }
}

/**
 * Each side's mentions as the reader's own mention markup, the same token the same on both sides,
 * read by its words: words that become a mention of the same words are the same words, now a link.
 */
function readable(before: string, after: string) {
  const ids = new Map<string, number>()
  const tokens: string[] = []
  const swap = (md: string) =>
    md.replace(MENTION, (token) => {
      let k = ids.get(token)
      if (k === undefined) {
        k = tokens.length
        ids.set(token, k)
        tokens.push(token)
      }
      return `@[m${k}](${k})`
    })
  const label = (k: string) => {
    const token = tokens[Number(k)] ?? ''
    return (/label="([^"]*)"/.exec(token)?.[1] ?? '').trim() || token
  }
  return {
    before: swap(before),
    after: swap(after),
    token: (k: string) => tokens[Number(k)],
    label,
  }
}

/** The number of each numbered step on one side, counted inside its list. */
function numbers(blocks: readonly DocBlock[]): (number | undefined)[] {
  const at: number[] = []
  return blocks.map((b) => {
    const { shape } = b
    if (shape.type !== 'bullet' && shape.type !== 'number') {
      at.length = 0
      return undefined
    }
    at.length = shape.depth + 1
    if (shape.type === 'bullet') {
      at[shape.depth] = 0
      return undefined
    }
    at[shape.depth] = (at[shape.depth] ?? 0) + 1
    return at[shape.depth]
  })
}

/** How a token of one side stands against the other: its words, its look or its link changed. */
type TokenState = { changed: boolean; look: Look | null; link: LinkChange | null }

const plainState = (): TokenState => ({ changed: false, look: null, link: null })

const markList = (m: string) => (m ? (m.split(',') as Mark[]) : [])

/** The marks `to` has that `from` has not, and the other way round, in the order marks come. */
function lookOf(from: string, to: string): Look {
  const was = markList(from)
  const now = markList(to)
  return {
    added: now.filter((m) => !was.includes(m)),
    removed: was.filter((m) => !now.includes(m)),
  }
}

/** What a token reads as: its text, or a mention's label. */
type Reads = (t: Token) => string

/** Words that read the same: their text, ignoring case where a mention takes the words. */
const sameWords = (reads: Reads) => (x: Token, y: Token) =>
  reads(x) === reads(y) ||
  ((x.mention !== null || y.mention !== null) && reads(x).toLowerCase() === reads(y).toLowerCase())

/**
 * How each token of two blocks stands against the other. Words are compared, spaces are not: a
 * space takes the state of the words on both sides of it when they agree. The same words with
 * other marks are a new look, with another link or mention a link, and words that became a
 * mention of the same words (or a mention its words) are a link too, never words changed.
 */
function tokenStates(
  a: readonly Token[],
  b: readonly Token[],
  reads: Reads,
): [TokenState[], TokenState[]] {
  const solid = (xs: readonly Token[]) => xs.flatMap((x, i) => (x.text.trim() ? [i] : []))
  const sa = solid(a)
  const sb = solid(b)
  const ca = a.map((x): TokenState => ({ ...plainState(), changed: !!x.text.trim() }))
  const cb = b.map((x): TokenState => ({ ...plainState(), changed: !!x.text.trim() }))
  const ops = sequenceDiff(
    sa.map((i) => a[i]!),
    sb.map((i) => b[i]!),
    sameWords(reads),
    'del',
    (x) => [...reads(x)].length,
  )
  for (const op of ops) {
    if (op.op !== 'same') continue
    const x = a[sa[op.a]!]!
    const y = b[sb[op.b]!]!
    const look = x.marks === y.marks ? null : lookOf(x.marks, y.marks)
    const has = (t: Token) => t.href !== null || t.mention !== null
    const link: LinkChange | null =
      x.href === y.href && x.mention === y.mention
        ? null
        : !has(x)
          ? 'added'
          : !has(y)
            ? 'removed'
            : 'address'
    ca[sa[op.a]!] = { changed: false, look: look && lookOf(y.marks, x.marks), link }
    cb[sb[op.b]!] = { changed: false, look, link }
  }
  // Words gone and a mention come in one place, reading the same: the words, now a link.
  const words = (xs: readonly Token[], at: readonly number[]) =>
    at
      .map((i) => reads(xs[i]!))
      .join('')
      .replace(/\s+/g, '')
      .toLowerCase()
  let k = 0
  while (k < ops.length) {
    if (ops[k]!.op === 'same') {
      k++
      continue
    }
    let end = k
    while (end < ops.length && ops[end]!.op !== 'same') end++
    const group = ops.slice(k, end)
    const gone = group.flatMap((op) => (op.op === 'del' ? [sa[op.a]!] : []))
    const come = group.flatMap((op) => (op.op === 'add' ? [sb[op.b]!] : []))
    const one = (xs: readonly Token[], at: readonly number[]) =>
      at.length === 1 && xs[at[0]!]!.mention !== null
    if (
      gone.length &&
      come.length &&
      (one(b, come) || one(a, gone)) &&
      words(a, gone) === words(b, come)
    ) {
      const link: LinkChange = !one(a, gone) ? 'added' : !one(b, come) ? 'removed' : 'address'
      // The words, and the spaces between them, that became one mention or came out of one.
      for (let i = gone[0]!; i <= gone.at(-1)!; i++) ca[i] = { changed: false, look: null, link }
      for (let j = come[0]!; j <= come.at(-1)!; j++) cb[j] = { changed: false, look: null, link }
    }
    k = end
  }
  const key = (s: TokenState) =>
    `${s.changed}|${s.link}|${s.look ? `${s.look.added.join()}/${s.look.removed.join()}` : ''}`
  const bridge = (xs: readonly Token[], states: TokenState[]) =>
    states.map((s, i) => {
      if (xs[i]!.text.trim()) return s
      const l = states[i - 1]
      const r = states[i + 1]
      return l && r && key(l) === key(r) && key(l) !== key(plainState()) ? { ...l } : s
    })
  return [bridge(a, ca), bridge(b, cb)]
}

/** A block's tokens as runs, each token as `states` says it stands against the other side. */
function runsOf(
  block: DocBlock,
  states: readonly TokenState[],
  token: (k: string) => string | undefined,
): PassageRun[] {
  const runs: PassageRun[] = []
  block.tokens.forEach((t, i) => {
    const mention = t.mention === null ? null : (token(t.mention) ?? null)
    const state = states[i] ?? plainState()
    // A mention that is not the editor's token is its words.
    const run: PassageRun = {
      text: t.text,
      changed: state.changed,
      look: state.look,
      link: state.link,
      marks: markList(t.marks),
      href: safeHref(t.href),
      mention,
    }
    const last = runs.at(-1)
    if (
      last &&
      !mention &&
      !last.mention &&
      last.changed === run.changed &&
      last.link === run.link &&
      JSON.stringify(last.look) === JSON.stringify(run.look) &&
      last.href === run.href &&
      last.marks.join() === run.marks.join()
    )
      last.text += run.text
    else runs.push(run)
  })
  return runs
}

export function passageDiff(before: string, after: string): PassageRow[] {
  const text = readable(before, after)
  const reads: Reads = (t) => (t.mention === null ? t.text : text.label(t.mention))
  const a = markdownBlocks(text.before)
  const b = markdownBlocks(text.after)
  const na = numbers(a)
  const nb = numbers(b)
  const passage = (
    block: DocBlock,
    n: number | undefined,
    states: readonly TokenState[],
    extra: Pick<Passage, 'was' | 'moved'> = {},
  ): Passage => ({
    shape: block.shape,
    runs: runsOf(block, states, text.token),
    line: block.line,
    last: block.last,
    ...(n === undefined ? {} : { n }),
    ...extra,
  })
  const whole = (block: DocBlock) => block.tokens.map(() => ({ ...plainState(), changed: true }))
  const labelled = (blocks: readonly DocBlock[]): DocBlock[] =>
    blocks.map((block) => {
      const tokens = block.tokens.map((t) =>
        t.mention === null ? t : { ...t, text: text.label(t.mention) },
      )
      return { ...block, tokens, text: tokens.map((t) => t.text).join('') }
    })
  const { same, moved, reworded } = alignBlocks(labelled(a), labelled(b))
  // A passage moved stands where it was on the left and where it is on the right, its words the
  // same: up when fewer passages that stay come before it now than did.
  const movedA = new Map<number, BlockPair>(moved.map((p) => [p.a, p]))
  const movedB = new Map<number, BlockPair>(moved.map((p) => [p.b, p]))
  const moveOf = ({ a: x, b: y }: BlockPair): Move => {
    const earlierA = same.filter((p) => p.a < x).length
    const earlierB = same.filter((p) => p.b < y).length
    const up = earlierB === earlierA ? y < x : earlierB < earlierA
    const steps =
      a[x]!.shape.type === 'number' && b[y]!.shape.type === 'number' && na[x] !== nb[y]
        ? { from: na[x]!, to: nb[y]! }
        : null
    return { up, steps }
  }
  const shapeOf = (x: DocBlock, y: DocBlock) =>
    JSON.stringify(x.shape) === JSON.stringify(y.shape) ? null : x.shape
  const gonePassage = (k: number) => {
    const pair = movedA.get(k)
    if (!pair) return passage(a[k]!, na[k], whole(a[k]!))
    const [ca] = tokenStates(a[k]!.tokens, b[pair.b]!.tokens, reads)
    const was = shapeOf(b[pair.b]!, a[k]!)
    return passage(a[k]!, na[k], ca, { moved: moveOf(pair), ...(was ? { was } : {}) })
  }
  const comePassage = (k: number) => {
    const pair = movedB.get(k)
    if (!pair) return passage(b[k]!, nb[k], whole(b[k]!))
    const [, cb] = tokenStates(a[pair.a]!.tokens, b[k]!.tokens, reads)
    const was = shapeOf(a[pair.a]!, b[k]!)
    return passage(b[k]!, nb[k], cb, { moved: moveOf(pair), ...(was ? { was } : {}) })
  }
  // A passage that only moved is no word changed, and counts once, where it goes.
  const wordsOf = (p: Passage | null) => !!p && !p.moved
  const pairs = [...same, ...reworded].sort((x, y) => x.a - y.a)
  const rows: PassageRow[] = []
  let i = 0
  let j = 0
  // What went and what came between two pairs, side by side, row by row.
  const gap = (toA: number, toB: number) => {
    const gone: Passage[] = []
    const come: Passage[] = []
    for (let k = i; k < toA; k++) gone.push(gonePassage(k))
    for (let k = j; k < toB; k++) come.push(comePassage(k))
    const row = (left: Passage | null, right: Passage | null) =>
      rows.push({
        before: left,
        after: right,
        changed: true,
        words: wordsOf(left) || wordsOf(right),
        stop: !!right || wordsOf(left),
      })
    // A moved half stands on its own row where it is; a deletion is its own change.
    let g = 0
    let c = 0
    while (g < gone.length || c < come.length) {
      const left = gone[g]
      const right = come[c]
      if (left?.moved) {
        row(left, null)
        g++
      } else if (right?.moved) {
        row(null, right)
        c++
      } else {
        row(left ?? null, right ?? null)
        if (left) g++
        if (right) c++
      }
    }
    i = Math.max(i, toA)
    j = Math.max(j, toB)
  }
  const pair = ({ a: x, b: y }: BlockPair) => {
    const [ca, cb] = tokenStates(a[x]!.tokens, b[y]!.tokens, reads)
    const was = shapeOf(a[x]!, b[y]!)
    const words = [...ca, ...cb].some((t) => t.changed)
    const kept = [...ca, ...cb].some((t) => t.look || t.link)
    const changed = !!was || words || kept
    rows.push({
      before: passage(a[x]!, na[x], ca, was ? { was: b[y]!.shape } : {}),
      after: passage(b[y]!, nb[y], cb, was ? { was } : {}),
      changed,
      words,
      stop: changed,
    })
    i = x + 1
    j = y + 1
  }
  for (const p of pairs) {
    // Pairs come in reading order on both sides; one out of order reads as gone and come.
    if (p.a < i || p.b < j) continue
    gap(p.a, p.b)
    pair(p)
  }
  gap(a.length, b.length)
  return rows
}

/** How the text changed: the passages that changed, and the words of each side. */
export function passageStats(rows: readonly PassageRow[]) {
  const words = (side: 'before' | 'after') =>
    rows.reduce(
      (n, r) =>
        n +
        (r[side]?.runs ?? []).reduce(
          (m, run) => m + (run.mention ? 1 : (run.text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0)),
          0,
        ),
      0,
    )
  return {
    /** The changes: a move counts once, where it goes. */
    changed: rows.filter((r) => r.stop).length,
    /** The changes that change words, not only a look, a link or a place. */
    reworded: rows.filter((r) => r.stop && r.words).length,
    words: { before: words('before'), after: words('after') },
  }
}

/**
 * The passages that change, as the comparison steps through them: none when only one side has a
 * text (a new item, an archive), which is shown once.
 */
export const passagesChanged = (before: string, after: string) =>
  before.trim() && after.trim() ? passageStats(passageDiff(before, after)).changed : 0
