/**
 * The demo Cube model (db/seed/cube) as the Cube connector reads it: the definition facts Footnote
 * stores (CON-207, never a calculation), and how the demo vocabulary points at them. The bulk
 * seed stores exactly these, so the demo has real definition reads, and the mock binding answers
 * the catalogue from them. tests/server/connectors/demo-model.test.ts compiles the model and
 * fails when this file no longer matches it: after changing the model, copy the new read here.
 */
import { REPOSITORY_URL } from '../../../src/domain/brand.ts'
import { termDomain } from '../../../src/domain/catalogue.ts'

/** The model version the connector reports for db/seed/cube (a digest of its files). */
export const DEMO_SOURCE_VERSION =
  '88853ca82fa69725bfe55c6fc4323c54abf78e3a235c32ad373a854a4118fe7a'
/** When the seed says the connector first read the model, and read it last (ISO 8601). */
export const DEMO_FIRST_READ_AT = '2026-09-01T05:00:00.000Z'
export const DEMO_READ_AT = '2026-10-07T05:00:00.000Z'
/**
 * The `sources.cube_model_url` setting the bulk seed turns on: the demo model's folder in this
 * repository, so a metric's Source tab links to its model file.
 */
export const DEMO_MODEL_URL = `${REPOSITORY_URL}/blob/main/db/seed/cube`
/** The definition the `definition-gone` scenario's newest read no longer lists. */
export const GONE_DEFINITION_REF = 'cube:basket.gross_margin'
/** The read before the newest, for a definition the newest read no longer lists (a mock scenario). */
export const DEMO_PREVIOUS_READ_AT = '2026-10-06T05:00:00.000Z'

export type DemoDefinition = {
  ref: string
  kind: 'metric' | 'dimension'
  name: string
  title: string | null
  descriptionCopy: string | null
  valueType: string | null
  areaHint: string | null
  domainSource: 'source' | 'override' | 'none'
  /** The model file that defines the member's view, in db/seed/cube. */
  modelFile: string
  /** The measures and columns its own calculation reads, when it is column arithmetic. */
  builtFrom?: { refs: string[]; columns: string[] }
  changeMark: string
}

/** Every member the connector lists, by id. */
export const demoDefinitions: DemoDefinition[] = [
  {
    ref: 'cube:basket.average_order_value',
    kind: 'metric',
    name: 'basket.average_order_value',
    title: 'Basket Average order value',
    descriptionCopy:
      'The mean value of a paid order, in euros, after discounts. Gift-card purchases are left out.',
    valueType: 'number',
    areaHint: 'area_sales',
    domainSource: 'source',
    modelFile: 'basket.yml',
    builtFrom: { refs: [], columns: ['order_value_eur'] },
    changeMark: '8c3c38d0031ca794c9d24a66da521a4ece524b558d1b1de1ff1388681e8f21ba',
  },
  {
    ref: 'cube:basket.gross_margin',
    kind: 'metric',
    name: 'basket.gross_margin',
    title: 'Basket Gross margin',
    descriptionCopy:
      'Net revenue minus what the goods cost us, as a share of net revenue, for orders shipped.',
    valueType: 'number',
    areaHint: 'area_sales',
    domainSource: 'source',
    modelFile: 'basket.yml',
    builtFrom: { refs: ['cube:revenue.net_revenue'], columns: ['cost_of_goods_eur'] },
    changeMark: '54549b828e59f0ad4d416cb0184322193aa8afbc79520d1762b165293b8e4b34',
  },
  {
    ref: 'cube:basket.online_share',
    kind: 'metric',
    name: 'basket.online_share',
    title: 'Basket Online share',
    descriptionCopy:
      'The share of net revenue from orders placed in the webshop or the apps, not in a store.',
    valueType: 'number',
    areaHint: 'area_sales',
    domainSource: 'source',
    modelFile: 'basket.yml',
    changeMark: 'ca38ffc795d41870134b799aab65b20823c0dc9ed9106a55b12ad4625b0da7d1',
  },
  {
    ref: 'cube:basket.units_per_order',
    kind: 'metric',
    name: 'basket.units_per_order',
    title: 'Basket Units per order',
    descriptionCopy:
      'The mean number of units in a paid order. A product bought in two sizes counts twice.',
    valueType: 'number',
    areaHint: 'area_sales',
    domainSource: 'source',
    modelFile: 'basket.yml',
    builtFrom: { refs: [], columns: ['units'] },
    changeMark: 'a8eca6cc0386a4bb793cf3bba5331c67b45f075f87a4af8be4f5e0d4bafbdd58',
  },
  {
    ref: 'cube:customers.active_customers',
    kind: 'metric',
    name: 'customers.active_customers',
    title: 'Customers Active customers',
    descriptionCopy:
      'Customers who placed at least one paid order in the period. A customer counts once, whatever the number of product groups they bought from.',
    valueType: 'number',
    areaHint: 'area_customer_value',
    domainSource: 'source',
    modelFile: 'customers.yml',
    builtFrom: { refs: [], columns: ['customer_id'] },
    changeMark: '84163fa596bcd35ed4a87c10101ef035dbe2a03d0f85fe1d8688cd90e8fa1c24',
  },
  {
    ref: 'cube:customers.churn_rate',
    kind: 'metric',
    name: 'customers.churn_rate',
    title: 'Customers Churn rate',
    descriptionCopy:
      'The share of customers active in the previous month who placed no order this month.',
    valueType: 'number',
    areaHint: 'area_customer_value',
    domainSource: 'source',
    modelFile: 'customers.yml',
    changeMark: '9359cd4a8b2c4b56dc96514a6ad4f6606a19145bdd58c8c3b3f82d03e52fa764',
  },
  {
    ref: 'cube:customers.customer_lifetime_value',
    kind: 'metric',
    name: 'customers.customer_lifetime_value',
    title: 'Customers Customer lifetime value',
    descriptionCopy:
      'The net revenue a customer is expected to bring over two years, in euros, from the customer value forecast run each Monday.',
    valueType: 'number',
    areaHint: 'area_customer_value',
    domainSource: 'source',
    modelFile: 'customers.yml',
    builtFrom: { refs: [], columns: ['predicted_value_eur'] },
    changeMark: '5f8ba26eca616756edb1b85ea95c8078b8d8531c2bdf81f00ae11a54d5d279ce',
  },
  {
    ref: 'cube:customers.first_time_buyers',
    kind: 'metric',
    name: 'customers.first_time_buyers',
    title: 'Customers First-time buyers',
    descriptionCopy:
      'Customers whose first paid order fell in the period, whenever they signed up.',
    valueType: 'number',
    areaHint: 'area_customer_value',
    domainSource: 'source',
    modelFile: 'customers.yml',
    changeMark: 'f14bc1d0732a5b590f1c93909bea903ae683e8d93715b4cae149791044d14e86',
  },
  {
    ref: 'cube:customers.new_customers',
    kind: 'metric',
    name: 'customers.new_customers',
    title: 'Customers New customers',
    descriptionCopy:
      'Customers who created an account in the period and confirmed it. Test and staff accounts are left out.',
    valueType: 'number',
    areaHint: 'area_customer_value',
    domainSource: 'source',
    modelFile: 'customers.yml',
    changeMark: 'bdc965dd2459c5ff6c0ac3d3481f0a5a9f8fe023073269aab4855d14d802ff33',
  },
  {
    ref: 'cube:customers.repeat_purchase_rate',
    kind: 'metric',
    name: 'customers.repeat_purchase_rate',
    title: 'Customers Repeat purchase rate',
    descriptionCopy:
      'The share of customers active in the previous month who are active again this month.',
    valueType: 'number',
    areaHint: 'area_customer_value',
    domainSource: 'source',
    modelFile: 'customers.yml',
    changeMark: '52cfadf74e721b28fa75fa1a3e86e64082859e4d1993e87b7abfa7559627714a',
  },
  {
    ref: 'cube:marketing.conversion_rate',
    kind: 'metric',
    name: 'marketing.conversion_rate',
    title: 'Marketing Conversion rate',
    descriptionCopy: 'The share of new accounts that place a first paid order within 30 days.',
    valueType: 'number',
    areaHint: 'area_marketing',
    domainSource: 'source',
    modelFile: 'marketing.yml',
    changeMark: '653af40459aae88806dfe505d15b01cc133da21656a66d503de85ec07d9cd1ba',
  },
  {
    ref: 'cube:marketing.cost_per_acquisition',
    kind: 'metric',
    name: 'marketing.cost_per_acquisition',
    title: 'Marketing Cost per acquisition',
    descriptionCopy: 'Marketing spend divided by first-time buyers in the same period, in euros.',
    valueType: 'number',
    areaHint: 'area_marketing',
    domainSource: 'source',
    modelFile: 'marketing.yml',
    builtFrom: {
      refs: ['cube:marketing.marketing_spend', 'cube:customers.first_time_buyers'],
      columns: [],
    },
    changeMark: '17d1deb4ee86c7d361c5e19471baa731fbb2bdfc92f6e55ce748f9cdce8ba362',
  },
  {
    ref: 'cube:marketing.discount_cost',
    kind: 'metric',
    name: 'marketing.discount_cost',
    title: 'Marketing Discount cost',
    descriptionCopy:
      'The value of the discounts and gift vouchers customers used, in euros, on the day they used them.',
    valueType: 'number',
    areaHint: 'area_marketing',
    domainSource: 'source',
    modelFile: 'marketing.yml',
    builtFrom: { refs: [], columns: ['discount_eur'] },
    changeMark: '39f2b8bb2eff779afc98b709e3f59aa992fced0b15724f7016d0f5302c307348',
  },
  {
    ref: 'cube:marketing.market',
    kind: 'dimension',
    name: 'marketing.market',
    title: 'Marketing Market',
    descriptionCopy: 'The country or region the cost was booked for.',
    valueType: 'string',
    areaHint: 'area_marketing',
    domainSource: 'source',
    modelFile: 'marketing.yml',
    changeMark: 'cc5b4ee95d2e8033c85725c7ac238441ceee4b8f6f074601b865b3108cd1db1c',
  },
  {
    ref: 'cube:marketing.marketing_day',
    kind: 'dimension',
    name: 'marketing.marketing_day',
    title: 'Marketing Marketing day',
    descriptionCopy: 'The day the cost was booked.',
    valueType: 'time',
    areaHint: 'area_marketing',
    domainSource: 'source',
    modelFile: 'marketing.yml',
    changeMark: '3a1bccc450fb34ee0994bbd7e56b429e3df4e11176f65f91a2b0834350e4b086',
  },
  {
    ref: 'cube:marketing.marketing_spend',
    kind: 'metric',
    name: 'marketing.marketing_spend',
    title: 'Marketing Marketing spend',
    descriptionCopy:
      'Money paid to media, partners and agencies, in euros, on the day the cost was booked. Discounts are not marketing spend.',
    valueType: 'number',
    areaHint: 'area_marketing',
    domainSource: 'source',
    modelFile: 'marketing.yml',
    builtFrom: { refs: [], columns: ['spend_eur'] },
    changeMark: 'a2b59fa0eed684b03ab389f91b79315b562225d0c65b85764bc0425365c2d26e',
  },
  {
    ref: 'cube:marketing.return_on_ad_spend',
    kind: 'metric',
    name: 'marketing.return_on_ad_spend',
    title: 'Marketing Return on ad spend',
    descriptionCopy:
      'Net revenue attributed to paid media divided by paid media spend. Attribution is the last click within 30 days.',
    valueType: 'number',
    areaHint: 'area_paid_media',
    domainSource: 'source',
    modelFile: 'marketing.yml',
    builtFrom: {
      refs: ['cube:revenue.net_revenue', 'cube:marketing.marketing_spend'],
      columns: [],
    },
    changeMark: '315fe74408c727af484528577c4bd035479b3862ff7d8e681e9059870a18ed56',
  },
  {
    ref: 'cube:operations.on_time_shipping_rate',
    kind: 'metric',
    name: 'operations.on_time_shipping_rate',
    title: 'Operations On-time shipping rate',
    descriptionCopy: null,
    valueType: 'number',
    areaHint: null,
    domainSource: 'none',
    modelFile: 'operations.yml',
    changeMark: '8fc5623dac3f79e577e9da7090995c0d6276a699de902a896eda77fbb35260ca',
  },
  {
    ref: 'cube:operations.support_contacts',
    kind: 'metric',
    name: 'operations.support_contacts',
    title: 'Operations Support contacts',
    descriptionCopy:
      'Chats, emails and calls to customer service that someone on our team answered.',
    valueType: 'number',
    areaHint: null,
    domainSource: 'none',
    modelFile: 'operations.yml',
    builtFrom: { refs: [], columns: ['contacts'] },
    changeMark: 'e6a541eb9162f535589eba9e152bbf986040c326662473c08728369fb53435ff',
  },
  {
    ref: 'cube:orders.market',
    kind: 'dimension',
    name: 'orders.market',
    title: 'Orders Market',
    descriptionCopy: 'The country or region the order ships to.',
    valueType: 'string',
    areaHint: 'area_sales',
    domainSource: 'source',
    modelFile: 'orders.yml',
    changeMark: '8ded2a631f7ca16fbbae30356780af4131fd2889891180813cbafe228641aeff',
  },
  {
    ref: 'cube:orders.order_day',
    kind: 'dimension',
    name: 'orders.order_day',
    title: 'Orders Order day',
    descriptionCopy: 'The day the order was paid for.',
    valueType: 'time',
    areaHint: 'area_sales',
    domainSource: 'source',
    modelFile: 'orders.yml',
    changeMark: '353b18918b1828b727eed680d69d1d1cafd3ec7edf77783dfa86119c9bb5ecf7',
  },
  {
    ref: 'cube:orders.orders',
    kind: 'metric',
    name: 'orders.orders',
    title: 'Orders Orders',
    descriptionCopy:
      'The value of orders customers completed and paid for, in euros at the daily rate. Cancelled orders and failed payments are left out.',
    valueType: 'number',
    areaHint: 'area_sales',
    domainSource: 'source',
    modelFile: 'orders.yml',
    builtFrom: { refs: [], columns: ['order_amount'] },
    changeMark: '3300dcae264963259beec8a93e00ac7595ca6357e8651f256fa4c4bdd5aa8129',
  },
  {
    ref: 'cube:orders.returns',
    kind: 'metric',
    name: 'orders.returns',
    title: 'Orders Returns',
    descriptionCopy:
      'The value of products customers sent back, in euros at the daily rate, on the day the payment provider confirmed the refund.',
    valueType: 'number',
    areaHint: 'area_sales',
    domainSource: 'source',
    modelFile: 'orders.yml',
    builtFrom: { refs: [], columns: ['refund_amount'] },
    changeMark: 'b82bc59631db1af4563678d9dd0a224213eed0abbf0575892f2456b66a54108f',
  },
  {
    ref: 'cube:revenue.gross_sales',
    kind: 'metric',
    name: 'revenue.gross_sales',
    title: 'Revenue Gross sales',
    descriptionCopy:
      'The value of every order at full price, in euros, before returns, discounts and VAT.',
    valueType: 'number',
    areaHint: 'area_sales',
    domainSource: 'source',
    modelFile: 'revenue.yml',
    builtFrom: { refs: [], columns: ['gross_sales_eur'] },
    changeMark: '76acca58c3eb0e0df2fc82fd7bdda67c89d15094998a6d167f7c93440edc81af',
  },
  {
    ref: 'cube:revenue.net_revenue',
    kind: 'metric',
    name: 'revenue.net_revenue',
    title: 'Revenue Net revenue',
    descriptionCopy:
      'Gross sales after returns, discounts, VAT and payment fees, in euros. The figure finance reports each month.',
    valueType: 'number',
    areaHint: 'area_sales',
    domainSource: 'source',
    modelFile: 'revenue.yml',
    builtFrom: { refs: [], columns: ['net_revenue_eur'] },
    changeMark: 'b170f6ef89915ff2e21576d51ae2403a75abc74dc5b95edd193cecb8ae1cb060',
  },
  {
    ref: 'cube:revenue.units_sold',
    kind: 'metric',
    name: 'revenue.units_sold',
    title: 'Revenue Units sold',
    descriptionCopy:
      'The number of units customers bought, including units paid with store credit.',
    valueType: 'number',
    areaHint: 'area_sales',
    domainSource: 'source',
    modelFile: 'revenue.yml',
    builtFrom: { refs: [], columns: ['units'] },
    changeMark: '1cccdf1061778a9aa416eacae17a5642536f3df5f45dfa5ddf8588e04277fa4c',
  },
  {
    ref: 'cube:segments.campaign',
    kind: 'dimension',
    name: 'segments.campaign',
    title: 'Segments Campaign',
    descriptionCopy:
      'The marketing campaign the customer was acquired through. There are thousands.',
    valueType: 'string',
    areaHint: null,
    domainSource: 'none',
    modelFile: 'segments.yml',
    changeMark: 'd2cdc9f07b6be346d9b98a92fbfff9edb9ecf96864f6ae50c4d70b7807ec628a',
  },
  {
    ref: 'cube:segments.channel',
    kind: 'dimension',
    name: 'segments.channel',
    title: 'Segments Channel',
    descriptionCopy: 'How the customer first came to us, from the attribution at sign-up.',
    valueType: 'string',
    areaHint: null,
    domainSource: 'none',
    modelFile: 'segments.yml',
    changeMark: 'e64a969626620ab75b142b5b55e1f6eef6706adaf1c35f348e4122e1658af599',
  },
  {
    ref: 'cube:segments.market',
    kind: 'dimension',
    name: 'segments.market',
    title: 'Segments Market',
    descriptionCopy: 'The country or region the order ships to.',
    valueType: 'string',
    areaHint: null,
    domainSource: 'none',
    modelFile: 'segments.yml',
    changeMark: '2db9a5f506c1663d4b9714da80b72efb90ad2f82305a2364ade295cc7765e3d9',
  },
  {
    ref: 'cube:segments.platform',
    kind: 'dimension',
    name: 'segments.platform',
    title: 'Segments Platform',
    descriptionCopy: 'Where the order was placed: the website, the iOS app or the Android app.',
    valueType: 'string',
    areaHint: null,
    domainSource: 'none',
    modelFile: 'segments.yml',
    changeMark: 'b4698fc3a2d195964689c6b1cc908141d97e34b4807fb0036ad4477257256e1e',
  },
  {
    ref: 'cube:segments.product',
    kind: 'dimension',
    name: 'segments.product',
    title: 'Segments Product',
    descriptionCopy:
      'The product group the sale belongs to: footwear, clothing, camping or climbing.',
    valueType: 'string',
    areaHint: null,
    domainSource: 'none',
    modelFile: 'segments.yml',
    changeMark: '045bba04d8030a8d9d99379aa8f10aa788d52f740352fe21d99b32eea139a377',
  },
]

/** The read of db/seed/cube warns about the two views without a domain (CON-516). */
export const demoWarnings = [
  { code: 'missing_domain', target: 'operations' },
  { code: 'missing_domain', target: 'segments' },
] as const

/**
 * Definitions Cube changed after the first read: the mark Footnote read then. Items accepted before
 * the change and not checked since carry the old mark, so they need a check (CON-209).
 */
export const changedDefinitions: Record<string, { previousMark: string; changedAt: string }> = {
  'cube:customers.repeat_purchase_rate': {
    previousMark: '1259ea3cc637221b435043fb9b6c262ca9d12d19bd3c91b3ec72f436a207cabf',
    changedAt: DEMO_READ_AT,
  },
}

const viewOfGroup: Record<string, string> = {
  Payments: 'orders',
  Revenue: 'revenue',
  Customers: 'customers',
  Marketing: 'marketing',
  Basket: 'basket',
  Operations: 'operations',
}

/**
 * The definition a vocabulary metric names: the member in the view of its group. A dimension's
 * first definition, in the shared `segments` view (`definitionRefsOf` has them all).
 */
export function definitionRefOf(term: { key: string; group?: string }): string {
  const [prefix, id] = term.key.split(':')
  if (prefix === 'dim') return `cube:segments.${id}`
  const view = viewOfGroup[term.group ?? '']
  if (!view) throw new Error(`No demo view for ${term.key}`)
  return `cube:${view}.${id}`
}

/**
 * The definitions each term named before a term could name several: its first view's member
 * only (the `term-in-one-view` mock scenario).
 */
export const firstViewRefs = (term: { key: string; group?: string }): string[] => [
  definitionRefOf(term),
]

/**
 * The definitions each vocabulary term names (CON-208): a metric's one, or every view's member
 * of a dimension's name, merged strictly by name (Market is in `segments` and `orders`).
 */
export function definitionRefsOf(term: { key: string; group?: string }): string[] {
  const [prefix, id] = term.key.split(':')
  if (prefix !== 'dim') return [definitionRefOf(term)]
  return demoDefinitions
    .filter((definition) => definition.kind === 'dimension' && definition.name.endsWith(`.${id}`))
    .map((definition) => definition.ref)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * The vocabulary's area map (CON-206), which wins over Cube's domain. Support contacts belongs
 * to Sales although its view has none; On-time shipping rate keeps no domain at all.
 */
export const termAreas: Record<string, string> = {
  'metric:support_contacts': 'area_sales',
}

/**
 * The domain of each metric by the one rule serving, gap topics and the catalogue share
 * (`termDomain`, CON-206): the vocabulary's area, else the domain its Cube view gives. A metric of
 * a group with no demo view (a test's own vocabulary) has the vocabulary's area only.
 */
export function demoMetricArea(
  metrics: readonly { id: string; group: string }[],
): Record<string, string> {
  const hints = new Map(demoDefinitions.map((definition) => [definition.ref, definition.areaHint]))
  return Object.fromEntries(
    metrics.flatMap(({ id, group }) => {
      const key = `metric:${id}`
      const view = viewOfGroup[group]
      const hint = view ? (hints.get(`cube:${view}.${id}`) ?? null) : null
      const { areaId } = termDomain(termAreas[key] ?? null, hint)
      return areaId === null ? [] : [[key, areaId]]
    }),
  )
}

/**
 * A member of a view Cube removed after the first read. Items flagged `source_missing` in the
 * fixtures reference one, so a read of the demo model keeps their flag (CON-210).
 */
export const goneRefOf = (metricId: string) => `cube:legacy.${metricId}`
