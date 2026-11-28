import { describe, expect, it } from 'vitest'
import { whenLabel } from '@/model/validity'
import { createKeptReads } from '../../../src/server/modules/answer/index.ts'
import { ADMIN } from './ask-disclosure.ts'
import { askWorld } from './ask-world.ts'

/*
  A follow-up in Ask after a publish (FR-718.3), on the demo week: a person's turns share what the
  live edition governs, and a publish does not change the live edition's key, so the count of items
  about a metric must still be read afresh by the next turn.
*/

const world = askWorld()

describe('a follow-up after a publish', () => {
  it('counts the items about a metric as they are now, on the same live edition', async () => {
    const kept = createKeptReads()
    const itemsAbout = (name: string) =>
      world.withTools(
        ADMIN,
        async (tools) => {
          const found = await tools.run('definitions', { names: [name] })
          if (!('definitions' in found)) throw new Error('definitions failed')
          return found.definitions[0]!.items
        },
        kept.turn(ADMIN, 'the same edition'),
      )

    const before = await itemsAbout('Orders')
    expect(before).toBeGreaterThan(0)

    const api = await world.as(ADMIN)
    const { items } = await api.getLibrary()
    const from = items.find((f) => f.status === 'Live' && f.title.includes('Orders'))!
    const { item } = (await api.itemPage({ id: from.id }))!
    const valid = { from: '2031-01-01', until: '2031-01-02' }
    const overlaps = items.filter(
      (f) =>
        (f.status === 'Live' || f.status === 'Needs a recheck') &&
        item.where.every((w) => f.where.includes(w)),
    )
    await api.saveItem({
      fact: {
        ...item,
        id: 'new',
        title: 'A follow-up test item about Orders',
        status: 'Live',
        owners: undefined,
        valid,
        when: whenLabel(valid),
      },
      isNew: true,
      relations: Object.fromEntries(overlaps.map((f) => [f.id, 'unrelated' as const])),
    })

    expect(await itemsAbout('Orders')).toBe(before! + 1)
  })
})
