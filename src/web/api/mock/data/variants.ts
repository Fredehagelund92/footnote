import { derivationsOf } from '@domain/metric-families'
import type { Definition } from '@/lib/definitions'
import { withWhen, type Fact } from '@/model/items'

// A catalogue with a metric per currency and per sales channel, for Definitions at that size
// (`?demo=variants`): twenty money measures of an invented shop, by fifty currencies and five
// channels, 5,000 metrics in all, as a model that keeps one metric for each would name them.

const currencies = [
  'eur',
  'usd',
  'gbp',
  'sek',
  'nok',
  'dkk',
  'chf',
  'pln',
  'czk',
  'huf',
  'jpy',
  'cad',
  'aud',
  'nzd',
  'sgd',
  'hkd',
  'krw',
  'inr',
  'brl',
  'mxn',
  'zar',
  'try',
  'ils',
  'aed',
  'sar',
  'thb',
  'myr',
  'idr',
  'php',
  'vnd',
  'cny',
  'twd',
  'ron',
  'bgn',
  'isk',
  'clp',
  'cop',
  'pen',
  'ars',
  'egp',
  'ngn',
  'kes',
  'mad',
  'qar',
  'kwd',
  'bhd',
  'omr',
  'jod',
  'uah',
  'kzt',
]
const channels = ['web', 'app', 'store', 'wholesale', 'marketplace']
const measures = [
  'Revenue',
  'Net revenue',
  'Gross revenue',
  'Discounts',
  'Refunds',
  'Tax',
  'Shipping fees',
  'Gross margin',
  'Cost of goods',
  'Gift card sales',
  'Subscription revenue',
  'Marketplace fees',
  'Payment fees',
  'Chargebacks',
  'Store credit',
  'Loyalty discounts',
  'Duties',
  'Handling fees',
  'Insurance fees',
  'Returns value',
]

/**
 * The same 5,000 metrics as the families a read finds in them (FR-142): twenty entries, each with
 * its 250 variants by Currency and Channel, as Definitions lists a model whose source says how
 * its metrics are made.
 */
export function familyDefinitions(tool: string): Definition[] {
  return [...measureFamilies(tool), accruedShare(tool), activeBuyers(tool), ...partnerPairs(tool)]
}

/**
 * Buyers by sales line, which the dbt project declares as one family in `meta.footnote` (D4): it
 * is changed there, never split here, and its model file is in the shop's repository.
 */
function activeBuyers(tool: string): Definition {
  const lines = ['online', 'retail', 'wholesale']
  return {
    name: 'Active buyers',
    type: 'metric',
    definition: '',
    synced: true,
    tool,
    sourceNames: [],
    domain: 'sales',
    group: 'orders',
    fileUrl: 'https://git.example/shop/dbt/blob/main/models/orders.yml',
    updated: '22 Oct 2026',
    family: {
      by: ['Sales line'],
      found: 'declared',
      declared: 'active_buyers',
      variants: lines.map((line) => ({
        name: `Active buyers (${line})`,
        values: [line],
        description: `Buyers with at least one paid order this month, sold ${line}.`,
        ref: refOf(`Active buyers ${line}`),
      })),
    },
  }
}

/**
 * A variant's own words, as its tool writes them: one wording with its values in it, so the
 * family's meaning is their common words. Three Revenue variants of the marketplace say something
 * else, as a model copied by hand does.
 */
function variantWords(measure: string, code: string, channel: string): string {
  if (measure !== 'Revenue')
    return `${measure} for orders paid in ${code} through the ${channel} channel.`
  return channel === 'marketplace' && ['BRL', 'MXN', 'INR'].includes(code)
    ? `Money taken for paid orders in ${code} via ${channel}, before marketplace fees and before tax.`
    : `Money taken for paid orders in ${code} via ${channel}, after discounts and before tax.`
}

/** A variant's id in the tool, as its source reads it: `dbt:orders.revenue_eur_web`. */
const refOf = (name: string) =>
  `dbt:orders.${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')}`

function measureFamilies(tool: string): Definition[] {
  // Three of the measures are the demo's own words by name, two metrics and a term: one word has
  // one meaning (FR-138).
  const own: Record<string, string> = {
    'Net revenue': 'Net takings',
    'Gross margin': 'Margin',
    'Store credit': 'Store credit used',
  }
  return measures.map<Definition>((measure) => {
    const label = own[measure] ?? measure
    return {
      name: label,
      type: 'metric',
      definition: '',
      synced: true,
      tool,
      sourceNames: [],
      domain: 'sales',
      group: 'orders',
      updated: '22 Oct 2026',
      family: {
        by: ['Currency', 'Channel'],
        found: 'calculation',
        variants: currencies.flatMap((code) =>
          channels.map((channel) => ({
            name: `${label} (${code.toUpperCase()}) ${channel}`,
            values: [code.toUpperCase(), channel],
            description: variantWords(label, code.toUpperCase(), channel),
            ref: refOf(`${label} ${code} ${channel}`),
          })),
        ),
        // Revenue's owners say a question that names no currency or channel means euros on the web.
        ...(label === 'Revenue'
          ? {
              usual: {
                member: 'Revenue (EUR) web',
                by: 'Jon Abara',
                on: '20 Nov 2026',
                revision: 1,
              },
            }
          : {}),
      },
    }
  })
}

/**
 * A metric in EUR and one in USD worked out from it with each row's rate: two calculations, one
 * family found from a rate (one rate converts the second from the first, D2, D6), whose source
 * also says so in its own words.
 */
function accruedShare(tool: string): Definition {
  return {
    name: 'Accrued share front loaded',
    type: 'metric',
    definition: '',
    synced: true,
    tool,
    sourceNames: [],
    domain: 'sales',
    group: 'orders',
    updated: '22 Oct 2026',
    family: {
      by: ['Currency'],
      derivations: [
        "Accrued share front loaded (USD): The EUR amount multiplied by the row's exchange rate.",
      ],
      found: 'rate',
      conversions: [
        {
          from: 'Accrued share front loaded (EUR)',
          to: 'Accrued share front loaded (USD)',
          by: 'exchange_rate_usd',
        },
      ],
      variants: [
        {
          name: 'Accrued share front loaded (EUR)',
          values: ['EUR'],
          description:
            "The share of a contract's value booked in its first three months, in euros.",
          ref: refOf('Accrued share front loaded EUR'),
        },
        {
          name: 'Accrued share front loaded (USD)',
          values: ['USD'],
          description: "The EUR amount multiplied by the row's exchange rate.",
          ref: refOf('Accrued share front loaded USD'),
        },
      ],
    },
  }
}

/**
 * Three pairs in EUR and USD found by their names alone, as a Cube model writes them (R1): one
 * whose USD words are the EUR ones with a note on the rate, so the family means what both say; one
 * whose USD words say only that it is converted to USD, so the EUR words speak for it (C3); and
 * one whose two variants are written apart, so it has no meaning yet.
 */
export function partnerPairs(tool: string): Definition[] {
  const pair = (name: string, eur: string, usd: string): Definition => {
    const variants = [
      { name: `${name} (EUR)`, values: ['EUR'], description: eur, ref: refOf(`${name} EUR`) },
      { name: `${name} (USD)`, values: ['USD'], description: usd, ref: refOf(`${name} USD`) },
    ]
    return {
      name,
      type: 'metric',
      definition: '',
      synced: true,
      tool,
      sourceNames: [],
      domain: 'sales',
      group: 'partners',
      updated: '22 Oct 2026',
      family: {
        by: ['Currency'],
        found: 'names',
        derivations: derivationsOf(variants.map((v) => ({ ...v, said: v.name }))),
        variants,
      },
    }
  }
  return [
    pair(
      'Partner fees',
      'Fees partners report on referred customers in EUR. Not our revenue: see `commission_eur`.',
      'Fees partners report on referred customers in USD (EUR × row fx_usd). Not our revenue: see `commission_eur`.',
    ),
    pair(
      'Partner payouts',
      'Payouts we send partners in EUR, booked on the day they are sent.',
      'Partner payouts converted to USD at each month’s rate.',
    ),
    pair(
      'Partner forecasts',
      'Payouts the planning model expects to send partners next month, in EUR.',
      'What finance plans to pay partners in the coming quarter, in USD.',
    ),
  ]
}

/** The 5,000 metrics, each read-only from the definitions tool. */
export function variantDefinitions(tool: string): Definition[] {
  return measures.flatMap((label) =>
    currencies.flatMap((code) =>
      channels.map<Definition>((channel) => ({
        name: `${label} (${code.toUpperCase()}) ${channel}`,
        type: 'metric',
        definition: `${label} for orders paid in ${code.toUpperCase()} through the ${channel} channel.`,
        synced: true,
        tool,
        sourceNames: [],
        domain: 'sales',
        group: 'Sales',
        updated: '22 Oct 2026',
      })),
    ),
  )
}

/**
 * Context about the families (FR-142): two notes on Revenue, for all its variants, and four on
 * one variant alone, as its quick view tells apart.
 */
export function familyFacts(): Fact[] {
  const note = (id: string, title: string, summary: string, where: string[]): Fact =>
    withWhen({
      id,
      title,
      summary,
      domain: 'sales',
      kind: 'note',
      where,
      valid: {},
      status: 'Live',
      checkedBy: 'Jon Abara',
      checkedOn: '18 Nov 2026',
      source: 'https://wiki.example/data/definitions/revenue',
      quote: '',
      dontConclude: '',
    })
  return [
    note(
      'itm_fam_rev_refund',
      'Revenue leaves out refunds',
      'Revenue counts an order once it is paid. A refund lowers Refunds, never Revenue.',
      ['Revenue'],
    ),
    note(
      'itm_fam_rev_day',
      'Revenue is booked on the day of payment',
      'An order paid after midnight counts on the next day, in the shop’s own time zone.',
      ['Revenue'],
    ),
    note(
      'itm_fam_rev_usd_app',
      'Revenue (USD) app starts on 3 March 2026',
      'The app took no US dollars before 3 March 2026, so Revenue (USD) app has no earlier days.',
      ['Revenue (USD) app'],
    ),
    note(
      'itm_fam_rev_usd_app_norway',
      'Revenue (USD) app in Norway is booked in kroner first',
      'Norwegian app orders are taken in kroner and converted, so Revenue (USD) app differs there.',
      ['Revenue (USD) app', 'Country', 'Norway'],
    ),
    note(
      'itm_fam_rev_gbp_store',
      'Revenue (GBP) store counts the London pop-up',
      'Revenue (GBP) store counts the London pop-up store from its first day, 1 June 2026.',
      ['Revenue (GBP) store'],
    ),
    note(
      'itm_fam_rev_gbp_store_vat',
      'Revenue (GBP) store is before UK VAT',
      'Revenue (GBP) store is before UK VAT, as every other variant of Revenue is before tax.',
      ['Revenue (GBP) store'],
    ),
    note(
      'itm_fam_accrued_restated',
      'Accrued share front loaded was restated for October',
      'Contracts signed in October were booked again on 4 November, so October reads higher than it did.',
      ['Accrued share front loaded'],
    ),
  ]
}
