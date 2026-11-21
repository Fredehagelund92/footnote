import { descriptionCopy } from '@domain/definition-helpers'
import type { Definition } from '@/lib/definitions'

// What a dbt semantic manifest in a folder on the server adds to the demo's definitions
// (`?demo=dbt`), in the shapes a real project has: a dbt ref, and no model file, as a dbt file
// never names one; a description that quotes a value and a column in backticks; and one dimension
// title in two semantic models, the second named with its model in brackets; a title with brackets
// of its own that two semantic models share, the second's model name long; and a description over
// the 500 characters Footnote keeps, cut as a read cuts it.

const dbt = (): Pick<Definition, 'synced' | 'tool' | 'connector' | 'sourceNames'> => ({
  synced: true,
  tool: 'dbt',
  connector: 'dbt-metricflow',
  sourceNames: [],
})

/** A description longer than a copy keeps: a read keeps its first 500 characters. */
const LONG_DESCRIPTION = [
  'What the shop keeps of an order once refunds are taken off, in euros at the rate of the very day it was paid.',
  'It counts an order on the day it was paid, not the day it shipped, and takes a refund off on',
  'the day it was paid back, so a month can go down after it closed. Gift cards count when they',
  'are spent, never when they are sold. Shipping is in, taxes are out. Test orders, staff orders',
  'and orders paid with a voucher for the whole amount are left out, and so are orders a payment',
  'provider still holds for review. A marketplace order counts only the shop’s commission, as',
  '`commission_eur`, never the seller’s share.',
].join(' ')

export const dbtFolderDefinitions = (): Definition[] => [
  {
    ...dbt(),
    name: 'Campaign spend (local currency)',
    type: 'metric',
    ref: 'dbt:campaign_spend.campaign_spend_local',
    definition:
      'What a campaign cost in the market’s own currency, as `spend_local`, without `TEST` campaigns.',
    domain: 'marketing',
    group: 'campaign_spend',
    updated: '22 Oct 2026',
  },
  {
    ...dbt(),
    name: 'Acquisition channel first touch',
    type: 'dimension',
    ref: 'dbt:campaign_spend.acquisition_channel_first_touch',
    definition: 'The channel of a customer’s first touch with a campaign.',
    domain: 'marketing',
    group: 'campaign_spend',
    updated: '22 Oct 2026',
  },
  {
    ...dbt(),
    name: 'Acquisition channel first touch (orders)',
    type: 'dimension',
    ref: 'dbt:orders.acquisition_channel_first_touch',
    definition: 'The channel of the first touch before an order.',
    domain: 'sales',
    group: 'orders',
    updated: '22 Oct 2026',
  },
  {
    ...dbt(),
    name: 'Clicks (partner platform)',
    type: 'metric',
    ref: 'dbt:partner_clicks.clicks_partner_platform',
    definition: 'Clicks on partner links, as each partner’s own platform counts them.',
    domain: 'marketing',
    group: 'partner_clicks',
    updated: '22 Oct 2026',
  },
  {
    ...dbt(),
    name: 'Search clicks (reported)',
    type: 'metric',
    ref: 'dbt:search_console.search_clicks_reported',
    definition:
      'Clicks on the shop’s pages from search results, as the search console reports them.',
    domain: 'marketing',
    group: 'search_console',
    updated: '22 Oct 2026',
  },
  {
    ...dbt(),
    name: 'Search clicks (reported) (search_console_keyword_rankings_joined)',
    type: 'metric',
    ref: 'dbt:search_console_keyword_rankings_joined.search_clicks_reported',
    definition: 'Clicks from search results on the keywords the rank tracker follows.',
    domain: 'marketing',
    group: 'search_console_keyword_rankings_joined',
    updated: '22 Oct 2026',
  },
  {
    ...dbt(),
    name: 'Keyword count (search_console_keyword_rankings_joined)',
    type: 'metric',
    ref: 'dbt:search_console_keyword_rankings_joined.keyword_count',
    definition: 'Distinct keywords the rank tracker follows in the selection.',
    domain: 'marketing',
    group: 'search_console_keyword_rankings_joined',
    updated: '22 Oct 2026',
  },
  {
    ...dbt(),
    name: 'Net revenue after refunds',
    type: 'metric',
    ref: 'dbt:orders.net_revenue_after_refunds',
    definition: descriptionCopy(LONG_DESCRIPTION).copy ?? '',
    domain: 'sales',
    group: 'orders',
    updated: '22 Oct 2026',
  },
]
