import * as React from 'react'
import './context-time.css'
import {
  CalendarIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleMinusIcon,
  ClockIcon,
  LayersIcon,
  ListFilterIcon,
  ListTreeIcon,
  ShapesIcon,
  SigmaIcon,
  SplitIcon,
  UserIcon,
} from '@/components/icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Kbd } from '@/components/ui/kbd'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  BarSpacer,
  barButton,
  barGroup,
  Count,
  FilterChip,
  FilterRow,
  FilterValue,
  Highlight,
  ListBar,
  SearchField,
} from '@/components/footnote/list'
import { TextSwitch } from '@/components/footnote/switches'
import { kindIcons } from '@/components/footnote/kind-icons'
import { DomainDot } from '@/components/footnote/tag-chip'
import { PersonAvatar } from '@/components/footnote/bits'
import { useVocabulary } from '@/api/queries'
import { kindLabel, type Fact, type Kind } from '@/model/items'
import { ownersOf } from '@/model/people'
import { useDomainList, useDomains } from '@/lib/workspace'
import { closeDock, openFromRow, useDock } from '@/lib/dock'
import { useListKeys, usePublishOrder, words, wordsIn } from '@/lib/list'
import { plainText } from '@/lib/mentions'
import { pageKey } from '@/lib/keys'
import { today, todayMs } from '@/lib/today'
import {
  axisOf,
  barKey,
  barOf,
  countsOf,
  dimKey,
  groupKey,
  groupsOf,
  isDim,
  NONE,
  passes,
  rowAt,
  spanOf,
  STATE_LABEL,
  timeAt,
  timeItemsOf,
  timeLayout,
  TIME_STATES,
  valuesOf,
  xOf,
  ZOOM_ORDER,
  ZOOMS,
  type Bar,
  type FieldKey,
  type Filters,
  type GroupBy,
  type TimeGroup,
  type TimeItem,
  type TimeLayout,
  type TimeState,
  type Zoom,
} from '@/lib/time-layout'

// Context by time: the same items as the list, along a time line. Groups run down the side
// (Domain first, then Owner, Kind, Metric or a dimension of the definitions), time runs left to
// right, and each item is a bar that ends where its dates end, filled by its state. Built to hold
// thousands of items: groups fold to one line each, and only the rows and the stretch of time near
// the screen are drawn, about three quarters of a screen past each edge, drawn again only once the
// view scrolls past that. The filters are the list's, as sentences under the bar, with the fields
// every install has and then the dimensions of the definitions: values of one field are OR, fields
// together are AND. A bar opens the item in the side panel, which steps through the bars with J
// and K.

/** Above this many items, groups start folded to one line each. */
const FOLD_ABOVE = 400
/** The axis's height, and the names' column's width (and none on a narrow pane). */
const AXIS_H = 44
const GUT = 248
const NARROW_BELOW = 640
/** How long the pointer rests on a bar before its card shows, in ms. */
const HOVER_WAIT = 280
/** How much past the screen is drawn, as a share of the screen, on every side. */
const MARGIN = 0.75
/** The longest a name may make its bar's lane, in px: a longer one is cut with an ellipsis. */
const NAME_MAX = 320
/** The icon, the gap and the padding beside a bar's words, in px. */
const NAME_EXTRA = 34

const ZOOM_LABEL: Record<Zoom, string> = {
  weeks: 'Weeks',
  months: 'Months',
  quarters: 'Quarters',
  years: 'Years',
}

const STATE_ICON: Record<TimeState, typeof CircleCheckIcon> = {
  checked: CircleCheckIcon,
  due: CircleAlertIcon,
  ended: CircleMinusIcon,
  waiting: ClockIcon,
}

/** The fields every install has, in the menus' order; the dimensions follow them. */
const FIELDS: { key: Exclude<FieldKey, `dim:${string}`>; label: string; group: boolean }[] = [
  { key: 'state', label: 'State', group: false },
  { key: 'domain', label: 'Domain', group: true },
  { key: 'owner', label: 'Owner', group: true },
  { key: 'kind', label: 'Kind', group: true },
  { key: 'metric', label: 'Metric', group: true },
]
const KINDS = Object.keys(kindLabel) as Kind[]

const count = (n: number) => n.toLocaleString('en-GB')
const itemsWord = (n: number) => `${count(n)} context ${n === 1 ? 'item' : 'items'}`

const labelSizes = new Map<string, number>()
let labelPen: CanvasRenderingContext2D | null | undefined
/** How wide a title is drawn, measured once in the bars' own type. */
function labelWidth(title: string) {
  let w = labelSizes.get(title)
  if (w !== undefined) return w
  if (labelPen === undefined) {
    labelPen = document.createElement('canvas').getContext('2d')
    if (labelPen) labelPen.font = `400 14px ${getComputedStyle(document.body).fontFamily}`
  }
  w = Math.min(
    NAME_MAX,
    (labelPen ? labelPen.measureText(title).width : title.length * 7) + NAME_EXTRA,
  )
  labelSizes.set(title, w)
  return w
}

/** Where a box that holds a name is, with its start for the name (--time-x, in context-time.css). */
const boxAt = (left: number, width: number) =>
  ({ left, width, '--time-x': `${left}px` }) as React.CSSProperties

/** The part of the content that is drawn: rows down to `yb`, time from `xa` to `xb`. */
type Win = { ya: number; yb: number; xa: number; xb: number; width: number; height: number }
const NO_WIN: Win = { ya: 0, yb: 0, xa: 0, xb: 0, width: 0, height: 0 }

function winAround(el: HTMLElement, gut: number): Win {
  const { scrollTop: st, scrollLeft: sl, clientWidth: vw, clientHeight: vh } = el
  return {
    ya: Math.max(0, st - vh * MARGIN),
    yb: st + vh * (1 + MARGIN),
    xa: Math.max(0, sl - (vw - gut) * MARGIN),
    xb: sl + (vw - gut) * (1 + MARGIN),
    width: vw,
    height: vh,
  }
}

/** Whether what is on screen is still inside what is drawn. */
const inside = (el: HTMLElement, w: Win, gut: number) =>
  el.clientWidth === w.width &&
  el.clientHeight === w.height &&
  el.scrollTop >= w.ya &&
  el.scrollTop + el.clientHeight <= w.yb &&
  el.scrollLeft >= w.xa &&
  el.scrollLeft + el.clientWidth - gut <= w.xb

/** How long the zoom moves, from the motion token: none when less motion is asked for. */
const zoomTime = () =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-3')) || 0

/** The fold of the groups: all start folded or open, and these are the other way round. */
type Fold = { by: GroupBy; all: boolean; except: ReadonlySet<string> }
/** Groups start folded when they hold many items; one group of everything never does. */
const startsFolded = (by: GroupBy, n: number) => by !== 'none' && n > FOLD_ABOVE

export function ContextTime({ facts, ready }: { facts: readonly Fact[]; ready: boolean }) {
  const domains = useDomains()
  const domainList = useDomainList()
  const { metrics, dimensions } = useVocabulary()
  const metricNames = React.useMemo(() => new Set(metrics.map((m) => m.name)), [metrics])
  const dock = useDock()
  const peeked = dock?.kind === 'context' ? dock.id : undefined

  const everyItem = React.useMemo(
    () =>
      timeItemsOf(facts, {
        today: today(),
        metrics: metricNames,
        ownersOf: (f) => ownersOf(f, domains),
        words: (f) =>
          wordsIn(
            `${f.title} ${plainText(f.summary)} ${f.where.join(' ')} ${domains[f.domain]?.name ?? ''} ${ownersOf(f, domains).join(' ')}`,
          ),
      }),
    [facts, metricNames, domains],
  )
  const items = React.useMemo(() => everyItem.filter((i) => !i.always), [everyItem])
  // The dimensions of the definitions, then any other an item names.
  const dims = React.useMemo(() => {
    const names = dimensions.map((d) => d.name)
    for (const item of items)
      for (const d of Object.keys(item.dims)) if (!names.includes(d)) names.push(d)
    return names
  }, [dimensions, items])

  const [text, setText] = React.useState('')
  const asked = React.useMemo(() => words(text), [text])
  const [filters, setFilters] = React.useState<Filters>({})
  const [groupBy, setGroupBy] = React.useState<GroupBy>('domain')
  const [fold, setFold] = React.useState<Fold>(() => ({
    by: 'domain',
    all: startsFolded('domain', items.length),
    except: new Set(),
  }))
  const [zoom, setZoom] = React.useState<Zoom>('quarters')
  // The zoom drawn now (it moves to the zoom chosen), and the one the lanes were packed at.
  const [ppd, setPpd] = React.useState(ZOOMS.quarters)
  const [packedAt, setPackedAt] = React.useState(ZOOMS.quarters)
  const [filterOpen, setFilterOpen] = React.useState(false)

  const shown = React.useMemo(
    () => items.filter((i) => passes(i, filters, asked)),
    [items, filters, asked],
  )
  const span = React.useMemo(() => spanOf(items, todayMs()), [items])
  const labelOf = React.useCallback(
    (field: FieldKey, v: string) =>
      field === 'state'
        ? STATE_LABEL[v as TimeState]
        : field === 'domain'
          ? (domains[v]?.name ?? v)
          : field === 'kind'
            ? kindLabel[v as Kind]
            : v !== NONE
              ? v
              : field === 'metric'
                ? 'No metric'
                : field === 'owner'
                  ? 'No owner'
                  : 'Every value',
    [domains],
  )
  const groups = React.useMemo(() => {
    const order =
      groupBy === 'domain'
        ? domainList.map((d) => d.id)
        : groupBy === 'kind'
          ? (KINDS as string[])
          : null
    return groupsOf(shown, groupBy, order ? (v) => order.indexOf(v) : undefined)
  }, [shown, groupBy, domainList])
  const folded = React.useMemo(
    () => new Set(groups.filter((g) => fold.all !== fold.except.has(g.key)).map((g) => g.key)),
    [groups, fold],
  )
  const layout = React.useMemo(
    () => timeLayout(groups, { span, ppd: packedAt, folded, labelWidth }),
    [groups, span, packedAt, folded],
  )

  // The order a side panel steps through: the bars as they read, each item once.
  const order = React.useMemo(() => {
    const seen = new Set<string>()
    for (const row of layout.rows)
      if (row.kind === 'lane') for (const b of row.bars) seen.add(b.item.id)
    return [...seen]
  }, [layout])
  usePublishOrder('context', order)
  // J and K step the open side panel along the bars, and the panel keeps the focus when the step
  // was made from inside it; the cursor follows to the bar below.
  useListKeys({
    order,
    current: peeked,
    docked: !!peeked,
    onMove: (id, from) =>
      peeked && openFromRow('context', id, undefined, { focus: from.panel, replace: true }),
  })

  /* ---------- the scroller, and what of it is drawn ---------- */

  const scroller = React.useRef<HTMLDivElement>(null)
  const [width, setWidth] = React.useState(0)
  const narrow = width > 0 && width < NARROW_BELOW
  const gut = narrow ? 0 : GUT
  const [win, setWin] = React.useState<Win>(NO_WIN)
  const redraw = React.useCallback(() => {
    const el = scroller.current
    if (el) setWin(winAround(el, gut))
  }, [gut])
  React.useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const watch = new ResizeObserver(() => {
      setWidth(el.clientWidth)
      setWin(winAround(el, el.clientWidth < NARROW_BELOW ? 0 : GUT))
    })
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    el.style.setProperty('--time-sl', `${el.scrollLeft}px`)
    if (!inside(el, win, gut)) setWin(winAround(el, gut))
    hideCard()
  }

  // The view opens on today, a little left of the middle, so what is coming shows too.
  const goToday = React.useCallback(
    (smooth: boolean) => {
      const el = scroller.current
      if (!el) return
      const left = xOf(todayMs(), span, ppd) - (el.clientWidth - gut) * 0.62
      el.scrollTo({ left, behavior: smooth && zoomTime() > 0 ? 'smooth' : 'auto' })
    },
    [span, ppd, gut],
  )
  const opened = React.useRef(false)
  React.useLayoutEffect(() => {
    if (opened.current || !ready || !width) return
    opened.current = true
    goToday(false)
    redraw()
    // The rows read before the page's own read may be fewer: fold by what it holds.
    setFold((f) => ({ ...f, all: startsFolded(f.by, items.length), except: new Set() }))
  }, [ready, width, goToday, redraw, items.length])

  /* ---------- zoom: the time under the middle of the screen stays put ---------- */

  const anchor = React.useRef<{ t: number; x: number } | null>(null)
  const moving = React.useRef(0)
  const zoomTo = (next: Zoom) => {
    const el = scroller.current
    setZoom(next)
    if (!el || ZOOMS[next] === ppd) return
    const x = (el.clientWidth - gut) / 2
    anchor.current = { t: timeAt(el.scrollLeft + x, span, ppd), x }
    cancelAnimationFrame(moving.current)
    const from = ppd
    const to = ZOOMS[next]
    const time = zoomTime()
    const started = performance.now()
    const step = (now: number) => {
      const k = time ? Math.min(1, (now - started) / time) : 1
      const eased = 1 - Math.pow(1 - k, 3)
      setPpd(Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * eased))
      if (k < 1) moving.current = requestAnimationFrame(step)
      else setPackedAt(to)
    }
    moving.current = requestAnimationFrame(step)
  }
  React.useEffect(() => () => cancelAnimationFrame(moving.current), [])
  React.useLayoutEffect(() => {
    const el = scroller.current
    const at = anchor.current
    if (!el || !at) return
    el.scrollLeft = xOf(at.t, span, ppd) - at.x
    setWin(winAround(el, gut))
    if (ppd === packedAt) anchor.current = null
  }, [ppd, packedAt, span, gut])

  /* ---------- folding ---------- */

  const isFolded = (key: string) => fold.all !== fold.except.has(key)
  const toggleGroup = (key: string, open?: boolean) =>
    setFold((f) => {
      const want = open ?? isFolded(key)
      const except = new Set(f.except)
      if (want === f.all) except.add(key)
      else except.delete(key)
      return { ...f, except }
    })
  const foldAll = (on: boolean) => setFold((f) => ({ ...f, all: on, except: new Set() }))
  const chooseGroup = (by: GroupBy) => {
    setGroupBy(by)
    setFold({ by, all: startsFolded(by, shown.length), except: new Set() })
    scroller.current?.scrollTo({ top: 0 })
  }

  /* ---------- the cursor: the bar or group the keys are on ---------- */

  const [cursor, setCursor] = React.useState<string>()
  const focusAsked = React.useRef(false)
  const findKey = (key: string) =>
    scroller.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`) ?? null
  /** Brings a bar or a group's line into view. */
  const reveal = (key: string) => {
    const el = scroller.current
    const at = layout.at.get(key)
    if (!el || !at) return
    const row = layout.rows[at.row]!
    const viewH = el.clientHeight - AXIS_H
    if (row.y < el.scrollTop) el.scrollTop = row.y - 8
    else if (row.y + row.h > el.scrollTop + viewH) el.scrollTop = row.y + row.h - viewH + 8
    if (row.kind === 'lane') {
      const bar = barOf(row.bars[at.index]!.item, span, ppd, labelWidth)
      const viewW = el.clientWidth - gut
      if (
        bar.x0 + Math.min(bar.ext - bar.x0, 200) < el.scrollLeft + 8 ||
        bar.x0 > el.scrollLeft + viewW - 80
      )
        el.scrollLeft = bar.x0 - Math.min(120, viewW / 4)
    }
    setWin(winAround(el, gut))
  }
  const goTo = (key: string) => {
    focusAsked.current = true
    setCursor(key)
    reveal(key)
  }
  React.useLayoutEffect(() => {
    if (!focusAsked.current || !cursor) return
    const el = findKey(cursor)
    if (!el) return
    focusAsked.current = false
    el.focus({ preventScroll: true })
  })

  // A step in the side panel (J and K, Previous and Next) moves the cursor to that bar, and when
  // the panel closes with nothing in focus, focus goes back to it.
  const [stepped, setStepped] = React.useState<string>()
  const [stepTo, setStepTo] = React.useState<{ key: string; focus: boolean }>()
  if (peeked !== stepped) {
    setStepped(peeked)
    const here = cursor?.split('\n')
    if (!peeked) {
      if (cursor && stepped) setStepTo({ key: cursor, focus: true })
    } else if (!(here?.[1] === peeked && layout.at.has(cursor!))) {
      const group = groups.find((g) => layout.at.has(barKey(g.key, peeked)))
      if (group) {
        setCursor(barKey(group.key, peeked))
        setStepTo({ key: barKey(group.key, peeked), focus: false })
      }
    }
  }
  React.useLayoutEffect(() => {
    if (!stepTo) return
    reveal(stepTo.key)
    const lost = !document.activeElement || document.activeElement === document.body
    if (stepTo.focus && lost) findKey(stepTo.key)?.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepTo])

  const targetsOf = (row: TimeLayout['rows'][number]) =>
    row.kind === 'group'
      ? [{ key: groupKey(row.group.key), x: -Infinity }]
      : row.bars.map((b) => ({ key: barKey(row.group.key, b.item.id), x: b.x0 * (ppd / packedAt) }))
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
    const at = cursor ? layout.at.get(cursor) : undefined
    const el = scroller.current
    if (!el) return
    const key = e.key
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape'].includes(key))
      return
    if (key === 'Escape') {
      if (!peeked) return
      e.preventDefault()
      closeDock()
      return
    }
    e.preventDefault()
    if (!at) {
      // The first place on screen.
      for (let i = rowAt(layout.rows, el.scrollTop); i < layout.rows.length; i++) {
        const first = targetsOf(layout.rows[i]!)[0]
        if (first) return goTo(first.key)
      }
      return
    }
    const row = layout.rows[at.row]!
    if (key === 'Enter') {
      if (row.kind === 'group') toggleGroup(row.group.key)
      else openFromRow('context', row.bars[at.index]!.item.id)
      return
    }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      if (row.kind === 'group') return toggleGroup(row.group.key, key === 'ArrowRight')
      const next = row.bars[at.index + (key === 'ArrowRight' ? 1 : -1)]
      if (next) goTo(barKey(row.group.key, next.item.id))
      return
    }
    const here = targetsOf(row)[at.index]!
    const from = here.x === -Infinity ? el.scrollLeft : here.x
    const step = key === 'ArrowDown' ? 1 : -1
    for (let r = at.row + step; r >= 0 && r < layout.rows.length; r += step) {
      const targets = targetsOf(layout.rows[r]!)
      if (!targets.length) continue
      // The nearest along the time line, and one on screen before one off it.
      const off = (x: number) =>
        x !== -Infinity && (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - gut) ? 1e7 : 0
      let best = targets[0]!
      for (const t of targets)
        if (
          Math.abs((t.x === -Infinity ? from : t.x) - from) + off(t.x) <
          Math.abs((best.x === -Infinity ? from : best.x) - from) + off(best.x)
        )
          best = t
      return goTo(best.key)
    }
  }

  // The page's own keys while nobody is typing: T today, 1 to 4 the zooms, - and = zoom out and
  // in, [ and ] fold and open every group, F the filters.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pageKey(e) || e.defaultPrevented) return
      const z = ZOOM_ORDER.indexOf(zoom)
      const pick =
        e.key === 't'
          ? () => goToday(true)
          : e.key >= '1' && e.key <= '4'
            ? () => zoomTo(ZOOM_ORDER[Number(e.key) - 1]!)
            : e.key === '-' && z < ZOOM_ORDER.length - 1
              ? () => zoomTo(ZOOM_ORDER[z + 1]!)
              : e.key === '=' && z > 0
                ? () => zoomTo(ZOOM_ORDER[z - 1]!)
                : e.key === '['
                  ? () => foldAll(true)
                  : e.key === ']'
                    ? () => foldAll(false)
                    : e.key === 'f'
                      ? () => setFilterOpen(true)
                      : null
      if (!pick) return
      e.preventDefault()
      pick()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------- the card over a bar ---------- */

  const [card, setCard] = React.useState<{ item: TimeItem; x: number; y: number } | null>(null)
  const cardWait = React.useRef(0)
  const cardOver = React.useRef<string>(undefined)
  const hideCard = () => {
    window.clearTimeout(cardWait.current)
    cardOver.current = undefined
    setCard(null)
  }
  // Armed on every move, not only on entering a bar: a scroll hides the card, and the next move over
  // the same bar brings it back.
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-item]')?.dataset.item
    if (id === cardOver.current) return
    hideCard()
    const item = id ? items.find((i) => i.id === id) : undefined
    if (!item) return
    cardOver.current = id
    const { clientX, clientY } = e
    cardWait.current = window.setTimeout(
      () => setCard({ item, x: clientX, y: clientY }),
      HOVER_WAIT,
    )
  }
  React.useEffect(() => () => window.clearTimeout(cardWait.current), [])

  /* ---------- filters ---------- */

  const fieldsOn = (Object.keys(filters) as FieldKey[]).filter((k) => filters[k]?.length)
  const setField = (field: FieldKey, values: string[]) =>
    setFilters((f) => {
      const next = { ...f }
      if (values.length) next[field] = values
      else delete next[field]
      return next
    })
  const clearAll = () => {
    setFilters({})
    setText('')
  }
  const fieldLabel = (field: FieldKey) =>
    isDim(field) ? field.slice(4) : FIELDS.find((f) => f.key === field)!.label

  /* ---------- drawing ---------- */

  const totalW = gut + xOf(span.t1, span, ppd) + 40
  const height = Math.max(layout.height, win.height - AXIS_H)
  const scale = ppd / packedAt
  const t0 = timeAt(win.xa, span, ppd)
  const t1 = timeAt(win.xb, span, ppd)
  const axis = React.useMemo(() => axisOf(span, ppd, t0, t1), [span, ppd, t0, t1])
  const todayX = gut + xOf(todayMs(), span, ppd)
  const keptRow = cursor ? layout.at.get(cursor)?.row : undefined
  const rows: number[] = []
  for (
    let i = rowAt(layout.rows, win.ya);
    i < layout.rows.length && layout.rows[i]!.y < win.yb;
    i++
  )
    rows.push(i)
  if (keptRow !== undefined && !rows.includes(keptRow)) rows.push(keptRow)
  const chosenId = peeked

  const groupIcon = (g: TimeGroup) =>
    groupBy === 'domain' ? (
      <DomainDot id={g.key} />
    ) : groupBy === 'owner' && g.key !== NONE ? (
      <PersonAvatar name={g.key} size={20} />
    ) : groupBy === 'kind' ? (
      React.createElement(kindIcons[g.key as Kind], {
        'aria-hidden': true,
        className: 'size-3.5 text-muted-foreground',
      })
    ) : groupBy === 'metric' ? (
      <SigmaIcon aria-hidden className="size-3.5 text-muted-foreground" />
    ) : groupBy === 'owner' ? (
      <UserIcon aria-hidden className="size-3.5 text-muted-foreground" />
    ) : groupBy === 'none' ? (
      <LayersIcon aria-hidden className="size-3.5 text-muted-foreground" />
    ) : (
      <SplitIcon aria-hidden className="size-3.5 text-muted-foreground" />
    )

  const drawBar = (g: TimeGroup, packed: Bar) => {
    const item = packed.item
    if (packed.x0 * scale > win.xb || packed.ext * scale < win.xa) {
      const key = barKey(g.key, item.id)
      if (key !== cursor) return null
    }
    const bar = scale === 1 ? packed : barOf(item, span, ppd, labelWidth)
    const key = barKey(g.key, item.id)
    const Icon = kindIcons[item.fact.kind]
    const open =
      item.start === null || item.start < span.t0
        ? item.end === null
          ? 'both'
          : 'start'
        : item.end === null
          ? 'end'
          : undefined
    const name = (
      <span className="time-name">
        <Icon aria-hidden />
        <span>
          <Highlight text={item.fact.title} query={text} />
        </span>
      </span>
    )
    const common = {
      'data-key': key,
      'data-item': item.id,
      'data-state': item.state,
      'data-chosen': chosenId === item.id || undefined,
      tabIndex: cursor === key ? 0 : -1,
      'aria-label': `${item.fact.title}. ${STATE_LABEL[item.state]}. ${item.fact.when}.`,
      onClick: () => {
        setCursor(key)
        hideCard()
        openFromRow('context', item.id)
      },
      onFocus: () => setCursor(key),
    }
    return bar.beside ? (
      <React.Fragment key={key}>
        <span
          aria-hidden
          className="time-bar"
          data-state={item.state}
          data-open={open}
          data-chosen={common['data-chosen']}
          style={{ left: gut + bar.x0, width: bar.w }}
        />
        <button
          type="button"
          {...common}
          className="time-beside"
          style={boxAt(gut + bar.x0 + bar.w + 2, bar.ext - bar.x0 - bar.w - 2)}
        >
          {name}
        </button>
      </React.Fragment>
    ) : (
      <button
        key={key}
        type="button"
        {...common}
        className="time-bar"
        data-open={open}
        style={boxAt(gut + bar.x0, bar.w)}
      >
        {name}
      </button>
    )
  }

  const filtersMenu = (
    <DropdownMenu open={filterOpen} onOpenChange={setFilterOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  className={cn(barButton, fieldsOn.length > 0 && 'bg-muted text-foreground')}
                />
              }
            />
          }
        >
          <ListFilterIcon />
          Filter
          {fieldsOn.length > 0 && <span className="tabular-nums">{fieldsOn.length}</span>}
        </TooltipTrigger>
        <TooltipContent>
          Filter <Kbd>F</Kbd>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-60">
        {filterOpen && (
          <FilterFields
            items={items}
            filters={filters}
            asked={asked}
            dims={dims}
            domainOrder={domainList.map((d) => d.id)}
            labelOf={labelOf}
            onChange={setField}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const groupMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className={cn(barButton, barGroup, groupBy !== 'none' && 'bg-muted text-foreground')}
          />
        }
      >
        <ListTreeIcon />
        {groupBy === 'none' ? 'Group' : fieldLabel(groupBy)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Group by</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={groupBy} onValueChange={(v) => chooseGroup(v as GroupBy)}>
            {FIELDS.filter((f) => f.group).map((f) => (
              <DropdownMenuRadioItem key={f.key} value={f.key} closeOnClick>
                {f.label}
              </DropdownMenuRadioItem>
            ))}
            {dims.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Dimensions from your definitions</DropdownMenuLabel>
                {dims.map((d) => (
                  <DropdownMenuRadioItem key={d} value={dimKey(d)} closeOnClick>
                    {d}
                  </DropdownMenuRadioItem>
                ))}
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuRadioItem value="none" closeOnClick>
              No grouping
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => foldAll(true)}>
            Fold every group
            <DropdownMenuShortcut>[</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => foldAll(false)}>
            Open every group
            <DropdownMenuShortcut>]</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const published = shown.filter((i) => i.state !== 'waiting').length
  const waiting = shown.length - published
  const t = todayMs()
  const applyToday = shown.filter(
    (i) =>
      i.state !== 'waiting' && (i.start === null || i.start <= t) && (i.end === null || i.end >= t),
  ).length
  const due = shown.filter((i) => i.state === 'due').length

  return (
    <div
      className="time-view @container/main flex min-h-0 flex-1 flex-col"
      data-narrow={narrow || undefined}
    >
      <ListBar>
        {filtersMenu}
        {groupMenu}
        <span
          aria-hidden
          className="mx-1 h-4 w-px bg-border @max-xl/main:mx-0 @max-xl/main:h-0 @max-xl/main:w-full"
        />
        {/* The view's keys live on its controls, as Filter and Today do: the shortcut sheet keeps to
            about thirty rows. */}
        <Tooltip>
          <TooltipTrigger render={<div />}>
            <TextSwitch
              label="Zoom"
              value={zoom}
              onChange={(z) => zoomTo(z)}
              options={ZOOM_ORDER.filter((z) => !narrow || z !== 'weeks').map((z) => ({
                value: z,
                label: ZOOM_LABEL[z],
              }))}
            />
          </TooltipTrigger>
          <TooltipContent>
            Zoom <Kbd>1</Kbd> to <Kbd>4</Kbd> or <Kbd>-</Kbd> and <Kbd>=</Kbd>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" className={barButton} onClick={() => goToday(true)} />}
          >
            <CalendarIcon />
            <span className="@max-3xl/main:sr-only">Today</span>
          </TooltipTrigger>
          <TooltipContent>
            Go to today <Kbd>T</Kbd>
          </TooltipContent>
        </Tooltip>
        <BarSpacer>
          <SearchField value={text} onChange={setText} placeholder="Search context" />
        </BarSpacer>
        <Count>
          {!ready ? null : shown.length === items.length ? (
            itemsWord(items.length)
          ) : (
            <>
              <span className="font-semibold text-foreground">{count(shown.length)}</span> of{' '}
              {itemsWord(items.length)}
            </>
          )}
        </Count>
      </ListBar>
      <FilterRow count={fieldsOn.length} onClear={() => setFilters({})}>
        {fieldsOn.map((field) => (
          <FilterChip
            key={field}
            field={fieldLabel(field)}
            values={filters[field]!.map((v) => labelOf(field, v))}
            onRemove={() => setField(field, [])}
          />
        ))}
      </FilterRow>
      {!ready ? (
        <div className="flex flex-col gap-2 p-4 md:p-6" aria-busy="true">
          <span role="status" aria-label="Loading" className="sr-only" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="p-4 md:p-6">
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarIcon />
              </EmptyMedia>
              {everyItem.length === 0 ? (
                <>
                  <EmptyTitle>Nothing published yet</EmptyTitle>
                  <EmptyDescription>
                    By time shows published context and what waits for review, along the days it
                    holds. Drafts show in the list.
                  </EmptyDescription>
                </>
              ) : (
                <>
                  <EmptyTitle>No item has dates to show</EmptyTitle>
                  <EmptyDescription>
                    By time draws items that start or end on a day. The list shows the items without
                    dates.
                  </EmptyDescription>
                </>
              )}
            </EmptyHeader>
          </Empty>
        </div>
      ) : (
        <div
          ref={scroller}
          className="time-scroller min-h-0 flex-1"
          role="region"
          aria-label="Items by time. Arrow keys move between them, Enter opens one."
          tabIndex={cursor && findKeyDrawn(rows, layout, cursor) ? -1 : 0}
          onScroll={onScroll}
          onKeyDown={onKeyDown}
          onPointerMove={onPointerMove}
          onPointerLeave={hideCard}
          onPointerDown={hideCard}
          onFocus={(e) => {
            if (e.target !== e.currentTarget || cursor) return
            const first = layout.rows[rowAt(layout.rows, e.currentTarget.scrollTop)]
            const target = first && targetsOf(first)[0]
            if (target) goTo(target.key)
          }}
        >
          <div className="relative" style={{ width: totalW, height: AXIS_H + height }}>
            <div className="time-axis" style={{ width: totalW }}>
              <div className="time-corner flex items-center justify-between gap-2 px-4 text-xs font-medium text-muted-foreground">
                <span>{groupBy === 'none' ? 'Context' : fieldLabel(groupBy)}</span>
                {groupBy !== 'none' && groups.length > 0 && (
                  <button
                    type="button"
                    className="rounded-sm outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                    onClick={() => foldAll(!groups.every((g) => folded.has(g.key)))}
                  >
                    {groups.every((g) => folded.has(g.key)) ? 'Open all' : 'Fold all'}
                  </button>
                )}
              </div>
              {axis.top.map((a) => (
                <div
                  key={`top${a.from}`}
                  className="time-tick-top"
                  style={{
                    left: gut + xOf(a.from, span, ppd),
                    width: xOf(a.to, span, ppd) - xOf(a.from, span, ppd),
                  }}
                >
                  <span>{a.label}</span>
                </div>
              ))}
              {axis.ticks.map((a) => (
                <div
                  key={`tick${a.from}`}
                  className="time-tick"
                  style={{
                    left: gut + xOf(a.from, span, ppd),
                    width: xOf(a.to, span, ppd) - xOf(a.from, span, ppd),
                  }}
                >
                  <span>{a.label}</span>
                </div>
              ))}
              <span className="time-today-label" style={{ left: todayX }}>
                Today
              </span>
            </div>
            <div className="time-body" style={{ height }}>
              <div className="time-future" style={{ left: todayX, width: totalW - todayX }} />
              {axis.lines.map((l) => (
                <div
                  key={`${l.strong ? 's' : 'l'}${l.t}`}
                  className="time-line"
                  data-strong={l.strong || undefined}
                  style={{
                    left: gut + xOf(l.t, span, ppd),
                    top: Math.max(0, win.ya - AXIS_H),
                    height: Math.min(height, win.yb) - Math.max(0, win.ya - AXIS_H),
                  }}
                />
              ))}
              <div className="time-today" style={{ left: todayX, height }} />
              <div className="time-gut-fill absolute top-0" style={{ height }} />
              {layout.rows.length === 0 && (
                <div
                  className="sticky left-0 px-6 py-10 text-center text-sm"
                  style={{ width: Math.min(totalW, win.width) }}
                >
                  <p className="font-medium">No context matches</p>
                  <p className="mt-1 text-muted-foreground">
                    {[
                      text.trim() && `Searching for “${text.trim()}”`,
                      ...fieldsOn.map(
                        (f) =>
                          `${fieldLabel(f)} is ${filters[f]!.map((v) => labelOf(f, v)).join(' or ')}`,
                      ),
                    ]
                      .filter(Boolean)
                      .join(', ')}
                    .
                  </p>
                  <Button variant="outline" className="mt-3" onClick={clearAll}>
                    Clear search and filters
                  </Button>
                </div>
              )}
              {rows.map((i) => {
                const row = layout.rows[i]!
                const g = row.group
                if (row.kind === 'group') {
                  const n = g.timed.length
                  return (
                    <div
                      key={groupKey(g.key)}
                      className="time-row time-group"
                      style={{ top: row.y, height: row.h, width: totalW }}
                    >
                      <button
                        type="button"
                        data-key={groupKey(g.key)}
                        tabIndex={cursor === groupKey(g.key) ? 0 : -1}
                        aria-expanded={row.open}
                        className="time-group-name gap-2 pr-4 text-left text-sm font-medium"
                        onFocus={() => setCursor(groupKey(g.key))}
                        onClick={(e) => {
                          setCursor(groupKey(g.key))
                          if (e.altKey) foldAll(row.open)
                          else toggleGroup(g.key)
                        }}
                      >
                        <ChevronRightIcon
                          aria-hidden
                          className="time-chevron size-3.5 text-muted-foreground"
                        />
                        {groupIcon(g)}
                        <span className="min-w-0 flex-1 truncate">
                          {groupBy === 'none' ? 'All context' : labelOf(groupBy, g.key)}
                        </span>
                        <span className="text-xs font-normal text-muted-foreground tabular-nums">
                          {count(n)}
                        </span>
                      </button>
                    </div>
                  )
                }
                return (
                  <div
                    key={`${groupKey(g.key)}\n${row.y}`}
                    className="time-row"
                    style={{ top: row.y, height: row.h, width: totalW }}
                  >
                    <div className="time-lane-gut" />
                    {row.bars.map((b) => drawBar(g, b))}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
      {ready && items.length > 0 && (
        <div className="flex h-bar shrink-0 items-center gap-6 px-4 text-xs whitespace-nowrap text-muted-foreground tabular-nums shadow-hairline-top md:px-6">
          <span>
            {count(published)} published
            {waiting > 0 && `, ${count(waiting)} not published yet`}
          </span>
          <span className="max-sm:hidden">{count(applyToday)} apply today</span>
          <span>{count(due)} needing a recheck</span>
        </div>
      )}
      {card && <TimeCard {...card} labelOf={labelOf} />}
    </div>
  )
}

/** Whether the cursor's element is among the rows drawn, so the region gives Tab to it. */
function findKeyDrawn(rows: number[], layout: TimeLayout, key: string) {
  const at = layout.at.get(key)
  return !!at && rows.includes(at.row)
}

/** The filter menu's fields, each a list of its values with what each would show. */
function FilterFields({
  items,
  filters,
  asked,
  dims,
  domainOrder,
  labelOf,
  onChange,
}: {
  items: readonly TimeItem[]
  filters: Filters
  asked: readonly string[]
  dims: readonly string[]
  domainOrder: readonly string[]
  labelOf: (field: FieldKey, v: string) => string
  onChange: (field: FieldKey, values: string[]) => void
}) {
  const field = (key: FieldKey, label: string, icon: React.ReactNode) => {
    const chosen = filters[key] ?? []
    const counts = countsOf(items, filters, asked, key)
    // Every value an item has, and those chosen: fixed fields in their own order, the rest A to Z
    // with "every" or "no" first.
    const known = new Set<string>(chosen)
    for (const item of items)
      for (const v of key === 'state' || key === 'kind' || key === 'domain'
        ? []
        : valuesOf(item, key))
        known.add(v)
    const values =
      key === 'state'
        ? (TIME_STATES as string[])
        : key === 'kind'
          ? (KINDS as string[])
          : key === 'domain'
            ? [...domainOrder]
            : [...known].sort((a, b) => (a === NONE ? -1 : b === NONE ? 1 : a.localeCompare(b)))
    return (
      <DropdownMenuSub key={key}>
        <DropdownMenuSubTrigger>
          {icon}
          <span className="flex-1">{label}</span>
          {chosen.length > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">{chosen.length} on</span>
          )}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{label}</DropdownMenuLabel>
            {values.map((v) => (
              <DropdownMenuCheckboxItem
                key={v}
                checked={chosen.includes(v)}
                onCheckedChange={(on) =>
                  onChange(key, on ? [...chosen, v] : chosen.filter((x) => x !== v))
                }
              >
                <FilterValue count={counts.get(v) ?? 0}>
                  <span className="flex min-w-0 items-center gap-2">
                    {key === 'state' && <span aria-hidden className="time-swatch" data-state={v} />}
                    {key === 'domain' && <DomainDot id={v} />}
                    <span className="truncate">{labelOf(key, v)}</span>
                  </span>
                </FilterValue>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
          {key === 'state' && (
            <>
              <DropdownMenuSeparator />
              <p className="max-w-56 px-1.5 py-1 text-xs text-muted-foreground">
                Not published yet means sent for review: you can see it, agents don’t get it yet.
              </p>
            </>
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    )
  }
  const icon = { className: 'text-muted-foreground', 'aria-hidden': true } as const
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel>Filter by</DropdownMenuLabel>
        {field('state', 'State', <CircleDashedIcon {...icon} />)}
        {field('domain', 'Domain', <LayersIcon {...icon} />)}
        {field('owner', 'Owner', <UserIcon {...icon} />)}
        {field('kind', 'Kind', <ShapesIcon {...icon} />)}
        {field('metric', 'Metric', <SigmaIcon {...icon} />)}
      </DropdownMenuGroup>
      {dims.length > 0 && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Dimensions from your definitions</DropdownMenuLabel>
            {dims.map((d) => field(dimKey(d), d, <SplitIcon {...icon} />))}
          </DropdownMenuGroup>
        </>
      )}
    </>
  )
}

/** The card over a bar: its title, state, days, what it applies to and who answers for it. */
function TimeCard({
  item,
  x,
  y,
  labelOf,
}: {
  item: TimeItem
  x: number
  y: number
  labelOf: (field: FieldKey, v: string) => string
}) {
  const Icon = STATE_ICON[item.state]
  const left = Math.min(x + 14, window.innerWidth - 300)
  const top = y + 18 + 160 > window.innerHeight ? y - 170 : y + 18
  return (
    <div
      aria-hidden
      className="time-card z-overlay flex flex-col gap-1.5 rounded-md bg-popover p-3 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10"
      style={{ left, top }}
    >
      <p className="text-sm font-medium">{item.fact.title}</p>
      <p className="flex items-center gap-1.5">
        <Icon
          aria-hidden
          className={cn(
            'size-3.5',
            item.state === 'due' ? 'text-caution' : 'text-muted-foreground',
          )}
        />
        {STATE_LABEL[item.state]}
      </p>
      <p className="flex items-center gap-1.5">
        <CalendarIcon aria-hidden className="size-3.5 text-muted-foreground" />
        {item.fact.when}
      </p>
      {item.fact.where.length > 0 && (
        <p className="flex items-center gap-1.5">
          <SigmaIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{item.fact.where.join(', ')}</span>
        </p>
      )}
      <p className="flex items-center gap-1.5">
        <UserIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">
          {[item.owners.join(', '), labelOf('domain', item.fact.domain)].filter(Boolean).join(', ')}
        </span>
      </p>
    </div>
  )
}
