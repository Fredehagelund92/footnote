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
  return [...measureFamilies(tool), accruedShare(tool)]
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
  // Two of the measures are the demo's own metrics by name: one word has one meaning (FR-138).
  const own: Record<string, string> = { 'Net revenue': 'Net takings', 'Gross margin': 'Margin' }
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
 * family found from the calculation (one rate converts the second from the first, D2), whose
 * source also says so in its own words.
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
      found: 'calculation',
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
 * Context about the families (FR-142): two notes on Revenue, for all its variants, and three on
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
  ]
}
