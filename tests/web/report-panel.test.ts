// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Answer } from '@/model/ask'
import type { Fact } from '@/model/items'

/*
  Something wrong? (FR-622) as a person fills it in: the app's own words when What's wrong? is
  empty or the link is not one, the right words for a source sent as a suggestion on it, the
  answer's wording and the figure with no suggestion, an owner offered Edit and the other owner
  named, and a send that fails keeping what was typed, with the service's reason.
*/

const world = vi.hoisted(() => ({
  me: { id: 'p1', name: 'Ines Duarte', role: '', owns: [] as string[], admin: false },
  writes: [] as { op: string; input: Record<string, unknown> }[],
  fail: null as Error | null,
  navigated: [] as string[],
}))
vi.mock('@/lib/workspace', () => ({
  useMe: () => world.me,
  useDomains: () => ({
    sales: {
      id: 'sales',
      name: 'Sales',
      owners: ['Jon Abara', 'Sofia Brandt'],
      covers: '',
      text: '',
    },
  }),
}))
vi.mock('@/lib/figures', () => ({ useFigures: () => ({ contact: () => 'Lars Dahl' }) }))
vi.mock('@/api/queries', () => ({
  useWrite: () => (op: string, input: Record<string, unknown>) => {
    world.writes.push({ op, input })
    return world.fail
      ? Promise.reject(world.fail)
      : Promise.resolve({ id: 'r1', ...(input.correction ? { suggestion: 's1' } : {}) })
  },
}))
vi.mock('@/lib/router', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  navigate: (path: string) => world.navigated.push(path),
}))

const { ReportForm, ReportPanel } = await import('@/components/footnote/report-panel')
const { keepShown, markReportSent } = await import('@/lib/shown-answers')
const { ApiError } = await import('@/api/errors')

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollIntoView = () => {}
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  })) as never
})
let root: Root | undefined
let host: HTMLElement | undefined
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  world.writes.length = 0
  world.navigated.length = 0
  world.fail = null
  closed.length = 0
  world.me = { id: 'p1', name: 'Ines Duarte', role: '', owns: [], admin: false }
})

const fact = {
  id: 'itm_units0001',
  title: 'Units sold excludes test accounts',
  summary: 'Units sold in Norway leaves out the 312 accounts our teams use to test the webshop.',
  domain: 'sales',
} as Fact
const closed: number[] = []
const second = {
  id: 'itm_units0002',
  title: 'Orders exclude refunds',
  summary: 'Orders leave out refunded orders.',
  domain: 'sales',
} as Fact
const answer = {
  id: 'a1',
  question: 'How many test accounts does units sold leave out in Norway?',
  sources: [fact.id],
  metric: 'metric:units_sold',
  markets: ['Norway'],
  state: 'grounded',
  text: '',
} as unknown as Answer

function mount(props: { figure?: string; facts?: Fact[] } = {}) {
  const sent: unknown[] = []
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  const client = new QueryClient()
  act(() =>
    root!.render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(ReportForm, {
          answer,
          facts: [fact],
          onClose: () => closed.push(1),
          onSent: (s: unknown) => sent.push(s),
          ...props,
        }),
      ),
    ),
  )
  return sent
}
const button = (name: string) =>
  [...host!.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)
const field = (label: string) => {
  const for_ = [...host!.querySelectorAll('label')].find((l) => l.textContent === label)
  return host!.querySelector<HTMLTextAreaElement | HTMLInputElement>(`[id="${for_!.htmlFor}"]`)!
}
/** Types into a controlled field as a person does: React reads the native setter's value. */
function type(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
  act(() => {
    Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const submit = () =>
  act(async () => {
    host!.querySelector('form')!.requestSubmit()
    await new Promise((r) => setTimeout(r, 0))
  })
const radio = (label: string) => {
  const for_ = [...host!.querySelectorAll('label')].find((l) => l.textContent === label)!
  act(() => host!.querySelector<HTMLElement>(`[id="${for_.htmlFor}"]`)!.click())
}

describe('Something wrong?', () => {
  it('says in its own words that What’s wrong? is empty, and sends nothing', async () => {
    mount()
    expect(document.activeElement).toBe(field("What's wrong?"))
    await submit()
    expect(host!.textContent).toContain('Say what is wrong, so the owners know what to fix.')
    expect(field("What's wrong?").getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(field("What's wrong?"))
    expect(world.writes).toEqual([])
  })

  it('names both owners, and sends a report alone when no words are suggested', async () => {
    const sent = mount()
    expect(host!.textContent).toContain('Goes to Jon Abara and Sofia Brandt, with your name')
    type(field("What's wrong?"), 'There were 316 in October.')
    await submit()
    expect(world.writes).toEqual([
      {
        op: 'reportAnswer',
        input: {
          question: answer.question,
          part: fact.id,
          sources: [fact.id],
          what: 'There were 316 in October.',
        },
      },
    ])
    expect(sent).toEqual([{ domain: 'sales' }])
  })

  it('sends the right words for a source as a suggestion on it, starting from its words', async () => {
    const sent = mount()
    type(field("What's wrong?"), 'There were 316 in October.')
    act(() => button('Suggest the right words')!.click())
    const words = field('The right words (a suggestion)')
    expect(words.value).toBe(fact.summary)
    // Unchanged, the words are no suggestion.
    expect(button('Send to the owners')).toBeDefined()
    type(
      words,
      'Units sold in Norway leaves out the 316 accounts our teams use to test the webshop.',
    )
    expect(host!.textContent).toContain(
      'It waits as a suggestion on “Units sold excludes test accounts”.',
    )
    await submit()
    expect(world.writes[0]?.input).toMatchObject({
      part: fact.id,
      correction:
        'Units sold in Norway leaves out the 316 accounts our teams use to test the webshop.',
    })
    expect(sent).toEqual([{ domain: 'sales', suggested: 'Units sold excludes test accounts' }])
  })

  it('offers no suggestion for the answer’s wording, which is filed on the first source', async () => {
    mount()
    radio("The answer's wording")
    expect(button('Suggest the right words')).toBeUndefined()
    type(field("What's wrong?"), 'It reads as if every market.')
    await submit()
    expect(world.writes[0]?.input).toMatchObject({ part: 'answer' })
    expect(world.writes[0]?.input).not.toHaveProperty('correction')
  })

  it('drops the right words when another part is chosen, so they are never filed on it', async () => {
    mount({ facts: [fact, second] })
    type(field("What's wrong?"), 'Wrong.')
    act(() => button('Suggest the right words')!.click())
    type(field('The right words (a suggestion)'), 'Something new for the first source.')
    radio('2. Orders exclude refunds')
    await submit()
    expect(world.writes[0]?.input).toMatchObject({ part: second.id })
    expect(world.writes[0]?.input).not.toHaveProperty('correction')
  })

  it('shows a note instead of a fresh form for an answer already reported', async () => {
    keepShown('a1-key', { answer, facts: [fact] })
    markReportSent('a1-key')
    host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    act(() =>
      root!.render(
        React.createElement(
          QueryClientProvider,
          { client: new QueryClient() },
          React.createElement(ReportPanel, { id: 'a1-key' }),
        ),
      ),
    )
    expect(host.textContent).toContain('You reported this answer')
    expect(host.querySelector('form')).toBeNull()
    expect(button('Close')).toBeDefined()
  })

  it('names the data contact for the figure', () => {
    mount({ figure: 'cube' })
    radio("The figure: it doesn't fit the context")
    expect(host!.textContent).toContain('and to Lars Dahl, the data contact,')
    expect(button('Send to the owners and the data contact')).toBeDefined()
  })

  it('gives an owner Edit first, and tells only the other owner', () => {
    world.me = { id: 'p2', name: 'Jon Abara', role: '', owns: ['sales'], admin: false }
    mount()
    expect(host!.textContent).toContain('You own Sales: you can change the item yourself')
    expect(host!.textContent).toContain('Or tell Sofia Brandt below.')
    expect(button('Suggest the right words')).toBeUndefined()
    expect(host!.textContent).toContain('Goes to Sofia Brandt, with your name')
    act(() => button('Edit “Units sold excludes test accounts”')!.click())
    expect(world.navigated).toEqual([`/context/${fact.id}/edit`])
    expect(button('Send to Sofia Brandt')).toBeDefined()
  })

  it('refuses a link that is not a web address in its own words, and sends one that is', async () => {
    mount()
    type(field("What's wrong?"), 'Off by four.')
    type(field('Link (optional)'), 'wiki page')
    await submit()
    expect(host!.textContent).toContain('A link starts with https:// and has no spaces.')
    expect(document.activeElement).toBe(field('Link (optional)'))
    expect(world.writes).toEqual([])
    type(field('Link (optional)'), 'https://wiki.example/test-accounts')
    await submit()
    expect(world.writes[0]?.input).toMatchObject({ link: 'https://wiki.example/test-accounts' })
  })

  it('keeps what was typed when the send fails, and says why', async () => {
    world.fail = new ApiError(
      'invalid',
      'The right words fit in 280 characters, as a summary does.',
    )
    const sent = mount()
    type(field("What's wrong?"), 'Off by four.')
    await submit()
    expect(host!.querySelector('[role=alert]')?.textContent).toBe(
      "The report wasn't sent. The right words fit in 280 characters, as a summary does.",
    )
    expect(field("What's wrong?").value).toBe('Off by four.')
    expect(sent).toEqual([])
  })
})
