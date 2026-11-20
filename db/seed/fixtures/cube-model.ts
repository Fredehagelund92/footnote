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
  '7d73c2db78838fb4b32f22780383c5ef13c65a3986e7ead4ead00e4fb234ed36'
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
    changeMark: '5f42fbc5583915c3dfe8b8477157e551d5f363390cf01aac297acef3a9635db7',
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
    changeMark: 'eeaa2264d30b352debbe87672650c0e1de72d5580963ed11d2ab88bcbca5fce2',
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
    changeMark: '8f88d42a5858e88e66cdedfa431c14ca0aef87aa8a1a204b91d5ef890dd33e82',
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
    changeMark: 'ad9e15ff5645c3a55afce144c2e58888443a637806494c8a015848618e65d7a0',
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
    changeMark: 'c22c29279c49be311d6cfab63a0516e3bdbc84d06d5e20307a0585c8bb7b2864',
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
    changeMark: 'cf49e1c33546bb52443bdd36f75299618a2d1a3282d2267f1d8ab43c790d2084',
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
    changeMark: 'fcf1f5fa58b488c70f81e5b704269780910cef34e00b709b094627f3d9312818',
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
    changeMark: 'cd7f1ee187fa36716261b67bb202217a55215c62c52890e31dbd50cf37eab0a3',
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
    changeMark: '1cd68f216ee2d53248918cfa06053934dec303642b7bf70580b961f1b4e9f8e4',
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
    changeMark: '493c6f61705389715b6172f57e9d0696d0a628c3aea1f59900fd26d8d179c702',
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
    changeMark: '541803b3d8926a97d935a360f79c8f8f4324e88951c3fa144836cd67b16d50b4',
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
    changeMark: '2543f168b3e66419f2b9b4f3ebf59c531d18d6958913020e61b19db7dfb6b24f',
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
    changeMark: 'ef347b31bb613dec8bfa58801ff43c78741de9770587d39653a5e9f25ccd8cbb',
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
    changeMark: 'a63879bd4eb0569d2deaee45f44a7cebba5d87fc5af58fdc7c77adbbff7f1cf0',
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
    changeMark: '920eb0687846a8ab5c55c41904ae59f1c96c164009f0ba45451be08138e6f6c4',
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
    changeMark: '14b9bd66bde8d442335baedfee649baa07a9840fb027ba4d2879c50a7d563b52',
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
    changeMark: '0727629d9abd5d467def0c35180d18d4bfe747ff4d8535a77d8275183c6fe4b9',
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
    changeMark: 'f0740998dc61971fbc614935f32ddfe753b7b8f9b8391ab169970f192d2f9ff3',
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
    changeMark: '7b4f474675994564ccc59cac4326564e9602ae034c143de4b76dfc71793aef5d',
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
    changeMark: '369ee68a2e3b6a00ba5360dc63fa72024512e7a499c51415f174d3aad2eff1b1',
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
    changeMark: 'b286fc0a77cd2d426edb066b1b6f8412abf6c6b2ee311a83576a08307f3d1972',
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
    changeMark: 'c93021cf8189e88c0cb7b6f4c942695f82a8a662edeb1daa1d1414f5a1f4a385',
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
    changeMark: '1dfd9bf3e467a9f3383c2332e0cb97c8ab48edac179c685dd75dd2adbbbb8859',
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
    changeMark: '93295ee693f3f4216e6fc7dc433c7b07e6e1685d789cc357c6e10b0f4f135494',
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
    changeMark: 'c9f632823c9a19e57d76b047e41f90d90506622bf88d7b58fb32ed88357321c1',
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
    changeMark: '0f3a267e0d015782889c5cbb73c4f36b06f739d5183af31f33d47c123a977ad1',
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
    changeMark: '1b1cc80d3c56a3df63a45cbd627bf4b171d6abf1467c8c7b377eca3ff7dae378',
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
    changeMark: '4c6ba594abc19e866449a7616cf13da1a7d91daa8e3a5937f10c4cded1c61634',
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
    changeMark: '247e97c7668e472c2b5294574a527d26c6cb5a5e76e62768bd1ebe6db30c5822',
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
    changeMark: '34fc4202bc4db9eb0c37222bfc9ba5c9333210fb794118fbb16a5e6b5f77c1de',
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
    changeMark: 'ac098f56fcaa4c8c338761fee76c5fc376349ba3a75660b71749e2bbc12f244c',
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
