import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider'
import { dynamicTool, generateText, jsonSchema } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkModelSetting,
  checkModelSettings,
  costMicros,
  createModelPort,
  defaultModel,
  modelAdapters,
  ModelConfigError,
  modelProviders,
  ModelVendorError,
  settingPrices,
  startCreditsCheck,
  type Connection,
  type ModelSettings,
  type ProviderAdapter,
  type ProviderEntry,
} from '../../src/server/modules/models/index.ts'
import type { Database } from '../../src/server/db/database.ts'
import { placeOf } from '../../src/server/modules/models/address.ts'
import { answerQuestion, judgeAnswer } from '../../src/server/modules/evals/answer.ts'

/*
  The provider registry: a provider is a configuration entry plus an adapter for its protocol.
  No test here reaches a vendor; the gateway's requests go to a stubbed fetch.
*/

const reply = (modelId: string): LanguageModelV4GenerateResult => ({
  content: [{ type: 'text', text: 'Fine.' }],
  finishReason: { unified: 'stop', raw: 'stop' },
  usage: {
    inputTokens: { total: 1_000, noCache: 1_000, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 100, text: 100, reasoning: 0 },
  },
  response: { modelId },
  warnings: [],
})

// A second vendor with its own protocol: one entry and one adapter, nothing else.
const connections: Connection[] = []
const acmeAdapter: ProviderAdapter = {
  connect(_entry, connection) {
    connections.push(connection)
    return (name) => ({
      model: new MockLanguageModelV4({
        provider: 'acme',
        modelId: name,
        doGenerate: () => Promise.resolve(reply(`acme/${name}`)),
      }),
      options: { acme: { mode: 'careful' } },
      cacheBreakpoint: {},
    })
  },
}
const acme: ProviderEntry = {
  name: 'acme',
  adapter: 'acme-protocol',
  operator: 'Acme Models',
  apiKeyEnv: 'ACME_API_KEY',
  baseUrlEnv: 'ACME_BASE_URL',
  baseUrl: 'https://api.acme.invalid/v2',
  models: {
    'acme-large-2': {
      vendor: 'acme',
      line: 'acme-large',
      prices: { input: 3, output: 12, cacheRead: 0.3 },
    },
  },
}
const withAcme = (env: Record<string, string>) =>
  createModelPort({
    mode: 'live',
    env,
    providers: [...modelProviders, acme],
    adapters: { ...modelAdapters, 'acme-protocol': acmeAdapter },
  })
const settings = (patch: Partial<ModelSettings> = {}): ModelSettings => ({
  eval_answer: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
  judge: 'different_family',
  assistant: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
  test_authoring: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
  ...patch,
})

afterEach(() => {
  vi.unstubAllGlobals()
  connections.length = 0
})

describe('the provider registry', () => {
  it('serves another vendor from one config entry and one adapter', async () => {
    const port = withAcme({ ACME_API_KEY: 'acme-key' })
    const judge = port.choose('judge', { provider: 'acme', model: 'acme-large-2' })
    expect(judge).toMatchObject({
      id: 'acme/acme-large-2',
      provider: 'acme',
      name: 'acme-large-2',
      vendor: 'acme',
      family: 'acme/acme-large',
      effort: 'low',
      options: { acme: { mode: 'careful' } },
      prices: { input: 3, output: 12, cacheRead: 0.3 },
      recipients: 'Acme Models and acme',
    })
    // The adapter got the entry's key setting and its default base URL.
    expect(connections).toEqual([{ apiKey: 'acme-key', baseUrl: 'https://api.acme.invalid/v2' }])
    const result = await generateText({ model: judge.model, prompt: 'Grade this.' })
    expect(result.text).toBe('Fine.')
    // Spend is priced with the provider's own table.
    expect(
      costMicros(judge.prices, { inputTokens: 1_000, outputTokens: 100, cacheReadTokens: 0 }),
    ).toBe(4_200)
  })

  it('reads a base URL override from the entry setting', () => {
    withAcme({ ACME_API_KEY: 'k', ACME_BASE_URL: 'https://eu.acme.invalid/v2' }).choose('judge', {
      provider: 'acme',
      model: 'acme-large-2',
    })
    expect(connections).toEqual([{ apiKey: 'k', baseUrl: 'https://eu.acme.invalid/v2' }])
    expect(() =>
      withAcme({ ACME_API_KEY: 'k', ACME_BASE_URL: 'ftp://acme' }).choose('judge', {
        provider: 'acme',
        model: 'acme-large-2',
      }),
    ).toThrow(/ACME_BASE_URL must be an http or https URL/)
  })

  it('refuses a model its provider does not list without prices, and a provider it does not know', () => {
    const port = withAcme({ ACME_API_KEY: 'k', ANTHROPIC_API_KEY: 'k' })
    expect(() => port.choose('assistant', { provider: 'acme', model: 'acme-huge-9' })).toThrow(
      'models.assistant names model acme-huge-9, which provider acme does not list. Give its prices in US dollars per million tokens in the setting: {"provider":"acme","model":"acme-huge-9","prices":{"input":1,"output":5}}. A model that costs nothing has prices of 0.',
    )
    // A model listed by one provider is not thereby allowed on another.
    expect(() =>
      port.choose('assistant', { provider: 'anthropic', model: 'anthropic/claude-sonnet-5.5' }),
    ).toThrow(/which provider anthropic does not list/)
    expect(() => port.choose('judge', { provider: 'nobody', model: 'x' })).toThrow(
      /models\.judge names provider nobody, which is not in the provider registry \(anthropic, vercel-gateway, openai, acme\)/,
    )
  })

  it('serves a model its provider does not list when the setting gives its prices', async () => {
    const port = withAcme({ ACME_API_KEY: 'k' })
    // A `vendor/model` name gives the vendor; the family is the whole name.
    const prefixed = port.choose('assistant', {
      provider: 'acme',
      model: 'beta/beta-huge-3',
      prices: { input: 0.5, output: 2 },
    })
    expect(prefixed).toMatchObject({
      id: 'acme/beta/beta-huge-3',
      provider: 'acme',
      name: 'beta/beta-huge-3',
      vendor: 'beta',
      family: 'beta/beta-huge-3',
      prices: { input: 0.5, output: 2 },
      recipients: 'Acme Models and beta',
    })
    // Spend is counted at the setting's prices: 1,000 at $0.5 and 100 at $2 a million tokens.
    expect(
      costMicros(prefixed.prices, { inputTokens: 1_000, outputTokens: 100, cacheReadTokens: 0 }),
    ).toBe(700)
    // A bare name is the provider's own model.
    expect(
      port.choose('assistant', {
        provider: 'acme',
        model: 'acme-huge-9',
        prices: { input: 0, output: 0 },
      }),
    ).toMatchObject({ vendor: 'acme', family: 'acme/acme-huge-9', prices: { input: 0, output: 0 } })
    // Its answers are still held to its vendor: the stub answers as acme/beta/beta-huge-3.
    await expect(generateText({ model: prefixed.model, prompt: 'Hello.' })).rejects.toThrow(
      'beta/beta-huge-3 was answered by acme/beta/beta-huge-3, a model of another vendor than beta',
    )
  })

  it("lets a setting's prices replace a listed model's built-in ones", () => {
    const port = withAcme({ ACME_API_KEY: 'k' })
    const listed = { provider: 'acme', model: 'acme-large-2' }
    expect(port.choose('assistant', listed).prices).toEqual({
      input: 3,
      output: 12,
      cacheRead: 0.3,
    })
    expect(port.choose('assistant', { ...listed, prices: { input: 2, output: 8 } })).toMatchObject({
      family: 'acme/acme-large',
      prices: { input: 2, output: 8 },
    })
  })

  it('judges a model its provider lists no line of with that model itself', () => {
    const port = withAcme({ ACME_API_KEY: 'k' })
    const answer = port.choose('eval_answer', {
      provider: 'acme',
      model: 'beta/beta-huge-3',
      prices: { input: 1, output: 4 },
    })
    expect(port.otherLine('judge', answer)).toMatchObject({
      id: 'acme/beta/beta-huge-3',
      family: 'beta/beta-huge-3',
      effort: 'low',
      prices: { input: 1, output: 4 },
    })
  })

  it('refuses a registry with a repeated name or a missing adapter', () => {
    expect(() =>
      createModelPort({ mode: 'mock', providers: [...modelProviders, modelProviders[0]!] }),
    ).toThrow('The provider registry has a second provider named anthropic')
    expect(() => createModelPort({ mode: 'mock', providers: [acme] })).toThrow(
      'Provider acme names adapter acme-protocol, which does not exist',
    )
  })

  it('never moves a different_family judge to another vendor', () => {
    const mixed: ProviderEntry = {
      ...acme,
      models: {
        'acme-large-2': acme.models['acme-large-2']!,
        'beta/beta-small-1': {
          vendor: 'beta',
          line: 'beta-small',
          prices: { input: 1, output: 1, cacheRead: 0 },
        },
      },
    }
    const port = createModelPort({
      mode: 'live',
      env: { ACME_API_KEY: 'k' },
      providers: [mixed],
      adapters: { 'acme-protocol': acmeAdapter },
    })
    const answer = port.choose('eval_answer', { provider: 'acme', model: 'acme-large-2' })
    // The only other line is another vendor's, so the judge stays on the answerer's own line.
    expect(port.otherLine('judge', answer)).toMatchObject({
      vendor: 'acme',
      family: 'acme/acme-large',
    })
  })

  it('checks every role at start-up, naming the setting and the missing key', () => {
    const live = withAcme({ ANTHROPIC_API_KEY: 'k' })
    expect(() => checkModelSettings(live, settings())).not.toThrow()
    expect(() =>
      checkModelSettings(live, settings({ judge: { provider: 'acme', model: 'acme-large-2' } })),
    ).toThrow(
      'models.judge uses provider acme, which needs ACME_API_KEY. Put it in .env.local (never commit it), or use MODELS=mock.',
    )
    expect(() =>
      checkModelSettings(
        live,
        settings({ test_authoring: { provider: 'acme', model: 'acme-tiny-1' } }),
      ),
    ).toThrow(/^models\.test_authoring names model acme-tiny-1/)
    // The mock needs no key, but a setting must still name a provider and model that exist.
    const mock = createModelPort({ mode: 'mock' })
    expect(() =>
      checkModelSettings(
        mock,
        settings({ assistant: { provider: 'vercel-gateway', model: 'anthropic/claude-opus-5.5' } }),
      ),
    ).not.toThrow()
    expect(() =>
      checkModelSettings(mock, settings({ assistant: { provider: 'vercel', model: 'x' } })),
    ).toThrow(ModelConfigError)
  })

  it('takes prices of 0 or more in a model setting, and names the roles they price', () => {
    const port = withAcme({ ACME_API_KEY: 'k', ANTHROPIC_API_KEY: 'k' })
    const local = { provider: 'acme', model: 'qwen3:8b', prices: { input: 0, output: 0 } }
    expect(() => checkModelSetting(port, 'models.assistant', local)).not.toThrow()
    for (const prices of [
      { input: -1, output: 0 },
      { input: 1 },
      { input: 1, output: 1, extra: 1 },
    ])
      expect(() => checkModelSetting(port, 'models.assistant', { ...local, prices })).toThrow(
        /models\.assistant must name a provider and a model/,
      )
    expect(settingPrices(settings({ assistant: local }))).toEqual([
      { setting: 'models.assistant', id: 'acme/qwen3:8b', prices: { input: 0, output: 0 } },
    ])
    expect(settingPrices(settings())).toEqual([])
  })

  it('checks a changed model setting before it is saved, and lets other settings pass', () => {
    const port = createModelPort({ mode: 'live', env: { ANTHROPIC_API_KEY: 'k' } })
    expect(() => checkModelSetting(port, 'review.default_days', 30)).not.toThrow()
    expect(() => checkModelSetting(port, 'models.judge', 'different_family')).not.toThrow()
    expect(() =>
      checkModelSetting(port, 'models.judge', {
        provider: 'vercel-gateway',
        model: 'anthropic/claude-opus-5.5',
      }),
    ).toThrow(/models\.judge uses provider vercel-gateway, which needs VERCEL_AI_GATEWAY_API_KEY/)
    expect(() => checkModelSetting(port, 'models.assistant', 'claude-sonnet-5-5')).toThrow(
      /models\.assistant must name a provider and a model/,
    )
  })
})

describe('the Vercel AI Gateway entry (OpenAI-compatible)', () => {
  const key = 'vck-placeholder-not-a-key'
  const gateway = () =>
    createModelPort({ mode: 'live', env: { VERCEL_AI_GATEWAY_API_KEY: key } }).choose('judge', {
      provider: 'vercel-gateway',
      model: 'anthropic/claude-opus-5.5',
    })
  const answering = (served: string) => {
    const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = []
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      requests.push({
        url,
        headers: new Headers(init.headers),
        body: JSON.parse(init.body as string) as Record<string, unknown>,
      })
      return Promise.resolve(
        Response.json({
          id: 'chatcmpl-1',
          object: 'chat.completion',
          created: 1_791_500_000,
          model: served,
          choices: [
            { index: 0, message: { role: 'assistant', content: 'Pass.' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 1_000, completion_tokens: 50, total_tokens: 1_050 },
        }),
      )
    })
    return requests
  }

  it('records the gateway as provider and Anthropic as vendor, priced from its own table', () => {
    expect(gateway()).toMatchObject({
      id: 'vercel-gateway/anthropic/claude-opus-5.5',
      provider: 'vercel-gateway',
      vendor: 'anthropic',
      // The same family as Opus from the Anthropic API: the gateway does not change the model.
      family: 'anthropic/claude-opus',
      prices: { input: 4, output: 20, cacheRead: 0.2 },
      recipients: 'Vercel and Anthropic',
    })
  })

  it('sends the key as a bearer token, the effort, the vendor-only route and a cache breakpoint', async () => {
    const requests = answering('anthropic/claude-opus-5.5')
    const judge = gateway()
    const result = await generateText({
      model: judge.model,
      instructions: { role: 'system', content: 'Grade.', providerOptions: judge.cacheBreakpoint },
      prompt: 'Answer: 42',
      providerOptions: judge.options,
    })
    expect(result.text).toBe('Pass.')
    expect(result.usage.inputTokens).toBe(1_000)
    const [request] = requests
    expect(request!.url).toBe('https://ai-gateway.vercel.sh/v1/chat/completions')
    expect(request!.headers.get('authorization')).toBe(`Bearer ${key}`)
    // The model the gateway is asked for, exactly as the registry lists it.
    expect(request!.body.model).toBe(judge.name)
    expect(request!.body).toMatchObject({
      reasoning: { effort: 'low' },
      providerOptions: { gateway: { only: ['anthropic'] } },
      messages: [
        { role: 'system', content: 'Grade.', cache_control: { type: 'ephemeral' } },
        { role: 'user', content: 'Answer: 42' },
      ],
    })
    // The key travels only in the header.
    expect(JSON.stringify(request!.body)).not.toContain(key)
  })

  it("asks for no reasoning for Ask's words, so their first sentence is not held up", async () => {
    const requests = answering('anthropic/claude-haiku-5.5')
    const words = createModelPort({
      mode: 'live',
      env: { VERCEL_AI_GATEWAY_API_KEY: key, ANTHROPIC_API_KEY: key },
    })
    const viaGateway = words.choose('assistant', {
      provider: 'vercel-gateway',
      model: 'anthropic/claude-haiku-5.5',
    })
    expect(viaGateway.effort).toBe('none')
    await generateText({
      model: viaGateway.model,
      prompt: 'Words.',
      providerOptions: viaGateway.options,
    })
    expect(requests[0]!.body.reasoning).toEqual({ enabled: false })
    // Claude itself thinks only when asked: it gets its lowest effort and no thinking.
    const direct = words.choose('assistant', {
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
    })
    expect(direct.options).toEqual({ anthropic: { effort: 'low' } })
  })

  it("marks an eval answer's instructions and its newest message for the prompt cache", async () => {
    // Round 5: the eval answers sent no breakpoint, so the gateway's Claude read nothing from
    // its prompt cache while the assistant, on the same gateway, read about 85% of its input.
    const bodies: { messages: Record<string, unknown>[] }[] = []
    const served = gateway().name
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string) as { messages: Record<string, unknown>[] })
      const message =
        bodies.length === 1
          ? {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'get_context', arguments: '{"question":"Orders"}' },
                },
              ],
            }
          : { role: 'assistant', content: 'Orders fell [itm_abc12345].' }
      return Promise.resolve(
        Response.json({
          id: `chatcmpl-${bodies.length}`,
          object: 'chat.completion',
          created: 1_791_500_000,
          model: served,
          choices: [
            { index: 0, message, finish_reason: bodies.length === 1 ? 'tool_calls' : 'stop' },
          ],
          usage: { prompt_tokens: 4_000, completion_tokens: 50, total_tokens: 4_050 },
        }),
      )
    })
    const arm = {
      tools: {
        get_context: dynamicTool({
          description: 'Context for a question',
          inputSchema: jsonSchema({ type: 'object' }),
          execute: () => Promise.resolve({ status: 'matched', items: [{ id: 'itm_abc12345' }] }),
        }),
      },
      close: () => Promise.resolve(),
    }
    const result = await answerQuestion(arm, gateway(), 'How did orders do in Norway?')
    expect(result.answer).toBe('Orders fell [itm_abc12345].')
    const marked = (body: { messages: Record<string, unknown>[] }) =>
      body.messages.map((m) => `${m.role as string}${m.cache_control ? '*' : ''}`)
    // The instructions always; then the question, and next the context the tool gave in its place.
    expect(bodies.map(marked)).toEqual([
      ['system*', 'user*'],
      ['system*', 'user', 'assistant', 'tool*'],
    ])
    expect(bodies[1]!.messages.at(-1)).toMatchObject({ cache_control: { type: 'ephemeral' } })
  })

  it("reads what the key has used from the gateway's own counter, and only there", async () => {
    const requests: { url: string; headers: Headers; method: string }[] = []
    let answer = Response.json({ balance: '12.368969635', total_used: '12.631030365' })
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      requests.push({ url, headers: new Headers(init.headers), method: init.method ?? 'GET' })
      return Promise.resolve(answer)
    })
    const port = createModelPort({ mode: 'live', env: { VERCEL_AI_GATEWAY_API_KEY: key } })
    expect(await port.creditsUsed('vercel-gateway')).toBe(12_631_030)
    expect(requests.map((r) => [r.method, r.url])).toEqual([
      ['GET', 'https://ai-gateway.vercel.sh/v1/credits'],
    ])
    expect(requests[0]!.headers.get('authorization')).toBe(`Bearer ${key}`)
    // A provider that keeps no counter, a provider without its key, and the mock: nothing to read.
    expect(await port.creditsUsed('anthropic')).toBeNull()
    expect(
      await createModelPort({ mode: 'live', env: {} }).creditsUsed('vercel-gateway'),
    ).toBeNull()
    expect(await createModelPort({ mode: 'mock' }).creditsUsed('vercel-gateway')).toBeNull()
    expect(requests).toHaveLength(1)
    answer = Response.json({ error: 'unauthorized' }, { status: 401 })
    const refused = port.creditsUsed('vercel-gateway')
    // The message says what failed and never carries the key.
    await expect(refused).rejects.toThrow(
      /^vercel-gateway answered the credit count with HTTP 401$/,
    )
  })

  it("sets the ledger of a run against the gateway's counter, and says when it cannot", async () => {
    // The two calls of the cache write test: the counter moved by exactly what the ledger records.
    const counter = [12_631_030, 12_633_305]
    const port = {
      ...createModelPort({ mode: 'mock' }),
      creditsUsed: (provider: string) =>
        Promise.resolve(provider === 'vercel-gateway' ? counter.shift()! : null),
    }
    const queries: unknown[][] = []
    const database = {
      query: (text: string, values: unknown[] = []) => {
        queries.push(values)
        return Promise.resolve(
          text.includes('now()') ? [{ at: '2026-10-14 16:00:00+00' }] : [{ cost: '2276' }],
        )
      },
    } as unknown as Database
    const check = await startCreditsCheck(port, database, [
      'vercel-gateway',
      'mock',
      'vercel-gateway',
    ])
    expect(await check.finish(['run-1'])).toEqual([
      "vercel-gateway's own counter moved $0.002275; the ledger recorded $0.002276 for the run on it " +
        '(difference -$0.000001; other use of the same key counts in the counter).',
    ])
    expect(queries.at(-1)).toEqual([['run-1'], 'vercel-gateway', '2026-10-14 16:00:00+00'])
    const unread = await startCreditsCheck(
      { ...port, creditsUsed: () => Promise.reject(new Error('HTTP 503')) },
      database,
      ['vercel-gateway'],
    )
    expect(await unread.finish(['run-1'])).toEqual([
      "vercel-gateway's own counter could not be read (HTTP 503); the ledger recorded $0.002276 for the run on it.",
    ])
  })

  it('refuses an answer from another vendor, as a fallback would give', async () => {
    answering('openai/gpt-5.5')
    const judge = gateway()
    await expect(
      generateText({ model: judge.model, prompt: 'Answer: 42', providerOptions: judge.options }),
    ).rejects.toThrow(ModelVendorError)
  })

  it("sends the judge's schema, so a verdict takes one call (R3)", async () => {
    const verdict = {
      caveat_present: null,
      cause_claimed: false,
      asks_clarifying_question: false,
      rubrics: [],
      reason: 'ok',
    }
    const requests: Record<string, unknown>[] = []
    const served = gateway().name
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(init.body as string) as Record<string, unknown>)
      return Promise.resolve(
        Response.json({
          id: 'chatcmpl-2',
          object: 'chat.completion',
          created: 1_791_500_000,
          model: served,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: JSON.stringify(verdict) },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 500, completion_tokens: 40, total_tokens: 540 },
        }),
      )
    })
    const result = await judgeAnswer(
      gateway(),
      {
        expected: {
          must_deliver: [],
          must_not_deliver: [],
          no_cause_claim: true,
          clarifying_question: false,
        },
        rubrics: [],
      },
      'Orders fell.',
    )
    expect(result).toEqual({ kind: 'verdict', verdict })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { schema: { type: 'object' } },
    })
  })
})

describe("the gateway's Google model (Gemini 2.5 Flash-Lite)", () => {
  const key = 'vck-placeholder-not-a-key'
  const gemini = 'google/gemini-2.5-flash-lite'
  const ref = { provider: 'vercel-gateway', model: gemini }
  const unlisted = { ...ref, model: ref.model.replace('2.5-flash-lite', '9-pro') }
  const port = () => createModelPort({ mode: 'live', env: { VERCEL_AI_GATEWAY_API_KEY: key } })

  it('records Google as vendor, Vercel and Google as recipients, priced from the gateway table', () => {
    expect(port().choose('eval_answer', ref)).toMatchObject({
      id: 'vercel-gateway/google/gemini-2.5-flash-lite',
      provider: 'vercel-gateway',
      vendor: 'google',
      family: 'google/gemini-flash-lite',
      prices: { input: 0.1, output: 0.4, cacheRead: 0.01 },
      recipients: 'Vercel and Google',
    })
  })

  it('is accepted as a setting, while an unlisted Google model needs its prices', () => {
    expect(() => checkModelSetting(port(), 'models.eval_answer', ref)).not.toThrow()
    expect(() => checkModelSetting(port(), 'models.judge', ref)).not.toThrow()
    expect(() => checkModelSetting(port(), 'models.eval_answer', unlisted)).toThrow(
      /^models\.eval_answer names model google\/gemini-9-pro, which provider vercel-gateway does not list\. Give its prices/,
    )
    const priced = { ...unlisted, prices: { input: 1.25, output: 10 } }
    expect(() => checkModelSetting(port(), 'models.eval_answer', priced)).not.toThrow()
    expect(port().choose('eval_answer', priced)).toMatchObject({
      vendor: 'google',
      family: 'google/gemini-9-pro',
      recipients: 'Vercel and Google',
    })
    // The model is the gateway's; the Anthropic API does not serve it.
    expect(() =>
      checkModelSetting(port(), 'models.eval_answer', { ...ref, provider: 'anthropic' }),
    ).toThrow(/which provider anthropic does not list/)
  })

  it('judges a Gemini answer with the same model, never another vendor', () => {
    const live = port()
    const judge = live.otherLine('judge', live.choose('eval_answer', ref))
    expect(judge).toMatchObject({ name: ref.model, vendor: 'google', effort: 'low' })
  })

  it('asks the gateway for Google only and reads usage without cached tokens', async () => {
    const requests: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(init.body as string) as Record<string, unknown>)
      return Promise.resolve(
        Response.json({
          id: 'chatcmpl-2',
          object: 'chat.completion',
          created: 1_791_800_000,
          model: gemini,
          choices: [
            { index: 0, message: { role: 'assistant', content: 'Pass.' }, finish_reason: 'stop' },
          ],
          // No prompt_tokens_details: Google reports no cached tokens here.
          usage: { prompt_tokens: 2_000, completion_tokens: 500, total_tokens: 2_500 },
        }),
      )
    })
    const answer = port().choose('eval_answer', ref)
    const result = await generateText({
      model: answer.model,
      prompt: 'Answer: 42',
      providerOptions: answer.options,
    })
    expect(requests[0]).toMatchObject({
      model: gemini,
      reasoning: { effort: 'medium' },
      providerOptions: { gateway: { only: ['google'] } },
    })
    const cacheReadTokens = result.usage.inputTokenDetails.cacheReadTokens ?? 0
    expect(cacheReadTokens).toBe(0)
    // 2,000 input tokens at $0.10 and 500 output tokens at $0.40 per million.
    expect(
      costMicros(answer.prices, { inputTokens: 2_000, outputTokens: 500, cacheReadTokens }),
    ).toBe(400)
  })
})

describe('the cost of a call', () => {
  it('bills cached tokens at the cache read price, or at the input price when there is none', () => {
    const usage = { inputTokens: 1_000, outputTokens: 100, cacheReadTokens: 400 }
    expect(costMicros({ input: 2, output: 10, cacheRead: 0.2 }, usage)).toBe(2_280)
    expect(costMicros({ input: 2, output: 10 }, usage)).toBe(3_000)
  })
})

describe("the gateway's Claude Haiku 5.5", () => {
  const ref = { provider: 'vercel-gateway', model: 'anthropic/claude-haiku-5.5' }
  const port = () =>
    createModelPort({
      mode: 'live',
      env: { VERCEL_AI_GATEWAY_API_KEY: 'vck-placeholder-not-a-key' },
    })

  it('is listed with the gateway price, on the Haiku line of Anthropic', () => {
    expect(port().choose('assistant', ref)).toMatchObject({
      id: 'vercel-gateway/anthropic/claude-haiku-5.5',
      vendor: 'anthropic',
      family: 'anthropic/claude-haiku',
      // https://ai-gateway.vercel.sh/v1/models, read 2026-10-12: USD 0.10 in, 0.50 out per million.
      prices: { input: 0.1, output: 0.5, cacheRead: 0.01 },
      recipients: 'Vercel and Anthropic',
    })
    expect(() => checkModelSetting(port(), 'models.assistant', ref)).not.toThrow()
  })

  it('leaves the default model as it was', () => {
    expect(defaultModel).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5-5' })
  })
})

describe('the openai entry (any server that speaks Chat Completions)', () => {
  const prices = { input: 0.1, output: 0.5 }
  const luna = { provider: 'openai', model: 'gpt-6-luna', prices }
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = []
  const serve = (served: string) => {
    requests.length = 0
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      requests.push({
        url,
        headers: new Headers(init.headers),
        body: JSON.parse(init.body as string) as Record<string, unknown>,
      })
      return Promise.resolve(
        Response.json({
          id: 'chatcmpl-1',
          object: 'chat.completion',
          created: 1_791_500_000,
          model: served,
          choices: [
            { index: 0, message: { role: 'assistant', content: 'Pass.' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 1_000, completion_tokens: 50, total_tokens: 1_050 },
        }),
      )
    })
  }
  const port = (env: Record<string, string>) => createModelPort({ mode: 'live', env })

  it("sends OpenAI's own fields to OPENAI_BASE_URL with the key as a bearer token", async () => {
    serve('gpt-6-luna')
    const key = 'sk-placeholder-not-a-key'
    const judge = port({ OPENAI_API_KEY: key }).choose('judge', luna)
    expect(judge).toMatchObject({
      id: 'openai/gpt-6-luna',
      vendor: 'openai',
      family: 'openai/gpt-6-luna',
      prices,
      recipients: 'OpenAI',
    })
    const result = await generateText({
      model: judge.model,
      instructions: { role: 'system', content: 'Grade.', providerOptions: judge.cacheBreakpoint },
      prompt: 'Answer: 42',
      providerOptions: judge.options,
    })
    expect(result.text).toBe('Pass.')
    const [request] = requests
    expect(request!.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(request!.headers.get('authorization')).toBe(`Bearer ${key}`)
    // OpenAI's effort field, no prompt cache breakpoint and no gateway route.
    expect(request!.body).toEqual({
      model: judge.name,
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: 'Grade.' },
        { role: 'user', content: 'Answer: 42' },
      ],
    })
  })

  it('takes another server at OPENAI_BASE_URL, and names it as who receives the requests', async () => {
    serve('anthropic/claude-sonnet-5.5')
    const openRouter = port({
      OPENAI_API_KEY: 'sk-or-placeholder',
      OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
    })
    const claude = openRouter.choose('assistant', {
      provider: 'openai',
      model: 'anthropic/claude-sonnet-5.5',
      prices: { input: 2, output: 10 },
    })
    expect(claude).toMatchObject({
      vendor: 'anthropic',
      family: 'anthropic/claude-sonnet-5.5',
      recipients: 'the host at openrouter.ai and Anthropic',
    })
    await generateText({ model: claude.model, prompt: 'Hello.', providerOptions: claude.options })
    expect(requests[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    // A name with no vendor in it says nothing of where the host sends it.
    const bare = { provider: 'openai', model: 'auto', prices }
    expect(openRouter.choose('assistant', bare).recipients).toBe('the host at openrouter.ai')
  })

  it('needs no key for a model server on this computer or a private network', async () => {
    serve('gpt-oss:20b')
    const local = { provider: 'openai', model: 'gpt-oss:20b', prices: { input: 0, output: 0 } }
    const ollama = port({ OPENAI_BASE_URL: 'http://127.0.0.1:11434/v1' }).choose('assistant', local)
    expect(ollama).toMatchObject({
      vendor: 'openai',
      family: 'openai/gpt-oss:20b',
      recipients: 'this computer',
    })
    await generateText({ model: ollama.model, prompt: 'Hello.', providerOptions: ollama.options })
    expect(requests[0]!.url).toBe('http://127.0.0.1:11434/v1/chat/completions')
    expect(requests[0]!.headers.has('authorization')).toBe(false)
    const fromDocker = port({ OPENAI_BASE_URL: 'http://host.docker.internal:11434/v1' })
    expect(fromDocker.choose('assistant', local).recipients).toBe('this computer')
    const network = port({ OPENAI_BASE_URL: 'http://10.0.0.12:4000/v1' })
    expect(network.choose('assistant', local).recipients).toBe('your network (10.0.0.12)')
    // A server on the internet needs its key, and so does OpenAI itself.
    const internet: Record<string, string>[] = [
      { OPENAI_BASE_URL: 'https://api.groq.com/openai/v1' },
      {},
    ]
    for (const env of internet)
      expect(() => port(env).choose('assistant', local)).toThrow(
        'models.assistant uses provider openai, which needs OPENAI_API_KEY. Put it in .env.local (never commit it), or use MODELS=mock.',
      )
  })

  it('lists no model, so every setting gives its prices', () => {
    expect(() =>
      checkModelSetting(port({ OPENAI_API_KEY: 'k' }), 'models.assistant', {
        provider: 'openai',
        model: 'gpt-6-luna',
      }),
    ).toThrow(/^models\.assistant names model gpt-6-luna, which provider openai does not list\./)
  })

  it('names a server that speaks the Anthropic API by its address too', () => {
    const viaGateway = port({
      ANTHROPIC_API_KEY: 'vck-placeholder',
      ANTHROPIC_BASE_URL: 'https://ai-gateway.vercel.sh/v1',
    }).choose('assistant', defaultModel)
    expect(viaGateway.recipients).toBe('the host at ai-gateway.vercel.sh and Anthropic')
    expect(port({ ANTHROPIC_API_KEY: 'k' }).choose('assistant', defaultModel).recipients).toBe(
      'Anthropic',
    )
  })
})

describe('where a base URL is', () => {
  it.each([
    ['localhost', 'this computer'],
    ['127.0.0.1', 'this computer'],
    ['[::1]', 'this computer'],
    ['host.docker.internal', 'this computer'],
    ['10.0.0.12', 'private network'],
    ['172.20.1.1', 'private network'],
    ['192.168.1.5', 'private network'],
    ['[fd00::1]', 'private network'],
    ['172.32.0.1', 'internet'],
    ['8.8.8.8', 'internet'],
    ['openrouter.ai', 'internet'],
  ])('reads %s as %s', (host, place) => {
    expect(placeOf(new URL(`http://${host}:8000/v1`).hostname)).toBe(place)
  })
})

describe('the anthropic entry at a gateway that speaks the Messages API', () => {
  const haiku = { provider: 'anthropic', model: 'claude-haiku-4-5' }
  const requests: { url: string; headers: Headers }[] = []
  const serve = () => {
    requests.length = 0
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      requests.push({ url, headers: new Headers(init.headers) })
      return Promise.resolve(
        Response.json({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: haiku.model,
          content: [{ type: 'text', text: 'Pass.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 2 },
        }),
      )
    })
  }
  const port = (env: Record<string, string>) => createModelPort({ mode: 'live', env })

  it('sends ANTHROPIC_AUTH_TOKEN as a bearer token in place of the key', async () => {
    serve()
    const token = 'gw-placeholder-not-a-token'
    const choice = port({
      ANTHROPIC_AUTH_TOKEN: token,
      ANTHROPIC_BASE_URL: 'https://openrouter.ai/api/v1',
    }).choose('assistant', haiku)
    expect(choice.recipients).toBe('the host at openrouter.ai and Anthropic')
    const result = await generateText({ model: choice.model, prompt: 'Hello.' })
    expect(result.text).toBe('Pass.')
    expect(requests[0]!.url).toBe('https://openrouter.ai/api/v1/messages')
    expect(requests[0]!.headers.get('authorization')).toBe(`Bearer ${token}`)
    expect(requests[0]!.headers.has('x-api-key')).toBe(false)
  })

  it('sends the key as x-api-key, as Anthropic itself takes it', async () => {
    serve()
    const key = 'sk-ant-placeholder-not-a-key'
    const choice = port({ ANTHROPIC_API_KEY: key }).choose('assistant', haiku)
    await generateText({ model: choice.model, prompt: 'Hello.' })
    expect(requests[0]!.url).toBe('https://api.anthropic.com/v1/messages')
    expect(requests[0]!.headers.get('x-api-key')).toBe(key)
    expect(requests[0]!.headers.has('authorization')).toBe(false)
  })

  it('refuses both a key and a token, and names both when neither is set', () => {
    expect(() =>
      port({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't' }).choose('assistant', haiku),
    ).toThrow(
      'Provider anthropic has both ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN. Set only one of them.',
    )
    expect(() => port({}).choose('assistant', haiku)).toThrow(
      'models.assistant uses provider anthropic, which needs ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN. Put it in .env.local (never commit it), or use MODELS=mock.',
    )
  })
})
