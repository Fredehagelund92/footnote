import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/*
  Cube Cloud on this machine for tests: the few parts of its API the connector uses (a deployment's
  environments, its build status and `tokens-for-meta-sync`), and a deployment's REST API that
  answers `/v1/meta`, over plain http on 127.0.0.1, each on a port of its own. Its API key and
  tokens are invented when it starts and live in memory only: no real key, token or deployment is
  ever in a test, a fixture or a log.

  The API key is limited to one deployment, as Cube Cloud lets an admin limit one. A token reads
  `/v1/meta` of the environment it was made for until it expires, and nothing else. Every request
  is recorded, so a test can prove where the key and the token went and that nothing was written.
*/

/** The invented model's `/v1/meta`, as Cube Cloud would answer it (tests/fixtures/cube-cloud). */
export const fixtureMeta = (): CubeMeta =>
  JSON.parse(
    readFileSync(new URL('../../fixtures/cube-cloud/meta.json', import.meta.url), 'utf8'),
  ) as CubeMeta

export interface CubeMeta {
  cubes: CubeEntry[]
  compilerId?: string
}
export interface CubeEntry {
  name: string
  measures: Record<string, unknown>[]
  dimensions: Record<string, unknown>[]
  [key: string]: unknown
}

export interface CubeCloudRequest {
  /** Which of the two it reached: Cube Cloud's API, or the deployment's REST API. */
  server: 'cloud' | 'rest'
  /** The host it was sent to, with its port. */
  host: string
  method: string
  path: string
  authorization: string | null
  body: string
}

/** A refusal the next requests to a path get, to test how a read takes it. */
interface Planned {
  path: RegExp
  status: number
  retryAfter?: string
  times: number
}

interface Environment {
  id: string
  type: 'production' | 'staging' | 'development'
  branch: string
}

/** A meta-sync token Cube Cloud made: the environment it reads and until when. */
interface Token {
  environment: string
  expiresAt: number
  securityContext: unknown
}

const listen = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/** Starts the fake Cube Cloud, with one deployment, its production and staging environments. */
export async function cubeCloudHost({ deployment = 42 }: { deployment?: number } = {}) {
  const apiKey = `cube-cloud-key-${randomBytes(12).toString('hex')}`
  const environments: Environment[] = [
    { id: '7', type: 'production', branch: 'main' },
    { id: '8', type: 'staging', branch: 'next' },
  ]
  const metas = new Map<string, unknown>(environments.map((e) => [e.id, fixtureMeta()]))
  const builds = new Map<string, { filesHash: string | null; lastHash: string | null }>(
    environments.map((e) => [e.branch, { filesHash: `files-${e.branch}-1`, lastHash: `build-1` }]),
  )
  const tokens = new Map<string, Token>()
  const requests: CubeCloudRequest[] = []
  const planned: Planned[] = []
  let clock = Date.parse('2026-11-20T06:00:00Z')
  let rest = ''
  /** The REST API address its environments say, when a test makes it another. */
  let shownRest: string | null = null

  const send = (res: ServerResponse, status: number, body: unknown, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers })
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  }
  const bodyOf = async (req: IncomingMessage) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks).toString('utf8')
  }
  /** The refusal planned for a path, if one is: it is answered instead. */
  const refused = (res: ServerResponse, path: string) => {
    const plan = planned.find((candidate) => candidate.times > 0 && candidate.path.test(path))
    if (!plan) return false
    plan.times -= 1
    send(
      res,
      plan.status,
      { error: 'Planned refusal' },
      plan.retryAfter ? { 'retry-after': plan.retryAfter } : {},
    )
    return true
  }

  const cloud = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://cloud')
      const body = await bodyOf(req)
      requests.push({
        server: 'cloud',
        host: req.headers.host ?? '',
        method: req.method ?? '',
        path: url.pathname + url.search,
        authorization: req.headers.authorization ?? null,
        body,
      })
      if (refused(res, url.pathname)) return
      if (req.headers.authorization !== `Bearer ${apiKey}`)
        return send(res, 401, { error: 'Invalid API key' })
      const match = /^\/api\/v1\/deployments\/(\d+)(\/.*)$/.exec(url.pathname)
      if (!match) return send(res, 404, { error: 'Not found' })
      // The key is limited to this one deployment.
      if (Number(match[1]) !== deployment) return send(res, 403, { error: 'Forbidden' })
      const route = match[2]!
      if (req.method === 'GET' && route === '/environments')
        return send(res, 200, {
          items: environments.map((e) => ({
            id: e.id,
            type: e.type,
            branch: e.branch,
            user: null,
            api_credentials: [
              { type: 'rest', version: 1, url: shownRest ?? `${rest}/cubejs-api/v1` },
              { type: 'sql', version: 1, host: 'sql.example.test', port: 5432, database: 'db' },
            ],
          })),
          pageInfo: { hasNextPage: false },
        })
      if (req.method === 'GET' && route === '/build-status') {
        const branch = url.searchParams.get('branchName') ?? 'main'
        const build = builds.get(branch)
        if (!build) return send(res, 404, { error: 'No such branch' })
        return send(res, 200, {
          deploymentId: deployment,
          branchName: branch,
          mode: 'production',
          status: 'done',
          buildJobId: 1,
          deploymentStatus: 'running',
          errorText: null,
          ...build,
          updatedAt: '2026-11-20T05:00:00.000Z',
        })
      }
      const token = /^\/environments\/(\d+)\/tokens-for-meta-sync$/.exec(route)
      if (req.method === 'POST' && token) {
        const environment = environments.find((e) => e.id === token[1])
        if (!environment) return send(res, 404, { error: 'No such environment' })
        let input: { expires_in?: unknown; security_context?: unknown }
        try {
          input = JSON.parse(body) as typeof input
        } catch {
          return send(res, 400, { error: 'Not JSON' })
        }
        const seconds = input.expires_in ?? 3600
        if (typeof seconds !== 'number' || seconds < 1 || seconds > 3600)
          return send(res, 400, { error: 'expires_in is out of range' })
        if (typeof input.security_context !== 'object' || input.security_context === null)
          return send(res, 400, { error: 'security_context is required' })
        const value = `meta-${randomBytes(16).toString('hex')}`
        tokens.set(value, {
          environment: environment.id,
          expiresAt: clock + seconds * 1000,
          securityContext: input.security_context,
        })
        return send(res, 200, {
          data: {
            token: value,
            created_at: new Date(clock).toISOString(),
            expires_at: new Date(clock + seconds * 1000).toISOString(),
            scopes: ['meta'],
            security_context: input.security_context,
          },
        })
      }
      send(res, 404, { error: 'Not found' })
    })()
  })

  const restServer = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://rest')
      requests.push({
        server: 'rest',
        host: req.headers.host ?? '',
        method: req.method ?? '',
        path: url.pathname + url.search,
        authorization: req.headers.authorization ?? null,
        body: await bodyOf(req),
      })
      if (refused(res, url.pathname)) return
      // Something else on the same host, which answers JSON that is not Cube's.
      if (url.pathname === '/elsewhere/v1/meta') return send(res, 200, { hello: 'world' })
      if (url.pathname !== '/cubejs-api/v1/meta') return send(res, 404, { error: 'Not found' })
      // Cube's REST API takes the token as it is, with no scheme in front.
      const token = tokens.get(req.headers.authorization ?? '')
      if (!token || token.expiresAt < clock) return send(res, 403, { error: 'Invalid token' })
      send(res, 200, metas.get(token.environment))
    })()
  })

  const address = await listen(cloud)
  rest = await listen(restServer)

  return {
    /** The Cube Cloud address, as a source's settings name it. */
    address,
    /** The deployment's REST API address, as Cube Cloud shows it. */
    apiAddress: `${rest}/cubejs-api/v1`,
    /** The REST API's host, which answers something that is not Cube's at `/elsewhere`. */
    restAddress: rest,
    deployment: String(deployment),
    apiKey,
    requests,
    /** The tokens it made, by value. */
    tokens,
    /** What `/v1/meta` answers for an environment: `7`, production, or `8`, staging. */
    setMeta(environment: string, meta: unknown) {
      metas.set(environment, meta)
    },
    /** A new build of a branch, with the hashes its status gives. */
    build(branch: string, hashes: { filesHash: string | null; lastHash: string | null }) {
      builds.set(branch, hashes)
    },
    /** Refuses the next `times` requests to a path with a status. */
    refuse(
      path: RegExp,
      status: number,
      { times = 1, retryAfter }: { times?: number; retryAfter?: string } = {},
    ) {
      planned.push({ path, status, times, ...(retryAfter ? { retryAfter } : {}) })
    },
    /** Makes its environments give another REST API address than its own. */
    showRestAddress(address: string | null) {
      shownRest = address
    },
    /** Moves its clock on, so tokens expire. */
    advance(ms: number) {
      clock += ms
    },
    async close() {
      for (const server of [cloud, restServer]) {
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    },
  }
}

export type CubeCloudHost = Awaited<ReturnType<typeof cubeCloudHost>>

/** The model with every key, cube and member in another order, and empty values: the same meaning. */
export function reorderedMeta(meta: CubeMeta): CubeMeta {
  const reverse = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(reverse)
      : typeof value === 'object' && value !== null
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([k, v]) => [k, reverse(v)]),
          )
        : value
  const cubes = (reverse(meta.cubes) as CubeEntry[]).reverse().map((cube) => ({
    ...cube,
    // What only steers Cube's own display: no meaning.
    connectedComponent: 2,
    measures: [...cube.measures].reverse().map((m) => ({ meta: {}, shortTitle: 'Other', ...m })),
    dimensions: [...cube.dimensions]
      .reverse()
      .map((d) => ({ description: null, ...d, suggestFilterValues: false })),
  }))
  return { compilerId: 'another-compiler-id', cubes }
}

/** The model with revenue worked out another way, as `/v1/meta` shows it: averaged, not added up. */
export function withAveragedRevenue(meta: CubeMeta): CubeMeta {
  return {
    ...meta,
    cubes: meta.cubes.map((cube) => ({
      ...cube,
      measures: cube.measures.map((m) =>
        m.aliasMember === 'orders.revenue' ? { ...m, aggType: 'avg' } : m,
      ),
    })),
  }
}

/** The model with one view Cube Cloud describes in a way the connector does not read. */
export function withUnreadableView(meta: CubeMeta): CubeMeta {
  return {
    ...meta,
    cubes: meta.cubes.map((cube) =>
      cube.name === 'operations'
        ? { ...cube, measures: [...cube.measures, { title: 'A member with no name' }] }
        : cube,
    ),
  }
}
