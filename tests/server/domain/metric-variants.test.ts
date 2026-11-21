import { describe, expect, it } from 'vitest'
import { variantShape } from '../../../src/domain/metric-variants.ts'
import {
  asDimensions,
  fiveThousand,
  variants,
  type VariantShape,
} from '../connectors/metric-variants-fixture.ts'

const names = (shape: VariantShape, view = 'sales') =>
  variants(shape).map((v) => `${view}.${v.name}`)

describe('metrics that look like variants of a few', () => {
  it('finds the 20 measures of 5,000 metrics split by currency and by channel', () => {
    expect(variantShape(names(fiveThousand))).toEqual({
      variants: 5_000,
      metrics: 5_000,
      bases: 20,
      splits: [
        { words: 5, examples: ['web', 'app', 'store'] },
        { words: 50, examples: ['EUR', 'USD', 'GBP'] },
      ],
    })
  })

  it('finds a metric per currency alone, and a model that names the variant first', () => {
    const shape = { measures: 5, currencies: 10, channels: 0 }
    expect(variantShape(names(shape))).toMatchObject({ variants: 50, bases: 5 })
    const first = variants(shape).map(
      (v) => `orders.${v.filters[0]!.value.toLowerCase()}_${v.measure}`,
    )
    expect(variantShape(first)).toMatchObject({
      variants: 50,
      bases: 5,
      splits: [{ words: 10, examples: ['EUR', 'USD', 'GBP'] }],
    })
  })

  it('takes no prefix off when a name would keep fewer than two words', () => {
    const codes = ['eur', 'usd', 'gbp', 'chf', 'sek', 'nok', 'dkk', 'pln', 'cad', 'aud']
    const names = codes.flatMap((code) =>
      ['revenue', 'revenue_net', 'revenue_gross'].map((measure) => `sales.${measure}_${code}`),
    )
    expect(variantShape(names)).toMatchObject({ variants: 30, bases: 3 })
  })

  it('names the real ways a project splits its metrics, when each group starts its names with its own', () => {
    // An invented dbt project: three ad channels, each a semantic model whose metrics start with
    // its name, with clicks and impressions, and spend per currency; and a shop's sales per
    // currency and per product line.
    const names: string[] = []
    for (const group of ['paid_search', 'paid_social', 'display_ads']) {
      names.push(`${group}.${group}_clicks`, `${group}.${group}_impressions`)
      for (const code of ['eur', 'usd', 'chf']) names.push(`${group}.${group}_spend_${code}`)
    }
    for (const measure of ['revenue', 'margin', 'discounts', 'refunds'])
      for (const code of ['eur', 'usd', 'chf']) {
        names.push(`shop_sales.shop_sales_${measure}_${code}`)
        for (const line of ['tents', 'boots', 'packs'])
          names.push(`shop_sales.shop_sales_${measure}_${line}_${code}`)
      }
    // Read across the groups, clicks and impressions looked like variants of each ad channel,
    // beside the currencies: "clicks, impressions, eur and 2 more".
    expect(variantShape(names)).toEqual({
      variants: 57,
      metrics: 63,
      bases: 5,
      splits: [
        { words: 3, examples: ['EUR', 'USD', 'CHF'] },
        { words: 3, examples: ['tents', 'boots', 'packs'] },
      ],
    })
  })

  it('names the words that split the most names first, and keeps two ways of splitting apart', () => {
    // Pounds on three measures and euros and dollars on five, the pounds listed first; and a
    // product line after the currency on two measures, which also ends names.
    const names = [
      ...['revenue', 'margin', 'tax'].map((measure) => `sales.${measure}_gbp`),
      ...['revenue', 'margin', 'tax', 'fees', 'refunds'].flatMap((measure) =>
        ['eur', 'usd'].map((code) => `sales.${measure}_${code}`),
      ),
      ...['revenue', 'margin'].flatMap((measure) =>
        ['eur', 'usd'].flatMap((code) =>
          ['tents', 'boots', 'packs'].map((line) => `sales.${measure}_${code}_${line}`),
        ),
      ),
    ]
    expect(variantShape(names)?.splits).toEqual([
      { words: 3, examples: ['EUR', 'USD', 'GBP'] },
      { words: 3, examples: ['tents', 'boots', 'packs'] },
    ])
  })

  it('says nothing of the same shop with currency and channel as dimensions', () => {
    expect(variantShape(names(asDimensions))).toBeNull()
  })

  it('says nothing of a few variants among many metrics, nor of names that only share words', () => {
    const few = [
      ...names({ measures: 2, currencies: 5, channels: 0 }),
      ...Array.from({ length: 60 }, (_, i) => `sales.metric_${'abcdefghij'[i % 10]}${i}`),
    ]
    expect(variantShape(few)).toBeNull()
    expect(
      variantShape([
        'net_revenue',
        'net_margin',
        'gross_revenue',
        'gross_margin',
        'operating_profit',
        'shipping_fees',
        'payment_fees',
        'handling_fees',
      ]),
    ).toBeNull()
  })
})
