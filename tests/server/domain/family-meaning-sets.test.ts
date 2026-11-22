import { describe, expect, it } from 'vitest'
import { familyMeaning } from '../../../src/domain/family-meaning.ts'
import { meaningLine } from '../../../src/domain/family-meaning-line.ts'

/*
  The rule (M1) on invented families shaped like the ones real installs hold: pairs with a note on
  their rate, pairs whose source says how one is worked out from the other, copy and paste errors,
  product lines, channels, regions and countries, hand-reworded variants and families with no
  words. Every name and description is invented. `means` is the meaning as one plain line, or none;
  `base` the variant whose words alone are it, the others worked out from it.

  What the rule still gets wrong, on purpose kept here: C4 reads a column formula as the family's
  words. And no rule reads rewording (P3, L4, R1, X1, X3): those families have no meaning until an
  owner writes one.
*/

type Invented = {
  id: string
  why: string
  by: string[]
  variants: [key: string, values: string[], description: string | null][]
  conversions?: [from: string, to: string][]
  means: string | null
  base?: string
}

const sets: Invented[] = [
  {
    id: 'P1',
    why: 'USD repeats EUR with a rate note',
    by: ['Currency'],
    variants: [
      [
        'partner_commission_eur',
        ['EUR'],
        'Commission partners earn on referred orders in EUR, net of refunds.',
      ],
      [
        'partner_commission_usd',
        ['USD'],
        'Commission partners earn on referred orders in USD (EUR × row fx_usd), net of refunds.',
      ],
    ],
    means: 'Commission partners earn on referred orders in each currency, net of refunds.',
    base: 'partner_commission_eur',
  },
  {
    id: 'P2',
    why: 'rate note plus a sibling id both cite',
    by: ['Currency'],
    variants: [
      [
        'booked_revenue_eur',
        ['EUR'],
        'Revenue booked in EUR when an order is paid. See `refunds_eur` for money returned.',
      ],
      [
        'booked_revenue_usd',
        ['USD'],
        "Revenue booked in USD (EUR × the row's exchange rate) when an order is paid. See `refunds_eur` for money returned.",
      ],
    ],
    means:
      'Revenue booked in each currency when an order is paid. See `refunds_eur` for money returned.',
    base: 'booked_revenue_eur',
  },
  {
    id: 'P3',
    why: 'two people wrote the pair apart',
    by: ['Currency'],
    variants: [
      [
        'seller_payouts_eur',
        ['EUR'],
        'Payouts we send sellers in EUR, booked on the day they are sent.',
      ],
      ['seller_payouts_usd', ['USD'], "Seller payouts converted to USD at each month's rate."],
    ],
    means: null,
  },
  {
    id: 'P4',
    why: 'currencies named, not coded',
    by: ['Currency'],
    variants: [
      ['net_sales_eur', ['EUR'], 'Net sales in euros, after returns and before tax.'],
      ['net_sales_usd', ['USD'], 'Net sales in US dollars, after returns and before tax.'],
    ],
    means: 'Net sales in each currency, after returns and before tax.',
  },
  {
    id: 'P5',
    why: 'only one variant has words',
    by: ['Currency'],
    variants: [
      ['ad_spend_eur', ['EUR'], 'Money spent on paid ads in EUR, by day of spend.'],
      ['ad_spend_usd', ['USD'], null],
    ],
    means: null,
  },
  {
    id: 'P6',
    why: 'USD says "same as the EUR one"',
    by: ['Currency'],
    variants: [
      [
        'subscription_revenue_eur',
        ['EUR'],
        'Recurring revenue from active subscriptions in EUR, recognised monthly.',
      ],
      ['subscription_revenue_usd', ['USD'], 'Same as the EUR one, converted at the daily rate.'],
    ],
    means: 'Recurring revenue from active subscriptions in each currency, recognised monthly.',
    base: 'subscription_revenue_eur',
  },
  {
    id: 'P7',
    why: 'plain pair',
    by: ['Currency'],
    variants: [
      ['refund_value_eur', ['EUR'], 'Value of refunds issued in EUR.'],
      ['refund_value_usd', ['USD'], 'Value of refunds issued in USD.'],
    ],
    means: 'Value of refunds issued in each currency.',
  },
  {
    id: 'P8',
    why: 'same words, another order',
    by: ['Currency'],
    variants: [
      ['store_credit_eur', ['EUR'], 'Store credit issued in EUR, excluding gift cards.'],
      [
        'store_credit_usd',
        ['USD'],
        "Store credit issued, excluding gift cards, in USD (converted from EUR at the row's rate).",
      ],
    ],
    means: 'Store credit issued in each currency, excluding gift cards.',
    base: 'store_credit_eur',
  },
  {
    id: 'E1',
    why: 'USD copied the EUR words, "in euros" and all',
    by: ['Currency'],
    variants: [
      ['gross_bookings_eur', ['EUR'], 'Gross bookings from confirmed orders, in euros.'],
      ['gross_bookings_usd', ['USD'], 'Gross bookings from confirmed orders, in euros.'],
    ],
    means: null,
  },
  {
    id: 'E2',
    why: 'USD copied the EUR words with the code left in',
    by: ['Currency'],
    variants: [
      ['gross_revenue_eur', ['EUR'], 'Gross revenue in EUR from paid orders.'],
      ['gross_revenue_usd', ['USD'], 'Gross revenue in EUR from paid orders.'],
    ],
    means: null,
  },
  {
    id: 'C1',
    why: 'the base names its currency in words',
    by: ['Currency'],
    variants: [
      [
        'accrued_share_eur',
        ['EUR'],
        "The share of a contract's value booked in its first three months, in euros.",
      ],
      ['accrued_share_usd', ['USD'], "The EUR amount multiplied by the row's exchange rate."],
    ],
    conversions: [['accrued_share_eur', 'accrued_share_usd']],
    means: "The share of a contract's value booked in its first three months, in each currency.",
    base: 'accrued_share_eur',
  },
  {
    id: 'C2',
    why: 'the base names its code',
    by: ['Currency'],
    variants: [
      ['contract_value_eur', ['EUR'], 'Total contract value signed in EUR, at signing.'],
      ['contract_value_usd', ['USD'], "The EUR amount multiplied by the row's exchange rate."],
    ],
    conversions: [['contract_value_eur', 'contract_value_usd']],
    means: 'Total contract value signed in each currency, at signing.',
    base: 'contract_value_eur',
  },
  {
    id: 'C3',
    why: 'the base names no currency',
    by: ['Currency'],
    variants: [
      ['booked_margin_eur', ['EUR'], 'Gross margin on booked orders: revenue minus cost of goods.'],
      ['booked_margin_usd', ['USD'], "The EUR margin multiplied by the row's rate."],
    ],
    conversions: [['booked_margin_eur', 'booked_margin_usd']],
    means: 'Gross margin on booked orders: revenue minus cost of goods.',
    base: 'booked_margin_eur',
  },
  {
    id: 'C4',
    why: 'the base is a column formula',
    by: ['Currency'],
    variants: [
      ['order_amount_eur', ['EUR'], 'Sum of amount_eur over paid orders.'],
      ['order_amount_usd', ['USD'], 'amount_eur multiplied by fx_rate_usd.'],
    ],
    conversions: [['order_amount_eur', 'order_amount_usd']],
    means: 'Sum of amount_eur over paid orders.',
    base: 'order_amount_eur',
  },
  {
    id: 'C5',
    why: 'three currencies, two converted from one',
    by: ['Currency'],
    variants: [
      ['net_revenue_eur', ['EUR'], 'Net revenue in EUR after refunds.'],
      ['net_revenue_usd', ['USD'], "EUR amount × the row's USD rate."],
      ['net_revenue_gbp', ['GBP'], "EUR amount × the row's GBP rate."],
    ],
    conversions: [
      ['net_revenue_eur', 'net_revenue_usd'],
      ['net_revenue_eur', 'net_revenue_gbp'],
    ],
    means: 'Net revenue in each currency after refunds.',
    base: 'net_revenue_eur',
  },
  {
    id: 'L1',
    why: 'plain product line',
    by: ['Plan'],
    variants: [
      ['subs_basic', ['Basic'], 'Active subscriptions on the Basic plan, counted at month end.'],
      ['subs_plus', ['Plus'], 'Active subscriptions on the Plus plan, counted at month end.'],
      ['subs_pro', ['Pro'], 'Active subscriptions on the Pro plan, counted at month end.'],
    ],
    means: 'Active subscriptions on each plan, counted at month end.',
  },
  {
    id: 'L2',
    why: 'a plan named Free beside "free trial"',
    by: ['Plan'],
    variants: [
      ['users_free', ['Free'], 'Users on the Free plan, including those on a free trial.'],
      ['users_plus', ['Plus'], 'Users on the Plus plan, including those on a free trial.'],
      ['users_pro', ['Pro'], 'Users on the Pro plan, including those on a free trial.'],
    ],
    means: 'Users on each plan, including those on a free trial.',
  },
  {
    id: 'L3',
    why: 'a plan named Plus beside "plus"',
    by: ['Plan'],
    variants: [
      ['seats_plus', ['Plus'], 'Seats on the Plus plan, plus seats added mid-term.'],
      ['seats_pro', ['Pro'], 'Seats on the Pro plan, plus seats added mid-term.'],
    ],
    means: 'Seats on each plan, plus seats added mid-term.',
  },
  {
    id: 'L4',
    why: 'each product team wrote its own',
    by: ['Product'],
    variants: [
      [
        'weekly_orders_meal',
        ['Meal kits'],
        'Meal kit orders shipped in the week, Monday to Sunday.',
      ],
      [
        'weekly_orders_grocery',
        ['Grocery box'],
        'Weekly count of grocery boxes sent to customers.',
      ],
      ['weekly_orders_snack', ['Snack box'], 'Snack box orders that left the warehouse this week.'],
    ],
    means: null,
  },
  {
    id: 'L5',
    why: 'they count paused subscribers differently',
    by: ['Product'],
    variants: [
      ['active_fresh', ['Fresh'], 'Active Fresh subscribers, paused ones left out.'],
      ['active_pantry', ['Pantry'], 'Active Pantry subscribers, paused ones included.'],
    ],
    means: null,
  },
  {
    id: 'L6',
    why: 'value twice in one sentence',
    by: ['Product'],
    variants: [
      ['units_lite', ['Lite'], 'Units of Lite sold, including Lite bundles.'],
      ['units_max', ['Max'], 'Units of Max sold, including Max bundles.'],
    ],
    means: 'Units of each product sold, including each product bundles.',
  },
  {
    id: 'R1',
    why: 'each channel takes its own preposition',
    by: ['Channel'],
    variants: [
      ['orders_web', ['web'], 'Orders placed on the web, excluding test orders.'],
      ['orders_app', ['app'], 'Orders placed in the app, excluding test orders.'],
      ['orders_store', ['store'], 'Orders placed in store, excluding test orders.'],
    ],
    means: null,
  },
  {
    id: 'R2',
    why: 'plain region split',
    by: ['Region'],
    variants: [
      ['rev_emea', ['EMEA'], 'Revenue booked in EMEA, at list price.'],
      ['rev_apac', ['APAC'], 'Revenue booked in APAC, at list price.'],
      ['rev_latam', ['LATAM'], 'Revenue booked in LATAM, at list price.'],
    ],
    means: 'Revenue booked in each region, at list price.',
  },
  {
    id: 'R3',
    why: 'one region takes "the"',
    by: ['Region'],
    variants: [
      ['book_emea', ['EMEA'], 'Bookings in EMEA, at list price.'],
      ['book_apac', ['APAC'], 'Bookings in APAC, at list price.'],
      ['book_americas', ['Americas'], 'Bookings in the Americas, at list price.'],
    ],
    means: 'Bookings in each region, at list price.',
  },
  {
    id: 'R4',
    why: 'a channel named store beside "store pickup"',
    by: ['Channel'],
    variants: [
      ['online_web', ['web'], 'Orders placed via the web, store pickup included.'],
      ['online_app', ['app'], 'Orders placed via the app, store pickup included.'],
      ['online_store', ['store'], 'Orders placed via the store, store pickup included.'],
    ],
    means: 'Orders placed via each channel, store pickup included.',
  },
  {
    id: 'R5',
    why: '"through the web channel"',
    by: ['Channel'],
    variants: [
      ['sales_web', ['web'], 'Sales for orders paid through the web channel.'],
      ['sales_app', ['app'], 'Sales for orders paid through the app channel.'],
      ['sales_store', ['store'], 'Sales for orders paid through the store channel.'],
    ],
    means: 'Sales for orders paid through each channel.',
  },
  {
    id: 'K1',
    why: 'a country coded IN beside the word "in"',
    by: ['Country'],
    variants: [
      ['customers_de', ['DE'], 'Active customers in DE with an order in the last 90 days.'],
      ['customers_in', ['IN'], 'Active customers in IN with an order in the last 90 days.'],
      ['customers_us', ['US'], 'Active customers in US with an order in the last 90 days.'],
    ],
    means: 'Active customers in each country with an order in the last 90 days.',
  },
  {
    id: 'K2',
    why: 'the IN pair alone',
    by: ['Country'],
    variants: [
      ['lapsed_in', ['IN'], 'Customers in IN with no order in the last 180 days.'],
      ['lapsed_us', ['US'], 'Customers in US with no order in the last 180 days.'],
    ],
    means: 'Customers in each country with no order in the last 180 days.',
  },
  {
    id: 'K3',
    why: 'four alike, two reworded',
    by: ['Country'],
    variants: [
      ['repeat_de', ['DE'], 'Customers in DE with two or more paid orders this year.'],
      ['repeat_es', ['ES'], 'Customers in ES with two or more paid orders this year.'],
      ['repeat_nl', ['NL'], 'Customers in NL with two or more paid orders this year.'],
      ['repeat_be', ['BE'], 'Customers in BE with two or more paid orders this year.'],
      ['repeat_fr', ['FR'], 'FR customers who paid for at least two orders this year.'],
      ['repeat_it', ['IT'], 'Customers with 2+ paid orders this year, IT only.'],
    ],
    means: 'Customers in each country with two or more paid orders this year.',
  },
  {
    id: 'X1',
    why: 'three people, three wordings',
    by: ['Device'],
    variants: [
      ['basket_desktop', ['desktop'], 'Average items per paid order on desktop.'],
      ['basket_mobile', ['mobile'], 'Mean number of items in a paid mobile order.'],
      ['basket_tablet', ['tablet'], 'Items per order (paid) placed from a tablet.'],
    ],
    means: null,
  },
  {
    id: 'X2',
    why: 'three alike, two reworded',
    by: ['Region'],
    variants: [
      [
        'returns_north',
        ['North'],
        'Share of delivered orders returned within 30 days, North region.',
      ],
      [
        'returns_south',
        ['South'],
        'Share of delivered orders returned within 30 days, South region.',
      ],
      ['returns_east', ['East'], 'Share of delivered orders returned within 30 days, East region.'],
      ['returns_west', ['West'], 'Percent of delivered West orders sent back within 30 days.'],
      [
        'returns_central',
        ['Central'],
        'Returned share of delivered orders (30-day window), Central.',
      ],
    ],
    means: 'Share of delivered orders returned within 30 days, each region.',
  },
  {
    id: 'X3',
    why: 'all reworded',
    by: ['Carrier'],
    variants: [
      ['delivery_dhl', ['DHL'], 'Hours from dispatch to delivery for DHL parcels.'],
      [
        'delivery_ups',
        ['UPS'],
        'Average delivery time of UPS shipments, dispatch to doorstep, in hours.',
      ],
      ['delivery_gls', ['GLS'], 'Time in hours between GLS pickup and delivery.'],
    ],
    means: null,
  },
  {
    id: 'N1',
    why: 'identical words, no value in them',
    by: ['Device'],
    variants: [
      ['sessions_desktop', ['desktop'], 'Count of sessions with at least one page view.'],
      ['sessions_mobile', ['mobile'], 'Count of sessions with at least one page view.'],
    ],
    means: 'Count of sessions with at least one page view.',
  },
  {
    id: 'N2',
    why: 'no variant has words',
    by: ['Device'],
    variants: [
      ['views_desktop', ['desktop'], null],
      ['views_mobile', ['mobile'], null],
      ['views_tablet', ['tablet'], null],
    ],
    means: null,
  },
  {
    id: 'N3',
    why: 'one variant says more, truly',
    by: ['Channel'],
    variants: [
      ['cancelled_web', ['web'], 'Orders cancelled before shipping.'],
      ['cancelled_store', ['store'], 'Orders cancelled before shipping.'],
      [
        'cancelled_app',
        ['app'],
        'Orders cancelled before shipping. The app also counts cancelled pre-orders.',
      ],
    ],
    means: 'Orders cancelled before shipping.',
  },
]

describe('the meaning of invented families (M1)', () => {
  it.each(sets)('$id: $why', (set) => {
    const meaning = familyMeaning({
      by: set.by,
      variants: set.variants.map(([key, values, description]) => ({ key, values, description })),
      conversions: (set.conversions ?? []).map(([from, to]) => ({ from, to })),
      declared: null,
      chosen: null,
    })
    expect(meaning.words && meaningLine(meaning.words, set.by)).toBe(set.means)
    expect(meaning.base).toBe(set.base ?? null)
  })
})
