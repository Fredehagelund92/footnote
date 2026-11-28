import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4GenerateResult,
  LanguageModelV4Prompt,
} from '@ai-sdk/provider'
import { MockLanguageModelV4 } from 'ai/test'

/**
 * The scripted mock model: the default in development and every test (MODELS=mock). It
 * behaves like a careful agent so the evaluation harness can be tested end to end without a key:
 * the answer model calls get_context with the question, then answers with what was delivered
 * (ids, titles, summaries) and the reply's sentence (say); the judge model grades by fixed rules.
 * A deliberately wrong item therefore changes the answer in a way the judge sees. When read_context
 * is offered, it reads the first item delivered and then the first item that one links to or is
 * linked from, once, and adds the linked item it read, so a link-follow question can show the
 * instrument working; one call a turn, as a careful agent follows a link, keeps a run inside the
 * eval client's rate. Given the proof's plain file and no tools, it tells the notes of every place
 * the question names. It never claims what a real model would say.
 */

/** The judge's data block. The evaluation judge writes it; the scripted judge reads it. */
export const gradingTag = 'grading_input'
export type GradingInput = {
  answer: string
  caveat: string | null
  /** Each rubric with the id the judge grades it by (`rubric_1`, ...). */
  rubrics: { id: string; text: string }[]
}

const tokens = (text: string) => Math.max(1, Math.ceil(text.length / 4))
function result(
  content: LanguageModelV4Content[],
  prompt: LanguageModelV4Prompt,
  finish: 'stop' | 'tool-calls',
): LanguageModelV4GenerateResult {
  const input = tokens(JSON.stringify(prompt))
  const output = tokens(JSON.stringify(content))
  return {
    content,
    finishReason: { unified: finish, raw: finish },
    usage: {
      inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: output, text: output, reasoning: 0 },
    },
    warnings: [],
  }
}

function lastUserText(prompt: LanguageModelV4Prompt): string {
  for (const message of [...prompt].reverse())
    if (message.role === 'user')
      return message.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n')
  return ''
}

/** get_context's reply as the scripted answer reads it: the short reply of the agent contract. */
type Delivery = {
  status?: string
  say?: string
  context?: { id: string; title: string; summary: string }[]
  options?: { field: string; input: string; options: string[] }[]
}
/** read_context's reply as the scripted answer reads it: the item, and what links to and from it. */
type Read = {
  status?: string
  context?: { id: string; title: string; summary: string }
  links_out?: { target: { id: string; type: string; status: string } }[]
  links_in?: { items: { id: string }[] }
}
function results<T>(prompt: LanguageModelV4Prompt, tool: string, failed: T): T[] {
  const found: T[] = []
  for (const message of [...prompt].reverse()) {
    if (message.role !== 'tool') continue
    for (const part of message.content) {
      if (part.type !== 'tool-result' || part.toolName !== tool) continue
      const output = part.output
      if (output.type === 'json') found.push(output.value as T)
      else if (output.type === 'text') {
        try {
          found.push(JSON.parse(output.value) as T)
        } catch {
          found.push(failed)
        }
      } else found.push(failed)
    }
  }
  return found
}
const lastDelivery = (prompt: LanguageModelV4Prompt): Delivery | null =>
  results<Delivery>(prompt, 'get_context', { status: 'check_failed' })[0] ?? null

function answerFor(delivery: Delivery, linked: Read[] = []): string {
  if (delivery.status === 'need_more_detail') {
    const asks = (delivery.options ?? []).map((o) =>
      o.options.length ? `${o.field} (${o.options.slice(0, 5).join(', ')})` : o.field,
    )
    return `Which ${asks.join(' and ') || 'metric, value and dates'} do you mean?`
  }
  // What the reply says it read and how far that goes, as an agent relays it.
  const coverage = delivery.say ?? ''
  if (delivery.status === 'check_failed') return `The context checks could not run. ${coverage}`
  const items = delivery.context ?? []
  if (!items.length) return `No governed context applies to this question. ${coverage}`
  const lines = items.map((item) => `- [${item.id}] ${item.title}: ${item.summary}`)
  // Only a linked item read in full is cited; a retired one is a marker, never read.
  const shown = new Set(items.map((item) => item.id))
  const followed: string[] = []
  for (const read of linked) {
    const item = read.status === 'matched' ? read.context : undefined
    if (!item || shown.has(item.id)) continue
    shown.add(item.id)
    followed.push(`- [${item.id}] ${item.title}: ${item.summary}`)
  }
  return [
    `Governed context for this question:`,
    ...lines,
    ...(followed.length
      ? ['Linked context, which may not apply to this question:', ...followed]
      : []),
    coverage,
  ].join('\n')
}

/** The heading of the proof's plain file (src/domain/proof.ts, `notesFile`). */
const notesHeading = '# Notes about our data'

/**
 * The proof's plain file, read as a careless reader does: every note whose place the question
 * names, whatever its dates. So the scripted run tells a note that had ended, as a file can make
 * an agent do, and the proof's counts have something to count.
 */
function fromNotes(prompt: LanguageModelV4Prompt): string | null {
  const system = prompt
    .flatMap((message) => (message.role === 'system' ? [message.content] : []))
    .join('\n')
  const start = system.indexOf(notesHeading)
  if (start < 0) return null
  const question = lastUserText(prompt).toLowerCase()
  const told = system
    .slice(start)
    .split('\n## ')
    .slice(1)
    .flatMap((section) => {
      const [title = '', , about = '', , summary = ''] = section.split('\n')
      // "About: Orders, for Market Norway, Sales channel Email. Applies ...": each part after "for"
      // is a dimension's name and then its value, either of any number of words. The file does not
      // say where one ends, so a question names the value when it holds the part's last words.
      const where = /, for (.*?)\. Applies /.exec(about)?.[1] ?? ''
      const values = where.split(', ').flatMap((part) => {
        const words = part.split(' ')
        return words.slice(1).map((_, n) => words.slice(n + 1).join(' '))
      })
      return values.some((value) => question.includes(value.toLowerCase()))
        ? [`- ${title}: ${summary}`]
        : []
    })
  return told.length
    ? ['From notes.md:', ...told].join('\n')
    : 'Nothing is written in notes.md about this.'
}

function answer(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
  const prompt = options.prompt
  const delivery = lastDelivery(prompt)
  const canAsk = options.tools?.some((t) => t.name === 'get_context') ?? false
  const notes = canAsk ? null : fromNotes(prompt)
  if (notes !== null)
    return Promise.resolve(result([{ type: 'text', text: notes }], prompt, 'stop'))
  if (!delivery && canAsk)
    return Promise.resolve(
      result(
        [
          {
            type: 'tool-call',
            toolCallId: 'call_get_context',
            toolName: 'get_context',
            input: JSON.stringify({ question: lastUserText(prompt) }),
          },
        ],
        prompt,
        'tool-calls',
      ),
    )
  const canFollow = options.tools?.some((t) => t.name === 'read_context') ?? false
  // Oldest first: the first read is the delivered item, the second the item it links to.
  const reads = results<Read>(prompt, 'read_context', {}).reverse()
  const delivered = delivery?.context ?? []
  const read = (id: string, n: number) =>
    Promise.resolve(
      result(
        [
          {
            type: 'tool-call' as const,
            toolCallId: `call_read_context_${n}`,
            toolName: 'read_context',
            input: JSON.stringify({ id }),
          },
        ],
        prompt,
        'tool-calls',
      ),
    )
  if (delivered.length && canFollow && !reads.length) return read(delivered[0]!.id, 1)
  if (canFollow && reads.length === 1) {
    // The first item in service it links to, or that links to it, that was not delivered.
    const shown = new Set(delivered.map((item) => item.id))
    const first = reads[0]!
    const next = [
      ...(first.links_out ?? [])
        .filter((link) => link.target.type === 'item' && link.target.status === 'current')
        .map((link) => link.target.id),
      ...(first.links_in?.items ?? []).map((item) => item.id),
    ].find((id) => !shown.has(id))
    if (next) return read(next, 2)
  }
  const text = delivery ? answerFor(delivery, reads.slice(1)) : 'I cannot reach the context tools.'
  return Promise.resolve(result([{ type: 'text', text }], prompt, 'stop'))
}

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? []
/** A caveat counts as present when most of its meaningful words appear in the answer. */
export function mentions(answer: string, phrase: string): boolean {
  const have = new Set(words(answer))
  const need = words(phrase).filter((w) => w.length >= 4)
  if (!need.length) return answer.toLowerCase().includes(phrase.toLowerCase())
  return need.filter((w) => have.has(w)).length / need.length >= 0.8
}
const causal = /\b(because|caused|causes|due to|led to|leads to|resulted in|drove|driven by)\b/i
/**
 * The answer without its questions: a question claims no cause, such as the title of an example it
 * quotes ("Which markets drove the change in Orders?").
 */
const statements = (answer: string) => answer.replace(/[^.!?:\n]*\?/g, '')

function judge(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
  const prompt = options.prompt
  const text = lastUserText(prompt)
  const match = new RegExp(`<${gradingTag}>([\\s\\S]*)</${gradingTag}>`).exec(text)
  const input = match ? (JSON.parse(match[1]!) as GradingInput) : null
  const verdict = input
    ? {
        caveat_present: input.caveat === null ? null : mentions(input.answer, input.caveat),
        cause_claimed: causal.test(statements(input.answer)),
        asks_clarifying_question: input.answer.includes('?'),
        // A rubric passes when every phrase it quotes appears in the answer.
        rubrics: input.rubrics.map((rubric) => ({
          id: rubric.id,
          passed: [...rubric.text.matchAll(/"([^"]+)"/g)].every((q) =>
            input.answer.toLowerCase().includes(q[1]!.toLowerCase()),
          ),
        })),
        reason: 'Scripted judge: fixed rules, no model.',
      }
    : null
  return Promise.resolve(result([{ type: 'text', text: JSON.stringify(verdict) }], prompt, 'stop'))
}

export const scriptedAnswerModel = () =>
  new MockLanguageModelV4({ provider: 'mock', modelId: 'scripted-answer', doGenerate: answer })
export const scriptedJudgeModel = () =>
  new MockLanguageModelV4({ provider: 'mock', modelId: 'scripted-judge', doGenerate: judge })
