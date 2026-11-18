import { describe, expect, it } from 'vitest'
import { definitionsStep, setupSteps } from '@/lib/setup'

// The checklist's definitions step (snag 5 of the release judge): an install the server started on
// its own model folder waits for that folder's read, says so, and never offers to connect a tool.

const folder = (read: boolean) => ({ id: 'cube', read })
const own = setupSteps.find((s) => s.id === 'definitions')!

describe('the definitions step', () => {
  it('says a read is on its way, and offers nothing, until the folder is read', () => {
    expect(definitionsStep(folder(false), 0)).toEqual({
      description:
        'Reading the definitions this server was started on. Their names show here when the read ends.',
      action: null,
      opens: 'source',
    })
  })

  it('publishes the names the read left waiting', () => {
    expect(definitionsStep(folder(true), 5)).toMatchObject({
      action: 'Publish 5 names',
      opens: 'names',
    })
    expect(definitionsStep(folder(true), 1).action).toBe('Publish 1 name')
  })

  it("opens the folder's page, not the connect flow, after a read that left no names waiting", () => {
    expect(definitionsStep(folder(true), 0)).toMatchObject({
      action: 'Open the read',
      opens: 'source',
    })
  })

  it('offers to connect a tool only where the server reads no definitions of its own', () => {
    expect(definitionsStep(null, 0)).toEqual({
      description: own.description,
      action: 'Connect',
      opens: 'connect',
    })
    for (const read of [false, true])
      for (const waiting of [0, 3])
        expect(definitionsStep(folder(read), waiting).opens).not.toBe('connect')
  })
})
