import type { LoopBlock, LoopItem, LoopTurn } from '@contract/answer'

// Answers that cite many items, for the journeys that hold the Used section's size
// (`?example=loop-used-10`). The service's turns on the demo week cite at most a few, so these are
// built from the shape of its Orders answer (loop-checked): N live items in Sales, each cited once,
// one sentence each, as the words of an answer about all of Orders would cite them.

const titles = [
  'Orders lags by one day in the source tool',
  'Payment provider switched in France on 12 May 2026',
  'Net revenue in Spain includes VAT',
  'Online sales to Norway stopped on 4 August 2026',
  'Data for Orders before 19 January 2026 is not reliable',
  'Marketplace orders arrive in a weekly batch on Mondays',
  'Gift card orders are left out of Orders',
  'Webshop outage on 7 October 2026 lost about four hours of orders',
  'Orders in Canada are converted to euros at the month-end rate',
  'Orders in Sweden are booked when the payment clears',
]
const kinds = ['warning', 'event', 'note', 'event', 'note']
const checked = ['2026-09-12', '2026-10-02', '2026-08-21', '2026-11-03', '2026-07-30', '2026-10-19']
const sales = 'domain:area_sales'
const orders = 'metric:orders'

/** The nth item an answer about all of Orders cites, from 1. */
const itemOf = (n: number): LoopItem => {
  const title = titles[(n - 1) % titles.length]!
  const round = Math.floor((n - 1) / titles.length)
  return {
    id: `itm_used${String(n).padStart(3, '0')}`,
    title: round ? `${title} (${round + 1})` : title,
    kind: kinds[(n - 1) % kinds.length]!,
    domain: sales,
    about: [orders],
    status: 'live',
    checked: checked[(n - 1) % checked.length]!,
    outOfDate: null,
    n,
  }
}

/** An answer about all of Orders that cites `count` live items. */
export function usedTurn(count: number): LoopTurn {
  const items = Array.from({ length: count }, (_, i) => itemOf(i + 1))
  const sentence = (i: LoopItem) => `${i.title}.`
  const body: LoopBlock[] = [
    {
      t: 'p',
      runs: items.flatMap((i, k) => [
        { t: 'text' as const, text: `${k ? ' ' : ''}${sentence(i)}` },
        { t: 'cite' as const, n: i.n! },
      ]),
    },
  ]
  const text = items.map((i) => `${sentence(i)}[${i.n}]`).join(' ')
  const applies = Math.max(count, 20)
  return {
    kind: 'answer',
    text,
    sources: items.map((i) => i.id),
    state: 'grounded',
    footer: {
      denominator: `${applies} of 1,209 published context items you may read apply.`,
      notSeen: null,
      stale: null,
    },
    read: [`Looked up Orders, 1-16 Nov 2026: ${applies} items apply.`],
    subject: {
      names: ['Orders'],
      about: [orders],
      period: '1-16 Nov 2026',
      note: null,
      assumedToday: false,
      carried: false,
      uncovered: [],
    },
    nearby: [],
    conflict: [],
    definitions: [],
    choices: [],
    reads: [
      { tool: 'get_context', input: { about: 'orders', from: '2026-11-01', to: '2026-11-16' } },
    ],
    stopped: null,
    body,
    said: items.map((i) => `${sentence(i)}[${i.id}]`).join(' '),
    nouns: [
      { id: orders, name: 'Orders', of: null, type: null },
      { id: sales, name: 'Sales', of: null, type: null },
    ],
    items,
    closest: null,
    owners: [],
    overview: null,
    checks: [],
  }
}
