import { describe, expect, it } from 'vitest'
import {
  changedSince,
  personChangedSince,
  stampsAfter,
  type FieldStamps,
} from '../../../src/domain/draft-stamps.ts'

/*
  Who last changed each field of a draft (Route 1, slice R1a): a write from an agent that read an
  older revision never overwrites a field the person changed since, field by field.
*/

const at = '2026-11-27T10:00:00.000Z'

describe('the stamps on a draft', () => {
  it('stamps each changed field with who changed it, and keeps the rest', () => {
    const before = { title: 'Orders closed', summary: 'Closed.' }
    const first = stampsAfter({}, {}, before, { by: 'agent', revision: 1, at })
    expect(first).toEqual({
      title: { by: 'agent', revision: 1, at },
      summary: { by: 'agent', revision: 1, at },
    })
    const after = { ...before, title: 'Webshop closed' }
    expect(stampsAfter(first, before, after, { by: 'person', revision: 2, at })).toEqual({
      title: { by: 'person', revision: 2, at },
      summary: { by: 'agent', revision: 1, at },
    })
  })
  it("refuses only what the person changed after the agent's revision", () => {
    const stamps: FieldStamps = {
      title: { by: 'person', revision: 3, at },
      summary: { by: 'agent', revision: 4, at },
      validity: { by: 'person', revision: 2, at },
    }
    expect(personChangedSince(stamps, ['title', 'summary', 'window'], 2)).toEqual(['title'])
    expect(personChangedSince(stamps, ['title', 'summary', 'window'], 3)).toEqual([])
    expect(changedSince(stamps, 2)).toEqual(['title', 'summary'])
    expect(changedSince(stamps, 0)).toEqual(['title', 'summary', 'window'])
  })
})
