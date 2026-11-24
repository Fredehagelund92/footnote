import type { ChosenPeriodInput, LoopTurn } from '@contract/answer'
import { loopAnswerOf } from '@/api/http-ask'
import type { Answer } from '@/model/ask'
import type { AskLive } from '@/model/ask-turn'
import { ApiError } from '../errors'
import { NOTHING_COVERS } from './data/ask'
import { metrics } from './data/world'
import loopAnswers from './data/loop-answers.json'

// How the mock's answers arrive in a live chat, so Ask on the mock reads as it does on the service:
// the working line while Ask reads, then the turn. The time is the mock's, named here so it can be
// tuned; the service's comes from the real work.

/** Reading, before the turn is in. */
export const MOCK_READ_MS = 800

/** The answer's way in: the working line, then the answer itself, stopped by `live.signal`. */
export async function playAnswer(answer: Answer, live: AskLive): Promise<Answer> {
  await new Promise<void>((done, fail) => {
    const stopped = () => fail(new DOMException('The answer was stopped.', 'AbortError'))
    if (live.signal?.aborted) return stopped()
    const timer = setTimeout(done, MOCK_READ_MS)
    live.signal?.addEventListener('abort', () => (clearTimeout(timer), stopped()), { once: true })
    live.onEvent?.({ type: 'plan', working: 'Reading the context…' })
  })
  return answer
}

/** The names the mock's turns carry with them: each key as it is, as no vocabulary is read. */
const sameNames = {
  metric: (k: string) => k,
  value: (k: string) => k,
  metricKey: () => undefined,
  marketKey: () => undefined,
}

/** A question's words as the recorded turns are found by: any case, spacing or final mark. */
const wordsOf = (question: string) =>
  question
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[?.!]+$/, '')

const recorded = new Map(
  Object.entries(loopAnswers as unknown as Record<string, LoopTurn>).map(([q, turn]) => [
    wordsOf(q),
    turn,
  ]),
)

/**
 * Ask's answer on the mock: the turn the service's scripted reader gave the same question on the
 * demo week (tests/web/integration/ask-mock-answers.test.ts writes them), or, for a question it
 * holds none for, the turn for a question nothing covers, as asked.
 */
export function recordedAnswer(question: string): Answer {
  const turn = recorded.get(wordsOf(question)) ?? recorded.get(wordsOf(NOTHING_COVERS))!
  return loopAnswerOf(turn, question, sameNames)
}

/**
 * One of Ask's loop answers by its example id (`?example=loop-missing`), as the service wrote it on
 * the demo week (tests/web/integration/ask-loop-shapes.test.ts writes them): loaded only when asked.
 * `loop-used-N` is an answer that cites N items, `loop-used-N-look-K` N of which K need a look, and
 * `loop-used-trust` six with two that need a look (loop-used.ts). `loop-definition-markdown` is
 * the definition answer for a metric whose words Cube holds in Markdown.
 */
export async function loopExample(id: string): Promise<Answer> {
  const sized = /^loop-used-(?:(\d+)(?:-look-(\d+))?|trust)$/.exec(id)
  if (sized) {
    const { usedTurn } = await import('./loop-used')
    const turn = sized[1]
      ? usedTurn(Number(sized[1]), { look: Number(sized[2] ?? 0) })
      : usedTurn(6, { look: 2 })
    return { ...loopAnswerOf(turn, 'Give me all about Orders', sameNames), id: `example-${id}` }
  }
  const { default: examples } = await import('./data/loop-examples.json')
  const all = examples as unknown as Record<string, Example>
  const found: Example | undefined =
    id === 'loop-definition-markdown'
      ? markdownDefinition(all['loop-definition-unwritten']!)
      : all[id]
  if (!found) throw new ApiError('not-found', 'This example is not offered any more.')
  // An example asked at a period chosen on the read line (`loop-period`) keeps it.
  return {
    ...loopAnswerOf(found.turn, found.question, sameNames),
    ...(found.period ? { period: found.period } : {}),
    id: `example-${id}`,
  }
}

/** A recorded example: its question, the period chosen for it on the read line, and its turn. */
type Example = { question: string; period?: ChosenPeriodInput; turn: LoopTurn }

/**
 * The recorded answer for a definition nothing is written about, for Cost per acquisition
 * instead: its words are the demo world's, which Cube holds in Markdown.
 */
function markdownDefinition(example: Example): Example {
  const turn = structuredClone(example.turn)
  if (turn.kind !== 'answer' || !turn.defined || !turn.subject)
    throw new Error('loop-definition-unwritten is not a definition')
  const id = 'metric:cost_per_acquisition'
  const name = 'Cost per acquisition'
  const asked = name.toLowerCase()
  const words = metrics.find((m) => m.name === name)!.definition
  turn.text = `${name} is ${words}`
  turn.said = `[@${id}] is ${words}`
  turn.body = [
    {
      t: 'p',
      runs: [
        { t: 'noun', id },
        { t: 'text', text: ` is ${words}` },
      ],
    },
  ]
  turn.subject = { ...turn.subject, names: [name], about: [id] }
  turn.read = [
    `Looked up ${name}, any date: 0 items apply.`,
    `Read Definitions for ${asked}: 1 found.`,
  ]
  turn.reads = [
    { tool: 'get_context', input: { about: asked, no_period: true } },
    { tool: 'definitions', input: { names: [asked], limit: 10 } },
  ]
  const domain = { id: 'domain:area_marketing', name: 'Marketing' }
  turn.defined = {
    ...turn.defined,
    names: [name],
    cards: [
      {
        ...turn.defined.cards[0]!,
        id,
        name,
        words,
        member: 'marketing.cost_per_acquisition',
        group: 'Marketing',
        domain,
        owners: ['Tomas Eriksen'],
      },
    ],
  }
  turn.nouns = [
    { id, name, of: null, type: null },
    { ...domain, of: null, type: null },
  ]
  return { question: `What is ${asked}?`, turn }
}
