import { withWhen, type Fact } from '@/model/items'

/**
 * What ?demo=imported adds to Context: 21 drafts Jon Abara brought in from the team wiki, never
 * published, to review and publish from the list at once. Two have no source yet, so the editor's
 * checks keep them back.
 */
const notes: [title: string, summary: string, domain: Fact['domain'], where: string[]][] = [
  [
    'Orders in Norway include click and collect',
    'Click and collect orders in Norway count as webshop orders on the day they are placed.',
    'sales',
    ['Orders', 'Norway'],
  ],
  [
    'Orders in Sweden exclude staff purchases',
    'Orders in Sweden leave out purchases made with a staff discount code.',
    'sales',
    ['Orders', 'Sweden'],
  ],
  [
    'Orders in Germany count gift cards when they are used',
    'A gift card sold in Germany counts as an order only when someone pays with it.',
    'sales',
    ['Orders', 'Germany'],
  ],
  [
    'Orders in France count marketplace sales',
    'Orders in France include what Larchwood sells through the outdoor marketplace.',
    'sales',
    ['Orders', 'France'],
  ],
  [
    'Returns in Norway are counted when the parcel arrives',
    'A return in Norway counts on the day the warehouse receives the parcel.',
    'sales',
    ['Returns', 'Norway'],
  ],
  [
    'Net revenue in Spain is after card fees',
    'Net revenue in Spain is what is left after the card provider takes its fee.',
    'sales',
    ['Net revenue', 'Spain'],
  ],
  [
    'Gross margin in Spain uses last month’s costs',
    'Gross margin in Spain is worked out with the product costs of the month before.',
    'sales',
    ['Gross margin', 'Spain'],
  ],
  [
    'Units sold in Norway count bundles as one',
    'A tent bundle sold in Norway counts as one unit, not one per part.',
    'sales',
    ['Units sold', 'Norway'],
  ],
  [
    'New customers in Spain are counted by email address',
    'A new customer in Spain is an email address that has not ordered before.',
    'sales',
    ['New customers', 'Spain'],
  ],
  [
    'First-time buyers in Spain exclude guest checkouts',
    'First-time buyers in Spain leave out orders made without an account.',
    'sales',
    ['First-time buyers', 'Spain'],
  ],
  [
    'Discount cost in Norway includes free shipping',
    'Discount cost in Norway counts free shipping as a discount.',
    'sales',
    ['Discount cost', 'Norway'],
  ],
  [
    'Discount cost in Italy is booked when the order ships',
    'Discount cost in Italy is booked on the day the order ships, not when it is placed.',
    'sales',
    ['Discount cost', 'Italy'],
  ],
  [
    'Support contacts in Norway count chats and calls',
    'Support contacts in Norway are chats and phone calls; emails are not counted.',
    'sales',
    ['Support contacts', 'Norway'],
  ],
  [
    'Orders count a split delivery once',
    'An order sent in two parcels still counts as one order.',
    'sales',
    ['Orders'],
  ],
  [
    'Orders count a cancelled order until it is refunded',
    'A cancelled order stays in Orders until its refund is booked.',
    'sales',
    ['Orders'],
  ],
  [
    'Marketing spend is booked in the week the invoice arrives',
    'Marketing spend counts in the week its invoice arrives, not the week the ads ran.',
    'marketing',
    ['Marketing spend'],
  ],
  [
    'Return on ad spend leaves out brand campaigns',
    'Return on ad spend is worked out only for campaigns that link to a product.',
    'marketing',
    ['Return on ad spend'],
  ],
  [
    'Return on ad spend in Norway counts orders for 7 days',
    'Return on ad spend in Norway credits an ad with orders placed up to 7 days after a click.',
    'marketing',
    ['Return on ad spend', 'Norway'],
  ],
  [
    'Marketing spend includes agency fees',
    'Marketing spend includes what the agency charges, not only the ads.',
    'marketing',
    ['Marketing spend'],
  ],
  [
    'Returns in Spain leave out exchanges',
    'An exchange in Spain is not counted as a return.',
    'sales',
    ['Returns', 'Spain'],
  ],
  [
    'Orders in Norway leave out test orders',
    'Orders in Norway leave out orders placed with the test card.',
    'sales',
    ['Orders', 'Norway'],
  ],
]

/** The id every imported draft starts with: its writer's Inbox has one card for them. */
export const IMPORTED = 'itm_draft_imported_'

export const importedDrafts = (): Fact[] =>
  notes.map(([title, summary, domain, where], i) =>
    withWhen({
      id: `${IMPORTED}${String(i + 1).padStart(2, '0')}`,
      title,
      summary,
      domain,
      kind: 'note',
      where,
      valid: { ongoing: true },
      status: 'Draft',
      by: 'Jon Abara',
      checkedBy: '',
      checkedOn: '',
      // The last two came without a source.
      source: i >= notes.length - 2 ? '' : `https://wiki.example/data/notes-${i + 1}`,
      quote: i >= notes.length - 2 ? '' : summary,
      dontConclude: '',
    }),
  )

/**
 * What ?demo=backlog adds to Context: 60 drafts Jon Abara brought in from the team wiki, all ready,
 * more than one Publish takes, so the list's bar publishes them in two presses.
 */
export const backlogDrafts = (): Fact[] =>
  Array.from({ length: 60 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0')
    const summary = `Wiki note ${n} on orders in Norway, as the team wrote it down.`
    return withWhen({
      id: `itm_draft_backlog_${n}`,
      title: `Orders in Norway, wiki note ${n}`,
      summary,
      domain: 'sales',
      kind: 'note',
      where: ['Orders', 'Norway'],
      valid: { ongoing: true },
      status: 'Draft',
      by: 'Jon Abara',
      checkedBy: '',
      checkedOn: '',
      source: `https://wiki.example/data/backlog-${n}`,
      quote: summary,
      dontConclude: '',
    })
  })
