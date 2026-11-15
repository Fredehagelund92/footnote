import type { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/errors'
import { createHttpApi } from '@/api/http'
import { createQueryClient } from '@/api/query-client'

// Every tab shares the session cookie. When another tab signs this browser in as someone else
// (View as, or a sign-in), the service refuses this tab's next change for its old token. The tab
// reads the session again: when it names the same person, the change goes again with the new
// token; when it names someone else, nothing is sent as them and the app moves to them.

const RAVI = '00000000-0000-4000-8000-000000000001'
const MARIA = '00000000-0000-4000-8000-000000000002'

function browser() {
  const state = { cookie: 'Ravi Kapoor' as 'Ravi Kapoor' | 'Maria Lindqvist', token: 'csrf-ravi-1' }
  const posts: string[] = []
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetch: typeof globalThis.fetch = (input, init) => {
    const request = new Request(input, init)
    const path = new URL(request.url).pathname.replace('/api/v1', '')
    if (path === '/auth/session')
      return Promise.resolve(
        json({
          csrfToken: state.token,
          profileLabel: null,
          person: {
            id: state.cookie === 'Ravi Kapoor' ? RAVI : MARIA,
            name: state.cookie,
            initials: 'XX',
            permissions: { roles: [], assignments: [] },
          },
        }),
      )
    if (request.method === 'POST') {
      const sent = request.headers.get('x-heed-csrf')
      const ok = sent === state.token
      posts.push(`POST ${path} with ${sent} -> ${ok ? `200, as ${state.cookie}` : '403'}`)
      return Promise.resolve(
        ok
          ? json({ results: [] })
          : json(
              {
                defined: false,
                code: 'FORBIDDEN',
                status: 403,
                message:
                  "We couldn't confirm this change came from the app. Reload the page, then try again.",
              },
              403,
            ),
      )
    }
    return Promise.resolve(json({}))
  }
  return { state, posts, api: createHttpApi({ baseUrl: 'https://heed.example/api/v1', fetch }) }
}

const invite = { emails: ['omar@larchwood.example'], admin: false, owns: [] }

describe('a change after another tab signed this browser in as someone else', () => {
  it('is not sent as them, and says so', async () => {
    const { state, posts, api } = browser()
    expect((await api.getSession()).user).toBe('Ravi Kapoor')
    // Another tab uses View as: same browser, same cookie, another person.
    state.cookie = 'Maria Lindqvist'
    state.token = 'csrf-maria'
    const failure = await api.invite(invite).then(
      () => expect.unreachable('the change was sent'),
      (error: unknown) => error as ApiError,
    )
    expect(posts).toEqual(['POST /invites with csrf-ravi-1 -> 403'])
    expect(failure).toBeInstanceOf(ApiError)
    expect(failure.message).toBe(
      "You're signed in as someone else in this browser, so nothing was changed.",
    )
    expect(failure.someoneElse).toBe(true)
  })

  it('is sent again with the new token when the session is still theirs', async () => {
    const { state, posts, api } = browser()
    await api.getSession()
    // Another tab signed in again as the same person: a new token, the same person.
    state.token = 'csrf-ravi-2'
    expect(await api.invite(invite)).toEqual({ links: [], skipped: [] })
    expect(posts).toEqual([
      'POST /invites with csrf-ravi-1 -> 403',
      'POST /invites with csrf-ravi-2 -> 200, as Ravi Kapoor',
    ])
  })

  it('moves the app to the person the browser is signed in as', async () => {
    let moved = 0
    const queryClient: QueryClient = createQueryClient({ onSomeoneElse: () => (moved += 1) })
    const { state, api } = browser()
    await api.getSession()
    state.cookie = 'Maria Lindqvist'
    state.token = 'csrf-maria'
    await queryClient
      .getMutationCache()
      .build(queryClient, { mutationFn: () => api.invite(invite) })
      .execute(undefined)
      .catch(() => {})
    expect(moved).toBe(1)
  })
})
