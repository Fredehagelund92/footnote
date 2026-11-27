import { describe, expect, it } from 'vitest'
import { draftsVerb, draftsWords } from '@/model/inbox'

// The person's own drafts card in the Inbox (FR-230): what it is called, and what its one button
// does with the drafts.

describe('the drafts card', () => {
  it('says how many drafts wait, and why: imported, left for 30 days, or both', () => {
    expect(draftsWords({ imported: 21, agent: 0, old: 0 }).title).toBe('21 drafts from your import')
    expect(draftsWords({ imported: 0, agent: 0, old: 3 }).title).toBe(
      '3 drafts not saved for 30 days',
    )
    expect(draftsWords({ imported: 1, agent: 0, old: 0 }).title).toBe('1 draft from your import')
    expect(draftsWords({ imported: 2, agent: 0, old: 1 }).title).toBe('3 drafts waiting for you')
    expect(draftsWords({ imported: 1_200, agent: 0, old: 0 }).title).toBe(
      '1,200 drafts from your import',
    )
    // An agent that wrote a document's items as drafts: they wait here for the person to review.
    expect(draftsWords({ imported: 0, agent: 12, old: 0 }).title).toBe('12 drafts from your agents')
    expect(draftsWords({ imported: 0, agent: 1, old: 0 }).title).toBe('1 draft from your agents')
    expect(draftsWords({ imported: 0, agent: 12, old: 1 }).title).toBe('13 drafts waiting for you')
  })

  it('says only the writer sees them, in the number they are', () => {
    expect(draftsWords({ imported: 2, agent: 0, old: 0 }).line).toBe(
      'Only you can see them. Agents get them once they are published.',
    )
    expect(draftsWords({ imported: 0, agent: 0, old: 1 }).line).toBe(
      'Only you can see it. Agents get it once it is published.',
    )
  })

  it('names its button by what it does: publish where the person may, and send the rest', () => {
    expect(draftsVerb(21, 0)).toBe('Publish all')
    expect(draftsVerb(0, 21)).toBe('Send all')
    expect(draftsVerb(12, 9)).toBe('Publish 12, send 9')
    // When it leaves some behind, such as drafts that need a fix first, it says how many it takes.
    expect(draftsVerb(19, 0, false)).toBe('Publish 19')
    expect(draftsVerb(0, 4, false)).toBe('Send 4')
    expect(draftsVerb(12, 7, false)).toBe('Publish 12, send 7')
  })
})
