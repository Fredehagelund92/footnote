import { withWhen, type Fact, type StoredFact } from '@/model/items'
import { dayMonthYear } from '@/lib/dates'
import { DEMO_TODAY } from '@/lib/today'
import { domains, metrics } from './world'

/**
 * What ?demo=many adds to Context: 5,000 published items over 40 markets and four channels, from
 * 2024 to 2027, so By time can be seen holding a large library. Made by a seeded generator, so
 * every load is the same. Invented, as the rest of the demo.
 */

const MARKETS = [
  'Norway',
  'Spain',
  'France',
  'Sweden',
  'Germany',
  'Italy',
  'Denmark',
  'Finland',
  'Netherlands',
  'Belgium',
  'Austria',
  'Switzerland',
  'Poland',
  'Portugal',
  'Ireland',
  'United Kingdom',
  'Czechia',
  'Hungary',
  'Greece',
  'Romania',
  'Estonia',
  'Latvia',
  'Lithuania',
  'Slovakia',
  'Slovenia',
  'Croatia',
  'Bulgaria',
  'Iceland',
  'Luxembourg',
  'Canada',
  'United States',
  'Mexico',
  'Brazil',
  'Chile',
  'Australia',
  'New Zealand',
  'Japan',
  'South Korea',
  'Singapore',
]
const CHANNELS = ['Marketplace', 'Paid search', 'Email', 'Organic']
const DAY = 86_400_000

/** A small seeded random source (mulberry32): the same items on every load. */
function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10)

export function manyFacts(n = 5000): Fact[] {
  const r = seeded(7919)
  const pick = <T>(list: readonly T[]) => list[Math.floor(r() * list.length)]!
  const today = Date.parse(`${DEMO_TODAY}T00:00:00Z`)
  const first = Date.UTC(2024, 0, 15)
  // A few markets hold most of the items, as a real library would.
  const weights = [1.3, ...MARKETS.map((_, i) => 1 / Math.sqrt(i + 2))]
  const sum = weights.reduce((a, b) => a + b, 0)
  const market = () => {
    let u = r() * sum
    for (let i = 0; i < weights.length; i++) if ((u -= weights[i]!) <= 0) return MARKETS[i - 1]
    return undefined
  }
  const metricsWithDomain = metrics.filter((m) => m.domain && m.domain in domains)
  const facts: Fact[] = []
  for (let i = 0; i < n; i++) {
    const m = pick(metricsWithDomain)
    const where = market()
    const channel = r() < 0.3 ? pick(CHANNELS) : undefined
    const inWhere = where ? ` in ${where}` : ''
    const start = first + Math.floor(Math.pow(r(), 0.8) * ((today - first) / DAY + 160)) * DAY
    const u = r()
    const kind: Fact['kind'] = u < 0.4 ? 'event' : u < 0.62 ? 'issue' : u < 0.86 ? 'note' : 'guide'
    let valid: StoredFact['valid']
    let title: string
    const days = (a: number, b: number) =>
      start + Math.round(a + Math.pow(r(), 1.6) * (b - a)) * DAY
    if (kind === 'event' && r() < 0.6) {
      const [t, end] = pick([
        [`Summer sale${inWhere}`, days(14, 45)],
        [`Regulator paused price promotions${inWhere}`, days(20, 120)],
        [`Warehouse${inWhere} closed for a move`, days(5, 30)],
        [`Launch campaign${inWhere}`, days(14, 60)],
        [`Delivery strike${inWhere}`, days(2, 14)],
        [`Payment outage${inWhere}`, days(0, 3)],
      ] as const)
      title = t
      valid = { from: iso(start), until: iso(end) }
    } else if (kind === 'event') {
      title = `${pick(['Payment provider switched', 'New price list', 'Minimum order for free delivery raised'])}${inWhere} on ${dayMonthYear(start, { utc: true })}`
      valid = { from: iso(start), ongoing: true }
    } else if (kind === 'issue' && r() < 0.5) {
      title = `${m.name}${inWhere} ${pick(['misses app orders', 'double counts split deliveries'])}`
      valid = { from: iso(start), until: iso(days(3, 200)) }
    } else if (kind === 'issue') {
      title = `${m.name}${inWhere} lags by one day in the source tool`
      valid = { from: iso(start), ongoing: true }
    } else if (kind === 'note' && r() < 0.4) {
      title = `${m.name}${inWhere} ${pick(['includes VAT', 'excludes test accounts', 'counts gift cards when used'])}`
      valid = {}
    } else if (kind === 'note') {
      title = `${m.name}${inWhere} includes marketplace fees`
      valid = { from: iso(start) }
    } else {
      title = `How to read ${m.name}${inWhere} after the new price list`
      valid = r() < 0.5 ? {} : { from: iso(start) }
    }
    const checked = Math.max(first, today - Math.floor(Math.pow(r(), 2.6) * 260) * DAY)
    const owners = domains[m.domain!]!.owners
    facts.push(
      withWhen({
        id: `itm_many_${String(i + 1).padStart(4, '0')}`,
        title,
        summary: `${title}. One of the invented items of a large library.`,
        domain: m.domain!,
        kind,
        where: [m.name, ...(where ? [where] : []), ...(channel ? [channel] : [])],
        values: [
          ...(where ? [{ dimension: 'Market', name: where }] : []),
          ...(channel ? [{ dimension: 'Channel', name: channel }] : []),
        ],
        valid,
        status: today - checked > 90 * DAY ? 'Due for a check' : 'Live',
        checkedBy: pick(owners),
        checkedOn: dayMonthYear(checked, { utc: true }),
        source: `https://wiki.example/data/many-${i + 1}`,
        quote: title,
        dontConclude: '',
      }),
    )
  }
  return facts
}
