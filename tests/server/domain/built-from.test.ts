import { describe, expect, it } from 'vitest'
import { answer, type AnswerSource } from '../../../src/domain/answer.ts'
import {
  builtFromPart,
  builtFromSaid,
  type BuiltFromBundle,
} from '../../../src/domain/built-from.ts'
import type { ResolvedScope } from '../../../src/domain/scope.ts'
import type { Term } from '../../../src/domain/vocabulary.ts'

/*
  The built-from lab's part of an answer (src/domain/built-from.ts), on the invented cases of the
  metric trees research: what is published about the metrics an asked one is built from, for the
  same dates and place, apart from the answer, which stays as it is.
*/

const metric = (id: string, name: string): Term => ({
  key: `metric:${id}`,
  kind: 'metric',
  name,
  aliases: [],
  parentKey: null,
  areaId: 'sales',
  definitionRefs: [`cube:shop.${id}`],
})
const market = (id: string, name: string): Term => ({
  key: `val:market/${id}`,
  kind: 'dimension_value',
  name,
  aliases: [],
  parentKey: 'dim:market',
  areaId: null,
  definitionRefs: [],
})
const terms: Term[] = [
  metric('return_on_ad_spend', 'Return on ad spend'),
  metric('marketing_spend', 'Marketing spend'),
  metric('net_revenue', 'Net revenue'),
  metric('gross_margin', 'Gross margin'),
  metric('gross_sales', 'Gross sales'),
  metric('orders', 'Orders'),
  metric('on_time_shipping_rate', 'On-time shipping rate'),
  {
    key: 'dim:market',
    kind: 'dimension',
    name: 'Market',
    aliases: [],
    parentKey: null,
    areaId: null,
    definitionRefs: [],
  },
  market('norway', 'Norway'),
  market('spain', 'Spain'),
]

let n = 0
const item = (
  title: string,
  metrics: string[],
  place: string | null,
  start: string,
  end: string | null,
  kind: AnswerSource['kind'] = 'event',
): AnswerSource => ({
  id: `itm_tree000${++n}`,
  version: 1,
  areaId: 'sales',
  kind,
  title,
  summary: `${title}.`,
  scope: {
    metrics,
    dimensions: [],
    dimensionValues: place ? [{ dimension: 'dim:market', value: `val:market/${place}` }] : [],
  },
  validity: { start, end },
  reviewDate: '2027-01-01',
  riskLevel: 'normal',
  checkFlag: null,
  status: 'accepted',
  audience: { kind: 'everyone' },
  conflicts: [],
  proposerId: 'p',
})
const counted = item(
  'Marketing spend counted twice in Norway, 3 to 9 March',
  ['metric:marketing_spend'],
  'norway',
  '2026-03-03',
  '2026-03-10',
  'issue',
)
const outlet = item(
  'Net revenue and gross margin leave out the outlet store in Spain from June',
  ['metric:net_revenue', 'metric:gross_margin'],
  'spain',
  '2026-06-01',
  null,
  'note',
)
const strike = item(
  'Carrier strike delayed deliveries in Norway, 16 to 27 March',
  ['metric:on_time_shipping_rate'],
  'norway',
  '2026-03-16',
  '2026-03-28',
)
const ended = item(
  'Marketing spend booked twice in Norway in January',
  ['metric:marketing_spend'],
  'norway',
  '2026-01-01',
  '2026-02-01',
  'issue',
)
const spain = item(
  'Marketing spend counted twice in Spain in March',
  ['metric:marketing_spend'],
  'spain',
  '2026-03-01',
  '2026-04-01',
  'issue',
)
const hidden = {
  ...item('Net revenue for the board only', ['metric:net_revenue'], 'norway', '2026-03-01', null),
  audience: { kind: 'groups' as const, groups: ['board'] },
}

const library: AnswerSource[] = [counted, outlet, strike, ended, spain, hidden]
const bundle: BuiltFromBundle & Parameters<typeof answer>[0] = {
  edition: 'lab',
  overlay: 'lab',
  items: library,
  terms,
  groupsOfMetric: {},
  metricArea: {},
  stopped: { all: false, areas: [], items: [] },
  // What the semantic layer says each is built from: names only.
  builtFrom: {
    'metric:return_on_ad_spend': ['metric:marketing_spend', 'metric:net_revenue'],
    'metric:gross_margin': ['metric:net_revenue'],
    'metric:net_revenue': ['metric:gross_sales'],
  },
}
const today = '2026-07-01'
const scope = (metric: string, place: string, start: string, end: string): ResolvedScope => ({
  metrics: [`metric:${metric}`],
  filters: { 'dim:market': [`val:market/${place}`] },
  window: { start, end },
})
const everyone = () => true
const partOf = (asked: ResolvedScope, shown: (key: string) => boolean = everyone) => {
  const given = answer(bundle, { scope: asked }, { today })
  return {
    given,
    part: builtFromPart(bundle, asked, new Set(given.items.map((i) => i.id)), today, shown),
  }
}
const titles = (part: ReturnType<typeof builtFromPart>) =>
  part?.items.map((i) => library.find((x) => x.id === i.match.id)!.title) ?? []
const nameOf = (key: string) => terms.find((t) => t.key === key)?.name ?? key

describe('the built-from part of an answer', () => {
  it('tells the note on a metric the asked one is built from, and leaves the answer Not found', () => {
    const { given, part } = partOf(
      scope('return_on_ad_spend', 'norway', '2026-03-01', '2026-04-01'),
    )
    expect(given.state).toBe('missing')
    expect(given.say).toMatch(/^Nothing is written down for Return on ad spend in Norway/)
    expect(part?.metrics).toEqual([
      {
        metric: 'metric:return_on_ad_spend',
        from: ['metric:marketing_spend', 'metric:net_revenue'],
      },
    ])
    // Not the note that ended in February, the one about Spain, nor one for another group.
    expect(titles(part)).toEqual(['Marketing spend counted twice in Norway, 3 to 9 March'])
    expect(part?.items[0]?.on).toEqual(['metric:marketing_spend'])
  })

  it('reads one step down only', () => {
    // Gross margin is built from net revenue, net revenue from gross sales: nothing on either.
    const { part } = partOf(scope('gross_margin', 'norway', '2026-03-01', '2026-04-01'))
    expect(part?.metrics).toEqual([{ metric: 'metric:gross_margin', from: ['metric:net_revenue'] }])
    expect(part?.items).toEqual([])
  })

  it('tells an item on both metrics once, in the answer', () => {
    const { given, part } = partOf(scope('gross_margin', 'spain', '2026-06-01', '2026-07-01'))
    expect(given.items.map((i) => i.title)).toEqual([outlet.title])
    expect(part?.items).toEqual([])
  })

  it('is none for a metric built from nothing, and adds no cause no definition holds', () => {
    expect(partOf(scope('gross_sales', 'norway', '2026-03-01', '2026-04-01')).part).toBeNull()
    // A strike on deliveries may move orders, but no definition says so.
    expect(partOf(scope('orders', 'norway', '2026-03-01', '2026-04-01')).part).toBeNull()
  })

  it('names no metric the reader may not see, and none that was asked too', () => {
    const asked = scope('return_on_ad_spend', 'norway', '2026-03-01', '2026-04-01')
    expect(partOf(asked, (key) => key !== 'metric:marketing_spend').part).toBeNull()
    const both = { ...asked, metrics: ['metric:return_on_ad_spend', 'metric:marketing_spend'] }
    expect(partOf(both).part?.metrics).toEqual([
      { metric: 'metric:return_on_ad_spend', from: ['metric:net_revenue'] },
    ])
  })

  it('says what each is built from, how many items apply to those, and that they prove no cause', () => {
    const tool = () => 'Cube'
    const one = partOf(scope('return_on_ad_spend', 'norway', '2026-03-01', '2026-04-01')).part!
    expect(builtFromSaid(one, nameOf, tool)).toBe(
      'Return on ad spend is built from Marketing spend and Net revenue, as Cube says. 1 published item applies to those for the same dates and place. It is not about Return on ad spend itself and proves no cause.',
    )
    const none = partOf(scope('gross_margin', 'norway', '2026-03-01', '2026-04-01')).part!
    expect(builtFromSaid(none, nameOf, () => null)).toBe(
      'Gross margin is built from Net revenue, as its definition says. Nothing published applies to those for the same dates and place.',
    )
  })
})
