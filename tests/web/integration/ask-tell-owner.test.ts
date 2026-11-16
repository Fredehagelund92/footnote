import { describe, expect, it } from 'vitest'
import { askWorld } from './ask-world.ts'

/*
  Tell the owner (decision 7 of the chat audit), through the real service and the browser's own
  binding on the demo week: a reader who may not write, under a Not found answer, tells the owners
  that nothing is written about its subject. It is the report of kind missing agents file, a gap on
  the subject's topic, so a card waits in the domain owner's Inbox; it names no one, and another
  report about the same subject counts against the same gap.
*/

const world = askWorld()
// Ines Duarte owns no domain; Sofia Brandt owns Sales, which holds Orders.
const READER = 'Ines Duarte'
const OWNER = 'Sofia Brandt'

const gapCards = async (name: string) =>
  (await (await world.as(name)).getInbox()).cards.filter((c) => c.type === 'gap')

describe('Tell the owner', () => {
  it("puts a card in the domain owner's Inbox, naming no one, and counts another report against the same gap", async () => {
    const reader = await world.as(READER)
    const subject = { about: ['metric:orders', 'value:market/poland'], dates: '1 to 31 Aug 2026' }
    const { id } = await reader.tellOwner(subject)
    const card = (await gapCards(OWNER)).find((c) => c.id === `gap:${id}`)
    expect(card).toMatchObject({
      title: 'Orders in Poland, August 2026',
      line: 'Someone asked Ask about this, found nothing written down and told you.',
    })
    expect(JSON.stringify(card)).not.toContain(READER)
    // The reader manages no gap, so the card is not in their own Inbox.
    expect((await gapCards(READER)).some((c) => c.title === card!.title)).toBe(false)
    // Told again about the same subject, the same gap counts it: people's reports, never who.
    const again = await reader.tellOwner(subject)
    expect(again.id).toBe(id)
    const { rows } = await world.client.query<{ reports: number; human: number }>(
      `select sum(reports)::int as reports, sum(human_reports)::int as human
         from gap_weekly_counts where gap_id = $1`,
      [id],
    )
    expect(rows[0]).toEqual({ reports: 2, human: 2 })
  })
})
