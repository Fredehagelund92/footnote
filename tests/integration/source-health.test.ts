import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildApp } from '../../src/server/app.ts'
import { createDatabase } from '../../src/server/db/database.ts'
import { localRoles } from '../../src/server/db/roles.ts'
import {
  ConnectorRegistry,
  connectorSyncJob,
  createCubeSource,
} from '../../src/server/modules/connectors/index.ts'
import { createJobRunner } from '../../src/server/modules/jobs/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { testDatabase } from './support.ts'

/*
  Source health (CON-104, CON-504, CON-516) and the hourly refresh (CON-506), as the service runs
  them: the `connectors.sync` job on pg-boss under the API role, run as the service starts and by
  an administrator from the operations view, which then shows the last read, its warnings and the
  domain coverage.
*/

const { client, url } = testDatabase()
const apiUrl = (() => {
  const api = new URL(url)
  api.searchParams.set('options', `-c role=${localRoles.api}`)
  return api.href
})()
const fixture = fileURLToPath(new URL('../fixtures/cube/model/model.yml', import.meta.url))
let modelDir = ''
const logger = createLogger({ level: 'silent' })
const database = createDatabase(apiUrl, logger)
let app: ReturnType<typeof buildApp>
let auth: Record<string, string> = {}
let jobs: ReturnType<typeof createJobRunner>

beforeAll(async () => {
  modelDir = await mkdtemp(join(tmpdir(), 'footnote-health-model-'))
  await copyFile(fixture, join(modelDir, 'model.yml'))
  const sources = new ConnectorRegistry([createCubeSource({ modelDir })])
  jobs = createJobRunner({
    connectionString: apiUrl,
    database,
    logger,
    jobs: [connectorSyncJob(sources)],
    pollingIntervalSeconds: 0.5,
    retryDelaySeconds: 1,
  })
  app = buildApp({
    database,
    logger,
    jobs,
    sources,
    devPeople: [{ email: 'ops@example.test', name: 'Ops', roles: ['administrator'] }],
  })
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { origin: 'http://localhost', 'x-heed-csrf': 'dev-sign-in' },
    payload: { email: 'ops@example.test' },
  })
  expect(login.statusCode, login.body).toBe(200)
  auth = {
    cookie: login.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    origin: 'http://localhost',
    'x-heed-csrf': login.json<{ csrfToken: string }>().csrfToken,
  }
}, 30_000)
afterAll(async () => {
  await app.close()
  await rm(modelDir, { recursive: true, force: true })
}, 30_000)

/** Starts a refresh as an administrator would, and returns the job's summary once it finished. */
async function syncFromOperations(): Promise<Record<string, unknown>> {
  for (;;) {
    const queued = await app.inject({
      method: 'POST',
      url: '/api/v1/operations/jobs/connectors.sync/run',
      headers: auth,
    })
    // A scheduled run may hold the queue for a moment.
    if (queued.statusCode === 409) {
      await sleep(100)
      continue
    }
    expect(queued.statusCode, queued.body).toBe(202)
    const { id } = queued.json<{ id: string }>()
    for (;;) {
      const { rows } = await client.query<{ state: string; output: Record<string, unknown> }>(
        'select state, output from pgboss.job where id = $1',
        [id],
      )
      if (rows[0]?.state === 'completed') return rows[0].output
      expect(rows[0]?.state).not.toBe('failed')
      await sleep(100)
    }
  }
}
async function overview() {
  const response = await app.inject({ method: 'GET', url: '/api/v1/operations', headers: auth })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ jobs: { name: string }[]; connectors: Record<string, unknown>[] }>()
}

/** The setup checklist as the Inbox reads it. */
async function setup() {
  const response = await app.inject({ method: 'GET', url: '/api/v1/setup', headers: auth })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ serverSource: unknown; steps: { id: string; done: boolean }[] }>()
}

it("reads the server's model folder as it starts, and setup knows the read is on its way", async () => {
  // Before the runner starts, nothing has read the folder: step 3 waits for it.
  expect((await setup()).serverSource).toEqual({ id: 'cube', state: 'reading' })
  await jobs.start()
  // Nobody asks: the start's own run reads the folder, minutes before the five-minute schedule.
  for (let tries = 0; tries < 300; tries++) {
    const { rows } = await client.query<{ status: string }>(
      `select status::text from connector_snapshots where connector_id = 'cube'`,
    )
    if (rows.length) {
      expect(rows).toEqual([{ status: 'ok' }])
      const after = await setup()
      expect(after.serverSource).toEqual({ id: 'cube', state: 'read' })
      // Its names wait to be published: the step is not done by the read alone.
      expect(after.steps.find((step) => step.id === 'definitions')).toEqual({
        id: 'definitions',
        done: false,
      })
      return
    }
    await sleep(100)
  }
  expect.fail('The model folder was not read at start')
}, 60_000)

it('refreshes from the operations view and shows the health of the source', async () => {
  const jobs = (await overview()).jobs.map((job) => job.name)
  expect(jobs).toContain('connectors.sync')
  const summary = await syncFromOperations()
  expect(summary).toMatchObject({
    connectors: {
      cube: { status: 'ok', definitionsSeen: 7, flags: { raised: 0, cleared: 0 } },
    },
  })
  const [cube] = (await overview()).connectors
  expect(cube).toMatchObject({
    id: 'cube',
    status: 'ok',
    lastError: null,
    lastRead: { status: 'ok' },
    definitions: { current: 7, missing: 0 },
    domainCoverage: { source: 3, override: 0, none: 2 },
    flaggedItems: 0,
    staleLinks: 0,
  })
  // CON-516: each view without meta.domain is named, so the gap can be closed view by view.
  expect((cube!.lastRead as { warnings: unknown[] }).warnings).toEqual([
    { code: 'missing_domain', target: 'marketing' },
    { code: 'missing_domain', target: 'operations' },
  ])
  // Sources: what the source is, how this server reads it, what it holds by view, its reads.
  expect(cube).toMatchObject({
    kind: 'definition_source',
    tool: 'Cube',
    settingKeys: ['sources.cube_model_url'],
    server: {
      settings: [
        { key: 'model_folder', variable: 'CUBE_MODEL_DIR', value: modelDir },
        { key: 'domain_overrides', variable: 'HEED_DOMAIN_OVERRIDES', value: null },
        { key: 'renames', variable: 'CUBE_RENAMES_FILE', value: null },
        { key: 'views', variable: 'CUBE_VIEWS_FILE', value: null },
      ],
    },
    renames: [],
    // The start's read, then this one.
    recentReads: [
      { status: 'ok', definitionsSeen: 7, warnings: 2 },
      { status: 'ok', definitionsSeen: 7, warnings: 2 },
    ],
  })
  const view = (name: string, metrics: number, dimensions: number, domains: string[]) => ({
    name,
    metrics,
    dimensions,
    domains,
    withoutDomain: domains.length ? 0 : metrics,
    fromServer: 0,
    modelFile: 'model.yml',
  })
  // A member's own meta.domain counts for it: sales holds finance twice and commerce once.
  expect(cube!.views).toEqual([
    view('growth', 1, 0, ['marketing']),
    view('marketing', 1, 1, []),
    view('operations', 1, 0, []),
    view('sales', 2, 1, ['finance', 'commerce']),
  ])
}, 60_000)

it('shows a failed read beside the data that is still served', async () => {
  await writeFile(join(modelDir, 'model.yml'), 'cubes: [')
  const summary = await syncFromOperations()
  expect(summary).toMatchObject({ connectors: { cube: { status: 'failed' } } })
  const [cube] = (await overview()).connectors
  expect(cube).toMatchObject({
    status: 'ok',
    lastError: 'Definition source could not be read',
    lastRead: {
      status: 'failed',
      // Why it failed comes first: no file left that the compiler could read.
      warnings: [
        { code: 'no_model_files', target: 'model' },
        { code: 'unreadable_file', target: 'model.yml' },
      ],
    },
    definitions: { current: 7, missing: 0 },
  })
  // The failed read heads the reads, and the views are what the good read left.
  expect((cube!.recentReads as { status: string }[]).map((read) => read.status)).toEqual([
    'failed',
    'ok',
    'ok',
  ])
  expect((cube!.views as unknown[]).length).toBeGreaterThan(0)
}, 60_000)

it('reports a source with no good read as failed, not as on its way', async () => {
  expect((await setup()).serverSource).toEqual({ id: 'cube', state: 'read' })
  await client.query(
    `update connector_snapshots set status = 'failed' where connector_id = 'cube' and status <> 'failed'`,
  )
  expect((await setup()).serverSource).toEqual({ id: 'cube', state: 'failed' })
}, 60_000)
