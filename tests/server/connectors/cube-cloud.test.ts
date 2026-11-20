import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { builtInConnectors } from '../../../src/connectors/index.ts'
import { baseNameOf } from '../../../src/connectors/cube-cloud/mapping.ts'
import { metaAddress, TOKEN_SECONDS } from '../../../src/connectors/cube-cloud/runtime.ts'
import {
  registerConnectors,
  type StoredSource,
} from '../../../src/server/modules/connectors/index.ts'
import { SourceReadError } from '../../../src/server/modules/connectors/types.ts'
import { cubeCloudHost, fixtureMeta, type CubeCloudHost } from './cube-cloud-server.ts'

/*
  Cube Cloud's runtime against a fake Cube Cloud on this machine, through the core as the
  definitions pipeline runs it: where the API key and the metadata token go and what they ask
  for, which environment and build a read takes, what an unchanged build reads, and how it takes
  Cube Cloud's refusals. The conformance kit covers the rest (conformance.test.ts).
*/

let cloud: CubeCloudHost
const connector = registerConnectors(
  builtInConnectors.filter((module) => module.manifest.id === 'cube-cloud'),
  [],
)[0]!

const source = (config: Record<string, unknown> = {}, apiKey = cloud.apiKey): StoredSource => ({
  id: 'cube-cloud',
  name: 'Cube Cloud',
  config: {
    address: cloud.address,
    deployment: cloud.deployment,
    apiAddress: cloud.apiAddress,
    ...config,
  },
  secrets: { apiKey },
})
const read = (config: Record<string, unknown> = {}, cursor: string | null = null) =>
  connector.source(source(config)).read({ cursor })
const failure = async (work: Promise<unknown>) => {
  try {
    await work
  } catch (error) {
    if (error instanceof SourceReadError) return error
    throw error
  }
  throw new Error('It did not fail')
}
const cloudHost = () => new URL(cloud.address).host
const restHost = () => new URL(cloud.apiAddress).host

beforeAll(async () => {
  cloud = await cubeCloudHost()
})
beforeEach(() => {
  cloud.requests.length = 0
})
afterAll(() => cloud.close())

describe('the REST API address', () => {
  it('leads to /v1/meta, however it is pasted', () => {
    const meta = 'https://shop.cubecloudapp.example.test/cubejs-api/v1/meta'
    for (const given of [
      'https://shop.cubecloudapp.example.test/cubejs-api/v1',
      'https://shop.cubecloudapp.example.test/cubejs-api/v1/',
      'https://shop.cubecloudapp.example.test/cubejs-api',
      'https://shop.cubecloudapp.example.test/cubejs-api/v1/load',
      'https://shop.cubecloudapp.example.test/cubejs-api/v1/meta',
    ])
      expect(metaAddress(given), given).toBe(meta)
  })
})

describe('a read', () => {
  it('sends the key to Cube Cloud only, and the token to the REST API only', async () => {
    const snapshot = await read()
    expect(snapshot.definitions.length).toBe(8)
    const [token] = [...cloud.tokens.keys()].slice(-1)
    for (const request of cloud.requests) {
      if (request.server === 'cloud') {
        expect(request.host).toBe(cloudHost())
        expect(request.authorization).toBe(`Bearer ${cloud.apiKey}`)
      } else {
        expect(request.host).toBe(restHost())
        // Cube's REST API takes its token with no scheme in front, and never the key.
        expect(request.authorization).toBe(token)
      }
    }
    expect(cloud.requests.map((r) => `${r.server} ${r.method} ${r.path}`)).toEqual([
      'cloud GET /api/v1/deployments/42/environments?type=production',
      'cloud GET /api/v1/deployments/42/build-status?branchName=main',
      'cloud POST /api/v1/deployments/42/environments/7/tokens-for-meta-sync',
      'rest GET /cubejs-api/v1/meta',
    ])
  })

  it('asks for a token that reads metadata for 5 minutes, as the security context given', async () => {
    await read()
    const post = cloud.requests.find((request) => request.method === 'POST')!
    // No scope is asked for: the token reads metadata, and never private members.
    expect(JSON.parse(post.body)).toEqual({ expires_in: TOKEN_SECONDS, security_context: {} })
    expect(TOKEN_SECONDS).toBe(300)
    await read({ securityContext: '{ "role": "catalog" }' })
    const [, made] = [...cloud.tokens].at(-1)!
    expect(made.securityContext).toEqual({ role: 'catalog' })
  })

  it('reads the environment the settings name, on its own branch', async () => {
    const staging = fixtureMeta()
    staging.cubes = staging.cubes.filter((cube) => cube.name !== 'growth')
    cloud.setMeta('8', staging)
    const snapshot = await read({ environment: '8', apiAddress: cloud.apiAddressOf('8') })
    expect(snapshot.definitions.map((d) => d.ref)).not.toContain('cube:growth.revenue')
    expect(cloud.requests.map((r) => r.path)).toEqual([
      '/api/v1/deployments/42/environments',
      '/api/v1/deployments/42/build-status?branchName=next',
      '/api/v1/deployments/42/environments/8/tokens-for-meta-sync',
      '/env8/cubejs-api/v1/meta',
    ])
    cloud.setMeta('8', fixtureMeta())
  })

  it('says an environment the deployment lacks is for an admin to fix', async () => {
    const error = await failure(read({ environment: '9' }))
    expect(error.warnings[0]).toEqual({
      code: 'cube-cloud.environment_not_found',
      target: 'environment',
    })
    expect(error.errorClass).toBe('config')
  })

  it('finds production and a numbered environment among many, as Cube Cloud pages them', async () => {
    const crowded = await cubeCloudHost()
    try {
      crowded.crowd(5, 2)
      const at = (config: Record<string, unknown> = {}) =>
        connector
          .source({
            id: 'cube-cloud',
            name: 'Cube Cloud',
            config: {
              address: crowded.address,
              deployment: crowded.deployment,
              apiAddress: crowded.apiAddress,
              ...config,
            },
            secrets: { apiKey: crowded.apiKey },
          })
          .read({ cursor: null })
      expect((await at()).definitions.length).toBe(8)
      const snapshot = await at({ environment: '8', apiAddress: crowded.apiAddressOf('8') })
      expect(snapshot.definitions.length).toBe(8)
      const pages = crowded.requests.filter((r) => r.path.includes('/environments?after='))
      expect(pages.length).toBeGreaterThan(1)
    } finally {
      await crowded.close()
    }
  })

  it('leaves out what Cube hides, and every key it does not read', async () => {
    const snapshot = await read()
    const refs = snapshot.definitions.map((d) => d.ref)
    expect(refs).not.toContain('cube:orders.revenue')
    expect(refs).not.toContain('cube:sales.margin')
    expect(JSON.stringify(snapshot)).not.toContain('example_orders')
  })
})

describe('the build status', () => {
  it('ends a read of an unchanged build without a token or the metadata', async () => {
    const first = await read()
    expect(first.cursor).toBeDefined()
    expect(first.sourceVersion).toBe('files-main-1')
    cloud.requests.length = 0
    const again = await read({}, first.cursor)
    expect(again).toMatchObject({ unchanged: true, complete: true, definitions: [] })
    expect(again.sourceVersion).toBe('files-main-1')
    expect(cloud.requests.map((r) => r.path)).toEqual([
      '/api/v1/deployments/42/environments?type=production',
      '/api/v1/deployments/42/build-status?branchName=main',
    ])
  })

  it('reads a new build whole', async () => {
    const first = await read()
    cloud.build('main', { filesHash: 'files-main-2', lastHash: 'build-2' })
    const next = await read({}, first.cursor)
    expect(next.unchanged).toBeUndefined()
    expect(next.sourceVersion).toBe('files-main-2')
    expect(next.definitions.length).toBe(8)
    cloud.build('main', { filesHash: 'files-main-1', lastHash: 'build-1' })
  })

  it('reads every time when the build status gives no hash', async () => {
    cloud.build('main', { filesHash: null, lastHash: null })
    const first = await read()
    expect(first.cursor).toBeUndefined()
    expect(first.sourceVersion).toMatch(/^[a-f0-9]{64}$/)
    cloud.build('main', { filesHash: 'files-main-1', lastHash: 'build-1' })
  })

  it('gives no cursor while the build is not done', async () => {
    cloud.build('main', { filesHash: 'files-main-2', lastHash: 'build-2', status: 'running' })
    const first = await read()
    expect(first.cursor).toBeUndefined()
    cloud.build('main', { filesHash: 'files-main-1', lastHash: 'build-1' })
  })

  it('reads every time on a branch it cannot ask the build status about', async () => {
    cloud.renameBranch('7', 'main branch')
    const first = await read()
    expect(first.cursor).toBeUndefined()
    expect(cloud.requests.some((r) => r.path.includes('/build-status'))).toBe(false)
    expect((await read({}, first.cursor)).unchanged).toBeUndefined()
    cloud.renameBranch('7', 'main')
  })

  it('reads the metadata of a branch that has no build yet', async () => {
    cloud.dropBuild('main')
    const first = await read()
    expect(first.definitions.length).toBe(8)
    expect(first.cursor).toBeUndefined()
    cloud.build('main', { filesHash: 'files-main-1', lastHash: 'build-1' })
  })

  it('never trusts a cursor left under other settings', async () => {
    const first = await read()
    cloud.requests.length = 0
    const other = await read({ domainNames: { commerce: 'finance' } }, first.cursor)
    expect(other.unchanged).toBeUndefined()
    expect(cloud.requests.some((r) => r.path === '/cubejs-api/v1/meta')).toBe(true)
  })
})

describe("Cube Cloud's refusals", () => {
  it('says a refused key needs a new one', async () => {
    const error = await failure(connector.source(source({}, 'not-the-key')).read({ cursor: null }))
    expect(error.warnings[0]).toEqual({ code: 'unauthorized', target: 'apiKey' })
    expect(error.errorClass).toBe('config')
  })

  it('says a key limited to another deployment is refused', async () => {
    const error = await failure(read({ deployment: '43' }))
    expect(error.warnings[0]).toEqual({ code: 'unauthorized', target: 'apiKey' })
  })

  it('says a token the REST API refuses means the wrong REST API address', async () => {
    const error = await failure(read({ apiAddress: cloud.apiAddressOf('8') }))
    expect(error.warnings[0]).toEqual({ code: 'cube-cloud.token_refused', target: 'apiAddress' })
    expect(error.errorClass).toBe('config')
  })

  it('waits as long as Cube Cloud asks when it gets too many requests', async () => {
    cloud.refuse(/build-status$/, 429, { retryAfter: '90' })
    const error = await failure(read())
    expect(error.warnings[0]).toEqual({ code: 'rate_limited', target: 'apiKey' })
    expect(error).toMatchObject({ errorClass: 'transient', retryAfter: 90 })
  })

  it('tries again later when Cube Cloud fails', async () => {
    cloud.refuse(/environments$/, 503)
    const error = await failure(read())
    expect(error.warnings[0]).toEqual({ code: 'unreachable', target: 'apiKey' })
    expect(error.errorClass).toBe('transient')
  })

  it('passes on none of what Cube Cloud says about a failure', async () => {
    cloud.refuse(/tokens-for-meta-sync$/, 400)
    const error = await failure(read())
    expect(error.warnings).toEqual([{ code: 'fetch_failed', target: 'apiKey' }])
    expect(JSON.stringify(error.warnings)).not.toContain('Planned refusal')
  })
})

describe('a check', () => {
  it('says what it reached, the environment, the token and what the metadata holds', async () => {
    const report = await connector.check(source({ domainNames: { commerce: 'finance' } }))
    expect(report.steps.map((step) => [step.id, step.status, step.detail])).toEqual([
      ['reach', 'ok', 'Found deployment 42.'],
      ['environment', 'ok', 'Read the production environment, branch main.'],
      ['token', 'ok', 'It reads metadata only, for 5 minutes.'],
      ['read', 'ok', '5 metrics and 3 dimensions in 4 views.'],
      ['domains', 'warning', '2 views name no domain.'],
    ])
  })

  it('warns when the REST API address is not the environment’s', async () => {
    cloud.showRestAddress('https://another.cubecloudapp.example.test/cubejs-api/v1')
    const report = await connector.check(source())
    expect(report.steps[1]).toMatchObject({
      id: 'environment',
      status: 'warning',
      fix: 'Copy the REST API address Cube Cloud shows for this environment.',
    })
    cloud.showRestAddress(null)
  })

  it('shows why when the REST API address is another environment’s, instead of failing', async () => {
    const report = await connector.check(source({ apiAddress: cloud.apiAddressOf('8') }))
    expect(report.steps.map((step) => [step.id, step.status])).toEqual([
      ['reach', 'ok'],
      ['environment', 'warning'],
      ['token', 'ok'],
      ['read', 'failed'],
    ])
    expect(report.steps[1]!.detail).toContain('another REST API address')
    expect(report.steps[3]!.fix).toContain('REST API address')
  })
})

describe("a view member's own name", () => {
  it('is the name after the prefix its view joins it with', () => {
    expect(baseNameOf('marketing.orders_country', 'orders.country')).toBe('country')
    expect(baseNameOf('marketing.orders_income', 'orders.revenue')).toBe('income')
    expect(baseNameOf('sales.country', 'orders.country')).toBeNull()
    expect(baseNameOf('sales.country', null)).toBeNull()
  })
})
