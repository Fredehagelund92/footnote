import { APICallError } from '@ai-sdk/provider'
import {
  generateText,
  InvalidToolInputError,
  NoObjectGeneratedError,
  NoSuchToolError,
  Output,
  tool,
  ToolChoiceViolationError,
} from 'ai'
import { z } from 'zod'
import type { Database } from '../../db/database.ts'
import { createCallMeter, ModelCallError, type RetryPolicy } from './calls.ts'
import type { ModelPort } from './port.ts'
import { differentFamily, type ModelSettings } from './settings.ts'
import { readSpendLimits, spendCapReached, type SpendFeature } from './spend.ts'
import type { ModelChoice, ModelRole } from './types.ts'

/**
 * The capability check (`npm run models:check`, and once at start-up for each role): three tiny
 * calls that tell whether a model does what its roles need, since a server that speaks OpenAI's or
 * Anthropic's API need not support tools or JSON schemas behind it.
 * - `tools`: one forced call of a tool whose input is a strict object of two fields. Ask's loop and
 *   test runs answer by calling tools; a model that fails sends Ask to its router, which needs only
 *   words, and test runs refuse to start.
 * - `noTools`: one call with the tool named and `toolChoice: 'none'`, which Ask's last step and its
 *   rewrite send. A model that calls the tool anyway ends its turn at the step limit, so a failure
 *   is shown and logged only.
 * - `json`: one answer as an object against a JSON schema, the judge's verdict. A judge that fails
 *   asks for JSON text at once.
 * A check that could not tell, because the provider failed, throttled or refused the key, a call
 * timed out or a spending cap was reached, is `unknown` and changes nothing; it is made again a
 * while later.
 */

export type CheckOutcome = 'pass' | 'fail' | 'unknown'
export type ModelCheck = {
  /** `provider/model`, as runs record it. */
  model: string
  /** When the check was made, as an ISO time. */
  at: string
  tools: CheckOutcome
  noTools: CheckOutcome
  json: CheckOutcome
  /** Why a check failed or could not tell, such as `tools: HTTP 400`; never a prompt or a key. */
  notes: string[]
}

/** The checks as the service keeps them, one per model, shared by every role that uses it. */
export interface ModelChecks {
  /** The model's check, made once; one that could not tell is made again after a while. */
  of(choice: ModelChoice, role: ModelRole): Promise<ModelCheck>
  /** The model's last check without making one, or undefined. */
  known(id: string): ModelCheck | undefined
}

/** Each call's limit. A reasoning model may think before it calls the tool. */
const CALL_MS = 30_000
const OUTPUT_TOKENS = 512
/** A provider that fails or throttles is tried once more, briefly. */
const checkRetry: RetryPolicy = { tries: 2, budgetMs: 20_000, baseMs: 1_000, capMs: 4_000 }
/** What a check is reckoned to cost before it is made, for the spending caps: one cent. */
const CHECK_MICROS = 10_000
/** How long a check that could not tell is kept before it is made again. */
const UNKNOWN_FOR_MS = 5 * 60_000

const city = z.strictObject({ city: z.string(), count: z.number().int() })
const record = tool({
  description: 'Record a city and a count.',
  inputSchema: city,
})
const task = 'Record the city Oslo with the count 3.'
const isOslo = (input: unknown) => {
  const parsed = city.safeParse(input)
  return parsed.success && parsed.data.city.toLowerCase() === 'oslo' && parsed.data.count === 3
}

/**
 * What the provider said when it turned a call away, on one line and short. The check's calls hold
 * no company data, so their errors can be shown.
 */
function providerMessage(error: APICallError): string {
  let said: unknown
  try {
    const body = JSON.parse(error.responseBody ?? '') as Record<string, unknown>
    said = (body.error as Record<string, unknown> | undefined)?.message ?? body.message
  } catch {
    said = undefined
  }
  const text = typeof said === 'string' ? said.replace(/\s+/g, ' ').trim() : ''
  return text.length > 160 ? `${text.slice(0, 159)}…` : text
}

/** Whether a call was turned away for what it asked: a tool, a tool choice or a schema. */
const turnedAway = (error: unknown) =>
  APICallError.isInstance(error) && [400, 404, 422].includes(error.statusCode ?? 0)

/** A call that went wrong: the model's failure, or `unknown` when the provider kept it from telling. */
function outcomeOf(error: unknown): { outcome: CheckOutcome; note: string } {
  if (NoSuchToolError.isInstance(error) || InvalidToolInputError.isInstance(error))
    return { outcome: 'fail', note: 'a call that did not fit the tool' }
  if (ToolChoiceViolationError.isInstance(error))
    return { outcome: 'fail', note: 'an answer against the tool choice' }
  if (NoObjectGeneratedError.isInstance(error))
    return { outcome: 'fail', note: 'no object that fits the schema' }
  if (error instanceof ModelCallError) return { outcome: 'unknown', note: error.message }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode
    const said = providerMessage(error)
    // The server turned the request itself away: it does not take tools, tool choice or a schema.
    if (turnedAway(error))
      return { outcome: 'fail', note: said ? `HTTP ${status}: ${said}` : `HTTP ${status}` }
    if (status === 401 || status === 403)
      return { outcome: 'unknown', note: `the key was refused (HTTP ${status})` }
    return { outcome: 'unknown', note: status ? `HTTP ${status}` : 'no answer' }
  }
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
    return { outcome: 'unknown', note: `no answer within ${CALL_MS / 1000} s` }
  return { outcome: 'unknown', note: error instanceof Error ? error.name : 'an error' }
}

/**
 * Makes the three calls on one model. What they cost is the caller's meter's. When the provider
 * turns a call away, one plain call follows, with no tool and no schema: turned away too, the
 * model or its provider is not reachable as set, which says nothing of what the model can do, so
 * every check is `unknown`.
 */
export async function checkModel(choice: ModelChoice): Promise<ModelCheck> {
  const common = {
    model: choice.model,
    providerOptions: choice.options,
    maxOutputTokens: OUTPUT_TOKENS,
    maxRetries: 0,
  }
  const notes: string[] = []
  let refused = false
  /** One call: `true` when it passed, why it failed, or null when it could not tell. */
  const run = async (
    name: string,
    call: () => Promise<true | string | null>,
  ): Promise<CheckOutcome> => {
    try {
      const result = await call()
      if (result === true) return 'pass'
      if (result === null) return 'unknown'
      notes.push(`${name}: ${result}`)
      return 'fail'
    } catch (error) {
      refused ||= turnedAway(error)
      const { outcome, note } = outcomeOf(error)
      notes.push(`${name}: ${note}`)
      return outcome
    }
  }
  const tools = await run('tools', async () => {
    const result = await generateText({
      ...common,
      prompt: task,
      tools: { record },
      toolChoice: { type: 'tool', toolName: 'record' },
      abortSignal: AbortSignal.timeout(CALL_MS),
    })
    const call = result.toolCalls.find((c) => c.toolName === 'record')
    if (call && !call.invalid && isOslo(call.input)) return true
    if (!call && result.finishReason === 'length') {
      notes.push('tools: the output limit ended it before a call')
      return null
    }
    return call ? 'a call with the wrong input' : 'no call of the tool'
  })
  const noTools = await run('noTools', async () => {
    const result = await generateText({
      ...common,
      prompt: `${task} Do not call the tool: say in one word which city it is.`,
      tools: { record },
      toolChoice: 'none',
      abortSignal: AbortSignal.timeout(CALL_MS),
    })
    if (result.toolCalls.length) return 'a call of the tool it was told not to call'
    return result.text.trim() ? true : 'no words'
  })
  const json = await run('json', async () => {
    const result = await generateText({
      ...common,
      prompt: `${task} Answer with the city and the count.`,
      output: Output.object({ schema: city }),
      abortSignal: AbortSignal.timeout(CALL_MS),
    })
    return isOslo(result.output) ? true : 'an object with the wrong values'
  })
  const at = new Date().toISOString()
  if (refused) {
    const plain = await generateText({
      ...common,
      prompt: 'Say the word ready.',
      abortSignal: AbortSignal.timeout(CALL_MS),
    }).then(
      () => null,
      (error: unknown) => (turnedAway(error) ? outcomeOf(error).note : null),
    )
    if (plain !== null)
      return {
        model: choice.id,
        at,
        tools: 'unknown',
        noTools: 'unknown',
        json: 'unknown',
        notes: [
          `a plain call was turned away too, so the model or its provider is not reachable as set (${plain})`,
        ],
      }
  }
  return { model: choice.id, at, tools, noTools, json, notes }
}

/** Which spending a role's check counts against. */
const featureOf = (role: ModelRole): SpendFeature => (role === 'assistant' ? 'assistant' : 'eval')

export type ModelChecksOptions = {
  /** The spend ledger the calls are written to; without it they are not metered. */
  database?: Database
  /** Makes the calls; tests replace it. */
  check?: (choice: ModelChoice) => Promise<ModelCheck>
  now?: () => number
}

/**
 * The service's checks, kept in memory per model: every role that uses a model shares its check,
 * and two at once wait for the same calls. The calls are metered as the role's feature, with no
 * person, and none is made while a spending cap is reached.
 */
export function createModelChecks(options: ModelChecksOptions = {}): ModelChecks {
  const now = options.now ?? Date.now
  const made = new Map<string, { check: ModelCheck; until: number }>()
  const making = new Map<string, Promise<ModelCheck>>()
  const unknown = (choice: ModelChoice, note: string): ModelCheck => ({
    model: choice.id,
    at: new Date(now()).toISOString(),
    tools: 'unknown',
    noTools: 'unknown',
    json: 'unknown',
    notes: [note],
  })
  async function make(choice: ModelChoice, role: ModelRole): Promise<ModelCheck> {
    const { database } = options
    const feature = featureOf(role)
    if (!database) return (options.check ?? checkModel)(choice)
    const cap = await database.transaction(null, async (tx) =>
      spendCapReached(tx, feature, await readSpendLimits(tx, feature), CHECK_MICROS, null),
    )
    if (cap) return unknown(choice, `not checked: ${cap}`)
    const meter = createCallMeter({
      database,
      feature,
      person: null,
      limits: null,
      retry: checkRetry,
    })
    try {
      return await (options.check ?? checkModel)(meter.wrap(choice, { role }))
    } finally {
      await meter.close()
    }
  }
  return {
    known: (id) => made.get(id)?.check,
    of(choice, role) {
      const kept = made.get(choice.id)
      if (kept && kept.until > now()) return Promise.resolve(kept.check)
      const pending = making.get(choice.id)
      if (pending) return pending
      const promise = make(choice, role)
        .catch((error: unknown) => unknown(choice, outcomeOf(error).note))
        .then((check) => {
          const told = [check.tools, check.noTools, check.json].every((o) => o !== 'unknown')
          made.set(choice.id, { check, until: told ? Infinity : now() + UNKNOWN_FOR_MS })
          return check
        })
        .finally(() => making.delete(choice.id))
      making.set(choice.id, promise)
      return promise
    },
  }
}

/** The roles the check covers: those that call a model. Nothing drafts test questions yet. */
export const checkedRoles = ['assistant', 'eval_answer', 'judge'] as const
export type CheckedRole = (typeof checkedRoles)[number]

/**
 * Each checked role's model as the service uses it now, the judge's `different_family` worked out
 * from the answering model as a test run works it out.
 */
export function roleModels(
  port: ModelPort,
  settings: ModelSettings,
): { role: CheckedRole; choice: ModelChoice }[] {
  const answer = port.choose('eval_answer', settings.eval_answer)
  const judge =
    settings.judge === differentFamily
      ? port.otherLine('judge', answer)
      : port.choose('judge', settings.judge)
  return [
    { role: 'assistant', choice: port.choose('assistant', settings.assistant) },
    { role: 'eval_answer', choice: answer },
    { role: 'judge', choice: judge },
  ]
}

/** Whether the role's model failed a check the role needs: a warning in the log. */
export function roleFails(role: CheckedRole, check: ModelCheck): boolean {
  if (role === 'assistant') return check.tools === 'fail' || check.noTools === 'fail'
  return role === 'eval_answer' ? check.tools === 'fail' : check.json === 'fail'
}

/** What a role's check means for it, in plain words, for the log, the command and Settings. */
export function checkWords(role: CheckedRole, check: ModelCheck): string {
  const { tools, noTools, json } = check
  if (role === 'assistant') {
    if (tools === 'fail') return 'Can’t call tools, so Ask answers without them'
    if (tools === 'unknown') return 'Couldn’t tell, so Ask reads with its tools'
    return noTools === 'fail'
      ? 'Calls tools, but also when told not to; Ask still ends each answer at its step limit'
      : 'Calls tools, so Ask reads with them'
  }
  if (role === 'eval_answer') {
    if (tools === 'fail') return 'Can’t call tools, so answer tests refuse to start'
    return tools === 'unknown' ? 'Couldn’t tell' : 'Calls tools, as answer tests need'
  }
  if (json === 'fail') return 'Can’t keep to a JSON schema, so it is asked for JSON text'
  return json === 'unknown' ? 'Couldn’t tell' : 'Keeps to a JSON schema, as judging needs'
}

/** Ask reads with its tools unless its model failed the tool call; the router needs only words. */
export const answersWithTools = (check: ModelCheck | undefined): boolean => check?.tools !== 'fail'

/** Why a test run cannot start on its answering model, or null. */
export function testRunRefusal(check: ModelCheck): string | null {
  if (check.tools !== 'fail') return null
  const why = check.notes.find((n) => n.startsWith('tools: '))?.slice('tools: '.length)
  return `Test runs answer by calling tools, and ${check.model} failed the tool call of the model check${why ? ` (${why})` : ''}. Set models.eval_answer to a model that calls tools; npm run models:check checks each role's model.`
}

/** The judge asks for JSON text at once when its model failed the JSON schema. */
export const withJsonText = (choice: ModelChoice, check: ModelCheck): ModelChoice =>
  check.json === 'fail' ? { ...choice, jsonSchema: false } : choice
