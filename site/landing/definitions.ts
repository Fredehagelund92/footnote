/*
  The landing page's definitions window (landing/components/Definitions.astro): six of the demo's
  metrics as its Definitions page shows them. Names, groups, definitions and other names are the
  demo's (docs/design/demo-world.md, section 4), and so is what each is built from: the demo's
  Cube model declares columns, and no metric built from another (db/seed/fixtures/cube-model.ts),
  so the window shows no tree; Gross margin's ratio records nothing, so it shows none. The notes
  are some of the hand-written story notes about each, with their market
  (db/seed/fixtures/story-facts.ts, db/seed/story.ts): the demo holds 70 to 82 published notes
  about each of these, so the window gives no count. test/landing.test.ts holds the Cube model's
  part to the model and the rest to the demo's design.
*/

export type Metric = {
  key: string
  name: string
  group: string
  /** Another name analysts use for it. */
  aka?: string
  definition: string
  /** The columns the demo's Cube model says it is built from. */
  columns: readonly string[]
  /** Some of the story's notes about it: their titles and markets. */
  notes: readonly { title: string; market: string }[]
}

export const metrics: readonly Metric[] = [
  {
    key: 'orders',
    name: 'Orders',
    group: 'Payments',
    definition:
      'The value of orders customers completed and paid for, in euros at the daily rate. Cancelled orders and failed payments are left out.',
    columns: ['order_amount'],
    notes: [
      { title: 'Online sales to Norway stopped on 4 August 2026', market: 'Norway' },
      { title: 'Orders lags by one day in the source tool', market: 'Germany' },
      { title: 'Data for Orders before 19 January 2026 is not reliable', market: 'Sweden' },
      { title: 'Orders is reported in local currency before conversion', market: 'Poland' },
    ],
  },
  {
    key: 'returns',
    name: 'Returns',
    group: 'Payments',
    definition:
      'The value of products customers sent back, in euros at the daily rate, on the day the payment provider confirmed the refund.',
    columns: ['refund_amount'],
    notes: [{ title: 'Returns changed definition on 28 April 2026', market: 'Norway' }],
  },
  {
    key: 'gross_sales',
    name: 'Gross sales',
    group: 'Revenue',
    aka: 'GMV',
    definition:
      'The value of every order at full price, in euros, before returns, discounts and VAT.',
    columns: ['gross_sales_eur'],
    notes: [
      { title: 'Online sales to Norway stopped on 4 August 2026', market: 'Norway' },
      { title: 'Checklist before you report a change in Gross sales', market: 'Netherlands' },
    ],
  },
  {
    key: 'units_sold',
    name: 'Units sold',
    group: 'Revenue',
    definition: 'The number of units customers bought, including units paid with store credit.',
    columns: ['units'],
    notes: [
      { title: 'Units sold excludes test accounts', market: 'Norway' },
      { title: 'Online sales to Norway stopped on 4 August 2026', market: 'Norway' },
    ],
  },
  {
    key: 'gross_margin',
    name: 'Gross margin',
    group: 'Basket',
    aka: 'Margin rate',
    definition:
      'Net revenue minus what the goods cost us, as a share of net revenue, for orders shipped.',
    columns: [],
    notes: [
      { title: 'What to rule out before explaining a jump in Gross margin', market: 'Spain' },
    ],
  },
  {
    key: 'discount_cost',
    name: 'Discount cost',
    group: 'Marketing',
    definition:
      'The value of the discounts and gift vouchers customers used, in euros, on the day they used them.',
    columns: ['discount_eur'],
    notes: [
      { title: 'Regulator paused price promotions in Italy on 18 April 2026', market: 'Italy' },
      { title: 'New VAT rate applied in Norway from 3 August 2025', market: 'Norway' },
    ],
  },
]
