// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { LoopTurn } from '@contract/answer'
import examples from '@/api/mock/data/loop-examples.json'

// A follow-up that reads nothing ("Who owns it?"): its first sentence shows the moment it passes
// the check, as a turn that read does, not only once the whole answer is in (the Ask re-run of
// 21 November 2026, section 4.3: it waited 0.3 to 1.8 s for the rest).

vi.mock('@/lib/workspace', () => ({
  useFacts: () => [],
  useFact: () => undefined,
  useMe: () => ({ name: 'Mia', owns: [], admin: false }),
  useDomains: () => ({}),
  usePeople: () => [],
}))
vi.mock('@/lib/definitions', () => ({ useDefinitions: () => [] }))
vi.mock('@/api/queries', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useWrite: () => vi.fn(),
}))
vi.mock('@/lib/dock', () => ({ openDock: vi.fn(), useDock: () => null }))
vi.mock('@/lib/read-ahead', () => ({ useReadAhead: () => () => ({}), useReadCitedAhead: () => {} }))
vi.mock('@/lib/figures', () => ({
  useFigures: () => ({
    enabled: () => false,
    contact: () => 'the data team',
    sourceOf: () => undefined,
  }),
}))
vi.mock('@/lib/shown-answers', () => ({ answerKey: () => 'k', keepShown: () => {} }))
vi.mock('@/lib/router', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useRoute: () => ({ path: '/ask', query: new URLSearchParams() }),
}))

const { AnswerBody } = await import('@/components/footnote/answer')
const { askedTurn, turnReducer } = await import('@/model/ask-turn')

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
let root: Root | undefined
let host: HTMLElement | undefined
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

describe('a follow-up that reads nothing', () => {
  it('shows its first sentence while the rest is still being written', async () => {
    const whole = examples['loop-checked'].turn as unknown as LoopTurn
    const first: LoopTurn = {
      ...whole,
      body: [{ t: 'p', runs: [{ t: 'text', text: 'Jon Abara owns Net revenue.' }] }],
      text: 'Jon Abara owns Net revenue.',
    }
    // As the service sends it: a working line, then the words, and no read in between.
    const turn = [
      { type: 'plan' as const, working: 'Writing the answer…' },
      { type: 'words' as const, words: first },
    ].reduce(turnReducer, askedTurn('t1', 'Who owns it?'))
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() =>
      root!.render(
        React.createElement(
          QueryClientProvider,
          { client: new QueryClient() },
          React.createElement(
            React.Suspense,
            { fallback: null },
            React.createElement(AnswerBody, { turn }),
          ),
        ),
      ),
    )
    // The loop answer's own code loads with its first answer: on a busy machine that takes a while.
    await vi.waitFor(
      async () => {
        await act(() => new Promise((r) => setTimeout(r, 50)))
        expect(host!.querySelector('[data-answer-words]')?.textContent).toBe(
          'Jon Abara owns Net revenue.',
        )
      },
      { timeout: 10_000 },
    )
  })
})
