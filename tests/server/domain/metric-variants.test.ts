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
        { words: 50, examples: ['eur', 'usd', 'gbp'] },
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
      splits: [{ words: 10, examples: ['eur', 'usd', 'gbp'] }],
    })
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
