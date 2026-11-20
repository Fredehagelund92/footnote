import { legacyManifest } from './dbt-metricflow-fixture.ts'

/*
  An invented shop that keeps one metric per currency, and per sales channel: twenty money measures
  (Revenue, Net revenue, Discounts...), up to fifty currencies and five channels, as dbt's semantic
  manifest and as a Cube model. Each is made from the same shop, so a test can compare the model
  with a metric per variant against the one with currency and channel as dimensions. Every name
  here is made up.
*/

export const currencies =
  'eur usd gbp sek nok dkk chf pln czk huf jpy cad aud nzd sgd hkd krw inr brl mxn zar try ils aed sar thb myr idr php vnd cny twd ron bgn isk clp cop pen ars egp ngn kes mad qar kwd bhd omr jod uah kzt'.split(
    ' ',
  )
export const channels = ['web', 'app', 'store', 'wholesale', 'marketplace']
/** Twenty measures, each a plain sum over an invented column. */
export const measures = [
  ['revenue', 'Revenue', 'amount'],
  ['net_revenue', 'Net revenue', 'amount - discount - refunded'],
  ['gross_revenue', 'Gross revenue', 'amount + tax'],
  ['discounts', 'Discounts', 'discount'],
  ['refunds', 'Refunds', 'refunded'],
  ['tax', 'Tax', 'tax'],
  ['shipping_fees', 'Shipping fees', 'shipping'],
  ['gross_margin', 'Gross margin', 'amount - discount - cost'],
  ['cost_of_goods', 'Cost of goods', 'cost'],
  ['gift_card_sales', 'Gift card sales', 'gift_card_amount'],
  ['subscription_revenue', 'Subscription revenue', 'subscription_amount'],
  ['marketplace_fees', 'Marketplace fees', 'marketplace_fee'],
  ['payment_fees', 'Payment fees', 'payment_fee'],
  ['chargebacks', 'Chargebacks', 'chargeback_amount'],
  ['store_credit', 'Store credit', 'store_credit_amount'],
  ['loyalty_discounts', 'Loyalty discounts', 'loyalty_discount'],
  ['duties', 'Duties', 'duty_amount'],
  ['handling_fees', 'Handling fees', 'handling_fee'],
  ['insurance_fees', 'Insurance fees', 'insurance_fee'],
  ['returns_value', 'Returns value', 'returned_amount'],
] as const

/**
 * How the shop is modelled: `measures` metrics, each split into `currencies` per-currency metrics
 * and those into `channels` per-channel ones. No currencies is the model with currency and
 * channel as dimensions: one metric per measure.
 */
export type VariantShape = { measures: number; currencies: number; channels: number }

/** The model of the scout's 5,000 run: 20 measures by 50 currencies by 5 channels. */
export const fiveThousand: VariantShape = { measures: 20, currencies: 50, channels: 5 }
/** 20 measures by 25 currencies by 5 channels: 2,500 metrics, about 2.3 MB as dbt writes them. */
export const twentyFiveHundred: VariantShape = { measures: 20, currencies: 25, channels: 5 }
/** The same shop with currency and channel as dimensions. */
export const asDimensions: VariantShape = { measures: 20, currencies: 0, channels: 0 }

/** Each metric of a shape: its name, its title, its words and its filters, in the tool's order. */
export function variants(shape: VariantShape) {
  const out: {
    name: string
    title: string
    description: string
    measure: string
    label: string
    filters: { column: 'currency_code' | 'channel'; value: string }[]
  }[] = []
  for (const [name, label] of measures.slice(0, shape.measures)) {
    if (!shape.currencies) {
      out.push({
        name,
        title: label,
        description: `${label}, in the currency the order was paid in.`,
        measure: name,
        label,
        filters: [],
      })
      continue
    }
    for (const code of currencies.slice(0, shape.currencies)) {
      const upper = code.toUpperCase()
      for (const channel of shape.channels ? channels.slice(0, shape.channels) : [null]) {
        out.push({
          name: channel ? `${name}_${code}_${channel}` : `${name}_${code}`,
          title: channel ? `${label} (${upper}) ${channel}` : `${label} (${upper})`,
          description: `${label} for orders paid in ${upper}${channel ? ` through the ${channel} channel` : ''}.`,
          measure: name,
          label,
          filters: [
            { column: 'currency_code', value: upper },
            ...(channel ? [{ column: 'channel' as const, value: channel }] : []),
          ],
        })
      }
    }
  }
  return out
}

type Json = Record<string, unknown>

/**
 * dbt's semantic manifest of a shape, made from the repository's own fixture so every field dbt
 * writes is there: one semantic model, `orders` (domain `sales`), with a measure per measure and
 * currency and channel as dimensions.
 */
export function variantManifest(shape: VariantShape): Json {
  const fixture = structuredClone(legacyManifest) as unknown as Json & {
    semantic_models: (Json & { name: string; measures: Json[]; dimensions: Json[] })[]
    metrics: (Json & { name: string; type_params: Json & { measure: Json } })[]
  }
  const template = fixture.metrics.find((m) => m.name === 'revenue')!
  const orders = fixture.semantic_models.find((m) => m.name === 'orders')!
  const categorical = orders.dimensions.find((d) => d.type === 'categorical')!
  orders.measures = measures.slice(0, shape.measures).map(([name, , expr]) => ({
    ...structuredClone(orders.measures[1]!),
    name: `${name}_amount`,
    expr,
  }))
  orders.dimensions = [
    ...orders.dimensions.filter((d) => d.name !== 'currency_code' && d.name !== 'channel'),
    {
      ...structuredClone(categorical),
      name: 'currency_code',
      label: 'Currency',
      description: 'The currency the order was paid in.',
    },
    {
      ...structuredClone(categorical),
      name: 'channel',
      label: 'Channel',
      description: 'Where the order was placed.',
    },
  ]
  const typeParams = template.type_params as Json & { measure: Json; input_measures: Json[] }
  const metrics = variants(shape).map((v) => ({
    ...structuredClone(template),
    name: v.name,
    label: v.title,
    description: v.description,
    type_params: {
      ...structuredClone(typeParams),
      measure: { ...typeParams.measure, name: `${v.measure}_amount` },
      input_measures: [{ ...typeParams.input_measures[0], name: `${v.measure}_amount` }],
    },
    filter: v.filters.length
      ? {
          where_filters: v.filters.map((f) => ({
            where_sql_template: `{{ Dimension('order__${f.column}') }} = '${f.value}'`,
          })),
        }
      : null,
  }))
  return { ...fixture, semantic_models: [orders], metrics, saved_queries: [] }
}

/**
 * A Cube model of a shape, as one generated file has it: a private cube `orders` with a measure
 * per variant, filtered by currency and channel, and a public view `sales` (domain `sales`).
 */
export function variantCube(shape: VariantShape): string {
  const lines = [
    'cubes:',
    '  - name: orders',
    '    public: false',
    '    sql: SELECT * FROM shop_orders',
    '    measures:',
  ]
  const sqlOf = new Map(measures.map(([name, , sql]) => [name as string, sql as string]))
  for (const v of variants(shape)) {
    lines.push(
      `      - name: ${v.name}`,
      '        type: sum',
      `        sql: "${sqlOf.get(v.measure)}"`,
      `        title: "${v.title}"`,
      `        description: ${v.description}`,
    )
    if (v.filters.length)
      lines.push(
        '        filters:',
        ...v.filters.map((f) => `          - sql: "{CUBE}.${f.column} = '${f.value}'"`),
      )
  }
  lines.push(
    '    dimensions:',
    ...[
      ['ordered_at', 'time', 'Order date'],
      ['currency_code', 'string', 'Currency'],
      ['channel', 'string', 'Channel'],
      ['status', 'string', 'Status'],
    ].flatMap(([name, type, title]) => [
      `      - name: ${name}`,
      `        type: ${type}`,
      `        sql: ${name}`,
      `        title: ${title}`,
    ]),
    'views:',
    '  - name: sales',
    '    meta:',
    '      domain: sales',
    '    cubes:',
    '      - join_path: orders',
    "        includes: '*'",
  )
  return lines.join('\n') + '\n'
}
