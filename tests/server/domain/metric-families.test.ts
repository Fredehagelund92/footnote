import { describe, expect, it } from 'vitest'
import { declaredFamily, filterVariant } from '../../../src/domain/definition-helpers.ts'
import {
  byWords,
  currencyIn,
  declaredFamilyProblems,
  declaredName,
  derivationsOf,
  familiesOf,
  nameWithout,
  type VariantMember,
} from '../../../src/domain/metric-families.ts'
import { conversionsOf } from '../../../src/domain/definition-relations.ts'
import { searchScope } from '../../../src/domain/scope-search.ts'
import { asSuggested } from '../../../src/domain/suggested-names.ts'
import { sourceNames, type WordHolders } from '../../../src/domain/source-names.ts'
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

describe('a family its names alone suggest: one metric in two currencies', () => {
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

  it('waits for the owner as names that look alike, by Currency, with or without a shared shape', () => {
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
      // Names alone never make a family: it is flagged, out of Publish all, with the evidence.
      expect(family).toMatchObject({
        key: 'group:accrued_share_front_loaded',
        kind: 'metric_group',
        name: 'Accrued share front loaded',
        state: 'flagged',
        flags: [
          {
            code: 'look_alike',
            message:
              'Their names differ only by EUR and USD. Publish them as one family, or apart.',
          },
        ],
        family: { by: ['Currency'], found: 'names' },
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
    expect(families.map((f) => [f.name, f.found, f.variants.map((v) => v.values)])).toEqual([
      ['Accrued share front loaded', 'names', [['EUR'], ['USD']]],
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
})

/** A metric of the partner model, as the dbt connector reads it: nothing else set. */
const metric = (
  name: string,
  title: string,
  extra: Partial<CandidateMember> = {},
): CandidateMember => ({
  ref: `dbt:partners.${name}`,
  source: 'dbt',
  kind: 'metric',
  name: `partners.${name}`,
  title,
  description: null,
  valueType: 'sum',
  areaHint: 'sales',
  synonyms: [],
  baseName: null,
  mergeDimensions: 'never',
  ...extra,
})
const line = (name: string, value: string, extra: Partial<CandidateMember> = {}) =>
  metric(`net_revenue_${name}`, `Net revenue ${name}`, {
    declared: { name: 'net_revenue_by_line', by: [{ name: 'sales_line', ref: null, value }] },
    ...extra,
  })
/** A metric in EUR and the one in USD its source works out from it with the row's rate. */
const twins = (stem: string, label: string, rate = 'exchange_rate_usd') => [
  metric(`${stem}_eur`, `${label} (EUR)`, {
    builtFrom: { refs: [], columns: [`${stem}_eur`] },
  }),
  metric(`${stem}_usd`, `${label} (USD)`, {
    builtFrom: { refs: [], columns: [`${stem}_eur`, rate] },
  }),
]

describe('a family its source declares', () => {
  it('is read as written, two variants enough, before any other way', () => {
    const members = [line('retail', 'retail'), line('online', 'online')]
    const [family] = familiesOf(asVariants(members))
    expect(family).toMatchObject({
      key: 'group:net_revenue_by_line',
      name: 'Net revenue by line',
      found: 'declared',
      by: [{ name: 'sales_line', ref: null }],
      variants: [
        { ref: 'dbt:partners.net_revenue_online', values: ['online'] },
        { ref: 'dbt:partners.net_revenue_retail', values: ['retail'] },
      ],
    })
    expect(declaredName('Net Revenue')).toBe('Net Revenue')
    expect(declaredName('net_revenue')).toBe('Net revenue')
  })

  it('takes its variants from every other way, even a filter family they would make', () => {
    const filtered = shop([['revenue', 'Revenue', 'a']]).map((m) => ({
      ...m,
      declared: {
        name: 'revenue',
        by: m.variant!.by.map(({ name, ref, value }) => ({ name, ref, value })),
      },
    }))
    const families = familiesOf(asVariants(filtered))
    expect(families.map((f) => [f.name, f.found, f.variants.length])).toEqual([
      ['Revenue', 'declared', 6],
    ])
  })

  it('is offered on the Names card as one name, marked declared, ready to publish', () => {
    const [family] = sourceNames(
      [line('retail', 'retail'), line('online', 'online')],
      [],
      new Map(),
      new Set(),
    )
    expect(family).toMatchObject({
      kind: 'metric_group',
      name: 'Net revenue by line',
      state: 'ready',
      family: { by: ['Sales line'], found: 'declared' },
    })
  })

  it('makes no family when it does not hold, and says why', () => {
    const one = [line('retail', 'retail')]
    const views = [
      line('retail', 'retail'),
      { ...line('online', 'online'), name: 'payouts.net_revenue_online' },
    ]
    const same = [line('retail', 'retail'), line('online', 'retail')]
    const axes = [
      line('retail', 'retail'),
      line('online', 'online', {
        declared: {
          name: 'net_revenue_by_line',
          by: [{ name: 'channel', ref: null, value: 'online' }],
        },
      }),
    ]
    for (const members of [one, views, same, axes])
      expect(familiesOf(asVariants(members)).map((f) => f.found)).toEqual([])
    const asRead = (members: CandidateMember[]) =>
      declaredFamilyProblems(
        members.map((m) => ({
          ref: m.ref,
          name: m.name,
          kind: m.kind,
          family: m.declared ?? null,
        })),
      )
    expect(asRead(one).warnings).toEqual([
      { code: 'family_one_member', target: 'net_revenue_by_line' },
    ])
    expect(asRead(views).warnings.map((w) => w.code)).toEqual(['family_two_views'])
    expect(asRead(same).warnings.map((w) => w.code)).toEqual(['family_same_values'])
    expect(asRead(axes).warnings.map((w) => w.code)).toEqual(['family_axes_differ'])
    const kinds = asRead([
      line('retail', 'retail'),
      { ...line('online', 'online'), kind: 'dimension' },
    ])
    expect(kinds.warnings.map((w) => w.code)).toEqual(['family_two_kinds'])
    expect([...kinds.dropped].sort()).toEqual([
      'dbt:partners.net_revenue_online',
      'dbt:partners.net_revenue_retail',
    ])
    // A family that holds is no problem.
    expect(asRead([line('retail', 'retail'), line('online', 'online')])).toEqual({
      warnings: [],
      dropped: new Set(),
    })
  })
})

describe('a family one rate works out', () => {
  it('pairs the metrics a shared rate column converts, by Currency, two variants enough', () => {
    const members = [
      ...twins('accrued_share', 'Accrued share'),
      ...twins('commission', 'Commission'),
    ]
    const families = familiesOf(asVariants(members))
    expect(families.map((f) => [f.name, f.found, f.by, f.variants])).toEqual([
      [
        'Accrued share',
        'calculation',
        [{ name: 'currency', ref: null }],
        [
          { ref: 'dbt:partners.accrued_share_eur', values: ['EUR'] },
          { ref: 'dbt:partners.accrued_share_usd', values: ['USD'] },
        ],
      ],
      [
        'Commission',
        'calculation',
        [{ name: 'currency', ref: null }],
        [
          { ref: 'dbt:partners.commission_eur', values: ['EUR'] },
          { ref: 'dbt:partners.commission_usd', values: ['USD'] },
        ],
      ],
    ])
    const names = sourceNames(members, [], new Map(), new Set())
    expect(names.map((n) => [n.name, n.state, n.family?.found])).toEqual([
      ['Accrued share', 'ready', 'calculation'],
      ['Commission', 'ready', 'calculation'],
    ])
  })

  it('needs the column to convert more than one pair: one conversion alone is a relation', () => {
    const members = [
      ...twins('accrued_share', 'Accrued share'),
      ...twins('commission', 'Commission', 'fx_commission'),
    ]
    expect(familiesOf(asVariants(members)).map((f) => [f.name, f.found])).toEqual([
      ['Accrued share', 'names'],
      ['Commission', 'names'],
    ])
  })

  it('joins a metric converted into two currencies into one family, each by its rate', () => {
    const three = (stem: string, label: string) => [
      ...twins(stem, label),
      metric(`${stem}_gbp`, `${label} (GBP)`, {
        builtFrom: { refs: [], columns: [`${stem}_eur`, 'exchange_rate_gbp'] },
      }),
    ]
    const families = familiesOf(
      asVariants([...three('commission', 'Commission'), ...three('payout', 'Payout')]),
    )
    expect(families.map((f) => [f.name, f.found, f.variants.map((v) => v.values[0])])).toEqual([
      ['Commission', 'calculation', ['EUR', 'GBP', 'USD']],
      ['Payout', 'calculation', ['EUR', 'GBP', 'USD']],
    ])
  })

  it('never pairs a forecast, a sales line or a metric with no currency', () => {
    const members = [
      ...twins('commission', 'Commission'),
      ...twins('payout', 'Payout'),
      metric('forecast_commission_eur', 'Forecast commission (EUR)', {
        builtFrom: { refs: [], columns: ['commission_eur', 'is_forecast'] },
      }),
      metric('commission_retail_eur', 'Commission retail (EUR)', {
        builtFrom: { refs: [], columns: ['commission_eur', 'retail_share'] },
      }),
    ]
    const families = familiesOf(asVariants(members))
    expect(families.flatMap((f) => f.variants.map((v) => v.ref)).sort()).toEqual([
      'dbt:partners.commission_eur',
      'dbt:partners.commission_usd',
      'dbt:partners.payout_eur',
      'dbt:partners.payout_usd',
    ])
  })
})

describe('a family one rate works out, whatever another way claimed first', () => {
  it('counts the rate over every metric, so a declared family leaves its twin a rate family', () => {
    const declared = (member: CandidateMember, value: string) => ({
      ...member,
      declared: { name: 'revenue', by: [{ name: 'currency', ref: null, value }] },
    })
    const [revenueEur, revenueUsd] = twins('revenue', 'Revenue')
    const members = [
      declared(revenueEur!, 'EUR'),
      declared(revenueUsd!, 'USD'),
      ...twins('cost', 'Cost'),
    ]
    expect(familiesOf(asVariants(members)).map((f) => [f.name, f.found])).toEqual([
      ['Cost', 'calculation'],
      ['Revenue', 'declared'],
    ])
  })

  it('never joins a converted metric to one another family already took', () => {
    const [revenueEur, revenueUsd] = twins('revenue', 'Revenue')
    const members = [
      {
        ...revenueEur!,
        declared: { name: 'revenue_by_line', by: [{ name: 'line', ref: null, value: 'a' }] },
      },
      {
        ...revenueUsd!,
        declared: { name: 'revenue_by_line', by: [{ name: 'line', ref: null, value: 'b' }] },
      },
      ...twins('cost', 'Cost'),
    ]
    const families = familiesOf(asVariants(members))
    expect(families.find((f) => f.name === 'Cost')?.variants.map((v) => v.ref)).toEqual([
      'dbt:partners.cost_eur',
      'dbt:partners.cost_usd',
    ])
    expect(families.find((f) => f.found === 'declared')?.variants).toHaveLength(2)
  })
})

describe('a declared family with no name to key it by', () => {
  it('is invalid, whatever the script its name is in', () => {
    const by = { currency: 'EUR' }
    expect(declaredFamily({ footnote: { family: 'Umsatz', by } })).toMatchObject({ name: 'Umsatz' })
    expect(declaredFamily({ footnote: { family: '売上', by } })).toBe('invalid')
    expect(declaredFamily({ footnote: { family: '--', by } })).toBe('invalid')
  })

  it('is no family when a read of it slips through', () => {
    const members = ['EUR', 'USD'].map((code) =>
      metric(`sales_${code.toLowerCase()}`, `Sales ${code}`, {
        declared: { name: '売上', by: [{ name: 'currency', ref: null, value: code }] },
      }),
    )
    expect(familiesOf(asVariants(members)).map((f) => f.key)).not.toContain('group:')
  })
})

describe('a metric named with an everyday word that is also a currency code', () => {
  const sessions = (word: string, columns: string[]) =>
    metric(`sessions_${word}`, `Sessions ${word}`, { builtFrom: { refs: [], columns } })

  it('is converted from nothing', () => {
    const all = sessions('all', ['visits'])
    const top = sessions('top', ['visits', 'page'])
    expect(
      conversionsOf([all, top].map((m) => ({ ref: m.ref, name: m.name, builtFrom: m.builtFrom! }))),
    ).toEqual([])
  })

  it('still reads real currencies in lowercase', () => {
    const eur = sessions('eur', ['visits'])
    const cad = sessions('cad', ['visits', 'rate'])
    expect(
      conversionsOf(
        [eur, cad].map((m) => ({ ref: m.ref, name: m.name, builtFrom: m.builtFrom! })),
      ).map((c) => c.currencies),
    ).toEqual([['EUR', 'CAD']])
  })
})
