import { describe, expect, it } from 'vitest'
import {
  mapDefinitions,
  parseSemanticManifest,
} from '../../../src/connectors/dbt-metricflow/mapping.ts'
import { arithmeticInputs, columnsOf } from '../../../src/domain/definition-helpers.ts'
import {
  conversionsOf,
  relationsOf,
  TREE_CAP,
  treeOf,
  type RelationMember,
} from '../../../src/domain/definition-relations.ts'
import {
  exampleShape,
  partnerManifest,
  stemsOf,
  summedOf,
} from '../connectors/partner-relations-fixture.ts'

/*
  What a metric is built from, and what is built from it (FR-143): the columns a calculation
  reads, and the relations worked out from the names a source sends, never from words. Every name
  is invented.
*/

describe('the columns a calculation reads', () => {
  it('names each column once, in the order it first appears', () => {
    expect(columnsOf('SUM(amount_eur * exchange_rate_usd)')).toEqual([
      'amount_eur',
      'exchange_rate_usd',
    ])
    expect(columnsOf('amount_eur')).toEqual(['amount_eur'])
    expect(columnsOf('amount - discount - amount')).toEqual(['amount', 'discount'])
  })

  it('leaves out functions, keywords, literals, numbers and casts', () => {
    expect(
      columnsOf("CASE WHEN plan = 'PAID' AND NOT is_test THEN 0.6 * amount ELSE NULL END"),
    ).toEqual(['plan', 'is_test', 'amount'])
    expect(columnsOf('count(distinct user_id)')).toEqual(['user_id'])
    expect(columnsOf("SUM(x) FILTER (WHERE stage != 'FORECAST')")).toEqual(['x', 'stage'])
    expect(columnsOf('amount::numeric(10, 2) / nullif(units, 0)')).toEqual(['amount', 'units'])
    expect(columnsOf('CAST(amount AS double precision)')).toEqual(['amount'])
    expect(
      columnsOf("extract(year from booked_at) = 2026 and booked_at > date '2026-01-01'"),
    ).toEqual(['booked_at'])
    expect(columnsOf('1')).toEqual([])
  })

  it('leaves out bare functions such as current_date, and the date part after interval or a number', () => {
    expect(columnsOf('SUM(CASE WHEN created_at >= current_date THEN amount END)')).toEqual([
      'created_at',
      'amount',
    ])
    expect(columnsOf('current_timestamp - booked_at > localtimestamp - current_user')).toEqual([
      'booked_at',
    ])
    expect(columnsOf('created_at > now() - interval 1 day')).toEqual(['created_at'])
    expect(columnsOf('created_at > now() - interval day')).toEqual(['created_at'])
    expect(columnsOf('day + amount')).toEqual(['day', 'amount'])
  })

  it('takes a qualified or quoted name as its column, and leaves templates and comments out', () => {
    expect(columnsOf('orders.amount + "Tax Rate" + "tax_rate"')).toEqual(['amount', 'tax_rate'])
    expect(columnsOf("{{ Dimension('order__channel') }} = 'web' -- per channel\n and x")).toEqual([
      'x',
    ])
    expect(columnsOf('a /* b */ + c')).toEqual(['a', 'c'])
  })
})

describe("what a Cube measure's own calculation reads (C2)", () => {
  it('reads plain column arithmetic: its columns, and the measures it takes as written', () => {
    expect(arithmeticInputs('{CUBE}.amount_eur * {CUBE}.exchange_rate_usd')).toEqual({
      measures: [],
      columns: ['amount_eur', 'exchange_rate_usd'],
    })
    expect(arithmeticInputs('${CUBE}.amount_eur')).toEqual({
      measures: [],
      columns: ['amount_eur'],
    })
    expect(arithmeticInputs('amount_eur')).toEqual({ measures: [], columns: ['amount_eur'] })
    expect(arithmeticInputs('({revenue} - {CUBE.refunds}) / 100.0')).toEqual({
      measures: ['revenue', 'refunds'],
      columns: [],
    })
    expect(arithmeticInputs('{CUBE}.amount * 1e3')).toEqual({ measures: [], columns: ['amount'] })
    expect(arithmeticInputs('{CUBE}.amount * 2.5E-3')).toEqual({
      measures: [],
      columns: ['amount'],
    })
    expect(arithmeticInputs('{orders.revenue} * fx_rate')).toEqual({
      measures: ['orders.revenue'],
      columns: ['fx_rate'],
    })
  })

  it('reads nothing of any other calculation: a function, a keyword, a literal or a qualified column', () => {
    for (const sql of [
      'SUM({CUBE}.amount_eur)',
      'COALESCE(amount_eur, 0) * fx_rate',
      "CASE WHEN currency = 'EUR' THEN amount END",
      'amount_eur * 1.1 + bonus IS NULL',
      'orders.amount_eur * fx_rate',
      "{CUBE}.amount || 'x'",
      'amount_eur, fx_rate',
      '1',
      '',
    ])
      expect(arithmeticInputs(sql), sql).toBeNull()
  })
})

const member = (
  name: string,
  builtFrom: { refs?: string[]; columns?: string[] } | null,
): RelationMember => ({
  ref: `dbt:${name}`,
  name,
  builtFrom: builtFrom && { refs: builtFrom.refs ?? [], columns: builtFrom.columns ?? [] },
})

describe('a conversion', () => {
  const eur = member('partners.commission_eur', { columns: ['commission_eur'] })
  const usd = member('partners.commission_usd', {
    columns: ['commission_eur', 'exchange_rate_usd'],
  })

  it('is the metric that reads another’s inputs and one column more, named in another currency', () => {
    expect(conversionsOf([usd, eur])).toEqual([
      {
        from: 'dbt:partners.commission_eur',
        to: 'dbt:partners.commission_usd',
        by: 'exchange_rate_usd',
        currencies: ['EUR', 'USD'],
      },
    ])
  })

  it('is none when the names differ by more than a currency, or the inputs by more than a column', () => {
    const forecast = member('partners.forecast_commission_eur', {
      columns: ['is_forecast', 'commission_eur'],
    })
    const line = member('partners.commission_retail_eur', { columns: ['commission_eur', 'retail'] })
    const twice = member('partners.commission_gbp', {
      columns: ['commission_eur', 'exchange_rate_usd', 'exchange_rate_gbp'],
    })
    expect(conversionsOf([eur, forecast, line, twice])).toEqual([])
  })

  it('is none across views, and none when two metrics could each be the one it is converted from', () => {
    const elsewhere = member('payouts.commission_usd', { columns: [...usd.builtFrom!.columns] })
    expect(conversionsOf([eur, elsewhere])).toEqual([])
    const sek = member('partners.commission_sek', { columns: ['commission_eur'] })
    expect(conversionsOf([eur, sek, usd]).map((c) => c.to)).toEqual([])
  })

  it('finds the 37 twins of the example project’s shape, and no forecast or product line', async () => {
    const read = await mapDefinitions(
      parseSemanticManifest(JSON.stringify(partnerManifest(exampleShape)))!,
    )
    expect(read.complete).toBe(true)
    const members = read.definitions.map((d) => ({
      ref: d.ref,
      name: d.name,
      builtFrom: d.builtFrom ?? null,
    }))
    const found = conversionsOf(members)
    const twins = [...stemsOf(exampleShape), ...summedOf(exampleShape)]
    expect(found).toHaveLength(37)
    expect(found.map((c) => [c.from, c.to, c.by]).sort()).toEqual(
      twins
        .map((stem) => [
          `dbt:partner_results.${stem}_eur`,
          `dbt:partner_results.${stem}_usd`,
          'exchange_rate_usd',
        ])
        .sort(),
    )
  })
})

describe('a view of thousands of metrics', () => {
  it('finds its conversions by lookup, not by comparing each pair', () => {
    const members = Array.from({ length: 2_500 }, (_, n) => [
      member(`orders.amount_${n}_eur`, { columns: [`amount_${n}_eur`] }),
      member(`orders.amount_${n}_usd`, { columns: [`amount_${n}_eur`, 'exchange_rate_usd'] }),
    ]).flat()
    const started = performance.now()
    const own = members[1]!
    const relations = relationsOf(own, members, () => undefined)
    expect(conversionsOf(members)).toHaveLength(2_500)
    // Each pair compared would be 25 million comparisons, seconds even on a quiet machine.
    expect(performance.now() - started).toBeLessThan(2_000)
    expect(relations[0]).toMatchObject({ kind: 'converted_from', ref: 'dbt:orders.amount_0_eur' })
  })
})

describe('the relations of a metric', () => {
  const signups = member('partners.signups', { columns: ['signup_count'] })
  const clicks = member('partners.clicks', { columns: ['click_count'] })
  const rate = member('partners.signup_rate', {
    refs: ['dbt:partners.signups', 'dbt:partners.clicks'],
  })
  const perSignup = member('_shared.revenue_per_signup', {
    refs: ['dbt:orders.revenue', 'dbt:partners.signups'],
  })
  const seen = (ref: string) => ({
    name: ref.split('.').at(-1)!,
    key: `metric:${ref.split('.').at(-1)}`,
    missing: false,
  })

  it('says a ratio is built from its two inputs, in its own order', () => {
    expect(relationsOf(rate, [signups, clicks], seen)).toEqual([
      {
        kind: 'built_from',
        ref: 'dbt:partners.signups',
        name: 'signups',
        key: 'metric:signups',
        missing: false,
        by: null,
      },
      {
        kind: 'built_from',
        ref: 'dbt:partners.clicks',
        name: 'clicks',
        key: 'metric:clicks',
        missing: false,
        by: null,
      },
    ])
  })

  it('says an input is used by what is built from it, by name, after its own columns', () => {
    expect(relationsOf(signups, [rate, perSignup, clicks], seen)).toEqual([
      { kind: 'built_from', ref: null, name: 'signup_count', key: null, missing: false, by: null },
      {
        kind: 'used_by',
        ref: 'dbt:_shared.revenue_per_signup',
        name: 'revenue_per_signup',
        key: 'metric:revenue_per_signup',
        missing: false,
        by: null,
      },
      {
        kind: 'used_by',
        ref: 'dbt:partners.signup_rate',
        name: 'signup_rate',
        key: 'metric:signup_rate',
        missing: false,
        by: null,
      },
    ])
  })

  it('names an input no longer in the source as such, one never listed by its ref, and hides one the reader may not see', () => {
    const gone = (ref: string) =>
      ref === 'dbt:partners.signups'
        ? { name: 'Signups', key: 'metric:signups', missing: true }
        : ref === 'dbt:partners.clicks'
          ? null
          : undefined
    expect(relationsOf(rate, [], gone)).toEqual([
      {
        kind: 'built_from',
        ref: 'dbt:partners.signups',
        name: 'Signups',
        key: 'metric:signups',
        missing: true,
        by: null,
      },
    ])
    expect(relationsOf(perSignup, [], () => undefined).map((r) => r.name)).toEqual([
      'orders.revenue',
      'partners.signups',
    ])
  })

  it('puts a conversion first, both ways', () => {
    const eur = member('partners.commission_eur', { columns: ['commission_eur'] })
    const usd = member('partners.commission_usd', {
      columns: ['commission_eur', 'exchange_rate_usd'],
    })
    expect(relationsOf(usd, [eur], seen)[0]).toEqual({
      kind: 'converted_from',
      ref: 'dbt:partners.commission_eur',
      name: 'commission_eur',
      key: 'metric:commission_eur',
      missing: false,
      by: 'exchange_rate_usd',
    })
    expect(relationsOf(eur, [usd], seen).map((r) => [r.kind, r.name])).toEqual([
      ['converted_to', 'commission_usd'],
      ['built_from', 'commission_eur'],
    ])
  })
})

describe('what a metric is built from, at every depth', () => {
  const net = member('orders.net_revenue', {
    refs: ['dbt:orders.gross_sales', 'dbt:orders.returns'],
  })
  const gross = member('orders.gross_sales', { columns: ['gross_amount'] })
  const returns = member('orders.returns', { columns: ['refund_amount'] })
  const spend = member('ads.spend', { columns: ['spend'] })
  const roas = member('ads.roas', { refs: ['dbt:orders.net_revenue', 'dbt:ads.spend'] })
  const seen = (ref: string) => ({
    name: ref.split('.').at(-1)!,
    key: `metric:${ref.split('.').at(-1)}`,
    missing: false,
  })
  const said = (tree: ReturnType<typeof treeOf>) =>
    tree.map((m) => [m.name, m.from.map((ref) => ref.split('.').at(-1))])

  it('lists the metric, then each metric below it once, as first reached', () => {
    expect(said(treeOf(roas, [net, gross, returns, spend], seen))).toEqual([
      ['roas', ['net_revenue', 'spend']],
      ['net_revenue', ['gross_sales', 'returns']],
      ['spend', []],
      ['gross_sales', []],
      ['returns', []],
    ])
  })

  it('lists a metric two others are built from once, and ends a loop', () => {
    const margin = member('orders.margin', { refs: ['dbt:orders.net_revenue', 'dbt:ads.roas'] })
    const loop = member('orders.gross_sales', { refs: ['dbt:orders.net_revenue'] })
    expect(said(treeOf(margin, [net, loop, returns, roas, spend], seen))).toEqual([
      ['margin', ['net_revenue', 'roas']],
      ['net_revenue', ['gross_sales', 'returns']],
      ['roas', ['net_revenue', 'spend']],
      ['gross_sales', ['net_revenue']],
      ['returns', []],
      ['spend', []],
    ])
  })

  it('leaves out a metric the reader may not see with all below it, and walks nothing below one gone', () => {
    const hidden = (ref: string) =>
      ref === 'dbt:orders.net_revenue'
        ? null
        : ref === 'dbt:ads.spend'
          ? { name: 'Spend', key: 'metric:spend', missing: true }
          : seen(ref)
    const gone = member('ads.spend', { refs: ['dbt:ads.clicks'] })
    expect(treeOf(roas, [net, gross, returns, gone], hidden)).toEqual([
      {
        ref: 'dbt:ads.roas',
        name: 'roas',
        key: 'metric:roas',
        missing: false,
        from: ['dbt:ads.spend'],
      },
      { ref: 'dbt:ads.spend', name: 'Spend', key: 'metric:spend', missing: true, from: [] },
    ])
  })

  it('names an input the source never listed by its ref, with nothing below it', () => {
    expect(treeOf(net, [], () => undefined)).toEqual([
      {
        ref: 'dbt:orders.net_revenue',
        name: 'orders.net_revenue',
        key: null,
        missing: false,
        from: ['dbt:orders.gross_sales', 'dbt:orders.returns'],
      },
      {
        ref: 'dbt:orders.gross_sales',
        name: 'orders.gross_sales',
        key: null,
        missing: false,
        from: [],
      },
      { ref: 'dbt:orders.returns', name: 'orders.returns', key: null, missing: false, from: [] },
    ])
  })

  it('reads 500 metrics below one at once, and stops at the cap with no line to a metric past it', () => {
    const wide = (n: number) => {
      const inputs = Array.from({ length: n }, (_, i) =>
        member(`orders.part_${i}`, { refs: [`dbt:orders.leaf_${i}`] }),
      )
      const top = member('orders.total', { refs: inputs.map((m) => m.ref) })
      return { top, inputs }
    }
    const small = wide(250)
    const started = performance.now()
    expect(treeOf(small.top, small.inputs, seen)).toHaveLength(501)
    expect(performance.now() - started).toBeLessThan(500)
    const large = wide(TREE_CAP)
    const capped = treeOf(large.top, large.inputs, seen)
    expect(capped).toHaveLength(TREE_CAP)
    const listed = new Set(capped.map((m) => m.ref))
    expect(capped.every((m) => m.from.every((ref) => listed.has(ref)))).toBe(true)
  })
})
