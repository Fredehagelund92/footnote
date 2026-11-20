/*
  The blocks of two texts paired, as the review's difference (doc-diff.ts) and the comparison's
  text (src/web/lib/passage-diff.ts) both pair them: the same block, the same words in another
  place, or one block reworded. Apart from markdown-blocks.ts, which the first screen loads, so this
  and the comparison of sequences load with the review alone. Pure: no clock, no input or output.
*/
import type { DocBlock } from './markdown-blocks.ts'
import { sequenceDiff, type Op } from './sequence-diff.ts'

/** How much of their words two blocks share, from 0 to 1. */
function similarity(a: DocBlock, b: DocBlock): number {
  const words = (x: DocBlock) =>
    x.tokens.filter((t) => t.text.trim()).map((t) => t.text.toLowerCase())
  const wa = words(a)
  const wb = words(b)
  if (!wa.length || !wb.length) return 0
  const common = sequenceDiff(wa, wb, (x, y) => x === y).filter((op) => op.op === 'same').length
  return (2 * common) / (wa.length + wb.length)
}

/** Two blocks share at least this much of their words to count as one block reworded. */
const PAIR_SIMILARITY = 0.4

/** A block of one text and its partner in the other, by their places in each. */
export type BlockPair = { a: number; b: number }

/**
 * The blocks of two texts paired: the same words in the same order (`same`), the same words in
 * another place (`moved`), and, between two unchanged blocks, a removed block and an added one that
 * share most of their words (`reworded`). The rest has no partner: `removed` from the first text,
 * `added` in the second. `ops` is the comparison by words that the pairs come from.
 */
export type BlockAlignment = {
  ops: Op[]
  same: BlockPair[]
  moved: BlockPair[]
  reworded: BlockPair[]
  removed: Set<number>
  added: Set<number>
}

export function alignBlocks(a: readonly DocBlock[], b: readonly DocBlock[]): BlockAlignment {
  const key = (x: DocBlock) => x.text.replace(/\s+/g, ' ').trim()
  const ops = sequenceDiff(a, b, (x, y) => key(x) === key(y), 'add')
  const same: BlockPair[] = []
  const removed = new Set<number>()
  const added = new Set<number>()
  for (const op of ops) {
    if (op.op === 'same') same.push({ a: op.a, b: op.b })
    else if (op.op === 'del') removed.add(op.a)
    else added.add(op.b)
  }
  // The same words in another place: a move, not a removal and an addition.
  const moved: BlockPair[] = []
  for (const j of [...added]) {
    if (!key(b[j]!)) continue
    const i = [...removed].find((x) => key(a[x]!) === key(b[j]!))
    if (i === undefined) continue
    removed.delete(i)
    added.delete(j)
    moved.push({ a: i, b: j })
  }
  // In each stretch between unchanged blocks, a removed block and an added one that share most of
  // their words are one block reworded.
  const reworded: BlockPair[] = []
  const anchors = [{ a: -1, b: -1 }, ...same, { a: a.length, b: b.length }]
  for (let k = 0; k + 1 < anchors.length; k++) {
    const from = anchors[k]!
    const to = anchors[k + 1]!
    const gone = [...removed].filter((i) => i > from.a && i < to.a).sort((x, y) => x - y)
    const come = [...added].filter((j) => j > from.b && j < to.b).sort((x, y) => x - y)
    let next = 0
    for (const i of gone) {
      for (let p = next; p < come.length; p++) {
        if (similarity(a[i]!, b[come[p]!]!) < PAIR_SIMILARITY) continue
        reworded.push({ a: i, b: come[p]! })
        removed.delete(i)
        added.delete(come[p]!)
        next = p + 1
        break
      }
    }
  }
  return { ops, same, moved, reworded, removed, added }
}
