import type { LanguageModelV4Prompt } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'
import { chatTurnOf, type Answer } from '@/model/ask'
import { fitChat } from '@domain/ask-chat'
import { scriptedLoopChoice } from '../../../src/server/modules/answer/index.ts'
import {
  modelProviders,
  type ModelChoice,
  type ModelPort,
} from '../../../src/server/modules/models/index.ts'
import { askWorld } from './ask-world.ts'

/*
  A long chat stays affordable (H20): fifteen questions in one chat on the demo week, through the
  real service and the browser's own chat, on a model priced as Claude Sonnet 5.5 is on Anthropic's
  API. The scripted model reads as the real one mostly does (a look-up and a search, then its
  words), and reports every token it was sent as fresh input, never a prompt cache read: what is
  measured is what the service sends, at its dearest. The chat stays under a person's daily limit,
  and its tenth turn, or any after its second, costs no more than twice its second: a turn sends
  the reads of the last two turns again, and older turns as their words. With every earlier read
  sent, the seventh turn cost 2.4 times the second and the chat USD 0.61; now it is 1.3 times at
  most, and USD 0.35.
*/

const ML = 'Maria Lindqvist'
/** A person's daily limit by default (`limits.llm_daily_micros_per_person`): USD 2. */
const DAILY_LIMIT = 2_000_000

const questions = [
  'Why did orders in Norway drop in August?',
  'and last year?',
  'Who owns Sales?',
  'What is net revenue?',
  'net revenue in Spain',
  'and in Germany?',
  'What changed in Finance this week?',
  'Are there conflicts about returns?',
  'returns in the UK',
  'What about Sweden?',
  'Which items are due for a check?',
  'What did agents ask this week?',
  'orders in Poland',
  'Is gross margin written down anywhere?',
  'Thanks, and who checked that last?',
]

const sonnet = modelProviders.find((p) => p.name === 'anthropic')!.models['claude-sonnet-5-5']!
const reader = scriptedLoopChoice('chat-cost', ({ question, results }) =>
  results.length
    ? { text: 'What is written is listed under the answer, with who checked it and when.' }
    : {
        calls: [
          { toolName: 'get_context', input: { about: question } },
          { toolName: 'find_context', input: { words: question } },
        ],
      },
)
const priced: ModelChoice = { ...reader, prices: sonnet.prices }
const live: ModelPort = {
  mode: 'live',
  choose: () => priced,
  otherLine: () => priced,
  check: () => {},
  creditsUsed: () => Promise.resolve(null),
  checkKey: () => Promise.resolve({ outcome: 'accepted' }),
}
const world = askWorld({ models: live })

describe('a long chat in Ask', () => {
  it('stays under the daily limit, and its tenth turn costs at most twice its second', async () => {
    const api = await world.as(ML)
    const spent = async () =>
      Number(
        (
          await world.client.query<{ cost: string }>(
            "select coalesce(sum(cost_micros), 0) as cost from llm_spend_daily where feature = 'assistant'",
          )
        ).rows[0]!.cost,
      )
    const answers: Answer[] = []
    const costs: number[] = []
    for (const question of questions) {
      const before = await spent()
      const turns = fitChat(answers.flatMap((a) => chatTurnOf(a) ?? []))
      const answer = await api.ask({ question, ...(turns.length ? { turns } : {}) })
      expect(answer.stopped, question).toBeUndefined()
      answers.push(answer)
      costs.push((await spent()) - before)
    }
    const total = costs.reduce((sum, c) => sum + c, 0)
    // What each turn cost, in dollars, when a check fails.
    const said = costs.map((c, i) => `${i + 1}: $${(c / 1e6).toFixed(4)}`).join(', ')
    expect(total, said).toBeLessThan(DAILY_LIMIT)
    expect(costs[9]!, said).toBeLessThanOrEqual(2 * costs[1]!)
    // Nor any later turn: what a turn sends stops growing after its third (EARLIER_TURNS).
    for (const cost of costs.slice(2)) expect(cost, said).toBeLessThanOrEqual(2 * costs[1]!)
  }, 120_000)
})

/*
  A follow-up starts with what the turn before it last sent, message for message (23 November
  2026): the earlier question with its language note, and its reads under the ids the follow-up
  sends them by. So the provider reads them from its prompt cache instead of writing them again:
  a follow-up that read nothing cost USD 0.022 with them written again, USD 0.0048 with them read.
*/
describe('a follow-up in Ask', () => {
  const prompts: LanguageModelV4Prompt[] = []
  const capture = scriptedLoopChoice('chat-prefix', ({ question, results, prompt }) => {
    prompts.push(structuredClone(prompt))
    return results.length || question === 'Who owns it?'
      ? { text: 'What is written is listed under the answer, with who checked it and when.' }
      : { calls: [{ toolName: 'get_context', input: { about: question } }] }
  })
  const captured: ModelChoice = { ...capture, prices: sonnet.prices }
  const port: ModelPort = { ...live, choose: () => captured, otherLine: () => captured }
  const chat = askWorld({ models: port })
  // Where a cache mark sits moves from turn to turn; what is sent does not.
  const sent = (prompt: LanguageModelV4Prompt) =>
    JSON.parse(
      JSON.stringify(prompt, (key, value: unknown) =>
        key === 'providerOptions' ? undefined : value,
      ),
    ) as unknown[]

  it('sends the earlier turn as it was sent, so its prompt cache holds', async () => {
    const api = await chat.as(ML)
    const first = await api.ask({ question: 'What is net revenue?' })
    const last = sent(prompts.at(-1)!)
    const from = prompts.length
    const turns = fitChat([chatTurnOf(first)!])
    const followUp = await api.ask({ question: 'Who owns it?', turns })
    expect(followUp.stopped).toBeUndefined()
    const next = sent(prompts[from]!)
    // The read the first turn made, then its words: the follow-up adds to what was sent.
    expect(last.length).toBeGreaterThan(2)
    expect(next.slice(0, last.length)).toEqual(last)
  }, 120_000)
})
