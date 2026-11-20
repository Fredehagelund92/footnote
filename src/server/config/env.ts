import { isIP } from 'node:net'
import * as z from 'zod'
import { DEFAULT_WEB_ORIGINS } from '../../contract/limits.ts'
import { productNameProblem } from '../../domain/brand.ts'
import { settingSchemas } from '../../contract/admin.ts'
import {
  modelProviders,
  providerEnvNames,
  type ModelRef,
  type StartModels,
} from '../modules/models/index.ts'

/**
 * The service's configuration, read once from the environment at start-up. Anything invalid
 * stops the service with one message that names every bad variable, before it listens.
 */

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const

/** The longest profile label (FOOTNOTE_PROFILE_LABEL) the header and the sign-in page show. */
const PROFILE_LABEL_MAX = 40

const serverFoldersSchema = z.record(z.string(), z.string().min(1))

/**
 * `<provider>:<model>`, split at the first colon: Ollama's model names hold colons, as in
 * `openai:gpt-oss:20b`.
 */
export const modelName = z.string().transform((text, context) => {
  const at = text.indexOf(':')
  const ref = { provider: text.slice(0, at), model: text.slice(at + 1) }
  if (at > 0 && settingSchemas['models.assistant'].safeParse(ref).success) return ref
  context.addIssue({
    code: 'custom',
    message: 'Expected <provider>:<model>, such as openai:gpt-oss:20b',
  })
  return z.NEVER
})

/** `<input>,<output>`: US dollars per million tokens, 0 for a model that costs nothing. */
export const modelPrices = z
  .string()
  .regex(
    /^\d+(\.\d+)?,\d+(\.\d+)?$/,
    'Expected <input>,<output> in US dollars per million tokens, such as 0.5,2',
  )
  .transform((text) => {
    const [input, output] = text.split(',').map(Number) as [number, number]
    return { input, output }
  })

/** The value of a variable that holds JSON; undefined when it is not JSON. */
function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
    LOG_LEVEL: z.enum(logLevels).default('info'),
    DATABASE_URL: z.url({
      protocol: /^postgres(?:ql)?$/,
      error: 'Expected a PostgreSQL URL such as postgres://localhost:5432/context_layer_dev',
    }),
    DATABASE_URL_SERVE: z.url({ protocol: /^postgres(?:ql)?$/ }).optional(),
    MCP_RESOURCE_URL: z.url().default('http://localhost:3000/mcp'),
    MCP_DEV_KEY_FILE: z.string().default('.footnote-dev-key.pem'),
    // The HMAC key (hex, 32 bytes or more, owner-only) that seals suggest_context's questions in a
    // person's agent (FR-121). Every instance needs the same file. Outside production a missing
    // file is created; in production a missing one turns those questions off.
    FOOTNOTE_MCP_STATE_KEY_FILE: z.string().default('.footnote-mcp-state.key'),
    // The login server for a person's own AI client (FR-403, FR-404, docs/contributing/sign-in.md).
    // `builtin` runs it in this service; `external` trusts another login server's tokens, read
    // by issuer and key set address; `off` leaves only dev tokens. Tools and items never change.
    FOOTNOTE_LOGIN_SERVER: z.enum(['builtin', 'external', 'off']).default('builtin'),
    // The issuer (`iss`) of the built-in login server's tokens. Default: the MCP address's origin.
    FOOTNOTE_OAUTH_ISSUER: z.url({ protocol: /^https?$/ }).optional(),
    // The web page where a person approves a client. Default: the first web origin's
    // /connect/approve. It must be on an allowed web origin, on the issuer's host.
    FOOTNOTE_OAUTH_CONSENT_URL: z.url({ protocol: /^https?$/ }).optional(),
    // The Ed25519 key that signs access tokens (PKCS #8 PEM, owner-only). Outside production a
    // missing file is created; in production it must exist. Earlier keys, listed after a
    // rotation, keep verifying the tokens they signed until those expire.
    FOOTNOTE_OAUTH_SIGNING_KEY_FILE: z.string().default('.footnote-oauth-key.pem'),
    FOOTNOTE_OAUTH_PREVIOUS_KEY_FILES: z.string().optional(),
    // Dynamic client registration (RFC 7591), the fallback to client ID metadata documents.
    // Defaults on outside production; production requires an explicit opt-in.
    FOOTNOTE_OAUTH_DYNAMIC_REGISTRATION: z.enum(['on', 'off']).optional(),
    // A refresh token unused this long expires; a connection ends this many days after sign-in.
    FOOTNOTE_OAUTH_REFRESH_IDLE_HOURS: z.coerce.number().int().min(1).max(2160).default(168),
    FOOTNOTE_OAUTH_CONNECTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    // FOOTNOTE_LOGIN_SERVER=external: whose tokens the MCP server accepts, and where their keys are.
    MCP_AUTH_ISSUER: z.url({ protocol: /^https?$/ }).optional(),
    MCP_AUTH_JWKS_URL: z.url({ protocol: /^https?$/ }).optional(),
    // Sign-in (FR-416). `oidc` signs people in with the company's OpenID Connect provider and is
    // the default in production. `dev` and `demo` pick a person from a local file (`demo` for
    // demos); production refuses both. Unset: `oidc` in production, `dev` elsewhere.
    FOOTNOTE_AUTH: z.enum(['dev', 'demo', 'oidc']).optional(),
    FOOTNOTE_DEV_PEOPLE_FILE: z.string().default('db/seed/people.local.yml'),
    // FOOTNOTE_AUTH=oidc: the provider's issuer (its discovery document is read from
    // <issuer>/.well-known/openid-configuration) and this app's client id there.
    FOOTNOTE_OIDC_ISSUER: z.url({ protocol: /^https?$/ }).optional(),
    FOOTNOTE_OIDC_CLIENT_ID: z
      .string()
      .regex(/^\S{1,255}$/, 'Expected the client id, without spaces')
      .optional(),
    // A confidential client's secret, read from an owner-only file (mode 0600), never from the
    // environment. Unset: a public client, with PKCE and no secret.
    FOOTNOTE_OIDC_CLIENT_SECRET_FILE: z.string().optional(),
    // Where the provider sends the browser back. Default: this service's address (the origin of
    // MCP_RESOURCE_URL) at /api/v1/auth/oidc/callback. Register exactly this address there.
    FOOTNOTE_OIDC_REDIRECT_URL: z.url({ protocol: /^https?$/ }).optional(),
    FOOTNOTE_OIDC_SCOPES: z.string().default('openid email profile'),
    // The claim of the ID token that lists the person's groups, and the groups that let a person
    // in without an invite: as an Admin, or as a Member. Comma-separated; unset maps none.
    FOOTNOTE_OIDC_GROUPS_CLAIM: z.string().default('groups'),
    FOOTNOTE_OIDC_ADMIN_GROUPS: z.string().optional(),
    FOOTNOTE_OIDC_MEMBER_GROUPS: z.string().optional(),
    // The sign-in button's name for the provider, such as "Okta". Default: "your company account".
    FOOTNOTE_OIDC_NAME: z.string().max(40).optional(),
    // A browser session ends after this many hours unused, and this many days after sign-in.
    FOOTNOTE_SESSION_IDLE_HOURS: z.coerce.number().int().min(1).max(720).default(12),
    FOOTNOTE_SESSION_MAX_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    // The web app's origins, which may send changes. The first is its public address: links to a
    // draft and to each item an agent is given go there (FR-121, FR-347).
    FOOTNOTE_WEB_ORIGINS: z
      .string()
      .default(DEFAULT_WEB_ORIGINS.join(','))
      .transform((value) => value.split(',').map((origin) => origin.trim()))
      .pipe(
        z.array(
          z
            .url({ protocol: /^https?$/ })
            .refine(
              (value) => URL.canParse(value) && new URL(value).origin === value,
              'Expected an origin without a path or credentials',
            ),
        ),
      ),
    // The proxies in front of this service whose X-Forwarded-For and X-Forwarded-Proto it believes:
    // addresses, ranges (10.0.0.0/8) or loopback, linklocal and uniquelocal, comma-separated.
    // `vercel` alone believes the one hop in front, whatever its address: Vercel's edge, which
    // writes X-Forwarded-For itself and drops what the caller sent (docs/vercel.md). Unset
    // believes none, and a caller's address is the connection's peer.
    FOOTNOTE_TRUSTED_PROXIES: z
      .string()
      .transform((value) =>
        value
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
      )
      .refine(
        (entries) =>
          entries.includes('vercel') ? entries.length === 1 : entries.every(isProxyAddress),
        'Expected vercel alone, or addresses or ranges such as 10.0.0.0/8, or loopback, linklocal or uniquelocal',
      )
      .optional(),
    // Pins the service's "today" (a UTC day) so demo data and end-to-end screenshots stay stable.
    FOOTNOTE_FIXED_TODAY: z.iso.date().optional(),
    // Language models for the assistant, judges and evals. `get_context` never calls a model.
    // `mock` scripts every role; `live` uses each role's provider and model from the settings
    // (`models.<role>`), with the provider's key from this environment.
    MODELS: z.enum(['mock', 'live']).default('mock'),
    // The one-line start: every role's model, and the judge's, at start-up, for each role whose
    // setting is still the one it was installed with. A model its provider does not list needs
    // its prices. An admin's change of the setting always wins.
    FOOTNOTE_MODEL: modelName.optional(),
    FOOTNOTE_MODEL_PRICES: modelPrices.optional(),
    FOOTNOTE_JUDGE_MODEL: modelName.optional(),
    FOOTNOTE_JUDGE_MODEL_PRICES: modelPrices.optional(),
    // A folder of Cube model files, read offline. Unset selects the demo connector.
    CUBE_MODEL_DIR: z.string().optional(),
    // Folders on the server, by connector id: a JSON object each connector named reads as
    // `ctx.folder`, when its manifest declares `capabilities.serverFolder`.
    FOOTNOTE_SERVER_FOLDERS: z
      .string()
      .transform((text, context) => {
        const folders = serverFoldersSchema.safeParse(parsedJson(text))
        if (folders.success) return folders.data
        context.addIssue({
          code: 'custom',
          message: 'Expected a JSON object of connector ids to folders',
        })
        return z.NEVER
      })
      .optional(),
    // Hosts on this machine or a private network that connectors may reach over https, as a
    // comma-separated list of names or addresses: an internal artifact server. The connectors
    // read it themselves through `egressPrivateHosts`.
    FOOTNOTE_EGRESS_PRIVATE_HOSTS: z.string().optional(),
    FOOTNOTE_DOMAIN_OVERRIDES: z.string().optional(),
    // A JSON file of renamed Cube members, old id to new id (CON-512).
    CUBE_RENAMES_FILE: z.string().optional(),
    // A JSON file of figure settings, by source and then by view or measure, for what a tool's
    // model leaves unsaid (FR-716): the date a view's figures are read by, whether a measure adds
    // up over days, and how its value is written.
    FOOTNOTE_FIGURE_OVERRIDES: z.string().optional(),
    // A JSON file of the Cube views the model folder is read for, an allow list; unset, every view.
    CUBE_VIEWS_FILE: z.string().optional(),
    // How long Cube's compiler may take on the model, and the memory it may use; a large model
    // needs more than the defaults (120 seconds, 1,024 MB).
    CUBE_COMPILE_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(1800).optional(),
    CUBE_COMPILE_MEMORY_MB: z.coerce.number().int().min(64).max(16384).optional(),
    // The local secret store: a folder outside the repository, only the server's user may open
    // (mode 0700). Sources an administrator adds keep their tokens there (CON-105). Unset, the
    // server keeps no secret, so a source that needs one cannot be added.
    FOOTNOTE_SECRETS_DIR: z.string().optional(),
    // `on` lets the service open plain http pages an evidence link names on this machine, where
    // the end-to-end tests serve theirs. Never another private address; refused in production.
    FOOTNOTE_WEB_READ_LOOPBACK: z.enum(['on', 'off']).default('off'),
    // The bearer token a scraper presents at /metrics. Unset turns the endpoint off.
    FOOTNOTE_METRICS_TOKEN: z
      .string()
      .regex(/^\S{32,}$/, 'Expected at least 32 characters without spaces (openssl rand -hex 32)')
      .optional(),
    // The product's name in what people and agents read. Checked here so a bad value stops the
    // start; src/server/brand.ts reads it (and the web build reads the same variable).
    FOOTNOTE_PRODUCT_NAME: z
      .string()
      .superRefine((value, context) => {
        const problem = productNameProblem(value)
        if (problem) context.addIssue({ code: 'custom', message: problem })
      })
      .optional(),
    // A name for this install that the header and the sign-in page show, so a person who runs
    // more than one (the demo and a private profile) always sees which one they are in. Unset
    // shows none.
    FOOTNOTE_PROFILE_LABEL: z
      .string()
      .trim()
      .min(1)
      .max(PROFILE_LABEL_MAX, `Keep the label to ${PROFILE_LABEL_MAX} characters`)
      // eslint-disable-next-line no-control-regex -- the point is to refuse control characters
      .regex(/^[^\u0000-\u001f\u007f]*$/, 'Expected one line, without control characters')
      .optional(),
  })
  .superRefine((env, context) => {
    if (
      env.NODE_ENV === 'production' &&
      (env.FOOTNOTE_AUTH === 'dev' || env.FOOTNOTE_AUTH === 'demo')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['FOOTNOTE_AUTH'],
        message: `${env.FOOTNOTE_AUTH === 'dev' ? 'Dev' : 'Demo'} sign-in is refused when NODE_ENV=production; use FOOTNOTE_AUTH=oidc`,
      })
    }
    const auth = env.FOOTNOTE_AUTH ?? (env.NODE_ENV === 'production' ? 'oidc' : 'dev')
    if (auth === 'oidc')
      for (const name of ['FOOTNOTE_OIDC_ISSUER', 'FOOTNOTE_OIDC_CLIENT_ID'] as const)
        if (env[name] === undefined)
          context.addIssue({
            code: 'custom',
            path: [name],
            message: 'Required when FOOTNOTE_AUTH=oidc',
          })
    if (env.FOOTNOTE_SESSION_IDLE_HOURS > env.FOOTNOTE_SESSION_MAX_DAYS * 24)
      context.addIssue({
        code: 'custom',
        path: ['FOOTNOTE_SESSION_IDLE_HOURS'],
        message: 'Expected no more hours than FOOTNOTE_SESSION_MAX_DAYS allows',
      })
    for (const [name, model, prices] of [
      ['FOOTNOTE_MODEL', env.FOOTNOTE_MODEL, env.FOOTNOTE_MODEL_PRICES],
      ['FOOTNOTE_JUDGE_MODEL', env.FOOTNOTE_JUDGE_MODEL, env.FOOTNOTE_JUDGE_MODEL_PRICES],
    ] as const) {
      if (prices && !model)
        context.addIssue({
          code: 'custom',
          path: [`${name}_PRICES`],
          message: `Expected ${name} too: these are its prices`,
        })
      if (model && !prices && unlistedModel(model))
        context.addIssue({
          code: 'custom',
          path: [name],
          message: `Provider ${model.provider} does not list ${model.model}: set ${name}_PRICES to <input>,<output> in US dollars per million tokens, 0,0 for a model that costs nothing`,
        })
    }
    if (env.NODE_ENV === 'production' && env.FOOTNOTE_WEB_READ_LOOPBACK === 'on') {
      context.addIssue({
        code: 'custom',
        path: ['FOOTNOTE_WEB_READ_LOOPBACK'],
        message: 'Reading pages on this machine is refused when NODE_ENV=production',
      })
    }
    if (env.NODE_ENV === 'production' && env.FOOTNOTE_FIXED_TODAY !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['FOOTNOTE_FIXED_TODAY'],
        message: 'A fixed date is refused when NODE_ENV=production',
      })
    }
    if (env.FOOTNOTE_LOGIN_SERVER === 'external') {
      for (const name of ['MCP_AUTH_ISSUER', 'MCP_AUTH_JWKS_URL'] as const)
        if (env[name] === undefined)
          context.addIssue({
            code: 'custom',
            path: [name],
            message: 'Required when FOOTNOTE_LOGIN_SERVER=external',
          })
    }
    for (const name of [
      'FOOTNOTE_OAUTH_ISSUER',
      'FOOTNOTE_OAUTH_CONSENT_URL',
      'MCP_AUTH_ISSUER',
      'MCP_AUTH_JWKS_URL',
      'FOOTNOTE_OIDC_ISSUER',
      'FOOTNOTE_OIDC_REDIRECT_URL',
    ] as const) {
      const value = env[name]
      if (value === undefined) continue
      const url = new URL(value)
      if (url.protocol !== 'https:' && !loopbackHosts.has(url.hostname))
        context.addIssue({
          code: 'custom',
          path: [name],
          message: 'Expected https, or http on this computer only (localhost, 127.0.0.1, [::1])',
        })
      if (url.search || url.hash || url.username || url.password)
        context.addIssue({
          code: 'custom',
          path: [name],
          message: 'Expected an address without a query, a fragment or credentials',
        })
    }
  })

export type LogLevel = (typeof logLevels)[number]

const proxyNames = new Set(['loopback', 'linklocal', 'uniquelocal'])

/** An address, a range with its prefix length, or one of the names Fastify's trustProxy knows. */
function isProxyAddress(entry: string): boolean {
  if (proxyNames.has(entry)) return true
  const [address = '', prefix, ...rest] = entry.split('/')
  const version = isIP(address)
  if (!version || rest.length) return false
  if (prefix === undefined) return true
  return /^\d{1,3}$/.test(prefix) && Number(prefix) <= (version === 4 ? 32 : 128)
}

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Which login server issues the tokens the MCP server accepts (FR-404). */
export type LoginServerConfig =
  | {
      kind: 'builtin'
      issuer: string
      consentUrl: string
      signingKeyFile: string
      previousKeyFiles: string[]
      dynamicRegistration: boolean
      refreshIdleHours: number
      connectionDays: number
    }
  | { kind: 'external'; issuer: string; jwksUrl: string }
  | { kind: 'off' }

export interface Config {
  nodeEnv: 'development' | 'test' | 'production'
  host: string
  port: number
  logLevel: LogLevel
  databaseUrl: string
  databaseServeUrl: string
  mcpResourceUrl: string
  mcpDevKeyFile: string
  mcpStateKeyFile: string
  loginServer: LoginServerConfig
  auth: 'dev' | 'demo' | 'oidc'
  /** FOOTNOTE_AUTH=oidc: the provider and this app's client there. */
  oidc: OidcConfig | null
  sessions: SessionLifetime
  devPeopleFile: string
  webOrigins: string[]
  /**
   * FOOTNOTE_TRUSTED_PROXIES: the proxies whose forwarded address the service believes, or `vercel`
   * alone for Vercel's edge; empty for none.
   */
  trustedProxies: string[]
  fixedToday: string | undefined
  models: 'mock' | 'live'
  /** The registry's key, bearer token and base URL variables that are set, by name. Never logged. */
  modelEnv: Record<string, string>
  /** FOOTNOTE_MODEL and FOOTNOTE_JUDGE_MODEL, with their prices: the one-line start. */
  startModels: StartModels
  cubeModelDir: string | undefined
  /** The folders on the server, by connector id (`FOOTNOTE_SERVER_FOLDERS`). */
  serverFolders: Readonly<Record<string, string>>
  domainOverridesFile: string | undefined
  renamesFile: string | undefined
  /** The figure settings file (`FOOTNOTE_FIGURE_OVERRIDES`), read when the service starts. */
  figureOverridesFile: string | undefined
  /** The Cube views the model folder is read for (`CUBE_VIEWS_FILE`); unset, every view. */
  cubeViewsFile: string | undefined
  /** Cube's compile limits, when the server sets them. */
  cubeCompile: { timeoutMs?: number; memoryMb?: number }
  /** The local secret store's folder; unset keeps no secret. */
  secretsDir: string | undefined
  metricsToken: string | undefined
  /** Evidence links may open http pages on this machine too (tests only). */
  webReadLoopback: boolean
  /** FOOTNOTE_PROFILE_LABEL: the name the header and the sign-in page show; unset shows none. */
  profileLabel: string | undefined
}

/** A model its provider does not list; a provider the registry lacks is refused at start-up. */
export function unlistedModel(ref: ModelRef): boolean {
  const entry = modelProviders.find((p) => p.name === ref.provider)
  return entry !== undefined && !Object.hasOwn(entry.models, ref.model)
}

/** A one-line start's model with its prices, when it has them. */
const withPrices = (model: ModelRef | undefined, prices: ModelRef['prices']) =>
  model && prices ? { ...model, prices } : model

/** What a refusal adds when production has no sign-in configured. */
export const productionSignInHint =
  'NODE_ENV=production signs people in with your OpenID Connect provider (docs/operations.md, "Run the image in production mode"). To try it out on this computer with the demo\'s people picker instead, set NODE_ENV=development, as compose.yaml does.'

export class ConfigError extends Error {
  override name = 'ConfigError'
}

/** Parses the environment. An empty value counts as unset, as `.env` files write them. */
export function loadConfig(environment: Record<string, string | undefined>): Config {
  const present = Object.fromEntries(
    Object.entries(environment).filter(([, value]) => value !== undefined && value !== ''),
  )
  const result = envSchema.safeParse(present)
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    // Production signs people in with the company's provider. Someone who only wants to look
    // around is told how to get the demo's picker instead.
    const noSignIn =
      present.NODE_ENV === 'production' &&
      present.FOOTNOTE_AUTH === undefined &&
      result.error.issues.some((issue) => issue.message === 'Required when FOOTNOTE_AUTH=oidc')
    if (noSignIn) lines.push('', productionSignInHint)
    throw new ConfigError(`Invalid configuration:\n${lines.join('\n')}`)
  }
  const env = result.data
  const auth = env.FOOTNOTE_AUTH ?? (env.NODE_ENV === 'production' ? 'oidc' : 'dev')
  const loginServer = loginServerConfig(env)
  return {
    nodeEnv: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    databaseServeUrl: env.DATABASE_URL_SERVE ?? servingUrl(env.DATABASE_URL),
    mcpResourceUrl: env.MCP_RESOURCE_URL,
    mcpDevKeyFile: env.MCP_DEV_KEY_FILE,
    mcpStateKeyFile: env.FOOTNOTE_MCP_STATE_KEY_FILE,
    loginServer,
    auth,
    oidc: auth === 'oidc' ? oidcConfig(env) : null,
    sessions: {
      idleHours: env.FOOTNOTE_SESSION_IDLE_HOURS,
      maxDays: env.FOOTNOTE_SESSION_MAX_DAYS,
    },
    devPeopleFile: env.FOOTNOTE_DEV_PEOPLE_FILE,
    webOrigins: env.FOOTNOTE_WEB_ORIGINS,
    trustedProxies: env.FOOTNOTE_TRUSTED_PROXIES ?? [],
    fixedToday: env.FOOTNOTE_FIXED_TODAY,
    models: env.MODELS,
    modelEnv: Object.fromEntries(
      providerEnvNames().flatMap((name) =>
        present[name] === undefined ? [] : [[name, present[name]]],
      ),
    ),
    startModels: {
      model: withPrices(env.FOOTNOTE_MODEL, env.FOOTNOTE_MODEL_PRICES),
      judge: withPrices(env.FOOTNOTE_JUDGE_MODEL, env.FOOTNOTE_JUDGE_MODEL_PRICES),
    },
    cubeModelDir: env.CUBE_MODEL_DIR,
    serverFolders: env.FOOTNOTE_SERVER_FOLDERS ?? {},
    domainOverridesFile: env.FOOTNOTE_DOMAIN_OVERRIDES,
    renamesFile: env.CUBE_RENAMES_FILE,
    figureOverridesFile: env.FOOTNOTE_FIGURE_OVERRIDES,
    cubeViewsFile: env.CUBE_VIEWS_FILE,
    cubeCompile: {
      ...(env.CUBE_COMPILE_TIMEOUT_SECONDS === undefined
        ? {}
        : { timeoutMs: env.CUBE_COMPILE_TIMEOUT_SECONDS * 1000 }),
      ...(env.CUBE_COMPILE_MEMORY_MB === undefined ? {} : { memoryMb: env.CUBE_COMPILE_MEMORY_MB }),
    },
    secretsDir: env.FOOTNOTE_SECRETS_DIR,
    metricsToken: env.FOOTNOTE_METRICS_TOKEN,
    webReadLoopback: env.FOOTNOTE_WEB_READ_LOOPBACK === 'on',
    profileLabel: env.FOOTNOTE_PROFILE_LABEL,
  }
}

/** How long a browser session lasts: unused, and at most (FOOTNOTE_SESSION_IDLE_HOURS, FOOTNOTE_SESSION_MAX_DAYS). */
export interface SessionLifetime {
  idleHours: number
  maxDays: number
}

/** Company sign-in with OpenID Connect (FOOTNOTE_AUTH=oidc, FR-416, docs/contributing/sign-in.md). */
export interface OidcConfig {
  issuer: string
  clientId: string
  /** The owner-only file of a confidential client's secret; null for a public client. */
  clientSecretFile: string | null
  redirectUrl: string
  scopes: string
  groupsClaim: string
  adminGroups: string[]
  memberGroups: string[]
  /** The sign-in button's name for the provider; null says "your company account". */
  name: string | null
}

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

function oidcConfig(env: z.infer<typeof envSchema>): OidcConfig {
  const scopes = env.FOOTNOTE_OIDC_SCOPES.split(/\s+/).filter(Boolean)
  if (!scopes.includes('openid'))
    throw new ConfigError(
      'Invalid configuration:\n  FOOTNOTE_OIDC_SCOPES: Expected openid among the scopes',
    )
  return {
    // An issuer is compared exactly (OpenID Connect Discovery 1.0, section 4.3), as configured.
    issuer: env.FOOTNOTE_OIDC_ISSUER!,
    clientId: env.FOOTNOTE_OIDC_CLIENT_ID!,
    clientSecretFile: env.FOOTNOTE_OIDC_CLIENT_SECRET_FILE ?? null,
    redirectUrl:
      env.FOOTNOTE_OIDC_REDIRECT_URL ??
      `${new URL(env.MCP_RESOURCE_URL).origin}/api/v1/auth/oidc/callback`,
    scopes: scopes.join(' '),
    groupsClaim: env.FOOTNOTE_OIDC_GROUPS_CLAIM,
    adminGroups: list(env.FOOTNOTE_OIDC_ADMIN_GROUPS),
    memberGroups: list(env.FOOTNOTE_OIDC_MEMBER_GROUPS),
    name: env.FOOTNOTE_OIDC_NAME?.trim() || null,
  }
}

/** Local clients can register by default; production requires an explicit opt-in. */
export function dynamicRegistrationEnabled(
  nodeEnv: Config['nodeEnv'],
  setting?: 'on' | 'off',
): boolean {
  return setting === undefined ? nodeEnv !== 'production' : setting === 'on'
}

function loginServerConfig(env: z.infer<typeof envSchema>): LoginServerConfig {
  if (env.FOOTNOTE_LOGIN_SERVER === 'off') return { kind: 'off' }
  if (env.FOOTNOTE_LOGIN_SERVER === 'external')
    return { kind: 'external', issuer: env.MCP_AUTH_ISSUER!, jwksUrl: env.MCP_AUTH_JWKS_URL! }
  // An issuer is compared as a string (RFC 8414): the origin, without a trailing slash.
  const issuer = (env.FOOTNOTE_OAUTH_ISSUER ?? new URL(env.MCP_RESOURCE_URL).origin).replace(
    /\/$/,
    '',
  )
  // By default the consent page is on the first web origin on the issuer's host: the browser
  // that starts a sign-in keeps a cookie the consent page must send back, and a cookie belongs
  // to a host, whatever its port.
  const sameHost = env.FOOTNOTE_WEB_ORIGINS.find(
    (o) => new URL(o).hostname === new URL(issuer).hostname,
  )
  const consentUrl =
    env.FOOTNOTE_OAUTH_CONSENT_URL ?? `${sameHost ?? env.FOOTNOTE_WEB_ORIGINS[0]}/connect/approve`
  const consent = new URL(consentUrl)
  const problems: string[] = []
  if (!env.FOOTNOTE_WEB_ORIGINS.includes(consent.origin))
    problems.push(
      `  FOOTNOTE_OAUTH_CONSENT_URL: Expected an address on one of FOOTNOTE_WEB_ORIGINS`,
    )
  if (consent.hostname !== new URL(issuer).hostname)
    problems.push(
      `  FOOTNOTE_OAUTH_CONSENT_URL: Expected a web origin on the issuer's host (${issuer}), or FOOTNOTE_LOGIN_SERVER=off`,
    )
  if (new URL(env.MCP_RESOURCE_URL).origin !== issuer)
    problems.push(
      `  FOOTNOTE_OAUTH_ISSUER: Expected the origin of MCP_RESOURCE_URL, which serves it`,
    )
  if (problems.length) throw new ConfigError(`Invalid configuration:\n${problems.join('\n')}`)
  return {
    kind: 'builtin',
    issuer,
    consentUrl: consent.href,
    signingKeyFile: env.FOOTNOTE_OAUTH_SIGNING_KEY_FILE,
    previousKeyFiles: (env.FOOTNOTE_OAUTH_PREVIOUS_KEY_FILES ?? '')
      .split(',')
      .map((file) => file.trim())
      .filter(Boolean),
    dynamicRegistration: dynamicRegistrationEnabled(
      env.NODE_ENV,
      env.FOOTNOTE_OAUTH_DYNAMIC_REGISTRATION,
    ),
    refreshIdleHours: env.FOOTNOTE_OAUTH_REFRESH_IDLE_HOURS,
    connectionDays: env.FOOTNOTE_OAUTH_CONNECTION_DAYS,
  }
}

/** Where the database is, without credentials, for the start-up log line. */
export function describeDatabase(databaseUrl: string): string {
  const url = new URL(databaseUrl)
  return `${url.hostname}:${url.port || '5432'}${url.pathname}`
}

function servingUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl)
  url.username = 'context_layer_serve'
  url.password = ''
  return url.href
}
