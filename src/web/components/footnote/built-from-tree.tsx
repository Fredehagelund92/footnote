import * as React from 'react'
import type { BuiltFromParts } from '@/components/footnote/definition'
import { builtFromRows, parentRow, type BuiltFromRow } from '@/lib/built-from'
import type { BuiltFromMetric } from '@/lib/definitions'

/*
  What a synced metric is built from, at every depth, as its tool's structure says (FR-143): an
  indented tree, the metric on top, each line with its kind and how many published context items
  about it the person may read. Counts only: no item's words, no figure. A line opens its metric in
  the side panel. It changes nothing an agent is given. Its own code loads apart, on a metric's
  page or its quick view; what it takes from the first load comes in as `parts`.
*/

type Props = { name: string; tool: string; parts: BuiltFromParts }

/** The tree under its label: nothing when the metric is built from no metric. */
export function BuiltFromTree({
  label,
  className,
  ...props
}: Props & {
  /** What it is called above it, drawn with it. */
  label: React.ReactNode
  className?: string
}) {
  const metrics = props.parts.useBuiltFrom(props.name)
  if (!metrics) return null
  return (
    <div className={props.parts.cn('flex flex-col gap-2', className)}>
      {label}
      <Tree key={props.name} metrics={metrics} {...props} />
    </div>
  )
}

/** The tree as a band of a metric's quick view: none when it is built from no metric. */
export default function BuiltFromBand(props: Props) {
  const { PeekBand, PeekLabel, useBuiltFrom } = props.parts
  const metrics = useBuiltFrom(props.name)
  if (!metrics) return null
  return (
    <PeekBand label="How it is built">
      <PeekLabel>Built from</PeekLabel>
      <Tree key={props.name} metrics={metrics} {...props} />
    </PeekBand>
  )
}

const said = (n: number) => n.toLocaleString('en-GB')

/** The keys a tree answers, as a list's: they never also reach the page or the panel. */
const KEYS = new Set(['ArrowDown', 'ArrowUp', 'j', 'k', 'Home', 'End', 'ArrowRight', 'ArrowLeft'])

function Tree({ metrics, tool, parts }: Props & { metrics: readonly BuiltFromMetric[] }) {
  const { cn, TypeTile, ShowMoreButton, ChevronDownIcon, ChevronRightIcon } = parts
  const lineOf = parts.useLines()
  const peeked = parts.usePeeked()
  const [toggled, setToggled] = React.useState<ReadonlySet<string>>(new Set())
  const rows = React.useMemo(() => builtFromRows(metrics, toggled), [metrics, toggled])
  const { shown, more, next, showMore } = parts.useShowMore(rows, 50, 200)
  const [cursor, setCursor] = React.useState(rows[0]!.id)
  const at = Math.max(
    0,
    shown.findIndex((row) => row.id === cursor),
  )
  const box = React.useRef<HTMLDivElement>(null)
  const top = metrics[0]!

  const toggle = (id: string) =>
    setToggled((now) => {
      const nextSet = new Set(now)
      if (!nextSet.delete(id)) nextSet.add(id)
      return nextSet
    })
  const opens = (row: BuiltFromRow) =>
    row.depth > 0 && !row.metric.missing && !!lineOf(row.metric).d
  const open = (row: BuiltFromRow) => {
    if (opens(row)) parts.openMetric(lineOf(row.metric).d!.name)
  }
  const move = (to: number) => {
    const row = shown[Math.max(0, Math.min(shown.length - 1, to))]
    if (!row) return
    setCursor(row.id)
    box.current?.querySelector<HTMLElement>(`[data-tree-row="${CSS.escape(row.id)}"]`)?.focus()
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const row = shown[at]
    if (!row) return
    if (e.key === 'Enter' || e.key === ' ') {
      if (e.key === 'Enter' && !opens(row)) return
      e.preventDefault()
      e.stopPropagation()
      if (opens(row)) open(row)
      return
    }
    if (!KEYS.has(e.key)) return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'ArrowDown' || e.key === 'j') move(at + 1)
    else if (e.key === 'ArrowUp' || e.key === 'k') move(at - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(shown.length - 1)
    else if (e.key === 'ArrowRight') {
      if (row.kids && !row.open) toggle(row.id)
      else if (row.kids) move(at + 1)
    } else if (row.open) toggle(row.id)
    else move(parentRow(shown, at))
  }

  const below = metrics.length - 1
  return (
    <div className="flex flex-col gap-2">
      <div
        ref={box}
        role="tree"
        aria-label={`What ${top.name} is built from`}
        onKeyDown={onKeyDown}
        className="overflow-hidden rounded-md border text-sm"
      >
        {shown.map((row, i) => {
          const { d, count } = lineOf(row.metric)
          return (
            <div
              key={row.id}
              role="treeitem"
              aria-level={row.depth + 1}
              aria-expanded={row.kids ? row.open : undefined}
              aria-current={row.depth === 0 ? 'true' : undefined}
              data-tree-row={row.id}
              data-peeked={(row.depth > 0 && d && peeked === d.name) || undefined}
              tabIndex={i === at ? 0 : -1}
              onFocus={() => setCursor(row.id)}
              onClick={() => open(row)}
              className={cn(
                'flex h-row min-w-0 items-stretch border-b pr-3 pl-2 outline-none last:border-b-0 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset data-peeked:bg-muted data-peeked:shadow-peeked',
                opens(row) && 'cursor-pointer hover:bg-muted/50',
              )}
            >
              <Rails row={row} cn={cn} />
              {row.kids ? (
                <span
                  aria-hidden
                  className="grid w-6 shrink-0 cursor-pointer place-items-center text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation()
                    setCursor(row.id)
                    toggle(row.id)
                  }}
                >
                  {row.open ? (
                    <ChevronDownIcon className="size-3.5" />
                  ) : (
                    <ChevronRightIcon className="size-3.5" />
                  )}
                </span>
              ) : (
                // A line with nothing below keeps the fold's place, so the tiles of a level line up.
                <span aria-hidden className="relative w-6 shrink-0">
                  {row.depth > 0 && (
                    <span className="absolute top-1/2 right-1.5 left-0 h-px bg-foreground/25" />
                  )}
                </span>
              )}
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <TypeTile d={d ?? { type: 'metric' }} />
                <span
                  className={cn(
                    'min-w-0 truncate',
                    row.depth ? 'font-medium' : 'font-semibold',
                    (!d || row.metric.missing) && 'text-muted-foreground',
                  )}
                >
                  {row.metric.name}
                </span>
                {row.metric.missing && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    no longer in {tool}
                  </span>
                )}
                {row.alsoIn.length > 0 && (
                  <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">
                    also in {row.alsoIn.join(', ')}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  'flex shrink-0 items-center pl-3 text-xs tabular-nums',
                  count ? 'font-medium' : 'text-muted-foreground',
                )}
              >
                {count ? `${said(count)} context ${count === 1 ? 'item' : 'items'}` : 'No context'}
              </span>
            </div>
          )
        })}
      </div>
      <ShowMoreButton more={more} next={next} onClick={showMore} />
      <p className="text-xs text-muted-foreground">
        {below === 1 ? '1 metric' : `${said(below)} metrics`} below it, read from {tool}. A count is
        the published context about that metric.
      </p>
    </div>
  )
}

/**
 * The lines that tie a row to its parent: one for each level above that runs on, and an elbow. Each
 * is as wide as a fold, so a line runs down from the middle of its parent's fold.
 */
function Rails({ row, cn }: { row: BuiltFromRow; cn: BuiltFromParts['cn'] }) {
  if (!row.depth) return null
  return (
    <span aria-hidden className="flex shrink-0">
      {row.rails.map((on, i) => (
        <span key={i} className="relative w-6">
          {on && <span className="absolute inset-y-0 left-1/2 w-px bg-foreground/25" />}
        </span>
      ))}
      <span className="relative w-6">
        <span
          className={cn(
            'absolute top-0 left-1/2 w-px bg-foreground/25',
            row.last ? 'h-1/2' : 'h-full',
          )}
        />
        <span className="absolute top-1/2 right-0 left-1/2 h-px bg-foreground/25" />
      </span>
    </span>
  )
}
