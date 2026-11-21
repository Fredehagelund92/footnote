import { describe, expect, it } from 'vitest'
import { columnsOf } from '../../../src/domain/definition-helpers.ts'
import {
  relationsOf,
  type RelationMember,
} from '../../../src/domain/definition-relations.ts'

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
    expect(
      columnsOf('SUM(CASE WHEN created_at >= current_date THEN amount END)'),
    ).toEqual(['created_at', 'amount'])
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

const member = (
  name: string,
  builtFrom: { refs?: string[]; columns?: string[] } | null,
): RelationMember => ({
  ref: `dbt:${name}`,
  name,
  builtFrom: builtFrom && { refs: builtFrom.refs ?? [], columns: builtFrom.columns ?? [] },
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
      },
      {
        kind: 'built_from',
        ref: 'dbt:partners.clicks',
        name: 'clicks',
        key: 'metric:clicks',
        missing: false,
      },
    ])
  })

  it('says an input is used by what is built from it, by name, after its own columns', () => {
    expect(relationsOf(signups, [rate, perSignup, clicks], seen)).toEqual([
      { kind: 'built_from', ref: null, name: 'signup_count', key: null, missing: false },
      {
        kind: 'used_by',
        ref: 'dbt:_shared.revenue_per_signup',
        name: 'revenue_per_signup',
        key: 'metric:revenue_per_signup',
        missing: false,
      },
      {
        kind: 'used_by',
        ref: 'dbt:partners.signup_rate',
        name: 'signup_rate',
        key: 'metric:signup_rate',
        missing: false,
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
      },
    ])
    expect(relationsOf(perSignup, [], () => undefined).map((r) => r.name)).toEqual([
      'orders.revenue',
      'partners.signups',
    ])
  })
})
