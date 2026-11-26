import { describe, expect, it } from 'vitest'
import { definitionsStep, setupSteps } from '@/lib/setup'

// The checklist's names step (snag 5 of the release judge): an install the server started on its
// own model folder waits for that folder's read, says so, and never offers to connect a tool.

const folder = (state: 'reading' | 'read' | 'failed') => ({ id: 'cube', state })
const own = setupSteps.find((s) => s.id === 'definitions')!

describe('the definitions step', () => {
  it('says a read is on its way, and offers nothing, until the folder is read', () => {
    expect(definitionsStep(folder('reading'), 0)).toEqual({
      description:
        'Reading the definitions this server was started on. Their names show here when the read ends.',
      action: null,
      opens: 'source',
    })
  })

  it('publishes the names the read left waiting', () => {
    expect(definitionsStep(folder('read'), 5)).toMatchObject({
      description: 'Once published, questions and context name them.',
      action: 'Publish 5 names',
      opens: 'names',
    })
    expect(definitionsStep(folder('read'), 1).action).toBe('Publish 1 name')
  })

  it('says where names with no domain go, and what a domain is (F08)', () => {
    expect(definitionsStep(folder('read'), 5, { id: null, name: 'Revenue' }).description).toBe(
      'They go under Revenue, a new domain you own. A domain is a part of the business with an owner.',
    )
    expect(definitionsStep(null, 2, { id: 'sales', name: 'Sales' }).description).toBe(
      'They go under Sales.',
    )
  })

  it("opens the folder's page, not the connect flow, after a read that left no names waiting", () => {
    expect(definitionsStep(folder('read'), 0)).toMatchObject({
      action: 'Open the read',
      opens: 'source',
    })
  })

  it("says the read failed and opens the folder's page when no read of it was good", () => {
    expect(definitionsStep(folder('failed'), 0)).toEqual({
      description:
        'The definitions this server was started on could not be read. Their page says why.',
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
    for (const state of ['reading', 'read', 'failed'] as const)
      for (const waiting of [0, 3])
        expect(definitionsStep(folder(state), waiting).opens).not.toBe('connect')
  })
})
