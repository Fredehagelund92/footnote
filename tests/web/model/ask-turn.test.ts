import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoopTurn } from '@contract/answer'
import { MOCK_READ_MS, playAnswer } from '@/api/mock/ask-live'
import { askedOf, chatTurnOf, type Answer } from '@/model/ask'
import { failedAnswer } from '@/api/http-ask'
import {
  askedTurn,
  doneTurn,
  drawnByLoop,
  effectsOf,
  isLive,
  outcomeOf,
  turnReducer,
  unansweredIn,
  type AskEvent,
  type Turn,
  type TurnAction,
} from '@/model/ask-turn'

// One question and its answer in Ask, as the loop's events arrive: the question at once, the
// working line while Ask reads, then the turn.

const engine: Answer = {
  id: 'custom',
  question: 'Why did orders in Norway drop in August?',
  metric: 'Orders',
  values: ['Norway'],
  state: 'grounded',
  text: 'Online sales to Norway stopped on 4 August [1]. Store credit counts [2].',
  sources: ['fct-1', 'fct-2'],
  said: '2 context items apply to Orders in Norway.',
}

const run = (turn: Turn, ...actions: TurnAction[]) => actions.reduce(turnReducer, turn)
const asked = () => askedTurn('t0', engine.question, { parts: [engine.question] })
const reads = { steps: [], nouns: [] }

describe('a turn as its answer arrives', () => {
  it('shows the question at once, looking up, with no answer yet', () => {
    const turn = asked()
    expect(turn).toMatchObject({ stage: 'looking', answered: false, found: null })
    expect(turn.answer).toMatchObject({ id: 't0', question: engine.question, state: null })
    expect(isLive(turn)).toBe(true)
  })

  it('says what Ask reads, then takes the finished answer under the question’s own id', () => {
    const working = run(
      asked(),
      { type: 'plan', working: 'Looking up Orders…' },
      { type: 'reads', reads },
    )
    expect(working).toMatchObject({ working: 'Looking up Orders…', reads, answered: false })
    const done = run(working, { type: 'done', answer: engine })
    expect(done).toMatchObject({ stage: 'done', answered: true, found: 2 })
    expect(done.answer).toMatchObject({ id: 't0', state: 'grounded', parts: [engine.question] })
    expect(isLive(done)).toBe(false)
  })

  it('stopped before the answer, names no state and no source, and takes nothing after', () => {
    const stopped = run(
      asked(),
      { type: 'reads', reads },
      { type: 'stop' },
      { type: 'done', answer: engine },
    )
    expect(stopped).toMatchObject({ stopped: true, answered: false })
    expect(stopped.answer.state).toBeNull()
    expect(stopped.answer.sources).toEqual([])
  })

  it('opens an answer that is already in as finished', () => {
    const turn = doneTurn(engine)
    expect(turn).toMatchObject({ stage: 'done', answered: true, found: 2, error: null })
    expect(run(turn, { type: 'reads', reads })).toBe(turn)
  })

  it('once done, takes only Stop, for words still on their way to the screen', () => {
    const done = run(asked(), { type: 'done', answer: engine })
    expect(run(done, { type: 'error', message: 'Too late.' })).toBe(done)
    const stopped = run(done, { type: 'stop' })
    expect(stopped).toMatchObject({ stopped: true, stage: 'done' })
    expect(run(stopped, { type: 'stop' })).toBe(stopped)
  })

  it('keeps a question that got nothing back, saying why, and takes nothing after', () => {
    const failed = run(asked(), { type: 'reads', reads }, { type: 'error', message: 'No reply.' })
    expect(failed).toMatchObject({ error: 'No reply.', answered: false })
    expect(failed.answer.question).toBe(engine.question)
    expect(isLive(failed)).toBe(false)
    expect(run(failed, { type: 'done', answer: engine }, { type: 'stop' })).toBe(failed)
  })
})

describe("the mock's answers in a live chat", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('come as the service sends them: the working line, then the turn in time', async () => {
    const events: [number, AskEvent['type']][] = []
    const start = Date.now()
    const played = playAnswer(engine, { onEvent: (e) => events.push([Date.now() - start, e.type]) })
    await vi.runAllTimersAsync()
    expect(await played).toEqual(engine)
    expect(Date.now() - start).toBe(MOCK_READ_MS)
    expect(events).toEqual([[0, 'plan']])
  })

  it('stop when the person stops them', async () => {
    const stop = new AbortController()
    const played = playAnswer(engine, { signal: stop.signal, onEvent: () => stop.abort() })
    const failed = expect(played).rejects.toMatchObject({ name: 'AbortError' })
    await vi.runAllTimersAsync()
    await failed
  })
})

describe('a turn asked at a chosen period', () => {
  const period = 'last month' as const
  const chosen = () => askedTurn('t2', engine.question, { parts: [engine.question], period })

  it('keeps the period when nothing came back or the person stopped it', () => {
    expect(run(chosen(), { type: 'error', message: 'offline' }).answer.period).toEqual(period)
    expect(run(chosen(), { type: 'stop' }).answer.period).toEqual(period)
  })

  it('keeps the period over the answer that comes in', () => {
    expect(run(chosen(), { type: 'done', answer: engine }).answer.period).toEqual(period)
  })
})

describe('a turn asked again in words', () => {
  const again = { question: engine.question, parts: [engine.question] }
  const repeated = () => askedTurn('t1', 'try again', { again })

  it('keeps what was typed, and what it repeated', () => {
    const turn = run(repeated(), { type: 'done', answer: engine })
    expect(turn.answer).toMatchObject({ id: 't1', question: 'try again', state: 'grounded', again })
    expect(turn.answer.parts).toBeUndefined()
    expect(askedOf(turn.answer)).toBe(engine.question)
  })

  it('sends on the question it repeated, so asking again twice stays on it', () => {
    const turn = run(repeated(), { type: 'done', answer: engine })
    expect(chatTurnOf(turn.answer)?.question).toBe(engine.question)
  })
})

describe('what a turn sends on to the next question', () => {
  it('holds how it was read and what it found, never the answer’s words', () => {
    const turn = chatTurnOf(engine)!
    expect(turn).toEqual({
      question: engine.question,
      sources: ['fct-1', 'fct-2'],
      understood: 'Orders in Norway',
      headline: '2 context items about Orders in Norway.',
    })
    expect(JSON.stringify(turn)).not.toMatch(/stopped on 4 August|Store credit/)
  })

  it('holds at most 10 sources, and lines the contract takes', () => {
    const many = Array.from({ length: 14 }, (_, i) => `fct-${i}`)
    const long = 'Orders'.repeat(60)
    const turn = chatTurnOf({ ...engine, sources: many, metric: long })!
    expect(turn.sources).toHaveLength(10)
    expect(turn.understood!.length).toBeLessThanOrEqual(200)
    expect(turn.headline!.length).toBeLessThanOrEqual(200)
  })

  it('sends a loop turn’s words and reads back, and a question back as asked', () => {
    const reads = [{ tool: 'get_context', input: { about: 'orders in Norway' } }]
    expect(chatTurnOf({ ...engine, reads })).toMatchObject({ reply: engine.text, reads })
    const back = chatTurnOf({ ...engine, state: null, reply: 'clarify', text: 'Which one?' })
    expect(back).toMatchObject({ asked: 'Which one?', headline: null })
  })
})

describe('how a turn ended (one outcome per turn)', () => {
  const notChecked = () =>
    run(asked(), { type: 'reads', reads }, { type: 'done', answer: failedAnswer(engine.question) })

  it('has no outcome while it is on its way', () => {
    expect(outcomeOf(asked())).toBeNull()
    expect(outcomeOf(run(asked(), { type: 'reads', reads }))).toBeNull()
  })

  it('reads every way a turn ends as one outcome', () => {
    expect(outcomeOf(run(asked(), { type: 'done', answer: engine }))).toEqual({ kind: 'answered' })
    expect(outcomeOf(notChecked())).toEqual({ kind: 'not_checked' })
    const limit = { ...engine, stopped: 'steps' as const, loop: {} as Answer['loop'] }
    expect(outcomeOf(run(asked(), { type: 'done', answer: limit }))).toEqual({ kind: 'limit' })
    expect(outcomeOf(run(asked(), { type: 'stop' }))).toEqual({ kind: 'stopped', answered: false })
    expect(outcomeOf(run(asked(), { type: 'done', answer: engine }, { type: 'stop' }))).toEqual({
      kind: 'stopped',
      answered: true,
    })
    expect(outcomeOf(run(asked(), { type: 'error', message: 'No.' }))).toEqual({
      kind: 'refused',
      message: 'No.',
    })
    // A loop answer that says Not checked has its own words and reads: it is an answer.
    const loopFailed = { ...engine, state: 'failed' as const, loop: {} as Answer['loop'] }
    expect(outcomeOf(doneTurn(loopFailed))).toEqual({ kind: 'answered' })
  })

  it('says what each outcome does, row by row', () => {
    const rows = {
      answered: effectsOf({ kind: 'answered' }),
      limit: effectsOf({ kind: 'limit' }),
      not_checked: effectsOf({ kind: 'not_checked' }),
      stoppedBefore: effectsOf({ kind: 'stopped', answered: false }),
      stoppedAfter: effectsOf({ kind: 'stopped', answered: true }),
      refused: effectsOf({ kind: 'refused', message: 'No.' }),
    }
    expect(rows).toEqual({
      answered: { joins: true, kept: true, carried: true, restores: false },
      limit: { joins: true, kept: true, carried: true, restores: false },
      // Not checked never joins the history and is never kept; asked again, the old answer stays.
      not_checked: { joins: false, kept: false, carried: false, restores: true },
      stoppedBefore: { joins: false, kept: false, carried: false, restores: true },
      stoppedAfter: { joins: true, kept: false, carried: true, restores: false },
      refused: { joins: false, kept: false, carried: false, restores: true },
    })
  })

  it('draws a Not checked turn as one, not as the loop still reading; a turn with words as the loop', () => {
    // The look-up read once, then the service failed: the loop's body would show it working for good.
    expect(drawnByLoop(notChecked())).toBe(false)
    expect(drawnByLoop(run(asked(), { type: 'reads', reads }))).toBe(true)
    expect(drawnByLoop(run(asked(), { type: 'reads', reads }, { type: 'stop' }))).toBe(true)
    // A follow-up that reads nothing: its words, as they come.
    const words = { text: 'Jon owns it.' } as LoopTurn
    expect(drawnByLoop(run(asked(), { type: 'words', words }))).toBe(true)
    expect(
      drawnByLoop(run(asked(), { type: 'words', words }, { type: 'words', words: null })),
    ).toBe(false)
    expect(drawnByLoop(doneTurn({ ...engine, loop: {} as Answer['loop'] }))).toBe(true)
    expect(drawnByLoop(doneTurn(engine))).toBe(false)
  })
})

describe('the sentence for a question that got no answer', () => {
  it('says why after the colon, with an ordinary first word lower-cased', () => {
    expect(unansweredIn("The app didn't reply.", true)).toBe(
      "Couldn't get an answer: the app didn't reply.",
    )
    expect(unansweredIn('AI Gateway is down', true)).toBe(
      "Couldn't get an answer: AI Gateway is down.",
    )
    expect(unansweredIn('', true)).toBe("Couldn't get an answer: the app didn't reply.")
  })

  it("offline, blames neither the service nor the question: 'You're offline.'", () => {
    const sentence = "You're offline. Ask again when you're back."
    expect(unansweredIn("The service didn't reply.", false)).toBe(sentence)
    expect(unansweredIn("You're offline.", false)).toBe(sentence)
  })
})
