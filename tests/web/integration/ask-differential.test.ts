import { describe, expect, it } from 'vitest'
import { people } from '@/api/mock/data/world'
import { devPeople } from '../http/demo-week.ts'
import { askWorld } from './ask-world.ts'
import { disclosure, type Cell } from './ask-disclosure.ts'

/*
  Ask's differential tests (docs/evaluations.md): on the demo week, through the real service, for
  each person, every count Asked this week states must be the number that person's Observability
  shows. A count Ask keeps by a path of its own fails here, whoever asks.
*/

const world = askWorld()

const persons = devPeople()
  .map((p) => p.name)
  .filter((name) => people.some((p) => p.name === name))

const { expectedRows } = disclosure((name) => world.as(name))

describe.each(persons)('as %s', (name) => {
  it("Asked this week counts what agents asked as the reader's Observability does", async () => {
    const api = await world.as(name)
    const expected = await expectedRows(name)
    const week = await api.askedThisWeek()
    const cellOf = (c: Cell) => (!c ? null : c.count !== null ? `${c.count}` : `${c.atLeast}+`)
    const listed = [...expected].filter(([, c]) => c && (c.count ?? c.atLeast) >= 5)
    expect(new Map(week.rows.map((r) => [r.title, r.count]))).toEqual(
      new Map(listed.map(([title, c]) => [title, cellOf(c)])),
    )
  })
})
