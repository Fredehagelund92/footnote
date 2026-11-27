// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/errors'
import { askHelp, noteHelpChange, setHelpDesk, type HelpDesk } from '@/lib/writing-help'
import type { AgentChange } from '@/model/draft-session'
import type { HelpReply } from '@/model/writing-help'

// The dock hands the keyboard to its box when a button of the conversation leaves the page: an
// answer to tap, Try again and Undo are removed when pressed, and focus must not fall to the body.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

vi.mock('@/components/dock', () => ({
  DockFrame: ({ children, foot }: { children: React.ReactNode; foot?: React.ReactNode }) =>
    React.createElement('div', null, children, foot),
}))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement('span', null, children),
  TooltipContent: () => null,
  TooltipTrigger: ({
    render,
    children,
  }: {
    render: React.ReactElement
    children: React.ReactNode
  }) => React.cloneElement(render, undefined, children),
}))

const { WritingHelpDock } = await import('@/pages/writing-help')

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia
  Element.prototype.scrollIntoView = () => {}
})

let root: Root | undefined
afterEach(() => {
  act(() => setHelpDesk(null))
  act(() => root?.unmount())
  document.body.innerHTML = ''
})

const reply = (extra: Partial<HelpReply> = {}): HelpReply => ({
  reply: 'I wrote the title.',
  changed: [],
  kept: [],
  refused: [],
  question: null,
  links: { read: 0, problem: null },
  stopped: null,
  limit: null,
  ...extra,
})

function deskOf(draftId: string, ask: HelpDesk['ask']): HelpDesk {
  return {
    page: 'new',
    draftId,
    ready: () => Promise.resolve(draftId),
    ask,
    refresh: () => Promise.resolve(),
    revert: () => undefined,
  }
}

const step = (f: () => unknown) =>
  act(async () => {
    await f()
    await new Promise((resolve) => setTimeout(resolve, 5))
  })

async function mount(desk: HelpDesk) {
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await step(() => {
    setHelpDesk(desk)
    root!.render(React.createElement(WritingHelpDock))
  })
}

const composer = () =>
  document.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Say something to writing help"]',
  )!
const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.includes(name),
  )
/** Presses a button that leaves the page once pressed, with the keyboard elsewhere first. */
async function press(name: string) {
  composer().blur()
  expect(document.activeElement).not.toBe(composer())
  await step(() => void button(name)!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

describe('the dock’s box after a button that leaves the page', () => {
  it('has the focus after an answer to tap', async () => {
    await mount(
      deskOf('f1', () =>
        Promise.resolve(reply({ question: { text: 'From which day?', answers: ['4 August'] } })),
      ),
    )
    await step(() => askHelp('Ops told us.'))
    await press('4 August')
    expect(document.activeElement).toBe(composer())
  })

  it('has the focus after Try again', async () => {
    await mount(deskOf('f2', () => Promise.reject(new ApiError('failed', 'Not just now.'))))
    await step(() => askHelp('Ops told us.'))
    await press('Try again')
    expect(document.activeElement).toBe(composer())
  })

  it('has the focus after Undo', async () => {
    await mount(
      deskOf('f3', () => {
        // The field lands while the turn runs, as the editor notes it.
        noteHelpChange('f3', {
          agent: 'Writing help',
          fields: ['title'],
          at: '2026-11-27T10:00:00.000Z',
          before: {},
          after: {},
        } as unknown as AgentChange)
        return Promise.resolve(reply({ changed: ['title'] }))
      }),
    )
    await step(() => askHelp('Ops told us.'))
    await press('Undo')
    expect(document.activeElement).toBe(composer())
  })
})
