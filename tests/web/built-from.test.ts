import { describe, expect, it } from 'vitest'
import { builtFromRows, OPEN_WHOLE, parentRow } from '@/lib/built-from'
import type { BuiltFromMetric } from '@/lib/definitions'

// What a metric is built from as an indented tree (FR-143): the metric on top, each metric it is
// built from a level in, a metric under two others under each, and a large tree opened one level
// only. Invented names.

const metric = (name: string, from: string[] = []): BuiltFromMetric => ({
  ref: `x:${name}`,
  name,
  linked: true,
  missing: false,
  from: from.map((n) => `x:${n}`),
})

const roas = [
  metric('Return on ad spend', ['Net revenue', 'Marketing spend']),
  metric('Net revenue', ['Gross sales', 'Returns']),
  metric('Marketing spend'),
  metric('Gross sales'),
  metric('Returns'),
]

/** Each row as a reader sees it: indented by its level, + open, - folded. */
const drawn = (rows: ReturnType<typeof builtFromRows>) =>
  rows.map((r) => `${'  '.repeat(r.depth)}${r.kids ? (r.open ? '- ' : '+ ') : ''}${r.metric.name}`)

describe('the tree of what a metric is built from', () => {
  it('opens a small tree whole, each metric under the one built from it', () => {
    expect(drawn(builtFromRows(roas, new Set()))).toEqual([
      '- Return on ad spend',
      '  - Net revenue',
      '    Gross sales',
      '    Returns',
      '  Marketing spend',
    ])
  })

  it('draws a line on, past a row, only while its level has more rows below', () => {
    const rows = builtFromRows(roas, new Set())
    expect(rows.map((r) => [r.metric.name, r.rails, r.last])).toEqual([
      ['Return on ad spend', [], true],
      ['Net revenue', [], false],
      ['Gross sales', [true], false],
      ['Returns', [true], true],
      ['Marketing spend', [], true],
    ])
  })

  it('folds and opens a row the person toggles', () => {
    const net = builtFromRows(roas, new Set())[1]!.id
    expect(drawn(builtFromRows(roas, new Set([net])))).toEqual([
      '- Return on ad spend',
      '  + Net revenue',
      '  Marketing spend',
    ])
  })

  it('shows a metric under each metric built from it, saying where else it is', () => {
    const shared = [
      metric('Margin', ['Net revenue', 'Return on ad spend']),
      metric('Net revenue', ['Gross sales']),
      metric('Return on ad spend', ['Net revenue']),
      metric('Gross sales'),
    ]
    const rows = builtFromRows(shared, new Set())
    expect(drawn(rows)).toEqual([
      '- Margin',
      '  - Net revenue',
      '    Gross sales',
      '  - Return on ad spend',
      '    - Net revenue',
      '      Gross sales',
    ])
    expect(rows[1]!.alsoIn).toEqual(['Return on ad spend'])
    expect(rows[4]!.alsoIn).toEqual(['Margin'])
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length)
  })

  it('leaves a metric out under itself, so a loop in the source ends', () => {
    const loop = [metric('A', ['B']), metric('B', ['A', 'C']), metric('C')]
    expect(drawn(builtFromRows(loop, new Set()))).toEqual(['- A', '  - B', '    C'])
  })

  it('opens only the first level of a large tree, and 500 metrics below draw at once', () => {
    const parts = Array.from({ length: 250 }, (_, i) => metric(`Part ${i}`, [`Leaf ${i}`]))
    const leaves = Array.from({ length: 250 }, (_, i) => metric(`Leaf ${i}`))
    const big = [
      metric(
        'Total',
        parts.map((p) => p.name),
      ),
      ...parts,
      ...leaves,
    ]
    expect(big.length).toBeGreaterThan(OPEN_WHOLE)
    const started = performance.now()
    const rows = builtFromRows(big, new Set())
    expect(performance.now() - started).toBeLessThan(200)
    expect(rows).toHaveLength(251)
    expect(drawn(rows).slice(0, 3)).toEqual(['- Total', '  + Part 0', '  + Part 1'])
    expect(drawn(builtFromRows(big, new Set([rows[1]!.id]))).slice(0, 4)).toEqual([
      '- Total',
      '  - Part 0',
      '    Leaf 0',
      '  + Part 1',
    ])
  })

  it('steps out of a row to its parent, and from the top to nowhere', () => {
    const rows = builtFromRows(roas, new Set())
    expect(parentRow(rows, 3)).toBe(1)
    expect(parentRow(rows, 4)).toBe(0)
    expect(parentRow(rows, 0)).toBe(-1)
  })

  it('draws nothing for nothing', () => {
    expect(builtFromRows([], new Set())).toEqual([])
  })
})
