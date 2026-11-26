import { afterAll, describe, expect, it } from 'vitest'
import { seedPersonId } from '../../db/seed/bulk.ts'
import { NAMES_CARD_MAX } from '../../src/domain/names-card.ts'
import { systemClock } from '../../src/server/clock.ts'
import { apiDatabase, askToolsAs, testDatabase } from './support.ts'

/*
  The names card in Ask's prompt (FR-718.8) at the demo's real size, with no model: the 1,500
  items of the bulk seed. The card is the names Definitions shows the person; the cases are the
  recorded get_context reads that read no subject because the model sent the person's words
  (23 November 2026 replay), each read again by the name the card gives. DEMO DATA ONLY.
*/

const { client, url } = testDatabase({ seeded: true })
const database = apiDatabase(url)
const asTools = askToolsAs(database, systemClock('2026-11-23'))
const administrator = seedPersonId('per_ravi')
const member = seedPersonId('per_maria')
afterAll(() => database.close())

const cardOf = async (person: string) => (await asTools(person, (tools) => tools.card()))!
/** The names of one list of the card: "Metrics: Orders; Gross sales." gives both. */
const listed = (card: string, label: string) =>
  (card.split('\n').find((l) => l.startsWith(`${label}:`)) ?? '')
    .slice(label.length + 1, -1)
    .split('; ')
    .map((entry) => entry.trim().replace(/ \(.*\)$/, ''))
    .filter(Boolean)

/** The metrics a get_context read of these words reads, as the person. */
const metricsRead = (person: string, input: Record<string, unknown>) =>
  asTools(person, async (tools) => {
    const read = await tools.run('get_context', { no_period: true, ...input })
    expect(read).not.toHaveProperty('error')
    const about = 'read' in read ? (read.read?.about ?? []) : []
    return about.filter((key) => key.startsWith('metric:'))
  })

describe('the names card on the demo', () => {
  it('names every metric, group, dimension and domain, well under the cap', async () => {
    const card = await cardOf(administrator)
    expect(listed(card, 'Metrics')).toHaveLength(22)
    expect(listed(card, 'Metrics').slice(0, 2)).toEqual(['Orders', 'Gross sales'])
    expect(listed(card, 'Groups of metrics')).toEqual(
      expect.arrayContaining(['Customers', 'Marketing', 'Revenue', 'Operations']),
    )
    expect(card).toContain('Market (12 values, such as ')
    expect(listed(card, 'Domains')).toEqual(
      expect.arrayContaining(['Sales', 'Marketing', 'Customer value', 'Paid media']),
    )
    // About 400 tokens: a quarter of the cap, so nothing is cut.
    expect(card.length).toBeLessThan(NAMES_CARD_MAX / 3)
    expect(card).not.toContain('is cut')
    // Names only: no item, no id and no definition's words.
    expect(card).not.toMatch(/itm_|metric:|[0-9a-f]{8}-[0-9a-f]{4}/)
  })

  it('is the same card in every turn, as the prompt cache needs', async () => {
    expect(await cardOf(member)).toBe(await cardOf(member))
  })

  // The words the model sent, read no subject; the card's name for what the person meant does.
  // A market's name the card need not list: it gives a few values of each dimension.
  const misses = [
    { question: 'Hva betyr netto omsetning?', sent: 'netto omsetning', meant: 'Net revenue' },
    {
      question: '¿Por qué bajaron los pedidos en Noruega en agosto?',
      sent: 'pedidos Noruega agosto 2026',
      meant: 'Orders',
      also: ' Norway',
    },
  ]
  it.each(misses)('gives the name that reads "$question"', async ({ sent, meant, also = '' }) => {
    expect(await metricsRead(member, { about: sent })).toEqual([])
    expect(listed(await cardOf(member), 'Metrics')).toContain(meant)
    expect(await metricsRead(member, { about: meant + also })).toHaveLength(1)
  })

  it('never names what Definitions hides from the person, an administrator included', async () => {
    // Support contacts and On-time shipping rate, all of Operations, and Platform with its values,
    // for a group nobody is in (CON-509).
    const hidden = ['metric:support_contacts', 'metric:on_time_shipping_rate', 'dim:platform']
    const limit = (groups: string | null) =>
      client.query(
        `update definitions set visible_groups = $2
          where ref in (select unnest(definition_refs) from serving_vocabulary((select seq from live_edition))
                         where key = any($1))`,
        [hidden, groups],
      )
    await limit('{finance}')
    try {
      for (const person of [member, administrator]) {
        const card = await cardOf(person)
        expect(listed(card, 'Metrics')).toHaveLength(20)
        expect(card).not.toContain('Support contacts')
        expect(card).not.toContain('On-time shipping rate')
        // A group with none of its metrics left is not named; Platform's values go with it.
        expect(listed(card, 'Groups of metrics')).not.toContain('Operations')
        expect(card).not.toMatch(/Platform|Android|iOS/)
      }
    } finally {
      await limit(null)
    }
    expect(await cardOf(member)).toContain('Support contacts')
  })
})
