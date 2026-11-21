import type { Definition } from '@/lib/definitions'

// What a dbt semantic manifest in a folder on the server adds to the demo's definitions
// (`?demo=dbt`), in the shapes a real project has: a dbt ref, and no model file, as a dbt file
// never names one; a description that quotes a value and a column in backticks; and one dimension
// title in two semantic models, the second named with its model in brackets.

const dbt = (): Pick<Definition, 'synced' | 'tool' | 'connector' | 'sourceNames'> => ({
  synced: true,
  tool: 'dbt',
  connector: 'dbt-metricflow',
  sourceNames: [],
})

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
]
