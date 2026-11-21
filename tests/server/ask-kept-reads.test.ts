import { describe, expect, it } from 'vitest'
import { UTC_CALENDAR } from '../../src/domain/dates.ts'
import { systemClock } from '../../src/server/clock.ts'
import {
  createBundleCache,
  createKeptReads,
  toolReadsIn,
  type ToolServices,
  type TurnReads,
} from '../../src/server/modules/answer/index.ts'

/*
  What Ask's turns read of the person's workspace, and how often (Ask's speed budget,
  docs/releasing.md): each read once a turn, however many transactions the turn's reads take, and
  the catalogue and the words written in Definitions kept between a person's turns while the live
  edition is the same. Which items the person may read is read every turn (FR-718.3).
*/

/** Services that count each read, as the person's request would make it. */
function counted() {
  const reads: Record<string, number> = {}
  const count =
    <T>(name: string, value: T) =>
    () => {
      reads[name] = (reads[name] ?? 0) + 1
      return Promise.resolve(value)
    }
  const services = {
    library: {
      getIndex: count('index', { items: [], loadedAt: '', today: '' }),
      getReadable: count('readable', []),
    },
    areas: { list: count('areas', []) },
    catalogue: { list: count('catalogue', { terms: [] }) },
    terms: { list: count('glossary', { terms: [] }), history: count('termHistory', []) },
    context: { page: count('page', null) },
    conflicts: { list: count('conflicts', { pairs: [] }) },
    cards: { feed: count('inbox', { groups: [] }) },
    people: count('people', []),
  } as unknown as ToolServices
  return { reads, services }
}

const readsOf = (services: ToolServices, kept: TurnReads) =>
  toolReadsIn({} as never, systemClock(), createBundleCache(), services, UTC_CALENDAR, kept)

/** Every read a view of the edition makes but the bundle, the way a tool's transaction does. */
const viewRead = async (reads: ReturnType<typeof readsOf>) => {
  await reads.readable()
  await reads.catalogue()
  await reads.areas()
  await reads.people()
  await reads.glossary()
}

describe("the reads of Ask's turns", () => {
  it('are made once a turn, however many transactions read them', async () => {
    const { reads, services } = counted()
    const turn = createKeptReads().turn('p_ada', 'e1')
    for (let tx = 0; tx < 3; tx++) await viewRead(readsOf(services, turn))
    expect(reads).toEqual({ readable: 1, catalogue: 1, areas: 1, people: 1, glossary: 1 })
  })

  it('keep the catalogue and the words between turns on the same edition, never what may be read', async () => {
    const { reads, services } = counted()
    const kept = createKeptReads()
    await viewRead(readsOf(services, kept.turn('p_ada', 'e1')))
    await viewRead(readsOf(services, kept.turn('p_ada', 'e1')))
    expect(reads).toEqual({ readable: 2, catalogue: 1, areas: 2, people: 2, glossary: 1 })
    // Another person reads their own.
    await viewRead(readsOf(services, kept.turn('p_jon', 'e1')))
    expect(reads.catalogue).toBe(2)
  })

  it('read everything again on a new edition, and after the time they are kept', async () => {
    const { reads, services } = counted()
    let now = 0
    const kept = createKeptReads(1000, () => now)
    await viewRead(readsOf(services, kept.turn('p_ada', 'e1')))
    await viewRead(readsOf(services, kept.turn('p_ada', 'e2')))
    expect(reads.catalogue).toBe(2)
    now = 999
    await viewRead(readsOf(services, kept.turn('p_ada', 'e2')))
    expect(reads.catalogue).toBe(2)
    now = 1000
    await viewRead(readsOf(services, kept.turn('p_ada', 'e2')))
    expect(reads.catalogue).toBe(3)
  })
})
