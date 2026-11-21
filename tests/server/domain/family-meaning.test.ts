import { describe, expect, it } from 'vitest'
import { declaredFamily } from '../../../src/domain/definition-helpers.ts'
import {
  baseVariant,
  familyMeaning,
  meaningLine,
  slotted,
  type MeaningVariant,
} from '../../../src/domain/family-meaning.ts'
import { declaredFamilyProblems, declaredWords } from '../../../src/domain/metric-families.ts'

/*
  What a family of metrics means (FR-142, M1): declared in the source, else an owner's choice,
  else the words most variants share, else the base variant's words. Every name is invented.
*/

const by = ['Currency', 'Channel']
const revenue = (currency: string, channel: string, after = 'after discounts'): MeaningVariant => ({
  key: `metric:revenue_${currency.toLowerCase()}_${channel}`,
  values: [currency, channel],
  description: `Money taken for paid orders in ${currency} via ${channel}, ${after} and before tax.`,
})
const many = [
  revenue('EUR', 'web'),
  revenue('EUR', 'app'),
  revenue('USD', 'web'),
  revenue('USD', 'app', 'before marketplace fees'),
]
const accrued: MeaningVariant[] = [
  {
    key: 'metric:accrued_eur',
    values: ['EUR'],
    description: "The share of a contract's value booked in its first three months, in euros.",
  },
  {
    key: 'metric:accrued_usd',
    values: ['USD'],
    description: "The EUR amount multiplied by the row's exchange rate.",
  },
]
const conversion = [{ from: 'metric:accrued_eur', to: 'metric:accrued_usd' }]
const meaning = (
  variants: readonly MeaningVariant[],
  more: Partial<Parameters<typeof familyMeaning>[0]> = {},
) => familyMeaning({ by, variants, conversions: [], declared: null, chosen: null, ...more })

describe('a variant’s words with its values as slots', () => {
  it('writes each value as the axis it stands for, as a whole word in any case', () => {
    expect(slotted('Money taken in eur via Web, not in EURO.', ['EUR', 'web'], by)).toBe(
      'Money taken in {Currency} via {Channel}, not in EURO.',
    )
  })

  it('places the longest value first, so one never splits another', () => {
    expect(slotted('Paid in USDT, priced in USD.', ['USD', 'USDT'], ['Currency', 'Coin'])).toBe(
      'Paid in {Coin}, priced in {Currency}.',
    )
  })
})

describe('the base variant', () => {
  it('is the one every conversion starts at', () => {
    expect(
      baseVariant([...conversion, { from: 'metric:accrued_eur', to: 'metric:accrued_gbp' }]),
    ).toBe('metric:accrued_eur')
  })

  it('is none without conversions, or when they start at two variants', () => {
    expect(baseVariant([])).toBeNull()
    expect(
      baseVariant([
        { from: 'metric:a', to: 'metric:b' },
        { from: 'metric:c', to: 'metric:d' },
      ]),
    ).toBeNull()
  })
})

describe('a family’s meaning (M1)', () => {
  it('is the words most variants share, and names the ones that say something else', () => {
    expect(meaning(many)).toEqual({
      source: 'common',
      words:
        'Money taken for paid orders in {Currency} via {Channel}, after discounts and before tax.',
      member: null,
      common: {
        words:
          'Money taken for paid orders in {Currency} via {Channel}, after discounts and before tax.',
        agree: 3,
      },
      base: null,
      differing: ['metric:revenue_usd_app'],
    })
  })

  it('needs more than half of all variants to share words, so a pair needs both', () => {
    const half = [
      many[0]!,
      many[3]!,
      { key: 'metric:x', values: ['GBP', 'web'], description: null },
    ]
    expect(meaning(half).common).toBeNull()
    expect(meaning(half).source).toBe('none')
  })

  it('is the base variant’s words when the variants say different things', () => {
    const found = familyMeaning({
      by: ['Currency'],
      variants: accrued,
      conversions: conversion,
      declared: null,
      chosen: null,
    })
    expect(found).toMatchObject({
      source: 'base',
      words: accrued[0]!.description,
      member: 'metric:accrued_eur',
      base: 'metric:accrued_eur',
      differing: ['metric:accrued_usd'],
    })
  })

  it('is none when nothing gives one, and then every variant with words says something else', () => {
    const found = familyMeaning({
      by: ['Currency'],
      variants: accrued,
      conversions: [],
      declared: null,
      chosen: null,
    })
    expect(found).toMatchObject({ source: 'none', words: null, member: null })
    expect(found.differing).toEqual(['metric:accrued_eur', 'metric:accrued_usd'])
  })

  it('is an owner’s chosen variant over the common words', () => {
    const found = meaning(many, {
      chosen: { choice: 'member', member: 'metric:revenue_usd_app', words: null },
    })
    expect(found).toMatchObject({
      source: 'member',
      words: many[3]!.description,
      member: 'metric:revenue_usd_app',
    })
    // Against that variant's words, the three others say something else.
    expect(found.differing).toHaveLength(3)
  })

  it('is the owner’s written words, as written', () => {
    const found = meaning(many, {
      chosen: { choice: 'written', member: null, words: '  Money taken for paid orders.  ' },
    })
    expect(found).toMatchObject({ source: 'written', words: 'Money taken for paid orders.' })
    expect(found.differing).toEqual(['metric:revenue_usd_app'])
  })

  it('falls back to the rule for a chosen variant that has gone or has no words', () => {
    expect(
      meaning(many, { chosen: { choice: 'member', member: 'metric:gone', words: null } }).source,
    ).toBe('common')
    expect(meaning(many, { chosen: { choice: 'auto', member: null, words: null } }).source).toBe(
      'common',
    )
  })

  it('is the source’s declared words over any owner’s choice', () => {
    const found = meaning(many, {
      declared: 'Money taken for paid orders.',
      chosen: { choice: 'written', member: null, words: 'Something else.' },
    })
    expect(found).toMatchObject({ source: 'declared', words: 'Money taken for paid orders.' })
  })
})

describe('a meaning as one plain line', () => {
  it('says each slot as what it stands for, and keeps braces that name no axis', () => {
    expect(meaningLine('Taken in {Currency} via {Channel} for {customers}.', by)).toBe(
      'Taken in each currency via each channel for {customers}.',
    )
  })
})

describe('the words a source declares for a family', () => {
  it('reads meta.footnote.family_description as a description copy', () => {
    expect(
      declaredFamily({
        footnote: { family: 'revenue', by: { currency: 'EUR' }, family_description: ' Money. ' },
      }),
    ).toEqual({
      name: 'revenue',
      by: [{ name: 'currency', ref: null, value: 'EUR' }],
      description: 'Money.',
    })
    expect(
      declaredFamily({ footnote: { family: 'revenue', by: { currency: 'EUR' } } }),
    ).not.toHaveProperty('description')
  })

  it('refuses a description that is not text', () => {
    expect(
      declaredFamily({
        footnote: { family: 'revenue', by: { currency: 'EUR' }, family_description: 3 },
      }),
    ).toBe('invalid')
  })

  it('is the one wording the variants write, case and spaces aside; none when they differ', () => {
    expect(declaredWords([null, 'Money taken.', 'money  taken.'])).toBe('money  taken.')
    expect(declaredWords([null, undefined])).toBeNull()
    expect(declaredWords(['Money taken.', 'Money given.'])).toBeUndefined()
  })

  it('warns once when a family’s variants describe it two ways, and keeps the family', () => {
    const member = (ref: string, currency: string, description: string) => ({
      ref,
      name: `orders.${ref}`,
      kind: 'metric',
      family: {
        name: 'revenue',
        by: [{ name: 'currency', ref: null, value: currency }],
        description,
      },
    })
    const read = declaredFamilyProblems([
      member('revenue_eur', 'EUR', 'Money taken.'),
      member('revenue_usd', 'USD', 'Money given.'),
    ])
    expect(read.warnings).toEqual([{ code: 'family_words_differ', target: 'revenue' }])
    expect(read.dropped.size).toBe(0)
  })
})
