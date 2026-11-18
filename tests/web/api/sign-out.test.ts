import { describe, expect, it } from 'vitest'
import { createHttpApi } from '@/api/http'
import type { Shelf } from '@/api/http-ask'

// Ask chats are kept in the browser, never on the service. Signing out takes the person's chats
// out of it, so whoever uses this browser next cannot read them; another person's stay theirs.

const RAVI = '00000000-0000-4000-8000-000000000001'
const MARIA = '00000000-0000-4000-8000-000000000002'
const chat = (question: string) =>
  JSON.stringify([{ id: 'c1', title: question, question, at: Date.now(), preview: 'Said.' }])

function browser({ signOutStatus = 200 } = {}) {
  const data = new Map<string, string>([
    [`footnote.ask.chats.${RAVI}`, chat('Why did orders in Norway drop?')],
    [`footnote.ask.chats.${MARIA}`, chat('Who owns net revenue?')],
  ])
  const shelf: Shelf = {
    get: (k) => data.get(k) ?? null,
    set: (k, v) => void data.set(k, v),
    remove: (k) => void data.delete(k),
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetch: typeof globalThis.fetch = (input, init) => {
    const path = new URL(new Request(input, init).url).pathname.replace('/api/v1', '')
    if (path === '/auth/session')
      return Promise.resolve(
        json({
          csrfToken: 'csrf-ravi',
          profileLabel: null,
          person: {
            id: RAVI,
            name: 'Ravi Kapoor',
            initials: 'RK',
            permissions: { roles: [], assignments: [] },
          },
        }),
      )
    if (path === '/auth/sign-out')
      return Promise.resolve(
        signOutStatus === 200
          ? json({ signedOut: true })
          : json({ defined: false, code: 'INTERNAL_SERVER_ERROR', status: 500, message: 'x' }, 500),
      )
    return Promise.resolve(json({}))
  }
  return { data, api: createHttpApi({ baseUrl: 'https://footnote.example/api/v1', fetch, shelf }) }
}

describe('signing out', () => {
  it("takes the person's Ask chats out of the browser, and leaves another person's", async () => {
    const { data, api } = browser()
    await api.getSession()
    expect((await api.listChats()).map((c) => c.question)).toEqual([
      'Why did orders in Norway drop?',
    ])
    await api.signOut()
    expect([...data.keys()]).toEqual([`footnote.ask.chats.${MARIA}`])
    // Signed in again as the same person, the history is empty: nothing was kept anywhere else.
    expect(await api.listChats()).toEqual([])
  })

  it('keeps the chats when the service did not sign the person out', async () => {
    const { data, api } = browser({ signOutStatus: 500 })
    await api.getSession()
    await expect(api.signOut()).rejects.toThrow()
    expect(data.has(`footnote.ask.chats.${RAVI}`)).toBe(true)
  })
})
