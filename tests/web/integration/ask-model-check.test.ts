import { describe, expect, it } from 'vitest'
import { scriptedLoopChoice } from '../../../src/server/modules/answer/index.ts'
import {
  createModelChecks,
  type ModelCheck,
  type ModelChoice,
  type ModelPort,
} from '../../../src/server/modules/models/index.ts'
import { askWorld } from './ask-world.ts'

/*
  The model check and Ask (P5, D4): Ask reads with its tools unless its model failed the check's
  tool call; then it answers with its router, which needs only words. A model not checked yet is
  checked while it answers with its tools.
*/

const ML = 'Maria Lindqvist'

/** One look-up, then its words with what it found. */
const reader = (name: string) =>
  scriptedLoopChoice(name, ({ question, results }) =>
    results.length
      ? { text: 'What is written is listed under the answer.' }
      : { calls: [{ toolName: 'get_context', input: { about: question } }] },
  )
const able = reader('able')
const toolless: ModelChoice = { ...reader('toolless'), id: 'openai/toolless' }
let assistant = able
const live: ModelPort = {
  mode: 'live',
  choose: () => assistant,
  otherLine: () => assistant,
  check: () => {},
  creditsUsed: () => Promise.resolve(null),
}
const checked: string[] = []
const modelChecks = createModelChecks({
  check: (choice): Promise<ModelCheck> => {
    checked.push(choice.id)
    const outcome = choice.id === toolless.id ? 'fail' : 'pass'
    return Promise.resolve({
      model: choice.id,
      at: '2026-11-19T12:00:00.000Z',
      tools: outcome,
      noTools: outcome,
      json: 'pass',
      notes: outcome === 'fail' ? ['tools: HTTP 400'] : [],
    })
  },
})
const loopTurns: string[] = []
const world = askWorld({
  askLoop: true,
  models: live,
  modelChecks,
  askTrace: {
    // The router's planner reads nothing here: the rules answer.
    planner: () => Promise.resolve(null),
    onLoopTurn: () => void loopTurns.push(assistant.id),
  },
})

describe('Ask and the model check', () => {
  it('reads with its tools on a model that passed, and on one not checked yet while it is checked', async () => {
    const api = await world.as(ML)
    const first = await api.ask({ question: 'orders in Norway' })
    expect(first.read?.[0]).toMatch(/^Looked up /)
    expect(loopTurns).toEqual([able.id])
    // Not checked before this turn: the turn read with its tools and the check was made.
    expect(checked).toEqual([able.id])
    await api.ask({ question: 'net revenue in Spain' })
    expect(loopTurns).toEqual([able.id, able.id])
    expect(checked).toEqual([able.id])
  }, 60_000)

  it('answers with its router while its model failed the tool call', async () => {
    assistant = toolless
    await modelChecks.of(toolless, 'assistant')
    const api = await world.as(ML)
    const answer = await api.ask({ question: 'orders in Norway' })
    // No loop turn: the rules found what is written about Norway's orders.
    expect(loopTurns).toEqual([able.id, able.id])
    expect(answer.stopped).toBeUndefined()
    expect(answer.state).toBe('conflict')
    expect(answer.sources).toContain('itm_norwaystop')
  }, 60_000)
})
