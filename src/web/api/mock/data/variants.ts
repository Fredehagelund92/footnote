import type { Definition } from '@/lib/definitions'

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
          })),
        ),
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
      variants: ['EUR', 'USD'].map((code) => ({
        name: `Accrued share front loaded (${code})`,
        values: [code],
      })),
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
