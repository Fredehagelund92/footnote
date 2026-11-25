// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// Good and Bad answer as a person clicks them: the pressed button always matches what the service
// has counted once the clicks settle, even when an earlier one fails, and a draft rates nothing.

const world = vi.hoisted(() => ({
  calls: [] as {
    op: string
    input: Record<string, unknown>
    ok: (v: unknown) => void
    no: () => void
  }[],
}))
vi.mock('@/lib/workspace', () => ({
  useMe: () => ({ name: 'Jon', role: 'Owner', owns: [], admin: true }),
  useDomains: () => ({}),
  useFacts: () => [],
  useFact: () => undefined,
  usePeople: () => [],
}))
vi.mock('@/lib/definitions', () => ({ useDefinitions: () => [] }))
vi.mock('@/lib/dock', () => ({ openDock: vi.fn(), useDock: () => null }))
vi.mock('@/lib/read-ahead', () => ({ useReadAhead: () => () => ({}), useReadCitedAhead: () => {} }))
vi.mock('@/lib/shown-answers', () => ({ answerKey: () => 'k', keepShown: () => {} }))
vi.mock('@/api/queries', () => ({
  useWrite: () => (op: string, input: Record<string, unknown>) =>
    new Promise((ok, no) => world.calls.push({ op, input, ok, no: () => no(new Error('down')) })),
}))
vi.mock('@/lib/toast', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

// The rating loads with the first click; loaded here, a click settles within its own turn.
await import('@/components/footnote/answer-rating')
const { AnswerActions } = await import('@/components/footnote/answer')

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia
})
let root: Root | undefined
let host: HTMLElement | undefined
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  world.calls.length = 0
})

function mount(draft: boolean) {
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  const answer = { state: 'grounded', keys: { metrics: ['metric:orders'] } }
  act(() =>
    root!.render(
      React.createElement(AnswerActions, {
        answer: answer as never,
        copyText: 'text',
        facts: [],
        draft,
        wrong: false,
        onWrong: () => {},
        canReport: false,
      }),
    ),
  )
}
const thumb = (name: string) =>
  [...host!.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === name)
const click = (name: string) =>
  act(async () => {
    thumb(name)!.click()
    await new Promise((r) => setTimeout(r, 0))
  })
const settle = async (i: number, how: 'ok' | 'no', value?: unknown) => {
  await act(async () => {
    const c = world.calls[i]!
    if (how === 'ok') c.ok(value)
    else c.no()
    await new Promise((r) => setTimeout(r, 0))
  })
}
const pressed = (name: string) => thumb(name)?.getAttribute('aria-pressed')

describe('Good and Bad answer', () => {
  it('shows the rating the service counted when an earlier click fails behind a later one', async () => {
    mount(false)
    await click('Good answer')
    await click('Bad answer')
    await settle(0, 'no')
    expect(world.calls.map((c) => c.op)).toEqual(['rateAnswer', 'rateAnswer'])
    await settle(1, 'ok', { id: 'r2' })
    expect(world.calls[1]!.input.verdict).toBe('wrong')
    expect(pressed('Bad answer')).toBe('true')
    expect(pressed('Good answer')).not.toBe('true')
    await click('Bad answer')
    await settle(2, 'ok')
    expect(world.calls[2]).toMatchObject({ op: 'takeBackRating', input: { id: 'r2' } })
    expect(pressed('Bad answer')).not.toBe('true')
  })

  it('keeps a rating pressed when its take-back fails', async () => {
    mount(false)
    await click('Good answer')
    await settle(0, 'ok', { id: 'r1' })
    await click('Good answer')
    await settle(1, 'no')
    expect(pressed('Good answer')).toBe('true')
  })

  it('shows no rating buttons on a draft preview', () => {
    mount(true)
    expect(thumb('Good answer')).toBeUndefined()
    expect(thumb('Bad answer')).toBeUndefined()
    expect(world.calls).toHaveLength(0)
  })
})
