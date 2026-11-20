import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Writable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SourceCheck, SourceSettings } from '../../src/contract/sources.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import {
  ConnectorRegistry,
  connectorSyncJob,
  createWorkspaceSources,
  openLocalSecretStore,
} from '../../src/server/modules/connectors/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import {
  cubeCloudHost,
  fixtureMeta,
  type CubeCloudHost,
  type CubeMeta,
} from '../server/connectors/cube-cloud-server.ts'
import { gitHost, type GitHost } from '../server/connectors/git-server.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { accept, foundation, people, publish, version } from './fixtures.ts'
import { apiDatabase, queueReads, testDatabase, transaction } from './support.ts'

/*
  Cube Cloud end to end on the real service and PostgreSQL 18, with a fake Cube Cloud on this
  machine: an admin tests a deployment and adds it, its API key stays in the secret store and its
  metadata token nowhere, and the sources' job reads it through the connector's runtime and the
  definitions pipeline. A build that has not changed is not read again. A changed member flags the
  live items that rely on it, a member that left marks them, and a read never publishes (I-2).
  A model that moves from Cube model files keeps its `cube:` refs: once the files source is
  disconnected, Cube Cloud takes them over without flagging any item (CON-117).
*/

const GIT_TOKEN = 'cube-cloud-it-git-token-4f1a9c'
const { client, url } = testDatabase()
const database = apiDatabase(url)
const logged: string[] = []
const logger = createLogger({
  level: 'trace',
  destination: new Writable({
    write(chunk: Buffer, _encoding, done) {
      logged.push(chunk.toString())
      done()
    },
  }),
})
const clock = systemClock('2026-11-20')
const secretsDir = await mkdtemp(join(tmpdir(), 'footnote-cube-cloud-'))
const store = await openLocalSecretStore(join(secretsDir, 'store'))
const registry = new ConnectorRegistry([], { secrets: store })
const app = buildApp({
  database,
  jobs: idleJobs(),
  sources: registry,
  workspaceSources: createWorkspaceSources({ secrets: store, registry }),
  logger,
  clock,
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
})
let cloud: CubeCloudHost
let git: GitHost
type Who = keyof typeof people
const headers: Partial<Record<Who, Record<string, string>>> = {}

const call = (method: 'GET' | 'POST' | 'PUT', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
const ok = async <T>(
  response: Promise<{ statusCode: number; body: string; json: <U>() => U }>,
  status = 200,
) => {
  const r = await response
  expect(r.statusCode, r.body).toBe(status)
  return r.json<T>()
}

/** One run of the sources' job, with these sources made due. */
async function read(...ids: string[]) {
  await queueReads(client, ids)
  const result = (await connectorSyncJob(registry, { clock }).run({
    database,
    logger,
    signal: new AbortController().signal,
  })) as { connectors: Record<string, Record<string, unknown>> }
  return result.connectors
}

/** What a read could publish, decide or suggest: none of it moves. */
const published = async () =>
  (
    await client.query(
      `select (select max(seq) from editions)::text as editions,
              (select count(*) from item_versions)::text as versions,
              (select count(*) from item_version_service)::text as served,
              (select count(*) from decisions)::text as decisions,
              (select count(*) from proposals)::text as proposals`,
    )
  ).rows[0] as Record<string, string>

/** What the database keeps of sources, as text: rows, the history log, retries, snapshots. */
async function rows(): Promise<string> {
  const rows: string[] = []
  for (const table of [
    'connectors',
    'audit_log',
    'idempotency_keys',
    'connector_snapshots',
    'definitions',
    'outbox_events',
  ])
    rows.push(JSON.stringify((await client.query(`select * from ${table}`)).rows))
  return rows.join('\n')
}

/** Every place a secret could leak to, as text: what the database keeps, and the logs. */
const kept = async () => [await rows(), ...logged].join('\n')

/** The flags on an item's live version, by name. */
const flags = async (item: string) =>
  (
    await client.query<{ flag: string }>(
      "select flag::text from v_overlay_on where item_id = $1 and kind = 'flag_on' order by flag",
      [item],
    )
  ).rows.map((row) => row.flag)

/** A live Finance note that relies on a definition, at the mark it has now. */
async function noteOn(ref: string, title: string) {
  const [{ mark }] = (
    await client.query<{ mark: string }>(
      'select change_mark as mark from definitions where ref = $1',
      [ref],
    )
  ).rows as [{ mark: string }]
  return transaction(client, async () => {
    const v = await version(client, { area: 'finance', owner: people.owner, title })
    await client.query('insert into item_version_refs values ($1, $2, $3)', [v.id, ref, mark])
    await accept(client, v.id)
    await publish(client, v.id)
    return v.item
  })
}

const config = () => ({
  address: cloud.address,
  deployment: cloud.deployment,
  apiAddress: cloud.apiAddress,
  domainNames: { commerce: 'finance' },
})

/** The model as Cube Cloud gives it after a new build of main. */
function rebuilt(build: number, change: (meta: CubeMeta) => CubeMeta) {
  cloud.setMeta('7', change(fixtureMeta()))
  cloud.build('main', { filesHash: `files-main-${build}`, lastHash: `build-${build}` })
}

beforeAll(async () => {
  await foundation(client)
  for (const name of Object.keys(people) as Who[]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin: 'http://localhost', 'x-footnote-csrf': 'dev-sign-in' },
      payload: { email: `${name}@example.test` },
    })
    expect(response.statusCode, response.body).toBe(200)
    headers[name] = {
      origin: 'http://localhost',
      cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-footnote-csrf': response.json<{ csrfToken: string }>().csrfToken,
    }
  }
  cloud = await cubeCloudHost()
  git = await gitHost({ token: GIT_TOKEN })
  await git.repository('analytics', {
    'cube/model/model.yml': await readFile(
      new URL('../fixtures/cube/model/model.yml', import.meta.url),
      'utf8',
    ),
  })
}, 120_000)
afterAll(async () => {
  await app.close()
  await cloud.close()
  await git.close()
  await rm(secretsDir, { recursive: true, force: true })
})

let filesId = ''
let cloudId = ''
let operations = ''

describe('a model that moves from Cube model files to Cube Cloud', () => {
  it('is read from the files first, and a live item relies on one of its members', async () => {
    const files = await ok<SourceSettings>(
      call('POST', '/sources', 'admin', {
        type: 'cube',
        name: 'Analytics model',
        config: {
          repository: git.address('analytics'),
          ref: 'main',
          folder: 'cube/model',
          domainNames: { commerce: 'finance' },
        },
        secrets: { token: GIT_TOKEN },
        reason: 'Read the analytics model from Git',
      }),
      201,
    )
    filesId = files.id
    expect((await read(filesId))[filesId]).toMatchObject({ status: 'ok', definitionsSeen: 7 })
    operations = await noteOn('cube:operations.revenue', 'Operations revenue counts returns')
    expect(await flags(operations)).toEqual([])
  }, 180_000)

  it('is tested in Cube Cloud with what a read would hold, and the test keeps nothing', async () => {
    const before = await rows()
    const check = await ok<SourceCheck>(
      call('POST', '/sources/test', 'admin', {
        type: 'cube-cloud',
        config: config(),
        secrets: { apiKey: cloud.apiKey },
      }),
    )
    // The refs the files source reads are taken: a test says so, as a read would, and is in part.
    expect(check).toMatchObject({ ok: true, complete: false, metrics: 5, dimensions: 3 })
    expect(check.warnings).toContainEqual({ code: 'taken', target: 'cube:operations.revenue' })
    expect(check.steps.map((step) => [step.id, step.status])).toEqual([
      ['reach', 'ok'],
      ['environment', 'ok'],
      ['token', 'ok'],
      ['read', 'ok'],
      ['domains', 'warning'],
    ])
    expect(JSON.stringify(check)).not.toContain(cloud.apiKey)
    const refused = await ok<SourceCheck>(
      call('POST', '/sources/test', 'admin', {
        type: 'cube-cloud',
        config: config(),
        secrets: { apiKey: 'not-the-api-key' },
      }),
    )
    expect(refused).toMatchObject({
      ok: false,
      warnings: [{ code: 'unauthorized', target: 'apiKey' }],
    })
    expect(await rows()).toBe(before)
  }, 120_000)

  it('is added beside the files, and leaves out each ref the files source holds', async () => {
    const added = await ok<SourceSettings>(
      call('POST', '/sources', 'admin', {
        type: 'cube-cloud',
        name: 'Cube Cloud',
        config: config(),
        secrets: { apiKey: cloud.apiKey },
        reason: 'The model moved to Cube Cloud',
      }),
      201,
    )
    cloudId = added.id
    expect(added).toMatchObject({ type: 'cube-cloud', secrets: [{ key: 'apiKey', set: true }] })
    const result = (await read(cloudId))[cloudId]
    // Only the member the files do not have is its own; the rest stay with the files.
    expect(result).toMatchObject({ status: 'partial', definitionsSeen: 1 })
    const owners = (
      await client.query<{ connector_id: string; n: number }>(
        `select connector_id, count(*)::int as n from definitions where connector_id = any($1)
          group by connector_id order by n`,
        [[cloudId, filesId]],
      )
    ).rows
    expect(owners).toEqual([
      { connector_id: cloudId, n: 1 },
      { connector_id: filesId, n: 7 },
    ])
  }, 120_000)

  it('takes them over once the files source is disconnected, and flags no item for it', async () => {
    await ok(
      call('POST', `/sources/${filesId}/disconnect`, 'admin', {
        reason: 'The model moved to Cube Cloud',
      }),
    )
    const before = await published()
    const result = (await read(cloudId))[cloudId]
    expect(result).toMatchObject({ status: 'ok', definitionsSeen: 8 })
    const refs = (
      await client.query<{ ref: string }>(
        'select ref from definitions where connector_id = $1 order by ref',
        [cloudId],
      )
    ).rows.map((row) => row.ref)
    expect(refs).toContain('cube:operations.revenue')
    // The two connectors compute marks differently: the new ones are a new baseline, told once.
    expect(await flags(operations)).toEqual([])
    const [snapshot] = (
      await client.query<{ rebaselined: number }>(
        `select rebaselined from connector_snapshots where connector_id = $1
          order by fetched_at desc limit 1`,
        [cloudId],
      )
    ).rows
    expect(snapshot!.rebaselined).toBe(7)
    const told = await client.query(
      "select area_id from outbox_events where topic = 'source.marks_rebaselined' and aggregate_id = $1",
      [cloudId],
    )
    expect(told.rows).toEqual([{ area_id: 'finance' }])
    expect(await published()).toEqual(before)
  }, 120_000)
})

describe('what a read of Cube Cloud does', () => {
  it('keeps its key in the secret store, and the metadata token nowhere', async () => {
    const text = await kept()
    expect(text).not.toContain(cloud.apiKey)
    for (const token of cloud.tokens.keys()) expect(text).not.toContain(token)
    const [{ ref }] = (
      await client.query<{ ref: string }>(
        'select secret_ref as ref from connectors where id = $1',
        [cloudId],
      )
    ).rows as [{ ref: string }]
    expect(await store.read(ref)).toEqual({ apiKey: cloud.apiKey })
  })

  it('reads an unchanged build no further than its status, and changes nothing', async () => {
    cloud.requests.length = 0
    const marks = await client.query('select ref, change_mark from definitions order by ref')
    expect((await read(cloudId))[cloudId]).toMatchObject({ status: 'ok' })
    expect(cloud.requests.map((r) => r.path)).toEqual([
      '/api/v1/deployments/42/environments',
      '/api/v1/deployments/42/build-status?branchName=main',
    ])
    expect(
      (await client.query('select ref, change_mark from definitions order by ref')).rows,
    ).toEqual(marks.rows)
  }, 120_000)

  it('flags the live items that rely on a member whose meaning changed, and never publishes', async () => {
    const sales = await noteOn('cube:sales.revenue', 'Sales revenue is booked on shipping')
    const growth = await noteOn('cube:growth.revenue', 'Growth revenue is net of discounts')
    const before = await published()
    // Revenue is now averaged in the sales view: its metadata says so.
    rebuilt(2, (meta) => ({
      ...meta,
      cubes: meta.cubes.map((cube) =>
        cube.name === 'sales'
          ? {
              ...cube,
              measures: cube.measures.map((m) =>
                m.name === 'sales.revenue' ? { ...m, aggType: 'avg' } : m,
              ),
            }
          : cube,
      ),
    }))
    expect((await read(cloudId))[cloudId]).toMatchObject({ status: 'ok', definitionsSeen: 8 })
    expect(await flags(sales)).toEqual(['needs_check'])
    expect(await flags(growth)).toEqual([])
    expect(await flags(operations)).toEqual([])
    expect(await published()).toEqual(before)

    // The growth view leaves the model: its member is missing, and the note on it is marked.
    rebuilt(3, (meta) => ({ ...meta, cubes: meta.cubes.filter((cube) => cube.name !== 'growth') }))
    expect((await read(cloudId))[cloudId]).toMatchObject({ status: 'ok', definitionsSeen: 7 })
    expect(await flags(growth)).toEqual(['source_missing'])
    const [missing] = (
      await client.query<{ missing: boolean }>(
        "select missing_since_snapshot is not null as missing from definitions where ref = 'cube:growth.revenue'",
      )
    ).rows
    expect(missing).toEqual({ missing: true })
    expect(await published()).toEqual(before)
  }, 180_000)

  it('changes nothing when Cube Cloud refuses the key, and says it needs a new one', async () => {
    const marks = async () =>
      (
        await client.query<Record<string, unknown>>(
          'select ref, change_mark, missing_since_snapshot from definitions order by ref',
        )
      ).rows
    const before = await marks()
    // An admin revoked the key in Cube Cloud.
    cloud.refuse(/environments$/, 401)
    rebuilt(4, (meta) => meta)
    const result = (await read(cloudId))[cloudId]
    expect(result).toMatchObject({ status: 'failed' })
    const [failed] = (
      await client.query<{ warnings: unknown }>(
        `select warnings from connector_snapshots where connector_id = $1
          order by fetched_at desc limit 1`,
        [cloudId],
      )
    ).rows
    expect(failed!.warnings).toEqual([{ code: 'unauthorized', target: 'apiKey' }])
    expect(await marks()).toEqual(before)
  }, 120_000)
})
