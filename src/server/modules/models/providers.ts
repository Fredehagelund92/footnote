import type { ModelRef, ProviderEntry } from './types.ts'

/**
 * The provider registry: every way this service may reach a language model. A provider is a
 * configuration entry naming an adapter, the environment variables for its key and base URL, and
 * the models it lists with their prices. Adding a vendor or a second gateway is one entry here,
 * plus one adapter in `adapters/` only when its protocol is new. Each role is assigned a provider
 * and a model in the versioned settings (`models.<role>`); a model the entry does not list is
 * served only with prices in that setting.
 *
 * Questions, test questions, item text and answers sent to a model leave the company to the
 * provider's operator and the model's vendor: Anthropic for Claude, Google for Gemini, and Vercel
 * for everything sent through its gateway. Use real company data only once the company has approved
 * those providers.
 */
export const modelProviders: readonly ProviderEntry[] = [
  {
    name: 'anthropic',
    adapter: 'anthropic',
    operator: 'Anthropic',
    operatorHost: 'api.anthropic.com',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    baseUrlEnv: 'ANTHROPIC_BASE_URL',
    baseUrl: 'https://api.anthropic.com/v1',
    // List prices of the direct API (Claude API skill tables, cached 2026-09-25). A prompt cache write
    // (five minutes, the only kind sent) bills at 1.25 times the input price.
    models: {
      'claude-opus-5-5': {
        vendor: 'anthropic',
        line: 'claude-opus',
        prices: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
      },
      'claude-sonnet-5-5': {
        vendor: 'anthropic',
        line: 'claude-sonnet',
        prices: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      },
      'claude-haiku-4-5': {
        vendor: 'anthropic',
        line: 'claude-haiku',
        prices: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
      },
    },
  },
  {
    // Vercel AI Gateway, through its OpenAI-compatible API. Every request goes to Vercel, which
    // passes it to the model's vendor only (`onlyVendor`), never to another company's copy of it:
    // Anthropic for Claude, Google for Gemini.
    name: 'vercel-gateway',
    adapter: 'openai-compatible',
    operator: 'Vercel',
    operatorHost: 'ai-gateway.vercel.sh',
    apiKeyEnv: 'VERCEL_AI_GATEWAY_API_KEY',
    baseUrlEnv: 'VERCEL_AI_GATEWAY_BASE_URL',
    baseUrl: 'https://ai-gateway.vercel.sh/v1',
    // The key's balance and what it has used so far (`GET /v1/credits`).
    creditsPath: '/credits',
    adapterOptions: {
      effort: 'reasoning',
      promptCache: 'cache_control',
      onlyVendor: true,
      // The gateway takes a JSON schema for every model it serves (R3).
      structuredOutputs: true,
    },
    // List prices of the gateway (https://ai-gateway.vercel.sh/v1/models, read 2026-10-09). Claude's
    // prompt cache writes bill at 1.25 times its input price, as on Anthropic's own API.
    models: {
      'anthropic/claude-opus-5.5': {
        vendor: 'anthropic',
        line: 'claude-opus',
        prices: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
      },
      'anthropic/claude-sonnet-5.5': {
        vendor: 'anthropic',
        line: 'claude-sonnet',
        prices: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
      },
      'anthropic/claude-haiku-4.5': {
        vendor: 'anthropic',
        line: 'claude-haiku',
        prices: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
      },
      // Read 2026-10-12. The gateway prices a request above 100,000 input tokens at five times
      // these; Ask's words and the evaluations send far less, so the flat price holds.
      'anthropic/claude-haiku-5.5': {
        vendor: 'anthropic',
        line: 'claude-haiku',
        prices: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
      },
      // Google's model, for demo data only until the company approves Google as a vendor.
      // List prices of the gateway (https://ai-gateway.vercel.sh/v1/models, read 2026-10-12).
      'google/gemini-2.5-flash-lite': {
        vendor: 'google',
        line: 'gemini-flash-lite',
        prices: { input: 0.1, output: 0.4, cacheRead: 0.01 },
      },
    },
  },
  {
    // OpenAI's Chat Completions API, or any server that speaks it at OPENAI_BASE_URL: a hosted
    // one such as OpenRouter or Groq, a company gateway such as LiteLLM, or a model server on this
    // computer such as Ollama (http://host.docker.internal:11434/v1 from the container), which
    // takes no key. It lists no model: each setting gives its model's prices.
    name: 'openai',
    adapter: 'openai-compatible',
    operator: 'OpenAI',
    operatorHost: 'api.openai.com',
    apiKeyEnv: 'OPENAI_API_KEY',
    keyOptionalWhenPrivate: true,
    baseUrlEnv: 'OPENAI_BASE_URL',
    baseUrl: 'https://api.openai.com/v1',
    adapterOptions: { effort: 'reasoning_effort', promptCache: 'none', structuredOutputs: true },
    models: {},
  },
]

/** Vendor names as people read them; a vendor missing here is shown by its id. */
export const vendorNames: Record<string, string> = {
  anthropic: 'Anthropic',
  google: 'Google',
  openai: 'OpenAI',
}

/** Every role's model when its setting is missing (plan section 2.3). */
export const defaultModel: ModelRef = { provider: 'anthropic', model: 'claude-sonnet-5-5' }
