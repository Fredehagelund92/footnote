// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/errors'
import { createQueryClient } from '@/api/query-client'
import type { SignInChoice, SignInMethod } from '@/api/client'
import { SignInPage } from '@/pages/signin'
import { rememberSignedOut } from '@/lib/demo-profiles'

// The picker on an install with its own data starts with the sample people of
// db/seed/people.local.yml (snag 7 of the release judgement): the page says they are samples and
// which one is the admin, before anyone is signed in to read the workspace.

const bindings = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSignInMethod: vi.fn(),
  listSignInPeople: vi.fn(),
  getWorkspace: vi.fn(),
}))
vi.mock('@/api', () => ({ api: bindings }))
vi.mock('@/lib/router', () => ({ useRoute: () => ({ query: new URLSearchParams() }) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const host = document.createElement('div')
let root: ReturnType<typeof createRoot> | undefined
afterEach(() => {
  act(() => root?.unmount())
  for (const binding of Object.values(bindings)) binding.mockReset()
  sessionStorage.clear()
})

const samples: SignInChoice[] = [
  { name: 'Ravi Kapoor', admin: true, sample: true },
  { name: 'Jon Abara', admin: false, sample: true },
  { name: 'Ella Voss', admin: false, sample: true },
]

async function show(method: Partial<SignInMethod>, people: SignInChoice[]) {
  bindings.getSession.mockRejectedValue(new ApiError('signed-out', 'Sign in first'))
  bindings.getSignInMethod.mockResolvedValue({
    kind: 'picker',
    demo: false,
    profileLabel: null,
    ...method,
  })
  bindings.listSignInPeople.mockResolvedValue(people)
  bindings.getWorkspace.mockRejectedValue(new ApiError('signed-out', 'Sign in first'))
  root = createRoot(host)
  act(() => {
    root!.render(
      React.createElement(
        QueryClientProvider,
        { client: createQueryClient() },
        React.createElement(SignInPage),
      ),
    )
  })
  for (let i = 0; i < 10; i++) await act(() => new Promise((r) => setTimeout(r, 0)))
  return host.textContent ?? ''
}

/** What a person's row says under their name. */
const under = (name: string) =>
  [...host.querySelectorAll('button')]
    .find((b) => b.textContent?.includes(name))
    ?.textContent?.split(name)[1]

describe('the picker on an own-data install', () => {
  it('says the people are samples and which one is the admin', async () => {
    const text = await show({}, samples)
    expect(text).toContain('Pick who you are.')
    expect(text).toContain(
      'These are sample people, made up for trying Footnote. Ravi Kapoor is the admin, who sets it up.',
    )
    expect(under('Ravi Kapoor')).toBe('Admin')
    expect(under('Jon Abara')).toBe('')
  })

  it('says nothing of samples once a real person is in the list', async () => {
    const text = await show({}, [...samples, { name: 'Kim Berg', admin: true, sample: false }])
    expect(text).not.toContain('sample people')
    expect(under('Kim Berg')).toBe('Admin')
  })

  it('leaves the demo to its own note', async () => {
    // Signed out on purpose, the demo shows its picker rather than opening as its admin.
    rememberSignedOut(true)
    const text = await show({ demo: true }, samples)
    expect(text).toContain('This is a demo. Pick who you are.')
    expect(text).not.toContain('sample people')
  })
})
