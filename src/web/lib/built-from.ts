import type { BuiltFromMetric } from '@/lib/definitions'

// What a metric is built from as an indented tree of rows (FR-143): the metric, then the metrics
// it is built from, each a level in. A metric under two others is a row under each, saying where
// else it is; one that would be under itself is left out there. A tree of a few lines opens
// whole; a larger one opens its first level, so 500 metrics below draw as a handful of rows.

export type BuiltFromRow = {
  /** Its path from the top, by ref: a metric under two others is two rows. */
  id: string
  metric: BuiltFromMetric
  depth: number
  /** For each level above but the top, whether a line still runs down past this row. */
  rails: boolean[]
  /** The last row under its parent: its line ends here. */
  last: boolean
  /** How many metrics it is built from, as drawn here. */
  kids: number
  open: boolean
  /** The other metrics, by name, that this one is also built into. */
  alsoIn: string[]
}

/** A tree of no more metrics than this opens whole. */
export const OPEN_WHOLE = 12

/**
 * The rows a tree shows, top down. `metrics` is the service's list: the top metric first, then
 * each metric below it once. `toggled` holds the rows the person opened or folded against how the
 * tree opens by itself.
 */
export function builtFromRows(
  metrics: readonly BuiltFromMetric[],
  toggled: ReadonlySet<string>,
): BuiltFromRow[] {
  const top = metrics[0]
  if (!top) return []
  const byRef = new Map(metrics.map((m) => [m.ref, m]))
  const parents = new Map<string, string[]>()
  for (const m of metrics)
    for (const ref of m.from) parents.set(ref, [...(parents.get(ref) ?? []), m.name])
  const whole = metrics.length <= OPEN_WHOLE
  const rows: BuiltFromRow[] = []
  const walk = (m: BuiltFromMetric, path: string[], rails: boolean[], last: boolean) => {
    const id = [...path, m.ref].join('/')
    const kids = m.from.flatMap((ref) => {
      const kid = byRef.get(ref)
      return kid && kid.ref !== m.ref && !path.includes(ref) ? [kid] : []
    })
    const depth = path.length
    const open = kids.length > 0 && (whole || depth === 0) !== toggled.has(id)
    const parent = path.length ? byRef.get(path.at(-1)!)?.name : undefined
    rows.push({
      id,
      metric: m,
      depth,
      rails,
      last,
      kids: kids.length,
      open,
      alsoIn: depth ? (parents.get(m.ref) ?? []).filter((name) => name !== parent) : [],
    })
    if (!open) return
    const below = depth ? [...rails, !last] : []
    kids.forEach((kid, i) => walk(kid, [...path, m.ref], below, i === kids.length - 1))
  }
  walk(top, [], [], true)
  return rows
}

/** The row a step out of `at`: its parent; -1 for the top. */
export const parentRow = (rows: readonly BuiltFromRow[], at: number) => {
  const depth = rows[at]?.depth ?? 0
  for (let i = at - 1; i >= 0; i--) if (rows[i]!.depth < depth) return i
  return -1
}
