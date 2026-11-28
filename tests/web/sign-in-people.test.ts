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

// Who the sign-in page offers on a picker install (the cold first use scout, call 2). On its own
// data with nobody in it yet: nobody, and the first screen, which asks the first person their
// name, their email and the workspace's name. After that, the people of the workspace. The demo
// keeps its people and its own note. No install says its people are samples: none has any.

const bindings = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSignInMethod: vi.fn(),
  listSignInPeople: vi.fn(),
  getWorkspace: vi.fn(),
  setUpWorkspace: vi.fn(),
}))
vi.mock('@/api', () => ({ api: bindings }))
vi.mock('@/lib/router', () => ({ useRoute: () => ({ query: new URLSearchParams() }) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const host = document.createElement('div')
document.body.append(host)
let root: ReturnType<typeof createRoot> | undefined
afterEach(() => {
  act(() => root?.unmount())
  for (const binding of Object.values(bindings)) binding.mockReset()
  sessionStorage.clear()
})

const demoPeople: SignInChoice[] = [
  { name: 'Ravi Kapoor', admin: true },
  { name: 'Jon Abara', admin: false },
  { name: 'Ella Voss', admin: false },
]

const settle = async () => {
  for (let i = 0; i < 10; i++) await act(() => new Promise((r) => setTimeout(r, 0)))
}

async function show(method: Partial<SignInMethod>, people: SignInChoice[]) {
  bindings.getSession.mockRejectedValue(new ApiError('signed-out', 'Sign in first'))
  bindings.getSignInMethod.mockResolvedValue({
    kind: 'picker',
    first: false,
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
  await settle()
  return host.textContent ?? ''
}

/** What a person's row says under their name. */
const under = (name: string) =>
  [...host.querySelectorAll('button')]
    .find((b) => b.textContent?.includes(name))
    ?.textContent?.split(name)[1]

const box = (label: string) => {
  const found = [...host.querySelectorAll('label')].find((l) => l.textContent === label)
  return host.querySelector<HTMLInputElement>(`#${found!.htmlFor}`)!
}
/** Types into a box as a person does, so React sees the change. */
function type(label: string, text: string) {
  const input = box(label)
  const value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!
  act(() => {
    value.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const start = async () => {
  act(() => {
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  await settle()
}

describe('the first screen of an install on its own data', () => {
  it('asks who the first person is, and offers nobody to pick', async () => {
    const text = await show({ first: true }, [])
    expect(text).toContain('Set up Footnote')
    expect(text).toContain('You are the first one here, so you are the admin. Say who you are.')
    expect(text).not.toContain('Pick who you are')
    expect(text).not.toContain('sample people')
    expect([...host.querySelectorAll('label')].map((l) => l.textContent)).toEqual([
      'Your name',
      'Your email',
      'Workspace name',
    ])
    expect(bindings.listSignInPeople).not.toHaveBeenCalled()
  })

  it('says what is missing at its field, and sends nothing until all three are given', async () => {
    await show({ first: true }, [])
    await start()
    expect(host.textContent).toContain('Add your name.')
    expect(host.textContent).toContain('Add your email address.')
    expect(host.textContent).toContain('Give the workspace a name.')
    expect(box('Your name').getAttribute('aria-invalid')).toBe('true')
    type('Your name', 'Kim Larsen')
    type('Your email', 'kim')
    type('Workspace name', 'Tallyfield')
    await start()
    expect(host.textContent).toContain('That is not an email address.')
    expect(host.textContent).not.toContain('Add your name.')
    expect(bindings.setUpWorkspace).not.toHaveBeenCalled()
  })

  it('sends the three answers, trimmed, once', async () => {
    bindings.setUpWorkspace.mockResolvedValue({
      user: 'Kim Larsen',
      install: 'new',
      fresh: false,
      profileLabel: null,
      answeredBy: 'reader',
    })
    await show({ first: true }, [])
    type('Your name', ' Kim Larsen ')
    type('Your email', 'kim@tallyfield.example ')
    type('Workspace name', ' Tallyfield')
    await start()
    expect(bindings.setUpWorkspace).toHaveBeenCalledTimes(1)
    expect(bindings.setUpWorkspace).toHaveBeenCalledWith({
      name: 'Kim Larsen',
      email: 'kim@tallyfield.example',
      workspace: 'Tallyfield',
    })
  })

  it('says why when someone else was first, and asks again how people sign in', async () => {
    bindings.setUpWorkspace.mockRejectedValue(
      new ApiError('conflict', 'Someone has set this workspace up already. Sign in instead.'),
    )
    await show({ first: true }, [])
    type('Your name', 'Kim Larsen')
    type('Your email', 'kim@tallyfield.example')
    type('Workspace name', 'Tallyfield')
    const reads = bindings.getSignInMethod.mock.calls.length
    await start()
    expect(host.querySelector('[role=alert]')?.textContent).toBe(
      'Someone has set this workspace up already. Sign in instead.',
    )
    expect(bindings.getSignInMethod.mock.calls.length).toBeGreaterThan(reads)
  })
})

describe('the picker once someone is in the workspace', () => {
  it('offers the people of the workspace, and says nothing of samples', async () => {
    const text = await show({}, [{ name: 'Kim Larsen', admin: true }])
    expect(text).toContain('Pick who you are.')
    expect(text).not.toContain('sample people')
    expect(text).not.toContain('Set up Footnote')
    expect(under('Kim Larsen')).toBe('Admin')
  })

  it('leaves the demo to its own people and its own note', async () => {
    // Signed out on purpose, the demo shows its picker rather than opening as its admin.
    rememberSignedOut(true)
    const text = await show({ demo: true }, demoPeople)
    expect(text).toContain('This is a demo. Pick who you are.')
    expect(text).toContain('Larchwood Outdoor is an invented company.')
    expect(under('Ravi Kapoor')).toBe('Admin')
    expect(under('Jon Abara')).toBe('')
  })
})
