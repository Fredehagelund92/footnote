import { describe, expect, it } from 'vitest'
import type { WritingHelpEvent, WritingHelpTurn } from '@contract/writing-help'
import { helpEventOf, helpReplyOf, helpTurn } from '@/api/http-writing-help'
import type { HelpEvent } from '@/model/writing-help'

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

const turnOf = (extra: Partial<WritingHelpTurn> = {}): WritingHelpTurn => ({
  reply: 'I wrote the title.',
  changed: ['title'],
  kept: [],
  refused: [],
  question: null,
  links: { read: 0, problem: null },
  revision: 4,
  stopped: null,
  limit: null,
  ...extra,
})

describe('refusals, by the editor’s field', () => {
  it('keeps one line for each field, the summary and the text refused as one, each reason once', () => {
    const reply = helpReplyOf(
      turnOf({
        refused: [
          { field: 'summary', why: 'Its words read like orders to an AI agent.' },
          { field: 'text', why: 'Its words read like orders to an AI agent.' },
          { field: 'text', why: 'It is too long.' },
          { field: 'kind', why: 'It is not a kind.' },
        ],
      }),
    )
    expect(reply.refused).toEqual([
      { field: 'text', why: 'Its words read like orders to an AI agent. It is too long.' },
      { field: 'kind', why: 'It is not a kind.' },
    ])
  })
})

describe('a turn on the service', () => {
  const streamOf = (events: WritingHelpEvent[]) =>
    // eslint-disable-next-line @typescript-eslint/require-await
    (async function* () {
      for (const event of events) yield event
    })()

  it('tells the page each event as the editor’s fields, says the draft changed on each write, and gives the turn', async () => {
    const heard: HelpEvent[] = []
    let changes = 0
    const opened: unknown[] = []
    const reply = await helpTurn(
      {
        draftId: 'd1',
        message: 'Write it up.',
        live: { onEvent: (event) => void heard.push(event) },
      },
      (input) => {
        opened.push(input)
        return Promise.resolve(
          streamOf([
            { type: 'progress', doing: 'writing', field: 'summary' },
            { type: 'written', applied: ['summary'], kept: [], refused: [], revision: 2 },
            { type: 'written', applied: [], kept: ['title'], refused: [], revision: 2 },
            { type: 'words', text: 'I wrote' },
            { type: 'turn', turn: turnOf() },
          ]),
        )
      },
      () => void changes++,
    )
    expect(opened).toEqual([{ draftId: 'd1', message: 'Write it up.' }])
    expect(heard).toEqual([
      { type: 'progress', progress: { doing: 'writing', field: 'text' } },
      { type: 'written', changed: ['text'] },
      { type: 'words', text: 'I wrote' },
    ])
    // Once on each write, and once more when the stream is over.
    expect(changes).toBe(3)
    expect(reply).toMatchObject({ reply: 'I wrote the title.', changed: ['title'] })
  })

  it('gives nothing when the stream ends before its turn, and still says the draft may have changed', async () => {
    let changes = 0
    const reply = await helpTurn(
      { draftId: 'd1', message: 'Write it up.' },
      () =>
        Promise.resolve(
          streamOf([{ type: 'written', applied: ['title'], kept: [], refused: [], revision: 2 }]),
        ),
      () => void changes++,
    )
    expect(reply).toBeUndefined()
    expect(changes).toBe(2)
  })
})
