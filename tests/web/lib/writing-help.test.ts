import { describe, expect, it } from 'vitest'
import {
  askHelp,
  helpNow,
  moveHelpChat,
  noteHelpChange,
  noteHelpSuggestion,
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
  said: '',
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
function desk(
  draftId: string | null,
  ask: HelpDesk['ask'] = () => Promise.resolve(reply()),
  page = 'new',
) {
  const calls: string[] = []
  const reverted: AgentChange[] = []
  const made: HelpDesk = {
    page,
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

describe('a field the person is writing in while a turn writes it', () => {
  it('is kept with the turn that wrote it, also when the page reads it after the turn ended', async () => {
    let live: HelpLive | undefined
    let answer!: (r: HelpReply) => void
    let read!: () => void
    const page = desk('s1', (_input, l) => {
      live = l
      return new Promise<HelpReply>((resolve) => (answer = resolve))
    })
    setHelpDesk(page.desk)
    const asking = askHelp('Make the title say webshop.')
    await settled()
    live!.onEvent!({ type: 'written', changed: ['title'] })
    // The page kept the person's title: writing help's waits under it.
    noteHelpSuggestion('s1', ['title'])
    expect(helpNow().turns[0]).toMatchObject({ state: 'asking', suggested: ['title'] })
    // The last read of the draft hangs: what it brings in still belongs to the turn.
    page.desk.refresh = () => new Promise<void>((resolve) => (read = resolve))
    answer(reply({ changed: ['title', 'text'] }))
    await settled()
    noteHelpSuggestion('s1', ['text'])
    read()
    await asking
    expect(helpNow().turns[0]).toMatchObject({ state: 'done', suggested: ['title', 'text'] })
    // Nothing came into the form, so there is no change to take back.
    expect(helpNow().latest).toBeNull()
    // With no turn on the draft, as a change made in another window, nothing is noted.
    noteHelpSuggestion('s1', ['when'])
    expect(helpNow().turns[0]!.suggested).toEqual(['title', 'text'])
  })
})

describe('a turn that ended while the page cannot read the draft', () => {
  it('ends as done, stopped or failed before the read settles, and its changes still join its Undo', async () => {
    let settle!: () => void
    const page = desk('d13')
    page.desk.refresh = () => new Promise<void>((resolve) => (settle = resolve))
    setHelpDesk(page.desk)
    const asking = askHelp('Write it up.')
    await settled()
    noteHelpChange('d13', change(['title'], { title: 'Norway' }))
    await settled()
    expect(helpNow().turns[0]).toMatchObject({ state: 'done' })
    expect(helpNow().busy).toBe(false)
    // The read is still waiting, and what comes in now is still this turn's change.
    noteHelpChange('d13', change(['text'], { title: 'Norway', body: 'Stopped.' }))
    settle()
    await asking
    expect(helpNow().latest).toMatchObject({ change: { fields: ['title', 'text'] } })

    page.desk.ask = () => Promise.reject(new ApiError('unanswered', "You're offline."))
    page.desk.refresh = () => new Promise<void>(() => undefined)
    void askHelp('Offline.')
    await settled()
    expect(helpNow().turns[1]).toMatchObject({ state: 'failed', problem: null })
    expect(helpNow().busy).toBe(false)
    setHelpDesk(null)
  })
})

describe('Undo and Stop around the ends of a turn', () => {
  it('takes back an ended turn while the read of the draft hangs, and the read still joins it', async () => {
    let arrive!: () => void
    const page = desk('d14')
    page.desk.refresh = () => new Promise<void>((resolve) => (arrive = resolve))
    setHelpDesk(page.desk)
    void askHelp('Write it up.')
    await settled()
    noteHelpChange('d14', change(['title'], { title: 'Norway' }))
    // The turn is done and its read is still waiting: Undo works now.
    expect(helpNow().turns[0]).toMatchObject({ state: 'done' })
    noteHelpChange('d14', change(['text'], { title: 'Norway', body: 'Stopped.' }))
    undoHelp()
    expect(page.reverted).toHaveLength(1)
    expect(page.reverted[0]).toMatchObject({ fields: ['title', 'text'] })
    expect(helpNow().turns[0]).toMatchObject({ undone: true })
    arrive()
    setHelpDesk(null)
  })

  it('ends a turn stopped before it started as stopped, and never asks it', async () => {
    const page = desk('d15')
    let ready!: (id: string) => void
    page.desk.ready = () => new Promise<string | null>((resolve) => (ready = resolve))
    setHelpDesk(page.desk)
    const asking = askHelp('Write it up.')
    await settled()
    stopHelp()
    ready('d15')
    await asking
    expect(helpNow().turns[0]).toMatchObject({ state: 'stopped' })
    expect(helpNow().busy).toBe(false)
    expect(page.calls.filter((c) => c.startsWith('ask'))).toEqual([])
    setHelpDesk(null)
  })

  it('ends a turn stopped while it waits for its draft’s page as stopped, and never starts it', async () => {
    const fresh = desk(null)
    fresh.desk.ready = () => {
      moveHelpChat('d16')
      return Promise.resolve(null)
    }
    setHelpDesk(fresh.desk)
    await askHelp('Ops told us about Norway.')
    stopHelp()
    const kept = desk('d16')
    setHelpDesk(kept.desk)
    await settled()
    expect(helpNow().turns[0]).toMatchObject({ state: 'stopped' })
    expect(kept.calls.filter((c) => c.startsWith('ask'))).toEqual([])
    setHelpDesk(null)
  })
})

describe('Stop while the draft is being made ready, with its page already there', () => {
  it('never asks the turn, and nothing overwrites its stopped state', async () => {
    const fresh = desk(null)
    const kept = desk('d19')
    fresh.desk.ready = () => {
      setHelpDesk(kept.desk)
      stopHelp()
      moveHelpChat('d19')
      return Promise.resolve(null)
    }
    setHelpDesk(fresh.desk)
    await askHelp('Ops told us about Norway.')
    await settled()
    expect(kept.calls.filter((c) => c.startsWith('ask'))).toEqual([])
    expect(helpNow().turns[0]).toMatchObject({ state: 'stopped' })
    expect(helpNow().busy).toBe(false)
    setHelpDesk(null)
  })
})

describe('the chat of a page with no draft yet', () => {
  it('is the page’s own: another page with no draft does not show it', async () => {
    const first = desk(null, undefined, 'item-1')
    first.desk.ready = () => Promise.reject(new ApiError('failed', 'Not just now.'))
    setHelpDesk(first.desk)
    await askHelp('Write it up.')
    expect(helpNow().turns[0]).toMatchObject({ state: 'failed', problem: 'Not just now.' })
    setHelpDesk(null)
    const other = desk(null, undefined, 'item-2')
    setHelpDesk(other.desk)
    expect(helpNow().turns).toEqual([])
    setHelpDesk(first.desk)
    expect(helpNow().turns).toHaveLength(1)
    setHelpDesk(null)
  })

  it('moves to the draft it becomes, from the page that made it', async () => {
    const other = desk(null, undefined, 'item-3')
    other.desk.ready = () => Promise.reject(new ApiError('failed', 'Not just now.'))
    setHelpDesk(other.desk)
    await askHelp('Hello.')
    const page = desk(null, undefined, 'item-4')
    page.desk.ready = () => {
      moveHelpChat('d18')
      return Promise.resolve(null)
    }
    setHelpDesk(page.desk)
    await askHelp('Ops told us about Norway.')
    setHelpDesk(null)
    setHelpDesk(desk('d18').desk)
    await settled()
    expect(helpNow().turns.map((t) => t.said)).toEqual(['Ops told us about Norway.'])
    setHelpDesk(null)
  })
})

describe('the opening line of a chat reached from a card', () => {
  const fromAsk = {
    known: 'From Ask: this item was last checked on 20 Jun 2026.',
    ask: 'What changed since then?',
  }

  it('is the page’s, and a page reached from no card has none', () => {
    setHelpDesk({ ...desk(null, undefined, 'item-5').desk, opening: fromAsk })
    expect(helpNow().opening).toEqual(fromAsk)
    setHelpDesk(null)
    setHelpDesk(desk(null, undefined, 'item-5').desk)
    expect(helpNow().opening).toBeNull()
    setHelpDesk(null)
  })

  it('moves with the chat to the draft it becomes, whose page was reached from no card', async () => {
    const page = desk(null, undefined, 'item-6')
    page.desk.ready = () => {
      moveHelpChat('d30')
      return Promise.resolve(null)
    }
    setHelpDesk({ ...page.desk, opening: fromAsk })
    await askHelp('It ended on 3 October.')
    setHelpDesk(null)
    setHelpDesk(desk('d30').desk)
    await settled()
    expect(helpNow().opening).toEqual(fromAsk)
    expect(helpNow().turns.map((t) => t.said)).toEqual(['It ended on 3 October.'])
    setHelpDesk(null)
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

  it('shows the turn that waits for its draft’s page, busy, until the page is there', async () => {
    const fresh = desk(null)
    fresh.desk.ready = () => {
      moveHelpChat('d8')
      return Promise.resolve(null)
    }
    setHelpDesk(fresh.desk)
    await askHelp('Ops told us about Norway.')
    // The chat is filed under the draft, and no page holds it yet: the dock still shows it.
    setHelpDesk(null)
    expect(helpNow()).toMatchObject({ busy: true })
    expect(helpNow().turns).toHaveLength(1)
    expect(helpNow().turns[0]).toMatchObject({ said: 'Ops told us about Norway.' })
    // A message now is not taken while one waits.
    await askHelp('Another.')
    expect(helpNow().turns).toHaveLength(1)
    const page = desk('d8')
    setHelpDesk(page.desk)
    await settled()
    expect(helpNow()).toMatchObject({ busy: false })
    expect(helpNow().turns[0]).toMatchObject({ state: 'done' })
    setHelpDesk(null)
  })

  it('ends a waiting turn as failed when the page that comes holds another draft', async () => {
    const fresh = desk(null)
    fresh.desk.ready = () => {
      moveHelpChat('d9')
      return Promise.resolve(null)
    }
    setHelpDesk(fresh.desk)
    await askHelp('Ops told us about Norway.')
    const other = desk('d10')
    setHelpDesk(other.desk)
    expect(other.calls.filter((c) => c.startsWith('ask'))).toEqual([])
    // Another page is there: the next message is taken, and the failed turn is on its own draft.
    expect(helpNow().busy).toBe(false)
    setHelpDesk(null)
    setHelpDesk(desk('d9').desk)
    await settled()
    expect(helpNow().turns[0]).toMatchObject({
      state: 'failed',
      problem: 'The draft did not open.',
    })
    setHelpDesk(null)
  })

  it('ends a waiting turn as failed when no page holds its draft once the page settled', async () => {
    const fresh = desk(null)
    fresh.desk.ready = () => {
      moveHelpChat('d11')
      return Promise.resolve(null)
    }
    setHelpDesk(fresh.desk)
    await askHelp('Ops told us about Norway.')
    setHelpDesk(null)
    expect(helpNow().busy).toBe(true)
    await settled()
    expect(helpNow().busy).toBe(false)
    // The page that holds the draft later finds the turn failed, and does not ask it.
    const late = desk('d11')
    setHelpDesk(late.desk)
    expect(helpNow().turns[0]).toMatchObject({
      state: 'failed',
      problem: 'The draft did not open.',
    })
    await settled()
    expect(late.calls.filter((c) => c.startsWith('ask'))).toEqual([])
    // Nothing stays stuck: the next message on another draft is taken.
    const next = desk('d12')
    setHelpDesk(next.desk)
    await askHelp('Again.')
    expect(next.calls).toContain('ask Again.')
    setHelpDesk(null)
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
