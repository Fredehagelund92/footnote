import { describe, expect, it } from 'vitest'
import { filterVariant } from '../../../src/domain/definition-helpers.ts'
import {
  byWords,
  currencyIn,
  derivationsOf,
  familiesOf,
  nameWithout,
  variantWords,
  type VariantMember,
} from '../../../src/domain/metric-families.ts'
import { searchScope } from '../../../src/domain/scope-search.ts'
import { asSuggested } from '../../../src/domain/suggested-names.ts'
import { nameRefusal, sourceNames, type WordHolders } from '../../../src/domain/source-names.ts'
import type { Term } from '../../../src/domain/vocabulary.ts'
import type { CandidateMember, KnownTerm } from '../../../src/domain/term-candidates.ts'

/*
  Families of metrics (FR-142): the variants of one calculation, a metric per currency and channel,
  found from the calculation's shape and offered on the Names card as one name. Every name is
  invented.
*/

describe('a filter as a variant', () => {
  it('leaves out the literal each comparison has, and keeps what it compares', () => {
    expect(filterVariant(["{CUBE}.currency_code = 'EUR'", "{CUBE.channel} IN ('web')"])).toEqual({
      shape: ['{CUBE}.currency_code = ?', '{CUBE.channel} IN (?)'],
      by: [
        { name: 'currency_code', value: 'EUR' },
        { name: 'channel', value: 'web' },
      ],
    })
    expect(filterVariant(["{{ Dimension('order__currency_code') }} = 'EUR'"])).toEqual({
      shape: ["{{ Dimension('order__currency_code') }} = ?"],
      by: [{ name: 'currency_code', value: 'EUR' }],
    })
    expect(filterVariant(["'O''Neil' = {CUBE}.last_name"])?.by).toEqual([
      { name: 'last_name', value: "O'Neil" },
    ])
  })

  it('is no variant when nothing is compared with a literal, or a literal is left over', () => {
    expect(filterVariant([])).toBeNull()
    expect(filterVariant(['{CUBE}.amount > 0'])).toBeNull()
    expect(filterVariant(["{CUBE}.status = 'done' or {CUBE}.note like '%x%'"])).toBeNull()
  })
})

describe("a variant's name without its values", () => {
  it('keeps what the variants share', () => {
    expect(nameWithout('Revenue (EUR) web', ['EUR', 'web'])).toBe('Revenue')
    expect(nameWithout('Net revenue (USD) marketplace', ['USD', 'marketplace'])).toBe('Net revenue')
    expect(nameWithout('Revenue - EUR - web', ['EUR', 'web'])).toBe('Revenue')
    expect(nameWithout('EUR revenue', ['EUR'])).toBe('Revenue')
    expect(nameWithout('Revenue in EUR', ['EUR'])).toBe('Revenue')
    // A value is a whole word: "web" is not taken out of "Webinars".
    expect(nameWithout('Webinars (web)', ['web'])).toBe('Webinars')
  })

  it('says the axes in words', () => {
    expect(byWords(['Currency'])).toBe('Currency')
    expect(byWords(['Currency', 'Channel'])).toBe('Currency and Channel')
    expect(byWords(['Currency', 'Channel', 'Store'])).toBe('Currency, Channel and Store')
  })
})

const currencies = ['EUR', 'USD', 'GBP']
const channels = ['web', 'app']
const by = (currency: string, channel: string) => [
  { name: 'currency_code', ref: 'dbt:orders.currency_code', value: currency },
  { name: 'channel', ref: 'dbt:orders.channel', value: channel },
]

/** A metric per currency and channel of each measure, as the dbt connector reads them. */
const shop = (measures: [string, string, string][]): CandidateMember[] =>
  measures.flatMap(([name, label, shape]) =>
    currencies.flatMap((currency) =>
      channels.map((channel) => ({
        ref: `dbt:orders.${name}_${currency.toLowerCase()}_${channel}`,
        source: 'dbt',
        kind: 'metric' as const,
        name: `orders.${name}_${currency.toLowerCase()}_${channel}`,
        title: `${label} (${currency}) ${channel}`,
        description: `${label} for orders paid in ${currency} through the ${channel} channel.`,
        valueType: 'sum',
        areaHint: 'sales',
        synonyms: [],
        baseName: null,
        mergeDimensions: 'never' as const,
        variant: { shape: shape.repeat(64).slice(0, 64), by: by(currency, channel) },
      })),
    ),
  )
const dimensions: CandidateMember[] = [
  ['currency_code', 'Currency'],
  ['channel', 'Channel'],
].map(([name, title]) => ({
  ref: `dbt:orders.${name}`,
  source: 'dbt',
  kind: 'dimension',
  name: `orders.${name}`,
  title: title!,
  description: null,
  valueType: 'categorical',
  areaHint: 'sales',
  synonyms: [],
  baseName: null,
  mergeDimensions: 'never',
}))
const asVariants = (members: readonly CandidateMember[]): VariantMember[] =>
  members.map((m) => ({ ...m, said: m.title ?? m.name, variant: m.variant ?? null }))

describe('families from the shape of the calculation', () => {
  it('groups the variants of one calculation, told apart by the same columns', () => {
    const families = familiesOf(
      asVariants(
        shop([
          ['revenue', 'Revenue', 'a'],
          ['net_revenue', 'Net revenue', 'b'],
        ]),
      ),
    )
    expect(families.map((f) => [f.key, f.name, f.variants.length])).toEqual([
      ['group:net_revenue', 'Net revenue', 6],
      ['group:revenue', 'Revenue', 6],
    ])
    expect(families[1]!.by.map((axis) => axis.name)).toEqual(['currency_code', 'channel'])
    expect(families[1]!.variants[0]).toEqual({
      ref: 'dbt:orders.revenue_eur_app',
      values: ['EUR', 'app'],
    })
  })

  it('keeps the family when a copied measure repeats one value set, leaving out only the copy', () => {
    const members = shop([['revenue', 'Revenue', 'a']])
    const copy = {
      ...members[0]!,
      ref: 'dbt:orders.a_revenue_copy',
      title: 'Revenue (EUR) web copy',
    }
    const [family] = familiesOf(asVariants([...members, copy]))
    expect(family!.variants).toHaveLength(6)
    expect(family!.variants.map((v) => v.ref)).toContain(members[0]!.ref)
    expect(family!.variants.map((v) => v.ref)).not.toContain('dbt:orders.a_revenue_copy')
  })

  it('groups by more than currency only from the shape, and never fewer than three', () => {
    const members = shop([['revenue', 'Revenue', 'a']])
    // With no shape from the source, the names group the variants by currency alone.
    expect(
      familiesOf(asVariants(members.map((m) => ({ ...m, variant: null })))).map((f) => [
        f.name,
        f.by.map((axis) => axis.name),
        f.variants.length,
      ]),
    ).toEqual([
      ['Revenue app', ['currency'], 3],
      ['Revenue web', ['currency'], 3],
    ])
    expect(familiesOf(asVariants(members.slice(0, 2)))).toEqual([])
    // Another calculation in the same names is another family, or none.
    const mixed = members.map((m, i) =>
      i < 2 ? { ...m, variant: { ...m.variant!, shape: 'c'.repeat(64) } } : m,
    )
    expect(familiesOf(asVariants(mixed)).map((f) => f.variants.length)).toEqual([4])
  })
})

describe('families on the Names card', () => {
  const none: WordHolders = new Map()

  it('offers a family as one name that holds its variants, never the variants apart', () => {
    const names = sourceNames(
      [...shop([['revenue', 'Revenue', 'a']]), ...dimensions],
      [],
      none,
      new Set(),
    )
    expect(names.map((n) => [n.kind, n.name, n.state])).toEqual([
      ['metric_group', 'Revenue', 'ready'],
      ['dimension', 'Channel', 'ready'],
      ['dimension', 'Currency', 'ready'],
    ])
    const [revenue] = names
    expect(revenue).toMatchObject({ key: 'group:revenue', areaId: 'sales' })
    expect(revenue!.family?.by).toEqual(['Currency', 'Channel'])
    expect(revenue!.family?.variants.map((v) => [v.name, v.parentKey])).toContainEqual([
      'Revenue (EUR) web',
      'group:revenue',
    ])
    expect(revenue!.definitionRefs).toHaveLength(6)
  })

  it('never publishes a family as suggested because a plain metric has its name', () => {
    const plain: CandidateMember = {
      ...shop([['revenue', 'Revenue', 'a']])[0]!,
      ref: 'dbt:returns.revenue',
      name: 'returns.revenue',
      title: 'Revenue',
      variant: null,
    }
    const names = sourceNames([...shop([['revenue', 'Revenue', 'a']]), plain], [], none, new Set())
    expect(names.find((n) => n.kind === 'metric_group')).toMatchObject({
      state: 'flagged',
      flags: [{ code: 'same_name' }],
    })
    expect(asSuggested(names)).toEqual([])
  })

  it('flags a family whose name has another meaning, and leaves it out with its variants', () => {
    const taken: WordHolders = new Map([
      ['revenue', [{ origin: 'vocabulary', ref: 'metric:turnover', name: 'Turnover' }]],
    ])
    const [flagged] = sourceNames(shop([['revenue', 'Revenue', 'a']]), [], taken, new Set())
    expect(flagged).toMatchObject({ kind: 'metric_group', state: 'flagged' })
    expect(flagged!.flags[0]!.code).toBe('taken')
    const members = shop([['revenue', 'Revenue', 'a']])
    const [left] = sourceNames(members, [], none, new Set(members.map((m) => m.ref)))
    expect(left).toMatchObject({ kind: 'metric_group', state: 'left_out', leftByOwner: true })
  })

  it('says how many variants have a problem and what kind, never naming one', () => {
    const taken: WordHolders = new Map([
      ['revenue (eur) web', [{ origin: 'vocabulary', ref: 'metric:turnover', name: 'Turnover' }]],
      ['revenue (usd) web', [{ origin: 'vocabulary', ref: 'metric:sales', name: 'Sales' }]],
    ])
    const [flagged] = sourceNames(shop([['revenue', 'Revenue', 'a']]), [], taken, new Set())
    expect(flagged).toMatchObject({ kind: 'metric_group', state: 'flagged' })
    expect(flagged!.flags).toHaveLength(1)
    expect(flagged!.flags[0]!.code).toBe('variants')
    expect(flagged!.flags[0]!.message).toContain('2 of its variants have names already in use')
    expect(JSON.stringify(flagged!.flags)).not.toMatch(/\(EUR\)|\(USD\)|Turnover|Sales/)
  })

  describe('two families of one name in two views', () => {
    const commission = (view: string, currency: string): CandidateMember => ({
      ref: `cube:${view}.commission_${currency.toLowerCase()}`,
      source: 'cube',
      kind: 'metric',
      name: `${view}.commission_${currency.toLowerCase()}`,
      title: `Commission (${currency})`,
      description: null,
      valueType: 'sum',
      areaHint: 'sales',
      synonyms: [],
      baseName: null,
      mergeDimensions: 'never',
      variant: null,
    })
    const members = ['affiliates', 'partners'].flatMap((view) =>
      ['EUR', 'USD'].map((currency) => commission(view, currency)),
    )
    const families = (names: ReturnType<typeof sourceNames>) =>
      names.filter((n) => n.kind === 'metric_group')

    it('flags both, and tells the second apart by its view, as two metrics are', () => {
      const names = families(sourceNames(members, [], none, new Set()))
      expect(names.map((n) => [n.key, n.name, n.state])).toEqual([
        ['group:commission', 'Commission', 'flagged'],
        ['group:partners_commission', 'Commission (partners)', 'flagged'],
      ])
      expect(names[0]!.flags).toContainEqual({
        code: 'same_name',
        message: 'Another definition is called “Commission”: Commission (partners).',
      })
      // Both go live in one press as suggested: their names are two words.
      const chosen = new Map(names.map((n) => [n.key, [n.name]]))
      for (const n of names) expect(nameRefusal(n.key, n.name, none, chosen)).toBeNull()
    })

    it('offers the second with its view once the first is live, and refuses it the first one’s word', () => {
      const first = families(sourceNames(members.slice(0, 2), [], none, new Set()))[0]!
      const live: KnownTerm[] = [
        ...first.family!.variants.map((v) => ({
          key: v.key,
          kind: 'metric',
          name: v.name,
          aliases: [],
          areaId: 'sales',
          definitionRefs: v.definitionRefs,
          open: false,
        })),
        {
          key: first.key,
          kind: 'metric_group',
          name: first.name,
          aliases: [],
          areaId: 'sales',
          definitionRefs: first.definitionRefs,
          open: false,
        },
      ]
      const holders: WordHolders = new Map([
        ['commission', [{ origin: 'vocabulary', ref: first.key, name: first.name, tool: null }]],
      ])
      const [second] = families(sourceNames(members, live, holders, new Set()))
      expect(second).toMatchObject({
        key: 'group:partners_commission',
        name: 'Commission (partners)',
        state: 'flagged',
      })
      expect(second!.flags.map((f) => f.code)).toContain('taken')
      const chosen = new Map([[second!.key, ['Commission']]])
      expect(nameRefusal(second!.key, 'Commission', holders, chosen)).toBe(
        'Another definition is already called “Commission”.',
      )
      expect(nameRefusal(second!.key, second!.name, holders, chosen)).toBeNull()
    })
  })

  it('adds the variants a later read found to the family that is live', () => {
    const members = shop([['revenue', 'Revenue', 'a']])
    const live: KnownTerm[] = [
      ...members.slice(0, 4).map((m) => ({
        key: `metric:${m.name.split('.')[1]}`,
        kind: 'metric',
        name: m.title!,
        aliases: [],
        areaId: 'sales',
        definitionRefs: [m.ref],
        open: false,
      })),
      {
        key: 'group:revenue',
        kind: 'metric_group',
        name: 'Revenue',
        aliases: [],
        areaId: 'sales',
        definitionRefs: members.slice(0, 4).map((m) => m.ref),
        open: false,
      },
    ]
    const [grown] = sourceNames(members, live, none, new Set())
    expect(grown).toMatchObject({ key: 'group:revenue', kind: 'metric_group', state: 'ready' })
    expect(grown!.linked).toHaveLength(4)
    expect(grown!.definitionRefs).toHaveLength(6)
    expect(grown!.family?.variants.map((v) => v.name)).toEqual([
      'Revenue (GBP) app',
      'Revenue (GBP) web',
    ])
  })
})

describe('a family in Applies to', () => {
  const term = (key: string, name: string, parentKey: string | null = null, refs: string[] = []) =>
    ({
      key,
      kind: key.startsWith('group:') ? 'metric_group' : 'metric',
      name,
      aliases: [],
      parentKey,
      areaId: null,
      definitionRefs: refs,
    }) as Term
  const terms = [
    term('group:revenue', 'Revenue', null, ['dbt:a', 'dbt:b']),
    term('metric:revenue_eur_web', 'Revenue (EUR) web', 'group:revenue', ['dbt:a']),
    term('metric:revenue_usd_web', 'Revenue (USD) web', 'group:revenue', ['dbt:b']),
    term('metric:orders', 'Orders'),
  ]
  const usage = { recent: [], uses: {} }

  it('is offered for its variants’ words, and the variants never apart', () => {
    const found = searchScope(terms, usage, { query: 'revenue eur web' })
    expect(found.metrics.map((hit) => [hit.key, hit.name, hit.variants, hit.alias])).toEqual([
      ['group:revenue', 'Revenue', 2, null],
    ])
    const opening = searchScope(terms, usage, { query: '' })
    expect(opening.metrics.map((hit) => hit.key)).toEqual(['metric:orders', 'group:revenue'])
  })
})

describe('a family its names alone make: one metric in two currencies', () => {
  // The USD variant is worked out from the EUR one with a rate: two calculations, one family.
  const accrued = (
    currency: string,
    description: string,
    shape: string | null,
  ): CandidateMember => ({
    ref: `dbt:finance.accrued_share_front_loaded_${currency.toLowerCase()}`,
    source: 'dbt',
    kind: 'metric',
    name: `finance.accrued_share_front_loaded_${currency.toLowerCase()}`,
    title: `Accrued share front loaded (${currency})`,
    description,
    valueType: 'sum',
    areaHint: 'finance',
    synonyms: [],
    baseName: null,
    mergeDimensions: 'never',
    variant: shape
      ? { shape: shape.repeat(64), by: [{ name: 'x', ref: null, value: shape }] }
      : null,
  })
  const members = [
    accrued('EUR', 'The share of each booking accrued up front, in EUR.', null),
    accrued('USD', "The EUR amount multiplied by the row's exchange rate.", null),
  ]

  it('reads the currency a name is in, written in capitals, bracketed or not', () => {
    expect(currencyIn('Accrued share front loaded (EUR)')).toBe('EUR')
    expect(currencyIn('Revenue USD')).toBe('USD')
    expect(currencyIn('Accrued share (eur)')).toBeNull()
    expect(currencyIn('Products (all)')).toBeNull()
    expect(currencyIn('Products (top)')).toBeNull()
    // Everyday words are no currency, and two currencies are none.
    expect(currencyIn('All orders on top')).toBeNull()
    expect(currencyIn('EUR to USD rate')).toBeNull()
  })

  it('offers them as one family by Currency, with or without a shared shape', () => {
    for (const shapes of [
      [null, null],
      ['a', 'b'],
    ] as const) {
      const [family, ...rest] = sourceNames(
        members.map((m, i) => ({ ...accrued(m.title!.slice(-4, -1), m.description!, shapes[i]!) })),
        [],
        new Map(),
        new Set(),
      )
      expect(rest).toEqual([])
      expect(family).toMatchObject({
        key: 'group:accrued_share_front_loaded',
        kind: 'metric_group',
        name: 'Accrued share front loaded',
        state: 'ready',
        family: { by: ['Currency'] },
      })
      expect(family!.family!.variants.map((v) => v.name)).toEqual([
        'Accrued share front loaded (EUR)',
        'Accrued share front loaded (USD)',
      ])
    }
  })

  it('needs two currencies of one name: one alone is a metric', () => {
    const [one] = sourceNames([members[0]!], [], new Map(), new Set())
    expect(one).toMatchObject({ kind: 'metric', name: 'Accrued share front loaded (EUR)' })
    const families = familiesOf(members.map((m) => ({ ...m, said: m.title!, variant: null })))
    expect(families.map((f) => [f.name, f.variants.map((v) => v.values)])).toEqual([
      ['Accrued share front loaded', [['EUR'], ['USD']]],
    ])
  })

  it('says how a variant is worked out from another when its source says so', () => {
    expect(
      derivationsOf(
        members.map((m) => ({
          said: m.title!,
          values: [m.title!.slice(-4, -1)],
          description: m.description,
        })),
      ),
    ).toEqual([
      "Accrued share front loaded (USD): The EUR amount multiplied by the row's exchange rate.",
    ])
  })

  it("gives an agent each variant's own words by its values, never its name (F2)", () => {
    expect(
      variantWords(
        members.map((m) => ({ values: [m.title!.slice(-4, -1)], description: m.description })),
      ),
    ).toEqual([
      'EUR: The share of each booking accrued up front, in EUR.',
      "USD: The EUR amount multiplied by the row's exchange rate.",
    ])
  })
})

describe("a family's variants' words for an agent", () => {
  const variant = (values: string[], description: string | null) => ({ values, description })

  it('gives words every variant shares, but for its values, once', () => {
    expect(
      variantWords([
        variant(['EUR', 'web'], 'Revenue for orders paid in EUR through the web channel.'),
        variant(['USD', 'app'], 'Revenue for orders paid in USD through the app channel.'),
      ]),
    ).toEqual([
      'EUR, web, and each other variant with its own: Revenue for orders paid in EUR through the web channel.',
    ])
  })

  it('gives at most four, and says how many more have words, and none when none has', () => {
    // One has no words, so the rest are not words every variant shares.
    const many = ['AUD', 'CAD', 'EUR', 'GBP', 'NOK', 'USD'].map((code) =>
      variant([code], code === 'CAD' ? null : `Booked in ${code}.`),
    )
    expect(variantWords(many)).toEqual([
      'AUD: Booked in AUD.',
      'EUR: Booked in EUR.',
      'GBP: Booked in GBP.',
      'NOK: Booked in NOK.',
      '1 more has words of its own.',
    ])
    expect(variantWords([variant(['EUR'], null), variant(['USD'], ' ')])).toEqual([])
  })
})
