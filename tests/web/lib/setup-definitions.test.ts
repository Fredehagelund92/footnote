import { describe, expect, it } from 'vitest'
import { nextStepWords, nextSteps, nextWords, NEXT_UNTIL } from '@/lib/next-steps'
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

// What comes after the checklist (the cold first use test, the owner's call 3): a Next card until
// five context items are published, the metrics agents asked about first.
describe('the Next card', () => {
  const uncovered = ['MRR', 'Churn Rate', 'Signups', 'Trial starts']

  it('names the metrics with nothing written, those agents asked about first, then a colleague and documents', () => {
    expect(
      nextSteps({ published: 1, uncovered, asked: ['Churn Rate, October 2026'], admin: true }),
    ).toEqual([
      { kind: 'metric', metric: 'Churn Rate', asked: true },
      { kind: 'metric', metric: 'MRR', asked: false },
      { kind: 'metric', metric: 'Signups', asked: false },
      { kind: 'people' },
      { kind: 'documents' },
    ])
  })

  it('matches a whole name only: Churn is not Churn Rate', () => {
    const steps = nextSteps({
      published: 0,
      uncovered: ['Churn', 'Churn Rate'],
      asked: ['Churn Rate in Norway, May 2026'],
      admin: false,
    })
    expect(steps).toEqual([
      { kind: 'metric', metric: 'Churn Rate', asked: true },
      { kind: 'metric', metric: 'Churn', asked: false },
    ])
  })

  it('goes by itself once five items are published, and offers a member only what they write', () => {
    expect(nextSteps({ published: NEXT_UNTIL, uncovered, asked: [], admin: true })).toBeNull()
    expect(nextSteps({ published: 4, uncovered: [], asked: [], admin: false })).toBeNull()
    expect(nextSteps({ published: 4, uncovered: [], asked: [], admin: true })).toEqual([
      { kind: 'people' },
      { kind: 'documents' },
    ])
    expect(nextWords(2).count).toBe('2 of 5 published')
  })

  it('says why each metric is there', () => {
    expect(nextStepWords({ kind: 'metric', metric: 'MRR', asked: true })).toEqual({
      title: 'Write about MRR',
      description: 'Agents asked about it and found nothing written down.',
      action: 'Write context',
    })
    expect(nextStepWords({ kind: 'metric', metric: 'MRR', asked: false }).description).toBe(
      'Nothing is written about it yet, so agents who ask get Not found.',
    )
  })
})
