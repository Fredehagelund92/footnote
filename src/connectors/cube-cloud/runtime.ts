import { contentDigest } from '../../domain/canonical.ts'
import {
  defineRuntime,
  SourceError,
  type CheckReport,
  type CheckStep,
  type RuntimeContext,
  type RuntimeMessage,
} from '../../domain/connector-runtime.ts'
import type { FieldProblem } from '../../domain/connector-config.ts'
import { mapDefinitions, parseMeta, type Meta } from './mapping.ts'

/*
  Cube Cloud's runtime (docs/contributing/connector-contract.md, "Interface 3.0"). A read asks Cube
  Cloud's API, with the source's API key, which environment of the deployment to read and how its
  latest build stands; when the build is the one the last read saw, it ends there and the core
  keeps what that read found. Otherwise it trades the key for a token that reads metadata only and
  lasts 5 minutes (`tokens-for-meta-sync`), and reads the deployment's `/v1/meta` with it.

  The key goes to the Cube Cloud address only, the token to the REST API address only, and
  neither is kept, logged or put in a step. Everything Cube Cloud answers is untrusted: answers are
  capped in size, ids are checked before they go into an address, and a refusal is a code.
*/

interface Config {
  address?: string
  deployment?: string
  apiAddress?: string
  environment?: string
  securityContext?: string
  domainNames?: Record<string, string>
}

const SECRET = 'apiKey'
/** How long the token a read asks for lasts, in seconds: one read, with room to spare. */
export const TOKEN_SECONDS = 300
/** The most bytes of an answer of Cube Cloud's API: a few environments, a build, a token. */
const ANSWER_MAX = 1_000_000
/** The most bytes of `/v1/meta`'s answer: the names and words of a large model. */
const META_MAX = 20_000_000
/**
 * What a read keeps of an answer, as its cursor says: a cursor of another reader reads again, so
 * a change to the mapping is never kept from by an unchanged build.
 */
const READER = 'cube-cloud/1'

/** An id or a hash Cube Cloud gives, as it may go into an address or a cursor. */
const printable = /^[\x21-\x7e]{1,200}$/
const environmentId = /^[0-9]{1,20}$/
/** A branch name, as it goes into the build status's query. */
const branchName = /^[A-Za-z0-9._/-]{1,200}$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en')} ${n === 1 ? one : many}`

/**
 * The address of `/v1/meta` from the REST API address as Cube Cloud shows it (`.../cubejs-api/v1`),
 * or as someone may paste it: without `/v1`, or with `/meta` or `/load` at its end.
 */
export function metaAddress(apiAddress: string): string {
  let base = apiAddress.replace(/\/+$/, '').replace(/\/(meta|load)$/, '')
  if (!/\/v1$/.test(base)) base = `${base}/v1`
  return `${base}/meta`
}

/** The security context the settings give, as an object; none is an empty one. */
function securityContextOf(config: Config): Record<string, unknown> {
  if (!config.securityContext) return {}
  const parsed = JSON.parse(config.securityContext) as unknown
  return isRecord(parsed) ? parsed : {}
}

/** Seconds to wait from a `Retry-After` header: seconds, or a date. */
function retryAfterOf(response: Response, now: Date): number | undefined {
  const header = response.headers.get('retry-after')?.trim()
  if (!header) return undefined
  if (/^\d{1,6}$/.test(header)) return Number(header)
  const at = Date.parse(header)
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now.getTime()) / 1000))
}

/** One environment of the deployment, as a read uses it. */
interface Environment {
  id: string
  type: string
  branch: string | null
  /** The REST API address Cube Cloud gives for it, when it says one. */
  rest: string | null
}

function environmentOf(raw: unknown): Environment | null {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === 'number' ? String(raw.id) : raw.id
  if (typeof id !== 'string' || !environmentId.test(id) || typeof raw.type !== 'string') return null
  const credentials = Array.isArray(raw.api_credentials) ? raw.api_credentials : []
  const rest = credentials.find(
    (entry): entry is { url: string } =>
      isRecord(entry) && entry.type === 'rest' && typeof entry.url === 'string',
  )
  return {
    id,
    type: raw.type,
    branch: typeof raw.branch === 'string' && branchName.test(raw.branch) ? raw.branch : null,
    rest: rest?.url ?? null,
  }
}

/** The build Cube Cloud last made of a branch, as a mark of its files; null when it says none. */
interface Build {
  mark: string | null
  /** The hash to show as the read's version. */
  hash: string | null
}

/** One session with a deployment: what Cube Cloud's API and its REST API answer this read. */
class Deployment {
  readonly #context: RuntimeContext<Config>

  constructor(context: RuntimeContext<Config>) {
    this.#context = context
  }

  get #config() {
    return this.#context.config
  }

  get #platform() {
    const address = (this.#config.address ?? '').replace(/\/+$/, '')
    return `${address}/api/v1/deployments/${this.#config.deployment ?? ''}`
  }

  get #key() {
    const key = this.#context.secret(SECRET)
    if (key === null)
      throw new SourceError({ code: 'secret_missing', target: SECRET, class: 'config' })
    return key
  }

  /** A request through `ctx.fetch`; a host that cannot be reached is a failure that clears. */
  async #request(address: string, init: Parameters<RuntimeContext['fetch']>[1]) {
    try {
      return await this.#context.fetch(address, init)
    } catch (error) {
      if (error instanceof SourceError || this.#context.signal.aborted) throw error
      throw new SourceError({
        code: 'unreachable',
        target: URL.parse(address)?.host ?? 'address',
        class: 'transient',
      })
    }
  }

  /** Why a request was refused, as the core says it: what Cube said is never passed on. */
  async #refusal(response: Response, refused: string, missing: string): Promise<SourceError> {
    await response.body?.cancel()
    const retryAfter = retryAfterOf(response, this.#context.now())
    const after = retryAfter === undefined ? {} : { retryAfter }
    const { status } = response
    if (status === 401 || status === 403)
      return new SourceError({ code: 'unauthorized', target: refused, class: 'config' })
    if (status === 404)
      return new SourceError({ code: 'not_found', target: missing, class: 'config' })
    if (status === 429)
      return new SourceError({
        code: 'rate_limited',
        target: refused,
        class: 'transient',
        ...after,
      })
    if (status >= 500)
      return new SourceError({ code: 'unreachable', target: refused, class: 'transient', ...after })
    return new SourceError({ code: 'fetch_failed', target: refused, class: 'source' })
  }

  /** An answer of Cube Cloud's API as JSON, or a failure that says the answer was not its. */
  async #json(response: Response, target: string): Promise<Record<string, unknown>> {
    let parsed: unknown
    try {
      parsed = JSON.parse(await response.text())
    } catch (error) {
      if (error instanceof SourceError) throw error
      parsed = null
    }
    if (isRecord(parsed)) return parsed
    throw new SourceError({ code: 'fetch_failed', target, class: 'source' })
  }

  /** A GET of Cube Cloud's API for this deployment, with the API key. */
  async #get(path: string, query: Record<string, string> = {}) {
    const search = new URLSearchParams(query).toString()
    const response = await this.#request(`${this.#platform}${path}${search ? `?${search}` : ''}`, {
      headers: { authorization: `Bearer ${this.#key}`, accept: 'application/json' },
      maxBytes: ANSWER_MAX,
    })
    if (!response.ok) throw await this.#refusal(response, SECRET, 'deployment')
    return this.#json(response, 'deployment')
  }

  /** The deployment's environments, in Cube Cloud's order. */
  async environments(): Promise<Environment[]> {
    const answer = await this.#get('/environments')
    const list = Array.isArray(answer.items) ? answer.items : answer.data
    if (!Array.isArray(list))
      throw new SourceError({ code: 'fetch_failed', target: 'deployment', class: 'source' })
    return list.flatMap((raw) => environmentOf(raw) ?? [])
  }

  /** The environment the settings name, or the production one when they name none. */
  async environment(): Promise<{ environment: Environment; count: number }> {
    const all = await this.environments()
    const wanted = this.#config.environment
    const environment =
      wanted === undefined
        ? all.find((candidate) => candidate.type === 'production')
        : all.find((candidate) => candidate.id === wanted)
    if (!environment)
      throw new SourceError({
        code: 'cube-cloud.environment_not_found',
        target: wanted === undefined ? 'production' : 'environment',
        class: 'config',
      })
    return { environment, count: all.length }
  }

  /** How the latest build of the environment's branch stands: its hashes, if Cube Cloud gives them. */
  async build(environment: Environment): Promise<Build> {
    const answer = await this.#get(
      '/build-status',
      environment.branch ? { branchName: environment.branch } : {},
    )
    const hashOf = (value: unknown) =>
      typeof value === 'string' && printable.test(value) ? value : null
    const files = hashOf(answer.filesHash)
    const last = hashOf(answer.lastHash)
    const hash = files ?? last
    return {
      hash,
      mark: hash === null ? null : await contentDigest({ files, last }),
    }
  }

  /** A token for this environment that reads metadata only, for `TOKEN_SECONDS`. */
  async token(environment: Environment): Promise<string> {
    const response = await this.#request(
      `${this.#platform}/environments/${environment.id}/tokens-for-meta-sync`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#key}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          expires_in: TOKEN_SECONDS,
          security_context: securityContextOf(this.#config),
        }),
        maxBytes: ANSWER_MAX,
      },
    )
    if (!response.ok) throw await this.#refusal(response, SECRET, 'environment')
    const data = (await this.#json(response, 'token')).data
    const token = isRecord(data) ? data.token : undefined
    if (typeof token !== 'string' || !/^[\x21-\x7e]{1,8192}$/.test(token))
      throw new SourceError({ code: 'fetch_failed', target: 'token', class: 'source' })
    return token
  }

  /** The deployment's `/v1/meta`, with the token; an answer that is not Cube's is the wrong address. */
  async meta(token: string): Promise<Meta> {
    const notMeta = () =>
      new SourceError({ code: 'cube-cloud.not_cube_meta', target: 'apiAddress', class: 'config' })
    const response = await this.#request(metaAddress(this.#config.apiAddress ?? ''), {
      // Cube's REST API takes its token as it is, with no scheme in front.
      headers: { authorization: token, accept: 'application/json' },
      maxBytes: META_MAX,
    })
    if (response.status === 404) {
      await response.body?.cancel()
      throw notMeta()
    }
    if (!response.ok) throw await this.#refusal(response, 'apiAddress', 'apiAddress')
    const meta = parseMeta(await response.text())
    if (meta === null) throw notMeta()
    return meta
  }
}

/** The read's cursor: who read it, the build it saw and the version it gave. */
interface Cursor {
  reader: string
  build: string
  version: string
}

function cursorOf(text: string | null): Cursor | null {
  if (text === null) return null
  try {
    const parsed = JSON.parse(text) as unknown
    if (
      isRecord(parsed) &&
      parsed.reader === READER &&
      typeof parsed.build === 'string' &&
      typeof parsed.version === 'string' &&
      parsed.version.length > 0
    )
      return { reader: READER, build: parsed.build, version: parsed.version }
  } catch {
    // Not a cursor of this connector's: it reads again.
  }
  return null
}

/** The steps a check says about the environment it found. */
function environmentStep(context: RuntimeContext<Config>, environment: Environment): CheckStep {
  const detail = `Read the ${environment.type} environment${environment.branch ? `, branch ${environment.branch}` : ''}.`
  const given = URL.parse(context.config.apiAddress ?? '')?.host
  const rest = environment.rest === null ? null : URL.parse(environment.rest)?.host
  if (rest && given && rest !== given)
    return {
      id: 'environment',
      title: 'Find the environment',
      status: 'warning',
      detail: `${detail} Cube Cloud gives it another REST API address.`,
      fix: 'Copy the REST API address Cube Cloud shows for this environment.',
    }
  return { id: 'environment', title: 'Find the environment', status: 'ok', detail }
}

/** The steps a check says about what the metadata holds. */
async function readSteps(context: RuntimeContext<Config>, meta: Meta): Promise<CheckStep[]> {
  const { definitions, warnings, complete } = await mapDefinitions(meta, context.config.domainNames)
  const metrics = definitions.filter((definition) => definition.kind === 'metric').length
  const views = new Set(definitions.map((definition) => definition.name.split('.')[0])).size
  const without = warnings.filter((warning) => warning.code === 'missing_domain').length
  const unread = warnings.filter((warning) => warning.code === 'cube-cloud.unreadable_view').length
  return [
    {
      id: 'read',
      title: 'Read the metadata',
      status: complete ? 'ok' : 'warning',
      detail: `${plural(metrics, 'metric')} and ${plural(definitions.length - metrics, 'dimension')} in ${plural(views, 'view')}.${unread ? ` ${plural(unread, 'view')} could not be read.` : ''}`,
      ...(complete ? {} : { fix: 'Read it again once Cube Cloud has built the model anew.' }),
    },
    without
      ? {
          id: 'domains',
          title: 'Find each domain',
          status: 'warning',
          detail: `${plural(without, 'view')} ${without === 1 ? 'names' : 'name'} no domain.`,
          fix: 'Map each view to a domain in the next step, or set meta.domain in the model.',
        }
      : { id: 'domains', title: 'Find each domain', status: 'ok' },
  ]
}

/**
 * The runtime of Cube Cloud: the deployment's environment and build through Cube Cloud's API,
 * then its `/v1/meta` with a token that reads metadata only, made into definitions by the pure
 * mapping. It reads no data, no SQL and no private member, and writes nothing.
 */
export const runtime = defineRuntime<Config>({
  parse(config): FieldProblem[] {
    if (!config.securityContext) return []
    let parsed: unknown
    try {
      parsed = JSON.parse(config.securityContext)
    } catch {
      // The form already says it is not JSON.
      return []
    }
    return isRecord(parsed)
      ? []
      : [
          {
            field: 'securityContext',
            message: 'Give a JSON object, such as { "role": "catalog" }.',
          },
        ]
  },

  async check(context): Promise<CheckReport> {
    const deployment = new Deployment(context)
    const { environment, count } = await deployment.environment()
    const meta = await deployment.meta(await deployment.token(environment))
    return {
      steps: [
        {
          id: 'reach',
          title: 'Reach Cube Cloud',
          status: 'ok',
          detail: `Deployment ${context.config.deployment ?? ''} has ${plural(count, 'environment')}.`,
        },
        environmentStep(context, environment),
        {
          id: 'token',
          title: 'Get a token that reads metadata',
          status: 'ok',
          detail: `It reads metadata only, for ${TOKEN_SECONDS / 60} minutes.`,
        },
        ...(await readSteps(context, meta)),
      ],
    }
  },

  async *read(context): AsyncIterable<RuntimeMessage> {
    const deployment = new Deployment(context)
    const { environment } = await deployment.environment()
    const build = await deployment.build(environment)
    const last = cursorOf(context.cursor)
    if (build.mark !== null && last?.build === build.mark) {
      // The build the last read saw: the core keeps what that read found.
      yield {
        type: 'end',
        version: last.version,
        complete: true,
        unchanged: true,
        cursor: context.cursor!,
      }
      return
    }
    const meta = await deployment.meta(await deployment.token(environment))
    const { definitions, warnings, complete } = await mapDefinitions(
      meta,
      context.config.domainNames,
    )
    // Warnings first, so a read that stops still names what it left out.
    yield* warnings
    for (const definition of definitions) yield { type: 'definition', definition }
    // The build's hash says the version; with none, the digest of what was read.
    const version = build.hash ?? (await contentDigest(definitions))
    yield {
      type: 'end',
      version,
      complete,
      ...(build.mark === null
        ? {}
        : { cursor: JSON.stringify({ reader: READER, build: build.mark, version }) }),
    }
  },
})
