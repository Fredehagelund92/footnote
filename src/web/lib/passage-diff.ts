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
// share rows, so the two sides line up. A move reads as a passage gone and one come, and the same
// words with another look as words changed. Each passage keeps the lines of the stored text it
// takes, so a comment on a line finds it. A mention ([@ id="..." label="..."]) is one word.

/** A run of a passage's words with the same marks, link and mention, changed or not. */
export type PassageRun = {
  text: string
  changed: boolean
  marks: Mark[]
  href: string | null
  /** A mention as the editor's token, drawn as its chip. */
  mention: string | null
}

/** One passage of one side: its shape, its words, and the lines of the stored text it takes. */
export type Passage = {
  shape: BlockShape
  runs: PassageRun[]
  line: number
  last: number
  /** Its number, for a numbered step. */
  n?: number
}

/** One row of the comparison: a passage now and suggested, either missing; changed or the same. */
export type PassageRow = { before: Passage | null; after: Passage | null; changed: boolean }

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

/** Each side's mentions as the reader's own mention markup, the same token the same on both sides. */
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
  return { before: swap(before), after: swap(after), token: (k: string) => tokens[Number(k)] }
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

const sameToken = (x: Token, y: Token) =>
  x.text === y.text && x.marks === y.marks && x.href === y.href && x.mention === y.mention

/**
 * Which tokens of each block the other does not have. Words and marks are compared, spaces are
 * not: a space is changed only between two changed words.
 */
function changedTokens(a: readonly Token[], b: readonly Token[]): [boolean[], boolean[]] {
  const solid = (xs: readonly Token[]) => xs.flatMap((x, i) => (x.text.trim() ? [i] : []))
  const sa = solid(a)
  const sb = solid(b)
  const ca = a.map((x) => !!x.text.trim())
  const cb = b.map((x) => !!x.text.trim())
  for (const op of sequenceDiff(
    sa.map((i) => a[i]!),
    sb.map((i) => b[i]!),
    sameToken,
    'del',
    (x) => [...x.text].length,
  ))
    if (op.op === 'same') {
      ca[sa[op.a]!] = false
      cb[sb[op.b]!] = false
    }
  const bridge = (xs: readonly Token[], changed: boolean[]) =>
    changed.map((c, i) => c || (!xs[i]!.text.trim() && !!changed[i - 1] && !!changed[i + 1]))
  return [bridge(a, ca), bridge(b, cb)]
}

/** A block's tokens as runs, each token changed or not as `changed` says. */
function runsOf(
  block: DocBlock,
  changed: readonly boolean[],
  token: (k: string) => string | undefined,
): PassageRun[] {
  const runs: PassageRun[] = []
  block.tokens.forEach((t, i) => {
    const mention = t.mention === null ? null : (token(t.mention) ?? null)
    // A mention that is not the editor's token is its words.
    const run: PassageRun = {
      text: t.text,
      changed: !!changed[i],
      marks: t.marks ? (t.marks.split(',') as Mark[]) : [],
      href: safeHref(t.href),
      mention,
    }
    const last = runs.at(-1)
    if (
      last &&
      !mention &&
      !last.mention &&
      last.changed === run.changed &&
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
  const a = markdownBlocks(text.before)
  const b = markdownBlocks(text.after)
  const na = numbers(a)
  const nb = numbers(b)
  const passage = (block: DocBlock, n: number | undefined, changed: readonly boolean[]) => ({
    shape: block.shape,
    runs: runsOf(block, changed, text.token),
    line: block.line,
    last: block.last,
    ...(n === undefined ? {} : { n }),
  })
  const whole = (block: DocBlock) => block.tokens.map(() => true)
  const plain = (block: DocBlock) => block.tokens.map(() => false)
  const { same, reworded } = alignBlocks(a, b)
  // A passage moved is, here, one gone and one come: only the same and the reworded pair up.
  const pairs = [...same, ...reworded].sort((x, y) => x.a - y.a)
  const rows: PassageRow[] = []
  let i = 0
  let j = 0
  // What went and what came between two pairs, side by side, row by row.
  const gap = (toA: number, toB: number) => {
    const gone = a.slice(i, Math.max(i, toA)).map((x, k) => passage(x, na[i + k], whole(x)))
    const come = b.slice(j, Math.max(j, toB)).map((x, k) => passage(x, nb[j + k], whole(x)))
    for (let k = 0; k < Math.max(gone.length, come.length); k++)
      rows.push({ before: gone[k] ?? null, after: come[k] ?? null, changed: true })
    i = Math.max(i, toA)
    j = Math.max(j, toB)
  }
  const pair = ({ a: x, b: y }: BlockPair) => {
    const [ca, cb] = changedTokens(a[x]!.tokens, b[y]!.tokens)
    const shape = JSON.stringify(a[x]!.shape) !== JSON.stringify(b[y]!.shape)
    const words = ca.some(Boolean) || cb.some(Boolean)
    rows.push({
      before: passage(a[x]!, na[x], words ? ca : plain(a[x]!)),
      after: passage(b[y]!, nb[y], words ? cb : plain(b[y]!)),
      changed: shape || words,
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
    changed: rows.filter((r) => r.changed).length,
    words: { before: words('before'), after: words('after') },
  }
}

/**
 * The passages that change, as the comparison steps through them: none when only one side has a
 * text (a new item, an archive), which is shown once.
 */
export const passagesChanged = (before: string, after: string) =>
  before.trim() && after.trim() ? passageStats(passageDiff(before, after)).changed : 0
