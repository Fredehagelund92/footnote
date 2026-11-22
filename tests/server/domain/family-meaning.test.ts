import { describe, expect, it } from 'vitest'
import { declaredFamily } from '../../../src/domain/definition-helpers.ts'
import {
  baseVariant,
  familyMeaning,
  meaningLine,
  slotted,
  usualVariant,
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

  it('never takes a value out of a name such as `fees_eur`', () => {
    expect(slotted('Fees in EUR; for refunds see `refunds_eur`.', ['EUR'], ['Currency'])).toBe(
      'Fees in {Currency}; for refunds see `refunds_eur`.',
    )
  })

  it('places the longest value first, so one never splits another', () => {
    expect(slotted('Paid in USDT, priced in USD.', ['USD', 'USDT'], ['Currency', 'Coin'])).toBe(
      'Paid in {Coin}, priced in {Currency}.',
    )
  })

  it('takes a note in brackets on how the value is converted with it, and keeps any other', () => {
    const axes = [['EUR', 'USD']]
    const slot = (words: string) => slotted(words, ['USD'], ['Currency'], axes)
    // Of another value of its axis, as a code or a currency's name, or of a rate.
    expect(slot('Fees paid in USD (EUR × row fx_usd). Net of refunds.')).toBe(
      'Fees paid in {Currency}. Net of refunds.',
    )
    expect(slot('Fees paid in USD (from euros). Net of refunds.')).toBe(
      'Fees paid in {Currency}. Net of refunds.',
    )
    expect(slot('Fees paid in USD (at the daily exchange rate).')).toBe('Fees paid in {Currency}.')
    // A note that says something else, or one not right after the value, stays.
    expect(slot('Fees paid in USD (partners only).')).toBe(
      'Fees paid in {Currency} (partners only).',
    )
    expect(slot('Fees (EUR × rate) paid in USD.')).toBe('Fees (EUR × rate) paid in {Currency}.')
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
      automatic:
        'Money taken for paid orders in {Currency} via {Channel}, after discounts and before tax.',
      differing: ['metric:revenue_usd_app'],
    })
  })

  it('is the common words of a variant whose words say how it is converted (R1)', () => {
    // A source that writes the converted variant's words with a note on its rate, as one
    // generated model does for every pair.
    const pair: MeaningVariant[] = [
      {
        key: 'metric:partner_fees_eur',
        values: ['EUR'],
        description: 'Fees partners report on referred users in EUR. See the glossary > Fees.',
      },
      {
        key: 'metric:partner_fees_usd',
        values: ['USD'],
        description:
          'Fees partners report on referred users in USD (EUR × row fx_usd). See the glossary > Fees.',
      },
    ]
    const found = familyMeaning({
      by: ['Currency'],
      variants: pair,
      conversions: [],
      declared: null,
      chosen: null,
    })
    expect(found).toMatchObject({
      source: 'common',
      words: 'Fees partners report on referred users in {Currency}. See the glossary > Fees.',
      common: { agree: 2 },
      differing: [],
    })
  })

  it('reads a copy cut short as saying the same as words that go on from where it stops', () => {
    // Footnote keeps 500 characters of a description: a note in one variant moves its cut.
    const long = 'Fees partners report on referred users, by month and partner. '.repeat(7)
    const found = familyMeaning({
      by: ['Currency'],
      variants: [
        {
          key: 'metric:fees_eur',
          values: ['EUR'],
          description: `Fees in EUR. ${long}The month…`,
        },
        {
          key: 'metric:fees_usd',
          values: ['USD'],
          description: `Fees in USD (EUR × row fx_usd). ${long}The…`,
        },
      ],
      conversions: [],
      declared: null,
      chosen: null,
    })
    expect(found).toMatchObject({ source: 'common', differing: [] })
    expect(found.words).toMatch(/^Fees in \{Currency\}\. Fees partners/)
  })

  it('is the words most variants hold within their own when none share them all', () => {
    const pair: MeaningVariant[] = [
      {
        key: 'metric:booked_eur',
        values: ['EUR'],
        description: 'Revenue booked in EUR. Booked stage only. The figure finance reports.',
      },
      {
        key: 'metric:booked_usd',
        values: ['USD'],
        description: 'Revenue booked in USD. Booked stage only.',
      },
    ]
    const found = familyMeaning({
      by: ['Currency'],
      variants: pair,
      conversions: [],
      declared: null,
      chosen: null,
    })
    // The words both say; the EUR one says more, which is named.
    expect(found).toMatchObject({
      source: 'common',
      words: 'Revenue booked in {Currency}. Booked stage only.',
      common: { agree: 2 },
      differing: ['metric:booked_eur'],
    })
    // Words within others only as part of a sentence are no one's.
    expect(
      familyMeaning({
        by: ['Currency'],
        variants: [pair[0]!, { ...pair[1]!, description: 'Revenue booked' }],
        conversions: [],
        declared: null,
        chosen: null,
      }).source,
    ).toBe('none')
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

  it('writes the base variant’s values as slots, so the family reads as no one variant (R4)', () => {
    const found = familyMeaning({
      by: ['Currency'],
      variants: [
        { ...accrued[0]!, description: "The share of a contract's value booked early, in EUR." },
        accrued[1]!,
      ],
      conversions: conversion,
      declared: null,
      chosen: null,
    })
    expect(found).toMatchObject({
      source: 'base',
      words: "The share of a contract's value booked early, in {Currency}.",
      automatic: "The share of a contract's value booked early, in {Currency}.",
    })
    expect(meaningLine(found.words!, ['Currency'])).toBe(
      "The share of a contract's value booked early, in each currency.",
    )
  })

  it('is none when nothing gives one, and then no variant says something else (R2)', () => {
    const found = familyMeaning({
      by: ['Currency'],
      variants: accrued,
      conversions: [],
      declared: null,
      chosen: null,
    })
    expect(found).toMatchObject({ source: 'none', words: null, member: null, automatic: null })
    // With no meaning, there is nothing to say something else than.
    expect(found.differing).toEqual([])
  })

  it('is an owner’s chosen variant over the common words', () => {
    const found = meaning(many, {
      chosen: { choice: 'member', member: 'metric:revenue_usd_app', words: null },
    })
    expect(found).toMatchObject({
      source: 'member',
      words: many[3]!.description,
      member: 'metric:revenue_usd_app',
      // What the rule gives stays, for the owner to go back to.
      automatic:
        'Money taken for paid orders in {Currency} via {Channel}, after discounts and before tax.',
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
    expect(declaredWords(['  ', null])).toBeNull()
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

describe('the variant a question that names a family means (F3)', () => {
  const family: { usual: string | null; variants: MeaningVariant[] } = {
    usual: 'metric:revenue_eur_web',
    variants: many,
  }
  const meant = (words: string, picked = family) => usualVariant(words, picked)?.key ?? null

  it('is the usual variant when the words name none of its values', () => {
    expect(meant('What is revenue?')).toBe('metric:revenue_eur_web')
    expect(meant('revenue last month in Norway')).toBe('metric:revenue_eur_web')
  })

  it('is none when the words name any value, as written or as a currency is said', () => {
    expect(meant('revenue in USD')).toBeNull()
    expect(meant('revenue in usd via the app')).toBeNull()
    expect(meant('revenue via app')).toBeNull()
    expect(meant('revenue in EUR')).toBeNull()
    expect(meant('revenue in dollars')).toBeNull()
    expect(meant('revenue in €')).toBeNull()
    // A value inside another word is not named: "web" in "webinar".
    expect(meant('revenue from the webinar')).toBe('metric:revenue_eur_web')
  })

  it('is none until an owner picks one, or once the picked variant has left the family', () => {
    expect(meant('What is revenue?', { ...family, usual: null })).toBeNull()
    expect(meant('What is revenue?', { ...family, usual: 'metric:revenue_gbp_web' })).toBeNull()
  })
})
