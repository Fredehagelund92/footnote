import { describe, expect, it } from 'vitest'
import { plainStep } from '../../src/server/modules/answer/loop-mock.ts'

// The plain read (the scripted reader, and a turn of the loop that stopped) writes each item that
// applies as its title, then its first sentence. A title that ends a sentence itself takes no colon.

const read = (items: { id: string; title: string; summary: string }[]) =>
  plainStep({
    question: 'What happened to online sales in Norway?',
    before: undefined,
    canRead: true,
    results: [
      { toolName: 'get_context', value: { read: { about: [] }, items } },
      { toolName: 'find_context', value: { items: [] } },
    ],
  }).text

describe('the plain read of an item', () => {
  it('writes a colon between a title and its sentence', () => {
    expect(
      read([
        {
          id: 'itm_1',
          title: 'Online sales to Norway stopped on 4 August 2026',
          summary: 'The carrier stopped parcels at the border. They resumed on 9 August.',
        },
      ]),
    ).toBe(
      'What is written.\n\nOnline sales to Norway stopped on 4 August 2026: The carrier stopped parcels at the border [itm_1].',
    )
  })

  it('writes no colon after a title that asks a question', () => {
    // It once read "...in February 2026?: What happened...".
    expect(
      read([
        {
          id: 'itm_2',
          title: 'What happened to online sales in Norway in February 2026?',
          summary: 'A storm closed the warehouse for three days. Orders were sent late.',
        },
      ]),
    ).toBe(
      'What is written.\n\nWhat happened to online sales in Norway in February 2026? A storm closed the warehouse for three days [itm_2].',
    )
  })
})
