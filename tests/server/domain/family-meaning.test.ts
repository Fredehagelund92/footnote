import { describe, expect, it } from 'vitest'
import { declaredFamily } from '../../../src/domain/definition-helpers.ts'
import {
  axisValues,
  familyMeaning,
  familyWordings,
  slotted,
  usualVariant,
  worksOut,
  type MeaningVariant,
} from '../../../src/domain/family-meaning.ts'
import { meaningLine } from '../../../src/domain/family-meaning-line.ts'
import {
  declaredFamilyProblems,
  declaredWords,
  derivedVariants,
} from '../../../src/domain/metric-families.ts'

/*
  What a family of metrics means (FR-142, M1): declared in the source, else words an owner wrote,
  else the words most variants share, those worked out from another aside. Every name is invented;
  family-meaning-sets.test.ts holds the rule on families shaped like real ones.
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
    expect(slotted('Money taken in eur via Web, not in EUROPE.', ['EUR', 'web'], by)).toBe(
      'Money taken in {Currency} via {Channel}, not in EUROPE.',
    )
  })

  it('writes a currency’s name as its code is (T1)', () => {
    expect(slotted('Net sales in US dollars, after returns.', ['USD'], ['Currency'])).toBe(
      'Net sales in {Currency}, after returns.',
    )
    expect(slotted('Euros booked, in euros.', ['EUR'], ['Currency'])).toBe(
      '{Currency} booked, in {Currency}.',
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

describe('a value its variants write as a word (T2)', () => {
  const plan = (value: string) => ({
    key: `metric:users_${value.toLowerCase()}`,
    values: [value],
    description: `Users on the ${value} plan, including those on a free trial.`,
  })
  const plans = [plan('Free'), plan('Plus'), plan('Pro')]

  it('stays a word where a variant holding another value writes it beside the same word', () => {
    const axes = axisValues(['Plan'], plans)
    const words = familyWordings({ by: ['Plan'], variants: plans })
    // "a free trial" is in every variant's words: a word, not the Free plan.
    expect(words).toEqual([
      {
        values: ['Free'],
        words: 'Users on the Free plan, including those on a free trial.',
        line: 'Users on each plan, including those on a free trial.',
        count: 3,
      },
    ])
    // Without what the others write beside it, it would be the plan.
    expect(slotted(plans[0]!.description, ['Free'], ['Plan'], axes)).toBe(
      'Users on the {Plan} plan, including those on a {Plan} trial.',
    )
  })

  it('so a family whose metric’s name holds a value says nothing else (side bug 1)', () => {
    const fees = ['web', 'marketplace'].map((channel) => ({
      key: `metric:fees_${channel}`,
      values: [channel],
      description: `Marketplace fees for orders paid through the ${channel} channel.`,
    }))
    expect(
      familyMeaning({
        by: ['Channel'],
        variants: fees,
        conversions: [],
        declared: null,
        chosen: null,
      }),
    ).toMatchObject({
      words: 'Marketplace fees for orders paid through the {Channel} channel.',
      common: { agree: 2 },
      differing: [],
    })
  })
})

describe('a variant worked out from another (T3)', () => {
  const axes = [['EUR', 'USD', 'GBP']]
  const usd = (description: string) => ({ values: ['USD'], description })

  it('says a rate and a value another variant holds, as a code, in an id or by its name', () => {
    expect(worksOut(usd("The EUR amount multiplied by the row's exchange rate."), axes)).toBe(true)
    expect(worksOut(usd('amount_eur multiplied by fx_rate_usd.'), axes)).toBe(true)
    expect(worksOut(usd('Converted from euros at the daily rate.'), axes)).toBe(true)
  })

  it('needs both: a rate alone, another value alone or its own value is not enough', () => {
    expect(worksOut(usd('Seller payouts converted to USD at the monthly rate.'), axes)).toBe(false)
    expect(worksOut(usd('Revenue in USD, as the EUR one is.'), axes)).toBe(false)
    // A code is written in capitals: "in" is no country coded IN.
    expect(
      worksOut({ values: ['DE'], description: 'Conversion rate of sessions in DE.' }, [
        ['DE', 'IN'],
      ]),
    ).toBe(false)
  })

  it('is what a family’s page and Ask say is worked out from another (side bug 2)', () => {
    const variants = [
      { values: ['EUR'], description: 'Fees in EUR.' },
      usd("The EUR amount multiplied by the row's rate."),
      // Another value without a rate says nothing of how it is worked out.
      { values: ['GBP'], description: 'Fees in GBP, like the EUR ones.' },
    ]
    expect(derivedVariants(variants)).toEqual([variants[1]])
  })
})

describe('a family’s meaning (M1)', () => {
  it('is the words most variants share, and names the ones that say something else', () => {
    expect(meaning(many)).toEqual({
      source: 'common',
      words:
        'Money taken for paid orders in {Currency} via {Channel}, after discounts and before tax.',
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

  it('is the words of the one variant whose words say nothing of a conversion (R1, T3)', () => {
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
    // The USD one says it is the EUR one at a rate: it has no say, and says nothing else.
    expect(found).toMatchObject({
      source: 'common',
      words: 'Fees partners report on referred users in {Currency}. See the glossary > Fees.',
      common: { agree: 1 },
      base: 'metric:partner_fees_eur',
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

  it('is the words of the variant the others are converted from, as no one variant (T3)', () => {
    const found = familyMeaning({
      by: ['Currency'],
      variants: accrued,
      conversions: conversion,
      declared: null,
      chosen: null,
    })
    // "in euros" is the EUR variant's currency (T1): the family reads as each currency.
    expect(found).toMatchObject({
      source: 'common',
      words: "The share of a contract's value booked in its first three months, in {Currency}.",
      common: { agree: 1 },
      base: 'metric:accrued_eur',
      differing: [],
    })
  })

  it('has no say for a variant converted from another, so the others decide (C5)', () => {
    const found = familyMeaning({
      by: ['Currency'],
      variants: [
        {
          key: 'metric:net_eur',
          values: ['EUR'],
          description: 'Net revenue in EUR after refunds.',
        },
        { key: 'metric:net_usd', values: ['USD'], description: "EUR amount × the row's USD rate." },
        { key: 'metric:net_gbp', values: ['GBP'], description: "EUR amount × the row's GBP rate." },
      ],
      conversions: [
        { from: 'metric:net_eur', to: 'metric:net_usd' },
        { from: 'metric:net_eur', to: 'metric:net_gbp' },
      ],
      declared: null,
      chosen: null,
    })
    expect(found).toMatchObject({
      words: 'Net revenue in {Currency} after refunds.',
      base: 'metric:net_eur',
    })
  })

  it('is none for words that still name a value, which would read as one variant (T4)', () => {
    const copied = (description: string) =>
      familyMeaning({
        by: ['Currency'],
        variants: ['EUR', 'USD'].map((code) => ({
          key: `metric:bookings_${code.toLowerCase()}`,
          values: [code],
          description,
        })),
        conversions: [],
        declared: null,
        chosen: null,
      })
    expect(copied('Gross bookings from confirmed orders, in euros.')).toMatchObject({
      source: 'none',
      common: null,
      automatic: null,
      differing: [],
    })
    expect(copied('Gross revenue in EUR from paid orders.').source).toBe('none')
    // An id is a name, not a value: `refunds_eur` stays.
    expect(copied('Bookings in each currency. See `refunds_eur`.').source).toBe('common')
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
      source: 'common',
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
      variants: [
        accrued[0]!,
        { ...accrued[1]!, description: "Contract value converted to USD at each month's rate." },
      ],
      conversions: [],
      declared: null,
      chosen: null,
    })
    expect(found).toMatchObject({ source: 'none', words: null, base: null, automatic: null })
    // With no meaning, there is nothing to say something else than.
    expect(found.differing).toEqual([])
  })

  it('is the owner’s written words, as written', () => {
    const found = meaning(many, {
      chosen: { choice: 'written', words: '  Money taken for paid orders.  ' },
    })
    expect(found).toMatchObject({ source: 'written', words: 'Money taken for paid orders.' })
    expect(found.differing).toEqual(['metric:revenue_usd_app'])
  })

  it('is the rule again once an owner chose it to be worked out', () => {
    expect(meaning(many, { chosen: { choice: 'auto', words: null } }).source).toBe('common')
  })

  it('is the source’s declared words over any owner’s choice', () => {
    const found = meaning(many, {
      declared: 'Money taken for paid orders.',
      chosen: { choice: 'written', words: 'Something else.' },
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

  it('says "the {Channel} channel" as each channel, never "the each channel channel"', () => {
    expect(meaningLine('Fees paid in {Currency} through the {Channel} channel.', by)).toBe(
      'Fees paid in each currency through each channel.',
    )
    expect(meaningLine('The {Plan} plan, {Region} region.', ['Plan', 'Region'])).toBe(
      'Each plan, each region.',
    )
    expect(meaningLine('Orders via the {Channel}.', by)).toBe('Orders via each channel.')
  })
})

describe('what a family’s variants say, for an owner to start from', () => {
  it('gives each wording once, most first, with its first variant’s values and words', () => {
    expect(familyWordings({ by, variants: many })).toEqual([
      {
        values: ['EUR', 'web'],
        words: 'Money taken for paid orders in EUR via web, after discounts and before tax.',
        line: 'Money taken for paid orders in each currency via each channel, after discounts and before tax.',
        count: 3,
      },
      {
        values: ['USD', 'app'],
        words:
          'Money taken for paid orders in USD via app, before marketplace fees and before tax.',
        line: 'Money taken for paid orders in each currency via each channel, before marketplace fees and before tax.',
        count: 1,
      },
    ])
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
