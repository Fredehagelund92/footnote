import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FootnoteApi } from '@/api/client'
import { createMockApi } from '@/api/mock'
import type { Fact } from '@/model/items'
import type { HelpEvent } from '@/model/writing-help'

// Writing help on the mock (Route 3): a design preview with no model, which plays the first minute
// and the changes it can make by rule, each field landing on its own, stamped as writing help's,
// so the editor shows the demo as it shows the service.

const blank: Fact = {
  id: 'new',
  title: '',
  summary: '',
  domain: 'sales',
  kind: 'event',
  where: [],
  valid: {},
  when: 'Always',
  status: 'Draft',
  checkedBy: '',
  checkedOn: '',
  source: '',
  quote: '',
  dontConclude: '',
}

async function on(api: FootnoteApi) {
  await api.signIn({ name: 'Jon Abara' })
  const { writingHelp } = await api.advancedPage()
  await api.setWritingHelp({ on: true, version: writingHelp!.version })
}

/** A turn played through: the mock's pauses between fields are its own, not the test's to wait for. */
async function played<T>(turn: Promise<T>): Promise<T> {
  turn.catch(() => undefined)
  await vi.runAllTimersAsync()
  return turn
}

describe('writing help on the mock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fills a blank draft from a message, a field at a time, and asks one question', async () => {
    const { api } = createMockApi()
    await on(api)
    const { id } = await api.startWritingHelp({ fact: blank, isNew: true })
    const events: HelpEvent[] = []
    const reply = await played(
      api.writingHelp({
        draftId: id,
        message: 'Ops told us about Norway. https://customs.example/notices/2026-08-04',
        live: { onEvent: (event) => void events.push(event) },
      }),
    )
    expect(reply).toMatchObject({
      reply:
        'I wrote a draft from your message and the notice. Check each field, then send it to the owner of Sales.',
      // The kind was an Event already: a field that says the same is not written again.
      changed: ['title', 'where', 'when', 'source', 'text'],
      links: { read: 1, problem: null },
      question: { answers: ['Yes, add it', 'No, leave it empty'] },
      stopped: null,
    })
    expect(events[0]).toEqual({ type: 'progress', progress: { doing: 'reading', links: 1 } })
    expect(events.filter((e) => e.type === 'written')).toHaveLength(5)
    const draft = (await api.draftNow({ id }))!
    expect(draft.title).toBe('Online sales to Norway stopped on 4 August 2026')
    expect(draft.untitled ?? false).toBe(false)
    expect(draft.session!.revision).toBe(6)
    expect(draft.session!.fields.title).toMatchObject({ by: 'writing_help', mark: 'prefilled' })
    expect(draft.session!.fields.kind).toBeUndefined()
  })

  it('adds what not to conclude, makes the text shorter, and says what it cannot do here', async () => {
    const { api } = createMockApi()
    await on(api)
    const { id } = await api.startWritingHelp({ fact: blank, isNew: true })
    await played(api.writingHelp({ draftId: id, message: 'Ops told us about Norway.' }))
    const added = await played(api.writingHelp({ draftId: id, message: 'Yes, add it' }))
    expect(added).toMatchObject({ reply: "Added to Don't conclude.", changed: ['dontConclude'] })
    const shorter = await played(
      api.writingHelp({ draftId: id, message: 'Can you make it shorter?' }),
    )
    expect(shorter.changed).toEqual(['text'])
    expect((await api.draftNow({ id }))!.body).toBeUndefined()
    const other = await played(
      api.writingHelp({ draftId: id, message: 'What were orders last week?' }),
    )
    expect(other.changed).toEqual([])
    expect(other.reply).toContain('I can’t do that in this demo')
    // The person's own save takes a field back as theirs.
    const draft = (await api.draftNow({ id }))!
    const edited = { ...draft, title: 'Webshop sales to Norway stopped' }
    await api.autosaveDraft({ fact: edited, before: draft, revision: draft.session!.revision })
    const now = (await api.draftNow({ id }))!
    expect(now.session!.fields.title).toMatchObject({ by: 'person' })
    expect(now.session!.fields.dontConclude).toMatchObject({ by: 'writing_help' })
  })

  it('is refused while it is off, over the most characters, and on a draft that is not there', async () => {
    const { api } = createMockApi()
    await api.signIn({ name: 'Jon Abara' })
    const off = await api.startWritingHelp({ fact: blank, isNew: true }).catch((e: unknown) => e)
    expect(off).toMatchObject({ message: 'An admin has turned off writing help.' })
    await on(api)
    const { id } = await api.startWritingHelp({ fact: blank, isNew: true })
    const long = await api
      .writingHelp({ draftId: id, message: 'a'.repeat(12_001) })
      .catch((e: unknown) => e)
    expect(long).toMatchObject({
      kind: 'invalid',
      message:
        'That is 12,001 characters, and writing help reads at most 12,000 at once. Paste the part that matters.',
    })
    const gone = await api
      .writingHelp({ draftId: 'itm_nope', message: 'Hello' })
      .catch((e: unknown) => e)
    expect(gone).toMatchObject({ kind: 'not-found' })
    // Stopped part way: what it wrote so far stays, and the rest never comes.
    const stop = new AbortController()
    const stopped = await played(
      api
        .writingHelp({
          draftId: id,
          message: 'Ops told us about Norway.',
          live: {
            signal: stop.signal,
            onEvent: (event) => {
              if (event.type === 'written') stop.abort()
            },
          },
        })
        .catch((e: unknown) => e),
    )
    expect(stopped).toMatchObject({ name: 'AbortError' })
    const draft = (await api.draftNow({ id }))!
    expect(draft.title).toBe('Online sales to Norway stopped on 4 August 2026')
    expect(draft.source).toBe('')
  })
})
