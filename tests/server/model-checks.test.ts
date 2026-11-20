import { afterEach, describe, expect, it, vi } from 'vitest'
import { systemClock } from '../../src/server/clock.ts'
import { checkedModelsFor, TestRunRefused } from '../../src/server/modules/evals/index.ts'
import {
  checkModel,
  checkWords,
  createModelChecks,
  createModelPort,
  roleFails,
  roleModels,
  testRunRefusal,
  withJsonText,
  type ModelCheck,
  type ModelSettings,
} from '../../src/server/modules/models/index.ts'

/*
  The model check (P5): three tiny calls on a model, through the real adapter, against a stubbed
  Chat Completions server. No test here reaches a provider.
*/

/** A model server on this computer, as Ollama is: the openai provider, with no key. */
const local = () =>
  createModelPort({ mode: 'live', env: { OPENAI_BASE_URL: 'http://127.0.0.1:11434/v1' } }).choose(
    'assistant',
    { provider: 'openai', model: 'gpt-oss:20b', prices: { input: 0, output: 0 } },
  )

type Body = {
  tools?: unknown[]
  tool_choice?: unknown
  response_format?: { type: string }
}
const served = 'gpt-oss:20b'
const completion = (message: Record<string, unknown>, finish = 'stop') =>
  Response.json({
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: 1_791_500_000,
    model: served,
    choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finish }],
    usage: { prompt_tokens: 60, completion_tokens: 12, total_tokens: 72 },
  })
const toolCall = (args: string) =>
  completion(
    {
      content: null,
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'record', arguments: args } },
      ],
    },
    'tool_calls',
  )

/**
 * A server that behaves as `kind` says: `able` does all three; `toolless` turns away any request
 * with tools (HTTP 400), as Ollama does for a model without tool support; `chatty` calls the tool
 * even when told not to and writes no JSON; `down` fails every request; `refusing` turns every
 * request away, as a gateway does whose vendor pin no host of the model meets; `broke` answers
 * every request with HTTP 402, as a gateway does for an account out of credit.
 */
function server(kind: 'able' | 'toolless' | 'chatty' | 'down' | 'refusing' | 'broke') {
  const bodies: Body[] = []
  vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as Body
    bodies.push(body)
    if (kind === 'down') return Promise.resolve(new Response('busy', { status: 503 }))
    if (kind === 'broke')
      return Promise.resolve(
        Response.json({ error: { message: 'Insufficient funds.' } }, { status: 402 }),
      )
    if (kind === 'refusing')
      return Promise.resolve(
        Response.json(
          { error: { message: "No available providers match the 'only' filter: openai." } },
          { status: 400 },
        ),
      )
    if (kind === 'toolless' && body.tools)
      return Promise.resolve(
        Response.json({ error: { message: 'model does not support tools' } }, { status: 400 }),
      )
    if (body.tools && (kind === 'chatty' || body.tool_choice !== 'none'))
      return Promise.resolve(toolCall('{"city":"Oslo","count":3}'))
    if (body.response_format)
      return Promise.resolve(
        completion({ content: kind === 'chatty' ? 'Oslo, 3' : '{"city":"Oslo","count":3}' }),
      )
    return Promise.resolve(completion({ content: 'Oslo' }))
  })
  return bodies
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the model check', () => {
  it('passes a model that calls tools, holds back when told and keeps to a JSON schema', async () => {
    const bodies = server('able')
    const check = await checkModel(local())
    expect(check.model).toBe('openai/gpt-oss:20b')
    expect(check).toMatchObject({
      tools: 'pass',
      noTools: 'pass',
      json: 'pass',
      notes: [],
    })
    // Three tiny calls: a forced tool call, one told to call none, one against a schema.
    expect(bodies).toHaveLength(3)
    expect(bodies[0]!.tool_choice).toEqual({ type: 'function', function: { name: 'record' } })
    expect(bodies[1]!.tool_choice).toBe('none')
    expect(bodies[2]!.response_format).toMatchObject({ type: 'json_schema' })
    expect(testRunRefusal(check)).toBeNull()
  })

  it('fails a model whose server turns tools away, which Ask needs and test runs refuse', async () => {
    const bodies = server('toolless')
    const check = await checkModel(local())
    expect(check).toMatchObject({ tools: 'fail', noTools: 'fail', json: 'pass' })
    expect(check.notes).toEqual([
      'tools: HTTP 400: model does not support tools',
      'noTools: HTTP 400: model does not support tools',
    ])
    // The plain call that followed was answered: the server works, its tools do not.
    expect(bodies).toHaveLength(4)
    expect(bodies[3]).not.toHaveProperty('tools')
    expect(testRunRefusal(check)).toBe(
      "Test runs answer by calling tools, and openai/gpt-oss:20b failed the tool call of the model check (HTTP 400: model does not support tools). Set models.eval_answer to a model that calls tools; npm run models:check checks each role's model.",
    )
    expect(roleFails('assistant', check)).toBe(true)
    expect(roleFails('judge', check)).toBe(false)
    expect(checkWords('assistant', check)).toBe('Can’t call tools, which Ask needs to read')
    expect(checkWords('eval_answer', check)).toBe(
      'Can’t call tools, so answer tests refuse to start',
    )
  })

  it('fails a model that calls the tool it was told not to, and one that writes no JSON', async () => {
    server('chatty')
    const check = await checkModel(local())
    expect(check).toMatchObject({ tools: 'pass', noTools: 'fail', json: 'fail' })
    expect(check.notes).toEqual([
      'noTools: an answer against the tool choice',
      'json: no object that fits the schema',
    ])
    expect(checkWords('assistant', check)).toMatch(/^Calls tools, but also when told not to/)
    const judge = withJsonText(local(), check)
    expect(judge.jsonSchema).toBe(false)
    expect(checkWords('judge', check)).toBe(
      'Can’t keep to a JSON schema, so it is asked for JSON text',
    )
  })

  it('tells nothing of a model whose provider turns even a plain call away', async () => {
    const bodies = server('refusing')
    const check = await checkModel(local())
    expect(check).toMatchObject({ tools: 'unknown', noTools: 'unknown', json: 'unknown' })
    expect(check.notes).toEqual([
      "a plain call was turned away too, so the model or its provider is not reachable as set (HTTP 400: No available providers match the 'only' filter: openai.)",
    ])
    expect(bodies).toHaveLength(4)
    expect(testRunRefusal(check)).toBeNull()
  })

  it('counts a provider that fails as a check that could not tell, which changes nothing', async () => {
    server('down')
    const check = await checkModel(local())
    expect(check).toMatchObject({ tools: 'unknown', noTools: 'unknown', json: 'unknown' })
    expect(check.notes).toEqual(['tools: HTTP 503', 'noTools: HTTP 503', 'json: HTTP 503'])
    expect(testRunRefusal(check)).toBeNull()
    expect(roleFails('eval_answer', check)).toBe(false)
    expect(checkWords('assistant', check)).toBe('Couldn’t tell, so Ask reads with its tools')
  })

  it('says a key whose account is out of credit is out of credit, not that it could not tell', async () => {
    server('broke')
    const check = await checkModel(local())
    expect(check).toMatchObject({ tools: 'unknown', noTools: 'unknown', json: 'unknown' })
    const note = 'the provider says the account is out of credit (HTTP 402)'
    expect(check.notes).toEqual([`tools: ${note}`, `noTools: ${note}`, `json: ${note}`])
    for (const role of ['assistant', 'eval_answer', 'judge'] as const)
      expect(checkWords(role, check)).toBe(
        'Out of credit: the provider turns every call away until its account has credit',
      )
  })
})

describe('the checks the service keeps', () => {
  const made = (outcome: ModelCheck['tools'], model = 'openai/gpt-oss:20b'): ModelCheck => ({
    model,
    at: '2026-11-19T12:00:00.000Z',
    tools: outcome,
    noTools: outcome,
    json: outcome,
    notes: [],
  })

  it('checks a model once for every role that uses it, two at once waiting for the same calls', async () => {
    const check = vi.fn(() => Promise.resolve(made('pass')))
    const checks = createModelChecks({ check })
    expect(checks.known('openai/gpt-oss:20b')).toBeUndefined()
    const [a, b] = await Promise.all([
      checks.of(local(), 'assistant'),
      checks.of(local(), 'eval_answer'),
    ])
    expect(a).toBe(b)
    await checks.of(local(), 'judge')
    expect(check).toHaveBeenCalledTimes(1)
    expect(checks.known('openai/gpt-oss:20b')).toBe(a)
  })

  it('checks again a while after a check that could not tell, and never after one that did', async () => {
    let now = 0
    const check = vi
      .fn<() => Promise<ModelCheck>>()
      .mockResolvedValueOnce(made('unknown'))
      .mockResolvedValue(made('fail'))
    const checks = createModelChecks({ check, now: () => now })
    expect((await checks.of(local(), 'assistant')).tools).toBe('unknown')
    now += 60_000
    expect((await checks.of(local(), 'assistant')).tools).toBe('unknown')
    now += 5 * 60_000
    expect((await checks.of(local(), 'assistant')).tools).toBe('fail')
    now += 365 * 24 * 3_600_000
    expect((await checks.of(local(), 'assistant')).tools).toBe('fail')
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('shows the new check from known() once a due check that could not tell is made again', async () => {
    let now = 0
    const check = vi
      .fn<() => Promise<ModelCheck>>()
      .mockResolvedValueOnce(made('unknown'))
      .mockResolvedValue(made('fail'))
    const checks = createModelChecks({ check, now: () => now })
    await checks.of(local(), 'assistant')
    now += 5 * 60_000 + 1
    expect(checks.known(local().id)?.tools).toBe('unknown')
    await checks.of(local(), 'assistant')
    expect(checks.known(local().id)?.tools).toBe('fail')
  })

  it('keeps a check that threw as one that could not tell', async () => {
    const checks = createModelChecks({ check: () => Promise.reject(new TypeError('fetch failed')) })
    expect(await checks.of(local(), 'assistant')).toMatchObject({
      tools: 'unknown',
      notes: ['TypeError'],
    })
  })
})

describe('each role’s model as the check covers it', () => {
  const settings: ModelSettings = {
    eval_answer: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    judge: 'different_family',
    assistant: { provider: 'openai', model: 'gpt-oss:20b', prices: { input: 0, output: 0 } },
    test_authoring: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
  }
  it('works out the judge from the answering model, and leaves out the role nothing uses', () => {
    const port = createModelPort({
      mode: 'live',
      env: { ANTHROPIC_API_KEY: 'sk-ant-placeholder', OPENAI_BASE_URL: 'http://127.0.0.1:1/v1' },
    })
    expect(roleModels(port, settings).map(({ role, choice }) => [role, choice.id])).toEqual([
      ['assistant', 'openai/gpt-oss:20b'],
      ['eval_answer', 'anthropic/claude-sonnet-5-5'],
      ['judge', 'anthropic/claude-opus-5-5'],
    ])
  })
})

describe('a test run’s models, checked', () => {
  const port = createModelPort({ mode: 'live', env: { ANTHROPIC_API_KEY: 'sk-ant-placeholder' } })
  const settings = {
    tries: 1,
    flipRepeats: 1,
    runBudgetMicros: 1,
    monthlyCapMicros: 1,
    featureCapMicros: 1,
    dailyPersonMicros: 1,
    models: {
      eval_answer: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
      judge: 'different_family' as const,
    },
  }
  const checksOf = (tools: ModelCheck['tools'], json: ModelCheck['json']) =>
    createModelChecks({
      check: (choice) =>
        Promise.resolve({
          model: choice.id,
          at: '2026-11-19T12:00:00.000Z',
          tools,
          noTools: 'pass',
          json,
          notes: tools === 'fail' ? ['tools: HTTP 400'] : [],
        }),
    })
  const clock = systemClock('2026-11-19')

  it('are refused when the answering model failed the tool call', async () => {
    const refused = checkedModelsFor({ port, clock, checks: checksOf('fail', 'pass') }, settings)
    await expect(refused).rejects.toBeInstanceOf(TestRunRefused)
    await expect(refused).rejects.toThrow(/anthropic\/claude-sonnet-5-5 failed the tool call/)
  })

  it('ask a judge that failed the JSON schema for JSON text, and keep one that passed as it was', async () => {
    const text = await checkedModelsFor({ port, clock, checks: checksOf('pass', 'fail') }, settings)
    expect(text.judge.jsonSchema).toBe(false)
    expect(text.answer.jsonSchema).toBeUndefined()
    const schema = await checkedModelsFor(
      { port, clock, checks: checksOf('pass', 'pass') },
      settings,
    )
    expect(schema.judge).not.toHaveProperty('jsonSchema')
    // Without checks, as with the mock, the models are as the settings name them.
    const plain = await checkedModelsFor({ port, clock }, settings)
    expect(plain.judge.id).toBe('anthropic/claude-opus-5-5')
  })
})
