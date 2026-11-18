// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// A turn the person stopped before any answer: one line says so, with Ask again, on both Asks.

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

const { AnswerBody, AnswerActions, ReportLine, SomethingWrong } =
  await import('@/components/footnote/answer')
const { LoopAnswerBody } = await import('@/components/footnote/loop-answer')
const { loopParts } = await import('@/components/footnote/loop-parts')
// The figure reads the data through the app's query cache: here, where it goes is enough.
const AnswerFigure = ({ answer }: { answer: { metric: string } }) =>
  React.createElement('p', { 'data-figure': answer.metric })
const parts = { ...loopParts, AnswerActions, ReportLine, SomethingWrong, AnswerFigure }
const { askedTurn, turnReducer } = await import('@/model/ask-turn')

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
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

async function render(turn: ReturnType<typeof askedTurn>, loop = false) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const onRetry = vi.fn()
  const body = loop
    ? React.createElement(LoopAnswerBody, { parts, turn, onRetry })
    : React.createElement(AnswerBody, { turn, onRetry })
  act(() =>
    root!.render(
      React.createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        React.createElement(React.Suspense, { fallback: null }, body),
      ),
    ),
  )
  await act(() => new Promise((r) => setTimeout(r, 50)))
  return host
}
const stoppedWords = (page: HTMLElement) => page.textContent.match(/stopped/gi) ?? []

describe('a turn stopped before an answer', () => {
  it('says so once on the Ask that ships', async () => {
    const turn = turnReducer(askedTurn('t0', 'Why did orders drop?'), { type: 'stop' })
    const page = await render(turn)
    expect(stoppedWords(page)).toHaveLength(1)
    expect(page.textContent).toContain('Stopped before an answer.')
    expect([...page.querySelectorAll('button')].map((b) => b.textContent)).toContain('Ask again')
  })

  it('says so once in the loop, after its reads', async () => {
    const reads = {
      steps: [{ runs: [{ t: 'text' as const, text: 'Looked up Net revenue' }], done: true }],
      nouns: [],
    }
    const turn = turnReducer(
      { ...askedTurn('t0', 'Why did orders drop?'), reads },
      { type: 'stop' },
    )
    const page = await render(turn, true)
    expect(stoppedWords(page)).toHaveLength(1)
    expect([...page.querySelectorAll('button')].map((b) => b.textContent)).toContain('Ask again')
  })
})
