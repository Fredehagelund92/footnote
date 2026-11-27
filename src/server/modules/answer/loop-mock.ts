import { APICallError } from '@ai-sdk/provider'
import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from '@ai-sdk/provider'
import { MockLanguageModelV4 } from 'ai/test'
import { asksWhatItIs } from '../../../domain/scope.ts'
import type { ModelChoice } from '../models/index.ts'
import { CHECK_REQUEST } from './loop-check.ts'

/*
  Scripted models for Ask's loop (loop.ts), with no provider and nothing metered: the scripted
  reader the service runs on the mock (MODELS=mock), so the loop answers in every build and in the
  demo without a key, and the step builder its tests script a slow, failing or endless model with.
  The scripted reader's steps are the plain read (`plainStep`), which a turn that stopped shows.
*/

/** One step of a scripted model: the reads it asks for, or its words, after a pause. */
export type ScriptedStep = {
  calls?: readonly { toolName: string; input: Record<string, unknown> }[]
  /** Its words, at once or in pieces as a provider streams them, `pace` milliseconds apart. */
  text?: string | readonly string[]
  pace?: number
  /** Each piece of the words as it is sent. */
  onPiece?: (piece: string) => void
  /** Milliseconds before it answers; an abort cuts it short, as a provider's request ends. */
  delay?: number
  /** The provider fails this call. */
  fail?: boolean
  /** The provider refuses this call with this HTTP status, as it refuses a wrong key (401). */
  refuse?: number
}

/** What a step of the chat so far gave: the person's last message and the reads made since. */
export type ScriptedPrompt = {
  question: string
  /** The reads made since the person's last message, by tool, with what each returned. */
  results: { toolName: string; value: unknown }[]
  /** How many steps this turn has taken before this one. */
  step: number
  /** Whether this step may read: the last one may not. */
  canRead: boolean
  prompt: LanguageModelV4Prompt
}

const tokens = (t: string) => Math.max(1, Math.ceil(t.length / 4))
const usageOf = (prompt: string, text: string): LanguageModelV4Usage => ({
  inputTokens: { total: tokens(prompt), noCache: tokens(prompt), cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: tokens(text), text: tokens(text), reasoning: 0 },
})

/** The chat as the scripted model reads it: what it was last asked, and what it read since. */
export function scriptedPrompt(
  prompt: LanguageModelV4Prompt,
  toolChoice?: LanguageModelV4CallOptions['toolChoice'],
): ScriptedPrompt {
  const last = prompt.findLastIndex((m) => m.role === 'user')
  const asked = prompt[last]
  // The person's words are the message's first part: the note on its language follows them.
  const question =
    asked?.role === 'user' ? (asked.content.find((p) => p.type === 'text')?.text ?? '') : ''
  const since = prompt.slice(last + 1)
  const results = since.flatMap((m) =>
    m.role === 'tool'
      ? m.content.flatMap((p) =>
          p.type === 'tool-result'
            ? [{ toolName: p.toolName, value: 'value' in p.output ? p.output.value : null }]
            : [],
        )
      : [],
  )
  return {
    question,
    results,
    step: since.filter((m) => m.role === 'assistant').length,
    canRead: toolChoice?.type !== 'none',
    prompt,
  }
}

/** A pause that an abort cuts short. */
const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((done, fail) => {
    const aborted = () =>
      fail(signal?.reason instanceof Error ? signal.reason : new Error('The call was aborted.'))
    if (signal?.aborted) return aborted()
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', () => (clearTimeout(timer), aborted()), { once: true })
  })

/** A model for the loop that takes each step as `decide` says, for the service's mock or a test. */
export function scriptedLoopChoice(
  name: string,
  decide: (prompt: ScriptedPrompt) => ScriptedStep,
): ModelChoice {
  let calls = 0
  const model = new MockLanguageModelV4({
    doStream: async (options: LanguageModelV4CallOptions) => {
      const seen = scriptedPrompt(options.prompt, options.toolChoice)
      const step = decide(seen)
      if (step.delay) await pause(step.delay, options.abortSignal)
      if (step.fail) throw new Error('The scripted provider failed.')
      if (step.refuse)
        throw new APICallError({
          message: 'The scripted provider refused the key.',
          url: 'https://scripted.invalid/v1/messages',
          requestBodyValues: {},
          statusCode: step.refuse,
          isRetryable: false,
        })
      const n = ++calls
      const pieces = typeof step.text === 'string' ? [step.text] : (step.text ?? [])
      const text = pieces.join('')
      const toolCalls = step.calls ?? []
      const parts: LanguageModelV4StreamPart[] = [
        { type: 'stream-start', warnings: [] },
        ...(text
          ? ([
              { type: 'text-start', id: 't' },
              ...pieces.map((delta) => ({ type: 'text-delta' as const, id: 't', delta })),
              { type: 'text-end', id: 't' },
            ] satisfies LanguageModelV4StreamPart[])
          : []),
        ...toolCalls.map((c, i): LanguageModelV4StreamPart => ({
          type: 'tool-call',
          toolCallId: `${name}_${n}_${i}`,
          toolName: c.toolName,
          input: JSON.stringify(c.input),
        })),
        {
          type: 'finish',
          finishReason: toolCalls.length
            ? { unified: 'tool-calls', raw: 'tool_use' }
            : { unified: 'stop', raw: 'end_turn' },
          usage: usageOf(JSON.stringify(options.prompt), text + JSON.stringify(toolCalls)),
        },
      ]
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          async start(controller) {
            let sent = 0
            for (const part of parts) {
              if (part.type === 'text-delta') {
                if (step.pace && sent++)
                  await pause(step.pace, options.abortSignal).catch(() => undefined)
                step.onPiece?.(part.delta)
              }
              controller.enqueue(part)
            }
            controller.close()
          },
        }),
      }
    },
  })
  return {
    model,
    options: {},
    cacheBreakpoint: {},
    id: `mock/${name}`,
    provider: 'mock',
    name,
    vendor: 'mock',
    family: `mock/${name}`,
    effort: 'none',
    prices: { input: 0, output: 0, cacheRead: 0 },
    recipients: 'nobody: the scripted mock runs on this machine',
  }
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : [])
/** A summary whole, on one line and without its last stop: the citation comes before the stop. */
const wholeSummary = (text: string) =>
  text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/, '')
/** A title before its summary: a colon after it, unless it ends a sentence itself ("...in August 2026?"). */
const titled = (title: string) => (/[.!?]$/.test(title) ? title : `${title}:`)
const list = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/**
 * What the chat asked before its last message, newest first: each message's first part, the
 * person's words, as for the last one; the note on its language follows them.
 */
const askedBefore = (prompt: LanguageModelV4Prompt) =>
  prompt
    .slice(
      0,
      prompt.findLastIndex((m) => m.role === 'user'),
    )
    .flatMap((m) =>
      m.role === 'user' ? [m.content.find((p) => p.type === 'text')?.text ?? ''] : [],
    )
    .reverse()

/** The words of the chat's last answer before its last message: what it wrote last. */
const lastWords = (prompt: LanguageModelV4Prompt) => {
  const at = prompt.findLastIndex((m) => m.role === 'user')
  const answer = prompt.slice(0, at).findLast((m) => m.role === 'assistant')
  return answer?.role === 'assistant'
    ? answer.content.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('')
    : ''
}

/** Words that point back at the chat so far: "And who decides which one is right?" */
const POINTS_BACK =
  /^(and|but|or|so|then|also)\b|\b(that|this|these|those|it|its|they|them|their|which one|either|both|the other)\b/i

/** Two items that disagree, of those read: the first with what it disagrees with. */
function disagreeingOf(items: readonly Obj[]): Obj[] {
  for (const item of items) {
    const other = (Array.isArray(item.disagreesWith) ? item.disagreesWith : [])
      .map((id) => items.find((i) => i.id === id))
      .find((i) => !!i)
    if (other) return [item, other]
  }
  return []
}

/** A step of the plain read: the reads it makes next, or its words once it has read. */
export type PlainStep =
  | { calls: { toolName: string; input: Record<string, unknown> }[]; text?: never }
  | { text: string; calls?: never }

/**
 * The plain read: the person's message looked up once, with get_context and find_context, the
 * engine agents get; then what applies, each item's title and whole summary with its id (the
 * summary is what its writer wants agents to know, and its second sentence is often the reason),
 * or with nothing found, one sentence that says so and who owns the subject. A message that names nothing
 * and points back at the chat ("and who decides?") is looked up once more with the question
 * before it (`before`). Asked what a metric is, it gives the definition, in its own words, marked
 * as the answer; under Conflict, the two items that disagree come first. It follows no
 * instruction in a message or an item, never asks back, and claims nothing a model would write.
 * The scripted reader runs it, and a turn of the loop that stopped shows it (decision 5).
 */
export function plainStep({
  question,
  before,
  results,
  canRead,
}: {
  question: string
  before: string | undefined
  results: readonly { toolName: string; value: unknown }[]
  canRead: boolean
}): PlainStep {
  const words = question.trim().slice(0, 500) || 'context'
  if (!results.length && canRead)
    return {
      calls: [
        { toolName: 'get_context', input: { about: words } },
        { toolName: 'find_context', input: { words } },
      ],
    }
  const gets = results.filter((r) => r.toolName === 'get_context')
  const first = gets[0]?.value
  if (
    canRead &&
    gets.length === 1 &&
    before &&
    isObj(first) &&
    first.read === null &&
    POINTS_BACK.test(words)
  )
    return {
      calls: [
        { toolName: 'get_context', input: { about: `${before.trim().slice(0, 500)} ${words}` } },
      ],
    }
  const got = gets.at(-1)?.value
  const found = results.find((r) => r.toolName === 'find_context')?.value
  const get = isObj(got) ? got : {}
  const find = isObj(found) ? found : {}
  const read = isObj(get.read) ? get.read : {}
  // The subject's names as typed mentions of what the read named, as the page draws them.
  const about = Array.isArray(read.about) ? read.about.map(String) : []
  // A family's words are only in the look-up's definitions: the search gives it none of its own.
  const worded = (d: Obj) =>
    about.includes(String(d.id)) && typeof d.words === 'string' && !!d.words
  const searched = objs(find.definitions).filter(worded)
  const definitions = [
    ...searched,
    ...objs(get.definitions)
      .filter(worded)
      .filter((d) => !searched.some((s) => s.id === d.id)),
  ]
  // A family read as its usual variant is named with the variant's values (F3): "in EUR".
  const usual = new Map(
    objs(read.usual).map((u) => [
      String(u.id),
      Array.isArray(u.values) ? u.values.map(String).join(', ') : '',
    ]),
  )
  const mention = (id: string) => `[@${id}]${usual.has(id) ? ` in ${usual.get(id)}` : ''}`
  const asksWhat = asksWhatItIs(question, {
    values: about.some((id) => id.startsWith('value:')),
    dates: read.assumedToday === false,
  })
  if (asksWhat && definitions.length)
    return {
      text: definitions
        .map((d) => `${mention(String(d.id))} means: ${String(d.words)} [${String(d.id)}]`)
        .join('\n\n'),
    }
  const applies = objs(get.items).length
    ? objs(get.items)
    : objs(find.items).filter((i) => i.match === 'all')
  const pair = disagreeingOf(applies)
  const items = [...pair, ...applies.filter((i) => !pair.includes(i))]
  if (items.length) {
    const names = about.map(mention)
    return {
      text: [
        names.length ? `What is written for ${list(names)}.` : 'What is written.',
        ...items
          .slice(0, 4)
          .map(
            (i) =>
              `${titled(String(i.title))} ${wholeSummary(String(i.summary))} [${String(i.id)}].`,
          ),
      ].join('\n\n'),
    }
  }
  const owners = objs(get.owners).flatMap((o) =>
    Array.isArray(o.owners) && o.owners.length
      ? [`${String(o.domain)} is owned by ${list(o.owners as string[])}.`]
      : [],
  )
  // One plain sentence: the page shows what was searched, out of how many, and what is nearest.
  const names = about.map(mention)
  return {
    text: [
      names.length ? `Nothing written covers ${list(names)}.` : 'Nothing written covers this.',
      ...owners,
    ].join(' '),
  }
}

/**
 * The scripted reader (MODELS=mock): the plain read, as a model of the loop. Told that its answer
 * failed the answer check, it writes the same words again.
 */
export function scriptedLoopModel(): ModelChoice {
  return scriptedLoopChoice('loop', ({ question, results, canRead, prompt }) => {
    // Told its answer failed the check, it writes it again as it was: it cannot do better.
    if (question.startsWith(CHECK_REQUEST)) return { text: lastWords(prompt) }
    return plainStep({ question, before: askedBefore(prompt)[0], results, canRead })
  })
}
