import type { LanguageModelV4, LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'
import { modelAdapters } from './adapters/index.ts'
import { placeOf } from './address.ts'
import { ModelConfigError, ModelVendorError } from './errors.ts'
import { scriptedAnswerModel, scriptedJudgeModel } from './mock.ts'
import { defaultModel, modelProviders, vendorNames } from './providers.ts'
import type {
  Effort,
  ListedModel,
  ModelChoice,
  ModelRef,
  ModelRole,
  Prices,
  ProviderAdapter,
  ProviderEntry,
} from './types.ts'

/**
 * The model port (plan section 3.1): one explicit model object per role. `get_context` never
 * calls a model; only the evaluation runner, its judges and Ask's words do. A plain string
 * model would route through an AI gateway the service did not choose, so every model here is an
 * object made by the adapter of a provider in the registry (`providers.ts`), for a model that
 * provider lists or one its setting gives prices for. `MODELS=mock` puts the scripted mock behind every role instead.
 */

export type ModelMode = 'mock' | 'live'

export interface ModelPort {
  readonly mode: ModelMode
  /** The model for a role. `ref` comes from the role's setting (`models.<role>`); the mock ignores it. */
  choose(role: ModelRole, ref?: ModelRef): ModelChoice
  /**
   * A model of another line than `answer`, from the same provider and vendor: the first its
   * provider lists, else its own line. A fallback never moves to another vendor; that takes a
   * setting that names one.
   */
  otherLine(role: ModelRole, answer: ModelChoice): ModelChoice
  /** Refuses an assignment this service cannot serve, with a message that names the setting. */
  check(setting: string, ref: ModelRef): void
  /**
   * What the provider's own counter says its key has used so far, in micros (`creditsPath`):
   * null when it keeps none, or for the mock. Throws when the counter cannot be read.
   */
  creditsUsed(provider: string): Promise<number | null>
}

/**
 * A call's tokens. `inputTokens` is every input token, those read from and written to a prompt
 * cache included; output tokens include any reasoning.
 */
export type Usage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens?: number
}

const free: Prices = { input: 0, output: 0, cacheRead: 0 }

/** Cost in micros (1e-6 US dollars): tokens times dollars per million tokens. */
export function costMicros(prices: Prices, usage: Usage): number {
  const written = usage.cacheWriteTokens ?? 0
  const fresh = Math.max(0, usage.inputTokens - usage.cacheReadTokens - written)
  return Math.ceil(
    fresh * prices.input +
      usage.cacheReadTokens * (prices.cacheRead ?? prices.input) +
      written * (prices.cacheWrite ?? prices.input) +
      usage.outputTokens * prices.output,
  )
}

export type ModelPortOptions = {
  mode: ModelMode
  /** The environment: each provider's key and base URL are read from it by name. */
  env?: Readonly<Record<string, string | undefined>>
  /** The registry; tests add a provider here. */
  providers?: readonly ProviderEntry[]
  adapters?: Readonly<Record<string, ProviderAdapter>>
  effort?: Partial<Record<ModelRole, Effort>>
  /** Mock prices, so tests can exercise spend caps. The scripted mock is free by default. */
  mockPrices?: Prices
}

const defaultEffort: Record<ModelRole, Effort> = {
  eval_answer: 'medium',
  judge: 'low',
  // Ask's words only phrase what the engine found, in a few sentences, and stream to the person as
  // they are written: any reasoning delays the first sentence, and at low effort the model still
  // spent the words' whole output limit on reasoning for some questions and wrote nothing.
  assistant: 'none',
  test_authoring: 'medium',
}

export function createModelPort(options: ModelPortOptions): ModelPort {
  const effort = (role: ModelRole) => options.effort?.[role] ?? defaultEffort[role]
  const adapters = options.adapters ?? modelAdapters
  const providers = registry(options.providers ?? modelProviders, adapters)
  const resolve = (setting: string, ref: ModelRef) => {
    const entry = providers.get(ref.provider)
    if (!entry)
      throw new ModelConfigError(
        `${setting} names provider ${ref.provider}, which is not in the provider registry (${[...providers.keys()].join(', ')})`,
      )
    const known = Object.hasOwn(entry.models, ref.model) ? entry.models[ref.model] : undefined
    if (known)
      return {
        entry,
        listed: ref.prices ? { ...known, prices: ref.prices } : known,
        vendorNamed: true,
      }
    if (!ref.prices)
      throw new ModelConfigError(
        `${setting} names model ${ref.model}, which provider ${entry.name} does not list. Give its prices in US dollars per million tokens in the setting: {"provider":"${entry.name}","model":"${ref.model}","prices":{"input":1,"output":5}}. A model that costs nothing has prices of 0.`,
      )
    return {
      entry,
      listed: unlisted(entry, ref.model, ref.prices),
      vendorNamed: ref.model.indexOf('/') > 0,
    }
  }
  if (options.mode === 'mock') return mockPort(options.mockPrices ?? free, effort, resolve)

  const env = options.env ?? {}
  const connections = new Map<string, ReturnType<ProviderAdapter['connect']>>()
  /** The provider's key and base URL, from the environment. */
  const connectionOf = (setting: string, entry: ProviderEntry) => {
    const baseUrl = baseUrlOf(entry)
    if (!URL.canParse(baseUrl) || !/^https?:$/.test(new URL(baseUrl).protocol))
      throw new ModelConfigError(`${entry.baseUrlEnv} must be an http or https URL`)
    const apiKey = env[entry.apiKeyEnv] || undefined
    const keyless =
      entry.keyOptionalWhenPrivate && placeOf(new URL(baseUrl).hostname) !== 'internet'
    if (!apiKey && !keyless)
      throw new ModelConfigError(
        `${setting} uses provider ${entry.name}, which needs ${entry.apiKeyEnv}. Put it in .env.local (never commit it), or use MODELS=mock.`,
      )
    return { apiKey, baseUrl }
  }
  const baseUrlOf = (entry: ProviderEntry) => env[entry.baseUrlEnv] || entry.baseUrl
  const connect = (setting: string, entry: ProviderEntry) => {
    const made = connections.get(entry.name)
    if (made) return made
    const connection = adapters[entry.adapter]!.connect(entry, connectionOf(setting, entry))
    connections.set(entry.name, connection)
    return connection
  }
  const cache = new Map<string, ModelChoice>()
  const choose = (role: ModelRole, ref: ModelRef = defaultModel): ModelChoice => {
    const key = `${role}:${ref.provider}:${ref.model}:${JSON.stringify(ref.prices ?? null)}`
    const cached = cache.get(key)
    if (cached) return cached
    const setting = `models.${role}`
    const { entry, listed, vendorNamed } = resolve(setting, ref)
    const adapted = connect(setting, entry)(ref.model, listed, effort(role))
    const choice: ModelChoice = {
      ...adapted,
      model: holdVendor(adapted.model, ref.model, listed.vendor),
      id: `${entry.name}/${ref.model}`,
      provider: entry.name,
      name: ref.model,
      vendor: listed.vendor,
      family: `${listed.vendor}/${listed.line}`,
      effort: effort(role),
      prices: listed.prices,
      recipients: recipients(entry, baseUrlOf(entry), listed.vendor, vendorNamed),
    }
    cache.set(key, choice)
    return choice
  }
  return {
    mode: 'live',
    choose,
    otherLine(role, answer) {
      const entry = providers.get(answer.provider)!
      const vendor = Object.entries(entry.models).filter(([, m]) => m.vendor === answer.vendor)
      const [name] = vendor.find(([, m]) => `${m.vendor}/${m.line}` !== answer.family) ??
        vendor[0] ?? [undefined]
      // The provider lists no model of the vendor (one only its setting prices): the answering
      // model judges itself, which a run records as a judge of the same family.
      if (name === undefined)
        return choose(role, { provider: entry.name, model: answer.name, prices: answer.prices })
      return choose(role, { provider: entry.name, model: name })
    },
    check(setting, ref) {
      connect(setting, resolve(setting, ref).entry)
    },
    async creditsUsed(provider) {
      const entry = providers.get(provider)
      const apiKey = entry ? env[entry.apiKeyEnv] : undefined
      if (!entry?.creditsPath || !apiKey) return null
      const base = (env[entry.baseUrlEnv] || entry.baseUrl).replace(/\/+$/, '')
      // The key goes in the header only, never in a message.
      const response = await fetch(base + entry.creditsPath, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok)
        throw new Error(`${entry.name} answered the credit count with HTTP ${response.status}`)
      const used = Number(((await response.json()) as { total_used?: unknown }).total_used)
      if (!Number.isFinite(used)) throw new Error(`${entry.name} gave no total used`)
      return Math.round(used * 1_000_000)
    },
  }
}

/** The entries by name, refused at start-up when two share a name or one names no adapter. */
function registry(
  entries: readonly ProviderEntry[],
  adapters: Readonly<Record<string, ProviderAdapter>>,
): Map<string, ProviderEntry> {
  const byName = new Map<string, ProviderEntry>()
  for (const entry of entries) {
    if (byName.has(entry.name) || entry.name === 'mock')
      throw new ModelConfigError(`The provider registry has a second provider named ${entry.name}`)
    if (!Object.hasOwn(adapters, entry.adapter))
      throw new ModelConfigError(
        `Provider ${entry.name} names adapter ${entry.adapter}, which does not exist`,
      )
    byName.set(entry.name, entry)
  }
  return byName
}

/** The scripted mock behind every role. A setting is still checked against the registry. */
function mockPort(
  prices: Prices,
  effort: (role: ModelRole) => Effort,
  resolve: (setting: string, ref: ModelRef) => unknown,
): ModelPort {
  const models: Record<ModelRole, LanguageModelV4> = {
    eval_answer: scriptedAnswerModel(),
    judge: scriptedJudgeModel(),
    assistant: scriptedAnswerModel(),
    // No feature drafts test questions with a model yet; the role can be assigned before it does.
    test_authoring: scriptedAnswerModel(),
  }
  const choose = (role: ModelRole): ModelChoice => ({
    model: models[role],
    id: `mock/${models[role].modelId}`,
    provider: 'mock',
    name: models[role].modelId,
    vendor: 'mock',
    family: `mock/${models[role].modelId}`,
    effort: effort(role),
    options: {},
    cacheBreakpoint: {},
    prices,
    recipients: 'no one (the scripted mock)',
  })
  return {
    mode: 'mock',
    choose,
    otherLine: choose,
    check(setting, ref) {
      resolve(setting, ref)
    },
    creditsUsed: () => Promise.resolve(null),
  }
}

/**
 * A model the provider does not list, priced by its setting. Its vendor is the prefix of a
 * `vendor/model` name, such as `google` in `google/gemini-3-flash`, else the provider's own name;
 * its line is the whole name without that prefix, so its family is `vendor/model`.
 */
function unlisted(entry: ProviderEntry, name: string, prices: Prices): ListedModel {
  const slash = name.indexOf('/')
  return slash > 0
    ? { vendor: name.slice(0, slash), line: name.slice(slash + 1), prices }
    : { vendor: entry.name, line: name, prices }
}

/**
 * Who receives what is sent to a model, in plain words: the provider's operator and the model's
 * vendor, when the model's name gives one. A base URL at another host than the operator's own is named by its address instead,
 * with the vendor only when the model's name gives one: a server on this computer or a private
 * network is the company's own, and what it passes on is up to how it is set up.
 */
function recipients(
  entry: ProviderEntry,
  baseUrl: string,
  vendorId: string,
  vendorNamed: boolean,
): string {
  const vendor = vendorNames[vendorId] ?? vendorId
  const host = new URL(baseUrl).hostname
  if (!entry.operatorHost || host === entry.operatorHost)
    return !vendorNamed || vendor === entry.operator
      ? entry.operator
      : `${entry.operator} and ${vendor}`
  const place = placeOf(host)
  if (place === 'this computer') return 'this computer'
  if (place === 'private network') return `your network (${host})`
  return vendorNamed ? `the host at ${host} and ${vendor}` : `the host at ${host}`
}

/**
 * Refuses a response that names a model of another vendor, as a gateway's fallback would. A
 * response model id of the form `vendor/model` is checked; a bare id names no vendor.
 */
function holdVendor(model: LanguageModelV4, name: string, vendor: string): LanguageModelV4 {
  const check = (served: string | undefined) => {
    const prefix = served?.includes('/') ? served.slice(0, served.indexOf('/')) : undefined
    if (prefix !== undefined && prefix !== vendor)
      throw new ModelVendorError(
        `${name} was answered by ${served}, a model of another vendor than ${vendor}; a fallback may not change the vendor`,
      )
  }
  return wrapLanguageModel({
    model,
    middleware: {
      wrapGenerate: async ({ doGenerate }) => {
        const result = await doGenerate()
        check(result.response?.modelId)
        return result
      },
      wrapStream: async ({ doStream }) => {
        const result = await doStream()
        const stream = result.stream.pipeThrough(
          new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
            transform(part, controller) {
              if (part.type === 'response-metadata') check(part.modelId)
              controller.enqueue(part)
            },
          }),
        )
        return { ...result, stream }
      },
    },
  })
}
