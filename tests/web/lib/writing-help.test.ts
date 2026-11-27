import { describe, expect, it } from 'vitest'
import {
  askHelp,
  helpNow,
  moveHelpChat,
  noteHelpChange,
  setHelpDesk,
  stopHelp,
  undoHelp,
  type HelpDesk,
} from '@/lib/writing-help'
import type { AgentChange, SessionForm } from '@/model/draft-session'
import type { HelpLive, HelpReply } from '@/model/writing-help'
import { ApiError } from '@/api/errors'

// Writing help between the editor and the dock (Route 3): a turn, its chat and what it changed are
// kept beside the page, so they outlast the page being drawn again; one Undo takes back one turn.

const form: SessionForm = {
  title: '',
  body: '',
  kind: 'event',
  domain: 'sales',
  owners: [],
  where: [],
  when: 'always',
  from: '',
  until: '',
  source: '',
  quote: '',
  dontConclude: '',
}
const reply = (extra: Partial<HelpReply> = {}): HelpReply => ({
  reply: 'I wrote the title.',
  changed: ['title'],
  kept: [],
  refused: [],
  question: null,
  links: { read: 0, problem: null },
  stopped: null,
  limit: null,
  ...extra,
})
const change = (fields: AgentChange['fields'], after: Partial<SessionForm>): AgentChange => ({
  agent: 'Writing help',
  fields,
  at: '2026-11-27T10:00:00.000Z',
  before: form,
  after: { ...form, ...after },
})

/** A page that holds a draft, with what the turn's model does when it is asked. */
function desk(draftId: string | null, ask: HelpDesk['ask'] = () => Promise.resolve(reply())) {
  const calls: string[] = []
  const reverted: AgentChange[] = []
  const made: HelpDesk = {
    draftId,
    ready: () => {
      calls.push('ready')
      return Promise.resolve(draftId)
    },
    ask: (input, live) => {
      calls.push(`ask ${input.message}`)
      return ask(input, live)
    },
    refresh: () => {
      calls.push('refresh')
      return Promise.resolve()
    },
    revert: (c) => void reverted.push(c),
  }
  return { desk: made, calls, reverted }
}
const settled = () => new Promise((resolve) => setTimeout(resolve, 5))

describe('a turn of writing help', () => {
  it('stores the draft first, asks, shows what it hears, and reads the draft as each field lands', async () => {
    let live: HelpLive | undefined
    let answer!: (r: HelpReply) => void
    const page = desk('d1', (_input, l) => {
      live = l
      return new Promise<HelpReply>((resolve) => (answer = resolve))
    })
    setHelpDesk(page.desk)
    const asking = askHelp('  Ops told us about Norway.  ')
    await settled()
    expect(helpNow()).toMatchObject({ busy: true, latest: null })
    expect(helpNow().turns[0]).toMatchObject({ said: 'Ops told us about Norway.', state: 'asking' })
    live!.onEvent!({ type: 'progress', progress: { doing: 'writing', field: 'title' } })
    live!.onEvent!({ type: 'written', changed: ['title'] })
    // The page merged the field the turn wrote: it is this turn's change.
    noteHelpChange('d1', change(['title'], { title: 'Norway' }))
    live!.onEvent!({ type: 'written', changed: ['text'] })
    noteHelpChange('d1', change(['text'], { title: 'Norway', body: 'Stopped.' }))
    answer(reply({ changed: ['title', 'text'], kept: ['when'] }))
    await asking
    expect(page.calls).toEqual([
      'ready',
      'ask Ops told us about Norway.',
      'refresh',
      'refresh',
      'refresh',
    ])
    const now = helpNow()
    expect(now.busy).toBe(false)
    expect(now.turns[0]).toMatchObject({ state: 'done', changed: ['title', 'text'] })
    // One change for the whole turn, with what kept the person's words.
    expect(now.latest).toMatchObject({
      turn: now.turns[0]!.id,
      change: { fields: ['title', 'text'], kept: ['when'], after: { body: 'Stopped.' } },
    })
  })

  it('sends the earlier answered turns along, and takes one turn at a time', async () => {
    const sent: { said: string; reply: string }[][] = []
    const page = desk('d2', (input) => {
      sent.push(input.turns)
      return Promise.resolve(reply({ reply: `Did: ${input.message}` }))
    })
    setHelpDesk(page.desk)
    await askHelp('First.')
    const second = askHelp('Second.')
    // While one runs, another is not started.
    await askHelp('Ignored.')
    await second
    expect(helpNow().turns.map((t) => t.said)).toEqual(['First.', 'Second.'])
    expect(sent).toEqual([[], [{ said: 'First.', reply: 'Did: First.' }]])
  })

  it('takes back one turn with Undo, then the turn before it', async () => {
    const page = desk('d3')
    setHelpDesk(page.desk)
    await askHelp('One.')
    noteHelpChange('d3', change(['title'], { title: 'One' }))
    const first = helpNow().turns[0]!.id
    let live: HelpLive | undefined
    let answer!: (r: HelpReply) => void
    page.desk.ask = (_input, l) => {
      live = l
      return new Promise<HelpReply>((resolve) => (answer = resolve))
    }
    const asking = askHelp('Two.')
    await settled()
    live!.onEvent!({ type: 'written', changed: ['text'] })
    noteHelpChange('d3', change(['text'], { body: 'Two' }))
    // Undo waits for the turn that is running.
    undoHelp()
    expect(page.reverted).toEqual([])
    answer(reply({ changed: ['text'] }))
    await asking
    const second = helpNow().turns[1]!.id
    expect(helpNow().latest?.turn).toBe(second)
    undoHelp()
    expect(page.reverted.map((c) => c.fields)).toEqual([['text']])
    expect(helpNow().turns[1]).toMatchObject({ undone: true })
    // A change made with no turn running here came before the second turn started.
    expect(helpNow().latest).toMatchObject({ turn: '', change: { fields: ['title'] } })
    undoHelp()
    expect(page.reverted.map((c) => c.fields)).toEqual([['text'], ['title']])
    expect(helpNow().latest).toBeNull()
    expect(helpNow().turns.find((t) => t.id === first)).toMatchObject({ undone: false })
  })

  it('says a stopped turn as stopped, and a turn that could not be asked with why', async () => {
    const page = desk(
      'd4',
      (_input, live) =>
        new Promise<HelpReply>((_resolve, reject) =>
          live.signal!.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    )
    setHelpDesk(page.desk)
    const asking = askHelp('Write it up.')
    await settled()
    stopHelp()
    await asking
    expect(helpNow().turns[0]).toMatchObject({ state: 'stopped' })

    page.desk.ask = () =>
      Promise.reject(new ApiError('failed', 'An admin has turned off writing help.'))
    await askHelp('Again.')
    expect(helpNow().turns[1]).toMatchObject({
      state: 'failed',
      problem: 'An admin has turned off writing help.',
    })
    page.desk.ask = () => Promise.reject(new ApiError('unanswered', "You're offline."))
    await askHelp('Offline.')
    expect(helpNow().turns[2]).toMatchObject({ state: 'failed', problem: null })
    // The words could not be stored first: nothing is asked.
    page.desk.ready = () => Promise.reject(new ApiError('conflict', 'It was sent already.'))
    page.calls.length = 0
    await askHelp('Unsaved.')
    expect(helpNow().turns[3]).toMatchObject({ state: 'failed', problem: 'It was sent already.' })
    expect(page.calls).toEqual([])
  })
})

describe('a page with no draft yet', () => {
  it('keeps its words as a draft, moves to it, and starts the turn once that page is there', async () => {
    const fresh = desk(null)
    fresh.desk.ready = () => {
      // The editor keeps the draft, hands the chat over and moves to the draft's page.
      moveHelpChat('d5')
      return Promise.resolve(null)
    }
    setHelpDesk(fresh.desk)
    await askHelp('Ops told us about Norway.')
    expect(fresh.calls).toEqual([])
    // The page is drawn again before it settles: the new page, then the same page once more.
    setHelpDesk(null)
    const first = desk('d5')
    setHelpDesk(first.desk)
    expect(helpNow().turns[0]).toMatchObject({ said: 'Ops told us about Norway.', state: 'asking' })
    setHelpDesk(null)
    const again = desk('d5')
    setHelpDesk(again.desk)
    await settled()
    // The turn ran once, and reads the draft through the page that is there now.
    expect(first.calls.filter((c) => c.startsWith('ask'))).toEqual([
      'ask Ops told us about Norway.',
    ])
    expect(again.calls.filter((c) => c.startsWith('ask'))).toEqual([])
    expect(again.calls).toContain('refresh')
    expect(helpNow().turns[0]).toMatchObject({ state: 'done' })
  })

  it('starts the turn where the page goes on as the draft it kept, whichever comes first', async () => {
    // A new item keeps itself as a draft and stays where it is: the page may say it holds the
    // draft before the chat is handed over, or after.
    for (const [id, holdsFirst] of [
      ['d6', true],
      ['d7', false],
    ] as const) {
      const fresh = desk(null)
      const kept = desk(id)
      fresh.desk.ready = () => {
        if (holdsFirst) setHelpDesk(kept.desk)
        moveHelpChat(id)
        if (!holdsFirst) setHelpDesk(kept.desk)
        return Promise.resolve(null)
      }
      setHelpDesk(fresh.desk)
      await askHelp('Ops told us about Norway.')
      await settled()
      expect(
        kept.calls.filter((c) => c.startsWith('ask')),
        id,
      ).toEqual(['ask Ops told us about Norway.'])
      expect(helpNow().turns[0], id).toMatchObject({ state: 'done' })
      setHelpDesk(null)
    }
  })

  it('stops a turn once no page holds its draft', async () => {
    let stopped = false
    const page = desk(
      'd6',
      (_input, live) =>
        new Promise<HelpReply>((_resolve, reject) =>
          live.signal!.addEventListener('abort', () => {
            stopped = true
            reject(new Error('aborted'))
          }),
        ),
    )
    setHelpDesk(page.desk)
    const asking = askHelp('Write it up.')
    await settled()
    setHelpDesk(null)
    await asking
    expect(stopped).toBe(true)
  })
})
