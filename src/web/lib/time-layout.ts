import type { Fact } from '@/model/items'
import { matchesWords } from '@/lib/list'
import { dayNumber, monthShort, monthYearLong } from '@/lib/dates'

// Context by time, as numbers: what each item draws as (its state and its days), what a filter
// lets through, the groups down the side, and where each bar sits. Bars inside a group share a
// lane wherever they do not overlap, with room for their names, so a group of 600 items takes tens
// of lanes rather than 600. Pure functions of what they are given, so the view only draws.

export const DAY = 86_400_000

/**
 * What a bar's fill says. Checked: published and in force or still to come. Needs a recheck: its
 * check date passed or a definition changed. Ended: its last day has passed. Not published yet:
 * sent for review, which a reader can see waiting and agents don't get.
 */
export type TimeState = 'checked' | 'due' | 'ended' | 'waiting'

export const STATE_LABEL: Record<TimeState, string> = {
  checked: 'Checked',
  due: 'Needs a recheck',
  ended: 'Ended',
  waiting: 'Not published yet',
}
export const TIME_STATES = Object.keys(STATE_LABEL) as TimeState[]

/**
 * The state an item draws in, or null for one By time leaves out: a draft only its writer sees,
 * and an archived item agents no longer get.
 */
export function timeStateOf(f: Pick<Fact, 'status' | 'valid'>, today: string): TimeState | null {
  if (f.status === 'Waiting') return 'waiting'
  if (f.status !== 'Live' && f.status !== 'Needs a recheck') return null
  if (f.valid.until && f.valid.until < today) return 'ended'
  return f.status === 'Needs a recheck' ? 'due' : 'checked'
}

/**
 * What items are filtered and grouped by: the fields every install has, then a dimension of the
 * definitions by its name (`dim:Market`), which only some installs have.
 */
export type FieldKey = 'state' | 'domain' | 'owner' | 'kind' | 'metric' | `dim:${string}`
/** State is a filter only: a group per state would split what one market holds. */
export type GroupBy = Exclude<FieldKey, 'state'> | 'none'

export const dimKey = (dimension: string): `dim:${string}` => `dim:${dimension}`
export const isDim = (key: string): key is `dim:${string}` => key.startsWith('dim:')

/** The value of an item that names none of a field's values: every market, no metric. */
export const NONE = ''

export type TimeItem = {
  id: string
  fact: Fact
  state: TimeState
  /** Its first day as a UTC time, or null when it has none: its bar fades in from the left. */
  start: number | null
  /** Its last day as a UTC time, or null when it has none: its bar fades out to the right. */
  end: number | null
  /** Neither a start nor an end: it holds whatever the date, so it has no bar. */
  always: boolean
  owners: string[]
  metrics: string[]
  /** Its values by dimension name. */
  dims: Record<string, string[]>
  /** The words a search reads, read once. */
  words: string[]
}

export type ItemsContext = {
  today: string
  /** The metrics' names, to tell a metric from the other names an item applies to. */
  metrics: ReadonlySet<string>
  /** Who answers for it: its own owners, or its domain's. */
  ownersOf: (f: Fact) => string[]
  /** The words a search reads in it. */
  words: (f: Fact) => string[]
}

/** A day "2026-08-04" as a UTC time. */
const dayOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`)

/** The items By time draws, read once from the list's rows. */
export function timeItemsOf(facts: readonly Fact[], ctx: ItemsContext): TimeItem[] {
  const items: TimeItem[] = []
  for (const fact of facts) {
    const state = timeStateOf(fact, ctx.today)
    if (!state) continue
    const start = fact.valid.from ? dayOf(fact.valid.from) : null
    const end = fact.valid.until ? dayOf(fact.valid.until) : null
    const dims: Record<string, string[]> = {}
    for (const v of fact.values ?? []) (dims[v.dimension] ??= []).push(v.name)
    items.push({
      id: fact.id,
      fact,
      state,
      start,
      end,
      always: start === null && end === null,
      owners: ctx.ownersOf(fact),
      metrics: fact.where.filter((w) => ctx.metrics.has(w)),
      dims,
      words: ctx.words(fact),
    })
  }
  return items
}

const ONE = [NONE]

/** An item's values of a field: what a filter matches and the groups it is drawn in. */
export function valuesOf(item: TimeItem, field: FieldKey): readonly string[] {
  if (field === 'state') return [item.state]
  if (field === 'domain') return [item.fact.domain]
  if (field === 'kind') return [item.fact.kind]
  if (field === 'owner') return item.owners.length ? item.owners : ONE
  if (field === 'metric') return item.metrics.length ? item.metrics : ONE
  return item.dims[field.slice(4)] ?? ONE
}

/** The values chosen, by field. Values of one field are OR; fields together are AND. */
export type Filters = Partial<Record<FieldKey, readonly string[]>>

/** Whether an item passes the filters and the search, leaving out one field's own filter. */
export function passes(
  item: TimeItem,
  filters: Filters,
  asked: readonly string[],
  skip?: FieldKey,
): boolean {
  for (const field in filters) {
    const chosen = filters[field as FieldKey]
    if (field === skip || !chosen?.length) continue
    if (!valuesOf(item, field as FieldKey).some((v) => chosen.includes(v))) return false
  }
  return !asked.length || matchesWords(asked, item.words)
}

/**
 * How many items each value of a field would show if it were chosen: everything the other filters
 * and the search let through, so the field's other values stay in sight.
 */
export function countsOf(
  items: readonly TimeItem[],
  filters: Filters,
  asked: readonly string[],
  field: FieldKey,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) {
    if (!passes(item, filters, asked, field)) continue
    for (const v of new Set(valuesOf(item, field))) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return counts
}

export type TimeGroup = {
  /** Its value, as the field holds it; `all` without grouping. */
  key: string
  /** Its items with dates, which are bars. */
  timed: TimeItem[]
  /** Its items without dates. */
  always: TimeItem[]
}

/**
 * The groups down the side: one per value, in the field's own order when it has one (`rank`),
 * else A to Z. An item that names several values is drawn in each of them. Every value (an item
 * that names none) comes first, as it holds for each of the others; No metric and No owner come last.
 */
export function groupsOf(
  items: readonly TimeItem[],
  by: GroupBy,
  rank?: (value: string) => number,
): TimeGroup[] {
  const groups = new Map<string, TimeGroup>()
  const add = (key: string, item: TimeItem) => {
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { key, timed: [], always: [] }))
    ;(item.always ? g.always : g.timed).push(item)
  }
  for (const item of items)
    if (by === 'none') add('all', item)
    else for (const v of new Set(valuesOf(item, by))) add(v, item)
  const noneFirst = isDim(by) ? -1 : 1
  return [...groups.values()].sort((a, b) => {
    if (a.key === NONE || b.key === NONE) return (a.key === NONE ? 1 : -1) * noneFirst
    if (rank) return rank(a.key) - rank(b.key)
    return a.key.localeCompare(b.key)
  })
}

/** The four zooms, as pixels a day: a tick of the axis is a day, a week, a month or a quarter. */
export type Zoom = 'weeks' | 'months' | 'quarters' | 'years'
export const ZOOMS: Record<Zoom, number> = { weeks: 24, months: 6, quarters: 2, years: 0.7 }
export const ZOOM_ORDER = Object.keys(ZOOMS) as Zoom[]

/** The time the axis covers, whole years: at least two years back and one ahead of today. */
export type Span = { t0: number; t1: number }

/** How far back the axis reaches at most: an older start fades in from the axis's first day. */
const MAX_YEARS_BACK = 15

export function spanOf(items: readonly TimeItem[], today: number): Span {
  const year = new Date(today).getUTCFullYear()
  let first = year - 2
  let last = year + 1
  for (const item of items)
    for (const t of [item.start, item.end])
      if (t !== null) {
        const y = new Date(t).getUTCFullYear()
        if (y < first) first = y
        if (y > last) last = y
      }
  first = Math.max(first, year - MAX_YEARS_BACK)
  return { t0: Date.UTC(first, 0, 1), t1: Date.UTC(last + 1, 0, 1) }
}

/** Where a time is, in pixels from the axis's first day. */
export const xOf = (t: number, span: Span, ppd: number) => ((t - span.t0) / DAY) * ppd
/** The time at a place, the other way round. */
export const timeAt = (x: number, span: Span, ppd: number) => span.t0 + (x / ppd) * DAY

/** A bar's place at a zoom, in pixels from the axis's first day. */
export type Bar = {
  item: TimeItem
  x0: number
  w: number
  /** Too short for its name: the name sits beside the bar, in a box of its own. */
  beside: boolean
  /** Where it and its name end: the next bar in its lane starts after this. */
  ext: number
}

/** A bar is never thinner than this, so a one-day item at Years can still be seen and pressed. */
export const MIN_BAR = 4
/** A name goes beside its bar when the bar is shorter than the name, up to this. */
const BESIDE_UNDER = 120
export const BESIDE_GAP = 6

export function barOf(
  item: TimeItem,
  span: Span,
  ppd: number,
  labelWidth: (title: string) => number,
): Bar {
  const from = item.start === null ? span.t0 : Math.max(item.start, span.t0)
  const to = item.end === null ? span.t1 : Math.min(item.end + DAY, span.t1)
  const x0 = xOf(from, span, ppd)
  const w = Math.max(MIN_BAR, xOf(to, span, ppd) - x0)
  const label = labelWidth(item.fact.title)
  const beside = w < Math.min(label, BESIDE_UNDER)
  return { item, x0, w, beside, ext: beside ? x0 + w + BESIDE_GAP + label : x0 + w }
}

/** The space left between two bars in a lane. */
const LANE_GAP = 8

/**
 * Bars into lanes: each goes in the first lane where it fits after what is already there, so
 * the top lanes fill first and a lane reads left to right.
 */
export function lanesOf(bars: readonly Bar[]): Bar[][] {
  const sorted = [...bars].sort(
    (a, b) => a.x0 - b.x0 || b.w - a.w || (a.item.id < b.item.id ? -1 : 1),
  )
  const lanes: { end: number; bars: Bar[] }[] = []
  for (const bar of sorted) {
    let lane = lanes.find((l) => l.end + LANE_GAP <= bar.x0)
    if (!lane) lanes.push((lane = { end: -Infinity, bars: [] }))
    lane.bars.push(bar)
    lane.end = bar.ext
  }
  return lanes.map((l) => l.bars)
}

export const GROUP_H = 36
export const LANE_H = 32
/** Room under the last lane, so its bars never touch the foot. */
const END_PAD = 24

export type TimeRow =
  | { kind: 'group'; group: TimeGroup; y: number; h: number; open: boolean }
  | { kind: 'lane'; group: TimeGroup; y: number; h: number; bars: Bar[] }

export type TimeLayout = {
  rows: TimeRow[]
  height: number
  span: Span
  /** The zoom the lanes were packed at. */
  ppd: number
  /** Where each bar is: its row, and its place in the row, by `barKey`. */
  at: Map<string, { row: number; index: number }>
}

/** A bar's key: an item drawn in two groups is two bars. */
export const barKey = (group: string, id: string) => `${group}\n${id}`
/** A group row's key, for the keyboard. */
export const groupKey = (group: string) => `group\n${group}`

/** The rows down the page: each group's line, then, when it is open, its lanes. */
export function timeLayout(
  groups: readonly TimeGroup[],
  opts: {
    span: Span
    ppd: number
    folded: ReadonlySet<string>
    labelWidth: (title: string) => number
  },
): TimeLayout {
  const rows: TimeRow[] = []
  const at = new Map<string, { row: number; index: number }>()
  let y = 0
  for (const group of groups) {
    const open = !opts.folded.has(group.key)
    at.set(groupKey(group.key), { row: rows.length, index: 0 })
    rows.push({ kind: 'group', group, y, h: GROUP_H, open })
    y += GROUP_H
    if (!open) continue
    const bars = group.timed.map((item) => barOf(item, opts.span, opts.ppd, opts.labelWidth))
    for (const lane of lanesOf(bars)) {
      lane.forEach((bar, index) =>
        at.set(barKey(group.key, bar.item.id), { row: rows.length, index }),
      )
      rows.push({ kind: 'lane', group, y, h: LANE_H, bars: lane })
      y += LANE_H
    }
  }
  return { rows, height: y + END_PAD, span: opts.span, ppd: opts.ppd, at }
}

/** The first row that reaches below `y`, by halving: rows are in order. */
export function rowAt(rows: readonly TimeRow[], y: number): number {
  let lo = 0
  let hi = rows.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid]!.y + rows[mid]!.h > y) hi = mid
    else lo = mid + 1
  }
  return lo
}

/* The axis: a line of longer stretches on top, ticks under it, and lines down the lanes. */

type Unit = 'day' | 'week' | 'month' | 'quarter' | 'year'

/** The first time of the unit at or before `t`: weeks start on Monday. */
function unitStart(unit: Unit, t: number): number {
  const d = new Date(t)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  if (unit === 'year') return Date.UTC(y, 0, 1)
  if (unit === 'quarter') return Date.UTC(y, m - (m % 3), 1)
  if (unit === 'month') return Date.UTC(y, m, 1)
  const day = Date.UTC(y, m, d.getUTCDate())
  return unit === 'week' ? day - ((new Date(day).getUTCDay() + 6) % 7) * DAY : day
}

function nextOf(unit: Unit, t: number): number {
  const d = new Date(t)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  if (unit === 'day') return t + DAY
  if (unit === 'week') return t + 7 * DAY
  if (unit === 'month') return Date.UTC(y, m + 1, 1)
  if (unit === 'quarter') return Date.UTC(y, m + 3, 1)
  return Date.UTC(y + 1, 0, 1)
}

/** Every unit that starts between two times, clipped to the span. */
function unitsIn(unit: Unit, span: Span, from: number, to: number): [number, number][] {
  const out: [number, number][] = []
  const end = Math.min(span.t1, to)
  for (let t = unitStart(unit, Math.max(span.t0, from)); t < end; t = nextOf(unit, t))
    out.push([Math.max(t, span.t0), Math.min(nextOf(unit, t), span.t1)])
  return out
}

export type Tick = { from: number; to: number; label: string }
export type Axis = { top: Tick[]; ticks: Tick[]; lines: { t: number; strong: boolean }[] }

/** What the axis says between two times at a zoom: months over days or weeks, years over months or quarters. */
export function axisOf(span: Span, ppd: number, from: number, to: number): Axis {
  const top: Unit = ppd >= 3.5 ? 'month' : 'year'
  const tick: Unit = ppd >= 14 ? 'day' : ppd >= 3.5 ? 'week' : ppd >= 1.2 ? 'month' : 'quarter'
  const line: Unit = tick === 'day' ? 'week' : tick
  const utc = { utc: true }
  const name = (unit: Unit, t: number) =>
    unit === 'year'
      ? String(new Date(t).getUTCFullYear())
      : unit === 'month'
        ? top === 'month'
          ? monthYearLong(t, utc)
          : monthShort(t, utc)
        : unit === 'quarter'
          ? `Q${Math.floor(new Date(t).getUTCMonth() / 3) + 1}`
          : dayNumber(t, utc)
  return {
    top: unitsIn(top, span, from, to).map(([a, b]) => ({ from: a, to: b, label: name(top, a) })),
    ticks: unitsIn(tick, span, from, to).map(([a, b]) => ({
      from: a,
      to: b,
      label: tick === 'month' ? monthShort(a, utc) : name(tick, a),
    })),
    lines: [
      ...unitsIn(line, span, from, to).map(([t]) => ({ t, strong: false })),
      ...unitsIn(top, span, from, to).map(([t]) => ({ t, strong: true })),
    ],
  }
}
