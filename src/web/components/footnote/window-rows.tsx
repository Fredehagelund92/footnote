import * as React from 'react'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'

// A long list's body, drawing only the rows that can be seen: those in view and a margin above and
// below, with spacer rows as tall as the rows left out. The demo's library holds 1,500 items, and
// drawing every row of Context at once held the page still for seconds after each click, and again
// whenever a read landed. The list's order, its keys and its selection still cover every row:
// `reveal` brings any row into view, then hands it over (to be focused). The row with focus and the
// one open in the dock stay drawn, with their neighbours, so focus is never lost and Shift and an
// arrow always find the next row.

/** How many rows are drawn past each edge of the view. */
const MARGIN = 8

export type WindowRowsHandle = {
  /** Brings the row with this key into view, then hands its element to `then`. */
  reveal: (key: string, then: (row: HTMLElement) => void) => void
}

/** The nearest ancestor that scrolls: the rows are measured against it. */
function scrollerOf(el: HTMLElement | null) {
  for (let at = el?.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at)
    if (overflowY === 'auto' || overflowY === 'scroll') return at
  }
  return null
}

/** A spacer the height of the rows not drawn; out of the accessibility tree, as it holds nothing. */
const Spacer = ({ height, colSpan }: { height: number; colSpan: number }) =>
  height > 0 ? (
    <tr aria-hidden>
      <td colSpan={colSpan} className="p-0" style={{ height }} />
    </tr>
  ) : null

export function WindowRows<T>({
  entries,
  keyOf,
  estimate,
  render,
  colSpan,
  keep,
  handle,
  before,
  after,
  ...body
}: {
  entries: readonly T[]
  keyOf: (entry: T) => string
  /** The height a row is drawn at before it is measured, in px. */
  estimate: (entry: T) => number
  /** A row: its `tr` takes `measure`, which marks it for measuring. */
  render: (
    entry: T,
    measure: { 'data-index': number; ref: (el: HTMLElement | null) => void },
  ) => React.ReactNode
  colSpan: number
  /** Rows that stay drawn wherever the list is scrolled, as the row open in the dock. */
  keep?: readonly (string | undefined)[]
  handle?: React.Ref<WindowRowsHandle>
  /** What the body shows before and after the rows: an empty list's note, the add row. */
  before?: React.ReactNode
  after?: React.ReactNode
} & Omit<React.ComponentProps<'tbody'>, 'children'>) {
  const tbody = React.useRef<HTMLTableSectionElement>(null)
  const scroller = React.useRef<HTMLElement | null>(null)
  const scrollElement = () => (scroller.current ??= scrollerOf(tbody.current))
  // Where the rows start in the scroller: below the bar, the filters and the table's head.
  const [margin, setMargin] = React.useState(0)
  const [focused, setFocused] = React.useState<string>()
  const indexOf = React.useMemo(
    () => new Map(entries.map((e, i) => [keyOf(e), i])),
    [entries, keyOf],
  )
  const held = [focused, ...(keep ?? [])]
    .map((k) => (k === undefined ? undefined : indexOf.get(k)))
    .filter((i): i is number => i !== undefined)
  const heldKey = held.join(' ')
  // The virtualizer's functions change under it, so the compiler leaves this component as written.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rows = useVirtualizer({
    count: entries.length,
    getScrollElement: scrollElement,
    estimateSize: (i) => estimate(entries[i]!),
    getItemKey: (i) => keyOf(entries[i]!),
    overscan: MARGIN,
    scrollMargin: margin,
    // The first draw already has rows: the view's height is the window's until it is measured.
    initialRect: { width: 0, height: window.innerHeight },
    rangeExtractor: React.useCallback(
      (range: Parameters<typeof defaultRangeExtractor>[0]) => {
        const shown = new Set(defaultRangeExtractor(range))
        for (const i of heldKey ? heldKey.split(' ').map(Number) : [])
          for (const at of [i - 1, i, i + 1]) if (at >= 0 && at < range.count) shown.add(at)
        return [...shown].sort((a, b) => a - b)
      },
      [heldKey],
    ),
  })

  // After every draw, as the bar above can change height with any of them; it settles at once, since
  // the margin it measures does not move the tbody.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useLayoutEffect(() => {
    const at = scrollElement()
    if (!at || !tbody.current) return
    const top =
      tbody.current.getBoundingClientRect().top - at.getBoundingClientRect().top + at.scrollTop
    if (Math.abs(top - margin) >= 1) setMargin(top)
  })

  // A table lays its columns out by the rows it holds, so with only some drawn a column sized by
  // its content would change width as the list scrolls. Each header marked data-steady keeps the
  // widest it has been for these rows at this width, as it would be with every row drawn; a
  // filter, a search or a new width starts again from the rows then drawn.
  const list = React.useMemo(() => entries.map(keyOf).sort().join(' '), [entries, keyOf])
  const widest = React.useRef<{ list: string; width: number; cols: number[] } | null>(null)
  React.useLayoutEffect(() => {
    const table = tbody.current?.closest('table')
    const heads = [...(table?.tHead?.querySelectorAll<HTMLElement>('th[data-steady]') ?? [])]
    if (!table || !heads.length) return
    const width = table.parentElement?.clientWidth ?? 0
    let seen = widest.current
    if (!seen || seen.list !== list || seen.width !== width) {
      for (const th of heads) th.style.minWidth = ''
      seen = widest.current = { list, width, cols: [] }
    }
    heads.forEach((th, i) => {
      const w = th.getBoundingClientRect().width
      if (w > (seen.cols[i] ?? 0)) {
        seen.cols[i] = w
        th.style.minWidth = `${w}px`
      }
    })
  })

  // A row asked for by `reveal`, handed over once it is drawn.
  const asked = React.useRef<{ key: string; then: (row: HTMLElement) => void } | null>(null)
  const rowOf = (key: string) => {
    const i = indexOf.get(key)
    return i === undefined
      ? null
      : tbody.current?.querySelector<HTMLElement>(`:scope > tr[data-index="${i}"]`)
  }
  React.useLayoutEffect(() => {
    const want = asked.current
    const row = want && rowOf(want.key)
    if (!want || !row) return
    asked.current = null
    want.then(row)
  })
  React.useImperativeHandle(handle, () => ({
    reveal: (key, then) => {
      const i = indexOf.get(key)
      if (i === undefined) return
      const row = rowOf(key)
      if (row) return then(row)
      asked.current = { key, then }
      rows.scrollToIndex(i, { align: 'auto' })
    },
  }))

  const items = rows.getVirtualItems()
  let end = margin
  const drawn: React.ReactNode[] = []
  for (const item of items) {
    drawn.push(<Spacer key={`gap:${item.index}`} height={item.start - end} colSpan={colSpan} />)
    drawn.push(
      <React.Fragment key={item.key}>
        {render(entries[item.index]!, { 'data-index': item.index, ref: rows.measureElement })}
      </React.Fragment>,
    )
    end = item.end
  }
  return (
    <tbody
      ref={tbody}
      {...body}
      onFocus={(e) => {
        body.onFocus?.(e)
        const row = (e.target as HTMLElement).closest<HTMLElement>('tr[data-index]')
        const entry = row?.parentElement === tbody.current && entries[Number(row.dataset.index)]
        setFocused(entry ? keyOf(entry) : undefined)
      }}
    >
      {before}
      {drawn}
      <Spacer height={rows.getTotalSize() + margin - end} colSpan={colSpan} />
      {after}
    </tbody>
  )
}
