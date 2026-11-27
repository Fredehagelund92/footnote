import { describe, expect, it } from 'vitest'
import { helpEventOf, helpReplyOf } from '@/api/http-writing-help'

// What a turn of writing help on the service tells the dock, by the editor's fields.

describe('a turn of writing help, as the dock hears it', () => {
  it("names what it wrote by the editor's fields, the summary and the text as one", () => {
    expect(
      helpReplyOf({
        reply: 'I wrote the draft.',
        changed: ['title', 'summary', 'text', 'scope', 'window', 'evidence', 'not_to_conclude'],
        kept: ['kind'],
        refused: [{ field: 'summary', why: 'Its words read like orders to an AI agent.' }],
        question: { text: 'From which day?', answers: ['4 August', 'I am not sure'] },
        links: { read: 1, problem: null },
        revision: 9,
        stopped: null,
        limit: null,
      }),
    ).toEqual({
      reply: 'I wrote the draft.',
      changed: ['title', 'text', 'where', 'when', 'source', 'dontConclude'],
      kept: ['kind'],
      refused: [{ field: 'text', why: 'Its words read like orders to an AI agent.' }],
      question: { text: 'From which day?', answers: ['4 August', 'I am not sure'] },
      links: { read: 1, problem: null },
      stopped: null,
      limit: null,
    })
  })

  it('tells the page what it is doing, and of a write only when it changed a field', () => {
    expect(helpEventOf({ type: 'progress', doing: 'reading', links: 1 })).toEqual({
      type: 'progress',
      progress: { doing: 'reading', links: 1 },
    })
    expect(helpEventOf({ type: 'progress', doing: 'looking' })).toEqual({
      type: 'progress',
      progress: { doing: 'looking' },
    })
    expect(helpEventOf({ type: 'progress', doing: 'writing', field: 'summary' })).toEqual({
      type: 'progress',
      progress: { doing: 'writing', field: 'text' },
    })
    expect(helpEventOf({ type: 'progress', doing: 'writing' })).toEqual({
      type: 'progress',
      progress: { doing: 'writing' },
    })
    expect(
      helpEventOf({
        type: 'written',
        applied: ['summary', 'text'],
        kept: [],
        refused: [],
        revision: 3,
      }),
    ).toEqual({ type: 'written', changed: ['text'] })
    expect(
      helpEventOf({ type: 'written', applied: [], kept: ['title'], refused: [], revision: 3 }),
    ).toBeNull()
    expect(helpEventOf({ type: 'words', text: 'I wrote' })).toEqual({
      type: 'words',
      text: 'I wrote',
    })
  })
})
