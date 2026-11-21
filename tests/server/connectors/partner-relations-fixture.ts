/*
  An invented partner programme's dbt project in the latest spec, in the shapes the scout counted
  in a real one (data/footnote-definitions-direction, sections 1.2 and 3.4): amounts in EUR, each
  with a USD twin worked out from the EUR column and a row rate (some written as
  `SUM(x_eur * rate)` against `SUM(x_eur)`), a third in local currency, forecast twins that read
  the EUR column and a flag, product lines as columns of their own, a ratio and a derived metric.
  Only the twins are conversions. Every name here is made up.
*/

const MODEL = 'partner_results'

/** How many of each shape the project holds. */
export type PartnerShape = {
  /** EUR amounts with a USD twin, both bare columns. */
  pairs: number
  /** EUR amounts with a USD twin, both written as `SUM(...)`. */
  summed: number
  /** Of the bare pairs, those with a third in local currency. */
  locals: number
  /** Of the bare pairs, those with a forecast twin. */
  forecasts: number
}

/** The scout's count: 37 conversions, 4 local thirds and 25 forecast twins. */
export const exampleShape: PartnerShape = { pairs: 33, summed: 4, locals: 4, forecasts: 25 }

/** Three product lines, each its own column, with their USD twins among the bare pairs. */
const productLines = ['net_revenue_retail', 'net_revenue_online', 'net_revenue_wholesale']

const simple = (name: string, expr: string, description = `The ${name.replace(/_/g, ' ')}.`) => ({
  name,
  description,
  type: 'simple',
  type_params: {
    expr,
    metrics: [],
    metric_aggregation_params: {
      semantic_model: MODEL,
      agg: 'sum',
      agg_time_dimension: 'booked_at',
    },
    is_private: false,
  },
  filter: null,
  config: { meta: {} },
})

const reference = (name: string) => ({ name, filter: null, alias: null })

/** The bare stems: product lines first, then numbered amounts. */
export function stemsOf(shape: PartnerShape): string[] {
  const numbered = Array.from(
    { length: Math.max(0, shape.pairs - productLines.length) },
    (_, n) => `partner_amount_${n + 1}`,
  )
  return [...productLines, ...numbered].slice(0, shape.pairs)
}

/** The summed stems, each a `SUM(...)` pair. */
export const summedOf = (shape: PartnerShape) =>
  Array.from({ length: shape.summed }, (_, n) => `accrued_share_${n + 1}`)

/** The project as dbt writes `semantic_manifest.json`, in the latest spec. */
export function partnerManifest(shape: PartnerShape) {
  const stems = stemsOf(shape)
  const metrics = [
    ...stems.flatMap((stem) => [
      simple(`${stem}_eur`, `${stem}_eur`),
      simple(
        `${stem}_usd`,
        `${stem}_eur * exchange_rate_usd`,
        `The ${stem.replace(/_/g, ' ')} in USD: the EUR amount times the row's rate.`,
      ),
    ]),
    ...summedOf(shape).flatMap((stem) => [
      simple(`${stem}_eur`, `SUM(${stem}_eur)`),
      simple(`${stem}_usd`, `SUM(${stem}_eur * exchange_rate_usd)`),
    ]),
    ...stems
      .slice(0, shape.locals)
      .map((stem) => simple(`${stem}_local`, `${stem}_eur * exchange_rate_local`)),
    // A forecast reads the same column and one more, yet means something else: never a conversion.
    ...stems
      .slice(0, shape.forecasts)
      .map((stem) => simple(`forecast_${stem}_eur`, `CASE WHEN is_forecast THEN ${stem}_eur END`)),
    simple('net_revenue_eur', 'net_revenue_eur'),
    simple('signups', 'signup_count'),
    simple('clicks', 'click_count'),
    {
      name: 'signup_rate',
      description: 'Signups divided by clicks.',
      type: 'ratio',
      type_params: {
        numerator: reference('signups'),
        denominator: reference('clicks'),
        metrics: [],
        is_private: false,
      },
      filter: null,
      config: { meta: {} },
    },
    {
      name: 'net_revenue_per_signup',
      description: 'Net revenue in EUR for each signup.',
      type: 'derived',
      type_params: {
        expr: 'net_revenue_eur / signups',
        metrics: [reference('net_revenue_eur'), reference('signups')],
        is_private: false,
      },
      filter: null,
      config: { meta: {} },
    },
  ]
  return {
    semantic_models: [
      {
        name: MODEL,
        defaults: { agg_time_dimension: 'booked_at' },
        node_relation: { alias: MODEL },
        config: { meta: { domain: 'partners' } },
        measures: [],
        dimensions: [
          {
            name: 'booked_at',
            label: 'Booked on',
            type: 'time',
            type_params: { time_granularity: 'day' },
            config: { meta: { domain: 'partners' } },
          },
        ],
      },
    ],
    metrics,
  }
}
