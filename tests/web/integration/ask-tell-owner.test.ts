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
// Ravi Kapoor is an admin.
const ADMIN = 'Ravi Kapoor'

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

  it("tells the admins about a word Ask could not find: the word alone, as the gap's note", async () => {
    const reader = await world.as(READER)
    const { id } = await reader.tellOwner({ about: [], word: 'EBITDA' })
    // The topic of no metric and no value this month: only admins manage it.
    const card = (await gapCards(ADMIN)).find((c) => c.id === `gap:${id}`)
    expect(card?.title).toMatch(/^“EBITDA”, [A-Z][a-z]+ \d{4}$/)
    expect((await gapCards(OWNER)).some((c) => c.id === `gap:${id}`)).toBe(false)
    expect(JSON.stringify(card)).not.toContain(READER)
    // The word is kept as the report's note, and nothing else of the question.
    const { rows } = await world.client.query<{ note: string; source: string }>(
      'select note, source from gap_notes where gap_id = $1',
      [id],
    )
    expect(rows).toEqual([{ note: 'EBITDA', source: 'person' }])
    // A second word counts against the same gap, as its own note.
    expect((await reader.tellOwner({ about: [], word: 'CAC' })).id).toBe(id)
    const notes = await world.client.query<{ note: string }>(
      'select note from gap_notes where gap_id = $1 order by note',
      [id],
    )
    expect(notes.rows.map((r) => r.note)).toEqual(['CAC', 'EBITDA'])
  })

  it('refuses a word sent with a subject, and a word that carries personal data', async () => {
    // Another reader who owns no domain, so the reports per minute of the first are not spent.
    const reader = await world.as('Maria Lindqvist')
    await expect(reader.tellOwner({ about: ['metric:orders'], word: 'EBITDA' })).rejects.toThrow(
      /word alone/,
    )
    await expect(reader.tellOwner({ about: [], word: 'ines@example.com' })).rejects.toThrow(
      /email address/,
    )
  })
})
