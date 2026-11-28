// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AgentChange, DraftSession, SessionField, SessionForm } from '@/model/draft-session'
import type { Fact } from '@/model/items'

// The person's own draft in the editor while writing help writes it (Route 3): a field the person
// is writing in keeps their words, and writing help's wait beside them as a suggestion, said to the
// dock with the turn that wrote them. The field is not marked as writing help's until it is taken.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

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

/** A draft as the service holds it: the editor reads its form and its session. */
type Stored = { id: string; form: SessionForm; session: DraftSession }
const asFact = (stored: Stored) => stored as unknown as Fact
let stored: Stored

const write = vi.fn(() => Promise.resolve({ revision: 9 }))
vi.mock('@/api/queries', () => ({
  draftNowQuery: (id: string) => ({
    queryKey: ['draftNow', id],
    queryFn: () => Promise.resolve(asFact(stored)),
  }),
  useWrite: () => write,
}))

const { useDraftSession } = await import('@/lib/draft-session')

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  document.body.innerHTML = ''
  write.mockClear()
})

const step = (f: () => unknown) =>
  act(async () => {
    await f()
    await new Promise((resolve) => setTimeout(resolve, 5))
  })

const at = '2026-11-27T10:00:00.000Z'
const byHelp = (revision: number) => ({ by: 'writing_help' as const, revision, at })

/** The editor's page, as far as the session goes: the cursor is in `typingIn`. */
async function open(typingIn: SessionField | null) {
  const heard = { helped: [] as AgentChange[], suggested: [] as SessionField[][] }
  const page: { session?: ReturnType<typeof useDraftSession<SessionForm>>; form: SessionForm } = {
    form: stored.form,
  }
  const opened = asFact(stored)
  function Page() {
    const [now, setNow] = React.useState(stored.form)
    page.form = now
    page.session = useDraftSession({
      draft: opened,
      form: now,
      setForm: setNow,
      formOf: (fact) => (fact as unknown as Stored).form,
      factOf: (f) => ({ id: 'd1', form: f }) as unknown as Fact,
      typing: (field) => field === typingIn,
      setText: () => undefined,
      onError: () => undefined,
      onHelped: (change) => void heard.helped.push(change),
      onSuggested: (fields) => void heard.suggested.push(fields),
    })
    return null
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root = createRoot(document.body.appendChild(document.createElement('div')))
  await step(() =>
    root!.render(React.createElement(QueryClientProvider, { client }, React.createElement(Page))),
  )
  return { page, heard }
}

describe('a field the person is writing in while writing help writes the draft', () => {
  it('keeps their words, and holds writing help’s as a suggestion to use', async () => {
    stored = { id: 'd1', form, session: { revision: 1, fields: {} } }
    const { page, heard } = await open('title')
    // Writing help wrote the title and the dates; the cursor is in the title.
    stored = {
      id: 'd1',
      form: { ...form, title: 'Webshop sales to Norway stopped', when: 'from', from: '2026-08-04' },
      session: { revision: 3, fields: { title: byHelp(2), when: byHelp(3) } },
    }
    await step(() => page.session!.refresh())
    expect(page.form).toMatchObject({ title: '', when: 'from', from: '2026-08-04' })
    expect(heard.suggested).toEqual([['title']])
    expect(heard.helped.map((change) => change.fields)).toEqual([['when']])
    expect(page.session!.waitingIn('title')).toMatchObject({
      agent: 'Writing help',
      form: { title: 'Webshop sales to Norway stopped' },
    })
    // The title the page shows is the person's, so it carries no mark; the dates carry one.
    expect(page.session!.agentIn('title')).toBeUndefined()
    expect(page.session!.agentIn('when')).toBe('Writing help')

    await step(() => page.session!.take('title'))
    expect(page.form.title).toBe('Webshop sales to Norway stopped')
    expect(page.session!.waitingIn('title')).toBeUndefined()
  })

  it('lets the suggestion go when it is dismissed, and saves the person’s own words', async () => {
    stored = { id: 'd1', form: { ...form, title: 'Norway' }, session: { revision: 1, fields: {} } }
    const { page, heard } = await open('title')
    stored = {
      id: 'd1',
      form: { ...form, title: 'Webshop sales to Norway stopped' },
      session: { revision: 2, fields: { title: byHelp(2) } },
    }
    await step(() => page.session!.refresh())
    expect(heard.suggested).toEqual([['title']])
    expect(heard.helped).toEqual([])
    await step(() => page.session!.leave('title'))
    expect(page.form.title).toBe('Norway')
    expect(page.session!.waitingIn('title')).toBeUndefined()
    // What the service holds is writing help's: the person's title is saved over it.
    await step(() => page.session!.flush())
    expect(write).toHaveBeenCalledWith(
      'autosaveDraft',
      expect.objectContaining({ fact: { id: 'd1', form: { ...form, title: 'Norway' } } }),
    )
  })

  it('says nothing of a suggestion for a field their own agent wrote', async () => {
    stored = { id: 'd1', form, session: { revision: 1, fields: {} } }
    const { page, heard } = await open('title')
    stored = {
      id: 'd1',
      form: { ...form, title: 'Norway stop' },
      session: {
        revision: 2,
        fields: { title: { by: 'agent', agent: 'Claude', revision: 2, at } },
      },
    }
    await step(() => page.session!.refresh())
    expect(heard.suggested).toEqual([])
    expect(page.session!.waitingIn('title')).toMatchObject({ agent: 'Claude' })
  })
})
