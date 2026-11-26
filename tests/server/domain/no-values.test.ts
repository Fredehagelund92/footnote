import { describe, expect, it } from 'vitest'
import {
  answer,
  type AnswerAsk,
  type AnswerBundle,
  type AnswerSource,
} from '../../../src/domain/answer.ts'
import { unkeptSay } from '../../../src/domain/say.ts'
import { extractScope } from '../../../src/domain/scope.ts'
import type { Term } from '../../../src/domain/vocabulary.ts'

/*
  A workspace with no dimension values, as every real install is until people add some: an agent's
  typed filter on such a dimension is read for every value and the reply says so, where before it
  was refused with nothing to choose from (V0, values without figures).
*/
const orders: Term = {
  key: 'metric:orders',
  kind: 'metric',
  name: 'Orders',
  aliases: [],
  parentKey: null,
  areaId: 'sales',
  definitionRefs: ['cube:orders.count'],
}
const market: Term = {
  key: 'dim:market',
  kind: 'dimension',
  name: 'Market',
  aliases: [],
  parentKey: null,
  areaId: null,
  definitionRefs: ['cube:orders.market'],
}
const norway: Term = {
  key: 'val:market/norway',
  kind: 'dimension_value',
  name: 'Norway',
  aliases: ['Norge'],
  parentKey: 'dim:market',
  areaId: null,
  definitionRefs: [],
}
const noValues = [orders, market]
const today = '2026-11-26'
const august = { start: '2026-08-01', end: '2026-09-01' }

const item = (scope: AnswerSource['scope']): AnswerSource => ({
  id: 'itm_00000001',
  version: 1,
  areaId: 'sales',
  kind: 'event',
  title: 'Online sales to Norway stopped',
  summary: 'Online sales to Norway stopped on 4 August 2026.',
  scope,
  validity: { start: '2026-08-04', end: '2026-09-01' },
  reviewDate: '2027-01-01',
  riskLevel: 'normal',
  checkFlag: null,
  status: 'accepted',
  audience: { kind: 'everyone' },
  conflicts: [],
  proposerId: 'p',
})
const world = (terms: Term[], items: AnswerSource[]): AnswerBundle => ({
  edition: 'ed_1',
  overlay: 'ov_1',
  items,
  terms,
  groupsOfMetric: {},
  metricArea: {},
  stopped: { all: false, areas: [], items: [] },
})
const typed: AnswerAsk = {
  question: 'Why did orders drop?',
  metrics: ['orders'],
  dimension_filters: [{ dimension: 'market', values: ['NO'] }],
  window: { from: '2026-08-01', to: '2026-08-31' },
}

describe('a typed filter on a dimension with no values', () => {
  it('is read for every value of it, and says which values it did not read', () => {
    const read = extractScope('Why did orders drop?', noValues, today, {
      metrics: ['orders'],
      filters: { market: ['Norway', 'NO'] },
      window: august,
    })
    expect(read).toMatchObject({
      status: 'resolved',
      scope: { metrics: ['metric:orders'], filters: { 'dim:market': [] } },
      unkept: [{ dimension: 'dim:market', values: ['Norway', 'NO'] }],
    })
  })

  it('still asks for a value it does not know on a dimension that has values', () => {
    const read = extractScope('Why did orders drop?', [...noValues, norway], today, {
      metrics: ['orders'],
      filters: { market: ['Sweden'] },
      window: august,
    })
    expect(read.status).toBe('need_more_detail')
    expect(read.unkept).toBeUndefined()
  })

  it('still refuses a dimension it does not know', () => {
    const read = extractScope('Why did orders drop?', noValues, today, {
      metrics: ['orders'],
      filters: { country: ['Norway'] },
      window: august,
    })
    expect(read).toMatchObject({ status: 'need_more_detail', issues: [{ field: 'filters' }] })
  })

  it('gives the item about any value of the dimension, and says it read every value', () => {
    const anyMarket = item({
      metrics: ['metric:orders'],
      dimensions: ['dim:market'],
      dimensionValues: [],
    })
    const reply = answer(world(noValues, [anyMarket]), typed, { today })
    expect(reply.status).toBe('matched')
    expect(reply.items.map((i) => i.id)).toEqual(['itm_00000001'])
    expect(reply.say).toContain(
      "No values of Market are kept yet, so this was read for every market, not only 'NO'.",
    )
  })

  it('gives the item about the metric alone, never a refusal', () => {
    const onOrders = item({ metrics: ['metric:orders'], dimensions: [], dimensionValues: [] })
    const reply = answer(world(noValues, [onOrders]), typed, { today })
    expect(reply.status).toBe('matched')
    expect(reply.issues).toEqual([])
  })
})

describe('unkeptSay', () => {
  it('names the dimension and every value it did not read', () => {
    expect(
      unkeptSay(world(noValues, []), [{ dimension: 'dim:market', values: ['Norway', 'NO'] }]),
    ).toBe(
      "No values of Market are kept yet, so this was read for every market, not only 'Norway' or 'NO'.",
    )
  })
})
