import { describe, expect, it } from 'vitest'
import { withWhen, type Fact, type StoredFact } from '@/model/items'
import { wordsIn } from '@/lib/list'
import {
  axisOf,
  barKey,
  barOf,
  countsOf,
  DAY,
  dimKey,
  groupKey,
  groupsOf,
  lanesOf,
  MIN_BAR,
  NONE,
  passes,
  rowAt,
  spanOf,
  timeItemsOf,
  timeLayout,
  timeStateOf,
  valuesOf,
  ZOOMS,
  type TimeItem,
} from '@/lib/time-layout'

const today = '2026-11-25'
const fact = (patch: Partial<StoredFact> & { id: string }): Fact =>
  withWhen({
    title: `Item ${patch.id}`,
    summary: '',
    domain: 'sales',
    kind: 'event',
    where: [],
    valid: {},
    status: 'Live',
    checkedBy: 'Jon Abara',
    checkedOn: '1 Nov 2026',
    source: '',
    quote: '',
    dontConclude: '',
    ...patch,
  })

const metrics = new Set(['Orders', 'Returns'])
const items = (facts: Fact[]) =>
  timeItemsOf(facts, {
    today,
    metrics,
    ownersOf: (f) => f.owners ?? (f.domain === 'sales' ? ['Maria Lund'] : ['Tomas Eriksen']),
    words: (f) => wordsIn(`${f.title} ${f.where.join(' ')}`),
  })
const one = (patch: Partial<StoredFact> & { id: string }) => items([fact(patch)])[0]!
/** Every title as wide as ten pixels a letter. */
const labelWidth = (title: string) => title.length * 10
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`)

describe('what an item draws as', () => {
  it('says its state from its status and its last day', () => {
    const state = (patch: Partial<StoredFact>) => timeStateOf(fact({ id: 'a', ...patch }), today)
    expect(state({ status: 'Live' })).toBe('checked')
    expect(state({ status: 'Needs a recheck' })).toBe('due')
    expect(state({ status: 'Waiting' })).toBe('waiting')
    // Ended wins over due: its time is over, whatever its check.
    expect(state({ status: 'Needs a recheck', valid: { until: '2026-11-24' } })).toBe('ended')
    expect(state({ status: 'Live', valid: { until: today } })).toBe('checked')
    // A draft only its writer sees, and an archived item agents no longer get, are left out.
    expect(state({ status: 'Draft' })).toBeNull()
    expect(state({ status: 'Archived' })).toBeNull()
  })

  it('reads its days, and an item with neither end as always', () => {
    const open = one({ id: 'a', valid: { from: '2026-08-04', ongoing: true } })
    expect(open).toMatchObject({ start: utc('2026-08-04'), end: null, always: false })
    const closed = one({ id: 'b', valid: { from: '2026-05-12', until: '2026-05-19' } })
    expect(closed).toMatchObject({ start: utc('2026-05-12'), end: utc('2026-05-19') })
    expect(one({ id: 'c', valid: {} }).always).toBe(true)
    expect(one({ id: 'd', valid: { ongoing: true } }).always).toBe(true)
    expect(items([fact({ id: 'e', status: 'Draft' })])).toEqual([])
  })

  it('tells its metrics from its values, and keeps each value under its dimension', () => {
    const item = one({
      id: 'a',
      where: ['Orders', 'Norway', 'Online'],
      values: [
        { dimension: 'Market', name: 'Norway' },
        { dimension: 'Channel', name: 'Online' },
      ],
    })
    expect(item.metrics).toEqual(['Orders'])
    expect(valuesOf(item, dimKey('Market'))).toEqual(['Norway'])
    expect(valuesOf(item, dimKey('Channel'))).toEqual(['Online'])
    // A dimension it names no value of holds it for every value: Every value.
    expect(valuesOf(item, dimKey('Product'))).toEqual([NONE])
    expect(valuesOf(one({ id: 'b' }), 'metric')).toEqual([NONE])
    expect(valuesOf(item, 'owner')).toEqual(['Maria Lund'])
  })
})

describe('filters', () => {
  const all = items([
    fact({
      id: 'orders-online',
      where: ['Orders', 'Online'],
      values: [{ dimension: 'Channel', name: 'Online' }],
    }),
    fact({
      id: 'returns-online',
      where: ['Returns', 'Online'],
      values: [{ dimension: 'Channel', name: 'Online' }],
    }),
    fact({
      id: 'returns-store',
      where: ['Returns', 'Store'],
      values: [{ dimension: 'Channel', name: 'Store' }],
    }),
    fact({ id: 'orders-due', where: ['Orders'], status: 'Needs a recheck' }),
  ])
  const ids = (filters: Parameters<typeof passes>[1], asked: string[] = []) =>
    all.filter((i) => passes(i, filters, asked)).map((i) => i.id)

  it('match any value inside a field and every field together', () => {
    expect(ids({ metric: ['Orders', 'Returns'] })).toEqual([
      'orders-online',
      'returns-online',
      'returns-store',
      'orders-due',
    ])
    expect(ids({ metric: ['Orders', 'Returns'], [dimKey('Channel')]: ['Online'] })).toEqual([
      'orders-online',
      'returns-online',
    ])
    expect(ids({ state: ['due'] })).toEqual(['orders-due'])
    expect(ids({ [dimKey('Channel')]: [NONE] })).toEqual(['orders-due'])
    expect(ids({ metric: [] })).toHaveLength(4)
  })

  it('take the search words as the list does: each starts a word', () => {
    expect(ids({}, ['ret', 'onl'])).toEqual(['returns-online'])
    expect(ids({ metric: ['Orders'] }, ['returns'])).toEqual([])
  })

  it('count each value without the field’s own filter, so the others stay in sight', () => {
    const counts = countsOf(
      all,
      { metric: ['Orders'], [dimKey('Channel')]: ['Online'] },
      [],
      'metric',
    )
    expect(Object.fromEntries(counts)).toEqual({ Orders: 1, Returns: 1 })
    const channels = countsOf(all, { metric: ['Orders'] }, [], dimKey('Channel'))
    expect(Object.fromEntries(channels)).toEqual({ Online: 1, [NONE]: 1 })
  })
})

describe('groups', () => {
  const all = items([
    fact({ id: 'a', values: [{ dimension: 'Market', name: 'Spain' }] }),
    fact({
      id: 'b',
      values: [
        { dimension: 'Market', name: 'Norway' },
        { dimension: 'Market', name: 'Spain' },
      ],
    }),
    fact({ id: 'c' }),
    fact({ id: 'd', valid: {}, domain: 'marketing' }),
  ])

  it('draw an item in each value it names, with Every value first', () => {
    const groups = groupsOf(all, dimKey('Market'))
    expect(groups.map((g) => [g.key, g.timed.map((i) => i.id), g.always.map((i) => i.id)])).toEqual(
      [
        [NONE, [], ['c', 'd']],
        ['Norway', [], ['b']],
        ['Spain', [], ['a', 'b']],
      ],
    )
  })

  it('keep a field’s own order, and put No metric last', () => {
    const byDomain = groupsOf(all, 'domain', (d) => ['marketing', 'sales'].indexOf(d))
    expect(byDomain.map((g) => g.key)).toEqual(['marketing', 'sales'])
    const withMetric = items([fact({ id: 'x', where: ['Returns'] }), fact({ id: 'y' })])
    expect(groupsOf(withMetric, 'metric').map((g) => g.key)).toEqual(['Returns', NONE])
    expect(groupsOf(all, 'none').map((g) => [g.key, g.always.length])).toEqual([['all', 4]])
  })
})

describe('bars and lanes', () => {
  const span = { t0: utc('2026-01-01'), t1: utc('2027-01-01') }
  const ppd = ZOOMS.months

  it('end where the item ends, and run to the edge of the span on an open side', () => {
    const closed = barOf(
      one({ id: 'a', title: 'Sale', valid: { from: '2026-01-11', until: '2026-01-20' } }),
      span,
      ppd,
      labelWidth,
    )
    expect(closed).toMatchObject({ x0: 10 * ppd, w: 10 * ppd, beside: false })
    const open = barOf(one({ id: 'b', valid: { from: '2026-12-01' } }), span, ppd, labelWidth)
    expect(open.x0 + open.w).toBe(365 * ppd)
    const before = barOf(one({ id: 'c', valid: { until: '2026-01-01' } }), span, ppd, labelWidth)
    expect(before).toMatchObject({ x0: 0, w: ppd })
  })

  it('put a short bar’s name beside it, and never draw a bar thinner than it can be pressed', () => {
    const short = barOf(
      one({ id: 'a', title: 'Payment outage', valid: { from: '2026-03-02', until: '2026-03-02' } }),
      span,
      ZOOMS.years,
      labelWidth,
    )
    expect(short.w).toBe(MIN_BAR)
    expect(short.beside).toBe(true)
    expect(short.ext).toBeGreaterThan(short.x0 + short.w + 'Payment outage'.length * 10)
  })

  it('share a lane wherever two bars and their names do not overlap', () => {
    const bar = (id: string, from: string, until: string) =>
      barOf(one({ id, title: 'A', valid: { from, until } }), span, ppd, labelWidth)
    const lanes = lanesOf([
      bar('a', '2026-01-01', '2026-02-01'),
      bar('b', '2026-01-15', '2026-03-01'),
      bar('c', '2026-03-01', '2026-04-01'),
      bar('d', '2026-02-10', '2026-02-20'),
    ])
    expect(lanes.map((l) => l.map((b) => b.item.id))).toEqual([['a', 'd', 'c'], ['b']])
    for (const lane of lanes)
      for (let i = 1; i < lane.length; i++)
        expect(lane[i]!.x0).toBeGreaterThanOrEqual(lane[i - 1]!.ext + 8)
  })
})

describe('the layout', () => {
  const span = { t0: utc('2026-01-01'), t1: utc('2027-01-01') }
  const all = items(
    Array.from({ length: 6 }, (_, i) =>
      fact({
        id: `i${i}`,
        domain: i % 2 ? 'sales' : 'marketing',
        valid: { from: '2026-02-01', until: '2026-03-01' },
      }),
    ),
  )
  const groups = groupsOf(all, 'domain')

  it('stacks each group’s line and, when it is open, its lanes', () => {
    const layout = timeLayout(groups, { span, ppd: ZOOMS.months, folded: new Set(), labelWidth })
    expect(layout.rows.map((r) => r.kind)).toEqual([
      'group',
      'lane',
      'lane',
      'lane',
      'group',
      'lane',
      'lane',
      'lane',
    ])
    expect(layout.rows.map((r) => r.y)).toEqual([0, 36, 68, 100, 132, 168, 200, 232])
    expect(layout.at.get(groupKey('sales'))).toEqual({ row: 4, index: 0 })
    expect(layout.at.get(barKey('sales', 'i1'))).toEqual({ row: 5, index: 0 })
  })

  it('folds a group to its line', () => {
    const layout = timeLayout(groups, {
      span,
      ppd: ZOOMS.months,
      folded: new Set(['marketing']),
      labelWidth,
    })
    expect(layout.rows.map((r) => r.kind)).toEqual(['group', 'group', 'lane', 'lane', 'lane'])
    expect(layout.at.has(barKey('marketing', 'i0'))).toBe(false)
    expect(rowAt(layout.rows, 0)).toBe(0)
    expect(rowAt(layout.rows, 36)).toBe(1)
    expect(rowAt(layout.rows, 80)).toBe(2)
    expect(rowAt(layout.rows, 10_000)).toBe(layout.rows.length)
  })

  it('reaches at least two years back and one ahead, in whole years', () => {
    const s = spanOf(all, utc(today))
    expect([new Date(s.t0).toISOString(), new Date(s.t1).toISOString()]).toEqual([
      '2024-01-01T00:00:00.000Z',
      '2028-01-01T00:00:00.000Z',
    ])
    const old = spanOf(items([fact({ id: 'x', valid: { from: '2019-06-01' } })]), utc(today))
    expect(new Date(old.t0).getUTCFullYear()).toBe(2019)
  })

  it('lays out 5,000 items over 40 groups quickly', () => {
    const many: TimeItem[] = items(
      Array.from({ length: 5000 }, (_, i) => {
        const from = utc('2024-02-01') + ((i * 7919) % 1000) * DAY
        const days = (i * 31) % 90
        return fact({
          id: `m${i}`,
          title: `Something that held in market ${i % 40} for a while`,
          values: [{ dimension: 'Market', name: `Market ${i % 40}` }],
          valid: {
            from: new Date(from).toISOString().slice(0, 10),
            ...(i % 3 ? { until: new Date(from + days * DAY).toISOString().slice(0, 10) } : {}),
          },
        })
      }),
    )
    const started = performance.now()
    const layout = timeLayout(groupsOf(many, dimKey('Market')), {
      span: spanOf(many, utc(today)),
      ppd: ZOOMS.quarters,
      folded: new Set(),
      labelWidth: (t) => t.length * 7,
    })
    const took = performance.now() - started
    expect(layout.rows.filter((r) => r.kind === 'group')).toHaveLength(40)
    expect(layout.rows.length).toBeLessThan(5000)
    expect(took).toBeLessThan(500)
  })
})

describe('the axis', () => {
  const span = { t0: utc('2026-01-01'), t1: utc('2027-01-01') }

  it('says months over weeks at Months, and years over quarters at Years', () => {
    const months = axisOf(span, ZOOMS.months, utc('2026-03-01'), utc('2026-03-20'))
    expect(months.top.map((t) => t.label)).toEqual(['March 2026'])
    expect(months.ticks.map((t) => t.label)).toEqual(['23', '2', '9', '16'])
    const years = axisOf(span, ZOOMS.years, utc('2026-01-01'), utc('2027-01-01'))
    expect(years.top.map((t) => t.label)).toEqual(['2026'])
    expect(years.ticks.map((t) => t.label)).toEqual(['Q1', 'Q2', 'Q3', 'Q4'])
    // The span's first week started in December: its tick is cut at the span's first day.
    const first = axisOf(span, ZOOMS.months, span.t0, utc('2026-01-10'))
    expect(first.ticks.map((t) => [t.label, t.from])).toEqual([
      ['1', span.t0],
      ['5', utc('2026-01-05')],
    ])
  })

  it('says years over months at Quarters, and months over days at Weeks', () => {
    const quarters = axisOf(span, ZOOMS.quarters, utc('2026-01-01'), utc('2026-03-01'))
    expect(quarters.ticks.map((t) => t.label)).toEqual(['Jan', 'Feb'])
    const weeks = axisOf(span, ZOOMS.weeks, utc('2026-05-30'), utc('2026-06-02'))
    expect(weeks.top.map((t) => t.label)).toEqual(['May 2026', 'June 2026'])
    expect(weeks.ticks.map((t) => t.label)).toEqual(['30', '31', '1'])
  })
})
