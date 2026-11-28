// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/errors'
import {
  askHelp,
  noteHelpChange,
  noteHelpSuggestion,
  setHelpDesk,
  setHelpReady,
  type HelpDesk,
} from '@/lib/writing-help'
import type { AgentChange } from '@/model/draft-session'
import type { HelpReply } from '@/model/writing-help'

// The dock hands the keyboard to its box when a button of the conversation leaves the page: an
// answer to tap, Try again and Undo are removed when pressed, and focus must not fall to the body.
// On a phone it is a screen of its own, and leads back to the draft; a field the person was
// writing in is said as a suggestion, not as changed.

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

const closeDock = vi.fn<() => void>()
vi.mock('@/lib/dock', () => ({
  closeDock: () => {
    closeDock()
  },
}))

const { WritingHelpDock } = await import('@/pages/writing-help')

/** Whether the window is a phone's: the dock is then a screen of its own. */
let phone = false

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = ((query: string) => ({
    matches: phone && query.includes('max-width'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia
  Element.prototype.scrollIntoView = () => {}
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

let root: Root | undefined
afterEach(() => {
  act(() => setHelpDesk(null))
  act(() => setHelpReady(false))
  act(() => root?.unmount())
  document.body.innerHTML = ''
  phone = false
  closeDock.mockClear()
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

describe('a field the person was writing in', () => {
  it('is said as a suggestion under the reply, and is not one of the fields changed', async () => {
    await mount(
      deskOf('s1', () => {
        // The page kept the person's title and took the text, as its merge notes them.
        noteHelpSuggestion('s1', ['title'])
        noteHelpChange('s1', {
          agent: 'Writing help',
          fields: ['text'],
          at: '2026-11-27T10:00:00.000Z',
          before: {},
          after: {},
        } as unknown as AgentChange)
        return Promise.resolve(reply({ reply: 'I wrote a title.', changed: ['title', 'text'] }))
      }),
    )
    await step(() => askHelp('Make the title say webshop.'))
    expect(document.body.textContent).toContain(
      'You were typing in Title, so I left your words and put mine under it. Use it, or keep yours.',
    )
    const chips = [...document.querySelectorAll('ul[aria-label="Fields it changed"] li')].map(
      (li) => li.textContent,
    )
    expect(chips).toEqual(['Text'])
  })
})

describe('the dock on a phone, a screen of its own over the draft', () => {
  const draftRow = () => button('Open the draft')?.parentElement

  it('says after a turn whether the page finds the draft ready, and leads back to it', async () => {
    phone = true
    await mount(deskOf('p1', () => Promise.resolve(reply({ changed: ['title'] }))))
    // Before anything is said there is no draft to open yet.
    expect(button('Open the draft')).toBeUndefined()
    await step(() => askHelp('Ops told us.'))
    expect(draftRow()?.textContent).toContain('Not ready yet')
    await step(() => setHelpReady(true))
    expect(draftRow()?.textContent).toContain('Draft is ready')
    // Sending is the draft's own button: the row has one way on, back to the draft.
    expect(draftRow()?.querySelectorAll('button')).toHaveLength(1)
    await step(() => void button('Open the draft')!.click())
    expect(closeDock).toHaveBeenCalledTimes(1)
  })

  it('leaves the row out while a turn runs', async () => {
    phone = true
    await mount(deskOf('p2', () => new Promise<HelpReply>(() => undefined)))
    await step(() => void askHelp('Ops told us.'))
    expect(button('Open the draft')).toBeUndefined()
  })

  it('has no such row beside the draft on a wider screen', async () => {
    await mount(deskOf('p3', () => Promise.resolve(reply({ changed: ['title'] }))))
    await step(() => askHelp('Ops told us.'))
    expect(button('Open the draft')).toBeUndefined()
  })
})
