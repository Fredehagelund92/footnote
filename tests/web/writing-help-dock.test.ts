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
  type HelpDesk,
} from '@/lib/writing-help'
import type { AgentChange } from '@/model/draft-session'
import type { HelpReply } from '@/model/writing-help'

// The dock hands the keyboard to its box when a button of the conversation leaves the page: an
// answer to tap, Try again and Undo are removed when pressed, and focus must not fall to the body.
// It takes the keyboard as it opens, but never from a field of the draft the person is in. A
// field the person was writing in is said as a suggestion, not as changed. A phone has no
// writing help: a link to it says where it is. Reached from a card, the chat opens with what the
// card knew; with writing help off or no model, the dock says why in one line and has no box.

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

/** The workspace as the dock reads it: writing help on, a model connected, the person an admin. */
const world = vi.hoisted(() => ({ help: true, model: true, admin: true }))
vi.mock('@/api/queries', () => ({
  useWorkspace: () => ({ writingHelp: world.help }),
  useSession: () => ({ answeredBy: world.model ? 'model' : 'reader' }),
}))
vi.mock('@/lib/workspace', () => ({ useMe: () => ({ admin: world.admin }) }))
vi.mock('@/components/footnote/guide-link', () => ({
  PublicGuideLink: ({ children }: { children: React.ReactNode }) =>
    React.createElement('a', { href: '/docs/model-providers' }, children),
}))

const { WritingHelpDock } = await import('@/pages/writing-help')

/** Whether the window is a phone's. */
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
  act(() => root?.unmount())
  document.body.innerHTML = ''
  phone = false
  Object.assign(world, { help: true, model: true, admin: true })
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

function deskOf(
  draftId: string | null,
  ask: HelpDesk['ask'],
  opening?: HelpDesk['opening'],
): HelpDesk {
  return {
    page: 'new',
    draftId,
    opening,
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

describe('the dock’s box as the dock opens', () => {
  it('has the focus', async () => {
    await mount(deskOf('o1', () => Promise.resolve(reply())))
    expect(document.activeElement).toBe(composer())
  })

  it('leaves it in a field of the draft the person went to before it opened', async () => {
    // The dock opens a moment after the page: by then the person may be in the title.
    const title = document.body.appendChild(document.createElement('input'))
    title.focus()
    await mount(deskOf('o2', () => Promise.resolve(reply())))
    expect(document.activeElement).toBe(title)
  })
})

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

describe('the dock on a phone', () => {
  it('says writing help is on a computer or tablet, and has no box to write in', async () => {
    phone = true
    await mount(deskOf('p1', () => Promise.resolve(reply())))
    expect(document.body.textContent).toContain('Writing help is on a computer or tablet.')
    expect(composer()).toBeNull()
  })
})

describe('the dock as a new item opens', () => {
  it('says where the words go and what it does, and its arrow is Say it, not Send', async () => {
    await mount(deskOf('a1', () => Promise.resolve(reply())))
    expect(document.body.textContent).toContain(
      "Your draft and what you write here go to the AI model set for Ask. Agents don't get it yet.",
    )
    expect(document.body.textContent).toContain(
      'Writing help fills in the draft. You check each field, then send or publish it yourself.',
    )
    expect(composer().placeholder).toBe('Paste a message or a link, or say what happened')
    expect(document.querySelector('button[aria-label="Say it"]')).not.toBeNull()
    expect(document.querySelector('button[aria-label="Send"]')).toBeNull()
  })

  it('opens with what the card knew, which stays at the top once the first turn is there', async () => {
    const opening = {
      known: 'From Ask: nothing is published about Orders in Poland yet.',
      ask: 'Say what happened there.',
    }
    await mount(deskOf(null, () => Promise.resolve(reply()), opening))
    expect(document.body.textContent).toContain(opening.known)
    expect(document.body.textContent).toContain(opening.ask)
    expect(document.body.textContent).not.toContain('Writing help fills in the draft.')
  })
})

describe('the dock where writing help is not there to ask', () => {
  it('with no model, says so in one line with the guide for an admin, and has no box', async () => {
    world.model = false
    world.help = false
    await mount(deskOf('n1', () => Promise.resolve(reply())))
    expect(document.body.textContent).toBe(
      'Writing help needs an AI model, and none is connected to this workspace. How to connect a model',
    )
    expect(composer()).toBeNull()
  })

  it('with the switch off, tells a member who can turn it on', async () => {
    world.help = false
    world.admin = false
    await mount(deskOf('n2', () => Promise.resolve(reply())))
    expect(document.body.textContent).toBe(
      'Writing help is off for this workspace. An admin can turn it on in Settings.',
    )
    expect(composer()).toBeNull()
  })
})
