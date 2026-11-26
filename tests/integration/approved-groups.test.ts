import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Feed, NamesRead } from '../../src/contract/inbox.ts'
import type { SourceCheck, SourceSettings } from '../../src/contract/sources.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { raiseAlerts } from '../../src/server/modules/alerts/index.ts'
import { createBundleCache } from '../../src/server/modules/answer/index.ts'
import {
  ConnectorRegistry,
  configuredSources,
  connectorSyncJob,
} from '../../src/server/modules/connectors/index.ts'
import { relayOutbox } from '../../src/server/modules/notifications/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { legacyManifest, type Manifest } from '../server/connectors/dbt-metricflow-fixture.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation } from './fixtures.ts'
import { apiDatabase, queueReads, testDatabase } from './support.ts'

/*
  The approved set of a source the server's configuration selects (CON-119), end to end on the
  real service and PostgreSQL 18: a dbt folder on the server reads every semantic model until an
  administrator chooses some in the app. Then only those are read, each in the domain mapped, the
  history log keeps one line, a model left out keeps its domain for when it is chosen again, and a
  model the file adds later raises one card for the admins, which goes once they choose again.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const logger = createLogger({ level: 'silent' })
const clock = systemClock()
const folder = await mkdtemp(join(tmpdir(), 'footnote-approved-'))
const manifestFile = join(folder, 'semantic_manifest.json')
const registry = new ConnectorRegistry(
  configuredSources({
    cubeModelDir: undefined,
    domainOverridesFile: undefined,
    renamesFile: undefined,
    serverFolders: { 'dbt-metricflow': folder },
  }),
)
const app = buildApp({
  database,
  jobs: idleJobs(),
  sources: registry,
  logger,
  clock,
  devPeople: [
    { name: 'admin', email: 'admin@example.test', roles: [] },
    { name: 'owner', email: 'owner@example.test', roles: [] },
  ],
})
const id = 'dbt-metricflow'
const sessions: Record<string, Record<string, string>> = {}

async function login(name: string) {
  if (sessions[name]) return sessions[name]
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { origin: 'http://localhost', 'x-footnote-csrf': 'dev-sign-in' },
    payload: { email: `${name}@example.test` },
  })
  expect(response.statusCode, response.body).toBe(200)
  return (sessions[name] = {
    origin: 'http://localhost',
    cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    'x-footnote-csrf': response.json<{ csrfToken: string }>().csrfToken,
  })
}
const api = async (method: 'GET' | 'POST' | 'PUT', path: string, payload?: object, as = 'admin') =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...(await login(as)), 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
async function ok<T>(method: 'GET' | 'POST' | 'PUT', path: string, payload?: object) {
  const response = await api(method, path, payload)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<T>()
}

/** The source's settings as Choose reads them. */
const settings = () => ok<SourceSettings>('GET', `/sources/${id}`)
/** Chooses the models it reads, on the revision read now. */
const choose = async (
  scopes: { id: string; domain: string | null }[],
  allGroups: boolean,
  reason = 'Only the validated models',
) =>
  api('PUT', `/sources/${id}/groups`, {
    id,
    revision: (await settings()).revision,
    scopes: scopes.map((scope) => ({ ...scope, title: scope.id })),
    allGroups,
    reason,
  })

/** The file the server's folder holds, then one read of the source. */
async function read(file: Manifest = legacyManifest) {
  await writeFile(manifestFile, JSON.stringify(file))
  await queueReads(client, [id])
  const result = (await connectorSyncJob(registry, { clock }).run({
    database,
    logger,
    signal: new AbortController().signal,
  })) as { connectors: Record<string, { status: string }> }
  return result.connectors[id]!
}
/** The models its current definitions are in, each with the domains they have. */
const current = async () =>
  (
    await client.query<{ model: string; domains: (string | null)[] }>(
      `select split_part(substr(ref, 5), '.', 1) as model,
              array_agg(distinct area_hint) as domains
         from definitions where connector_id = $1 and missing_since_snapshot is null
        group by 1 order by split_part(substr(ref, 5), '.', 1) collate "C"`,
      [id],
    )
  ).rows
const named = async () => {
  const names = await ok<NamesRead>('GET', '/inbox/names')
  return [...new Set(names.names.flatMap((name) => name.definitionRefs))]
}
const history = async () =>
  (
    await client.query<{ action: string; details: Record<string, unknown> }>(
      `select action, details from audit_log where subject_type = 'source' and subject_id = $1
        order by seq`,
      [id],
    )
  ).rows
/** The Alert cards of new models an admin has, by title. */
const cards = async (as = 'admin') => {
  await raiseAlerts(database, clock, createBundleCache(), ['views'])
  await relayOutbox(database)
  const response = await api('GET', '/inbox/feed', undefined, as)
  expect(response.statusCode, response.body).toBe(200)
  return response
    .json<Feed>()
    .cards.flatMap((card) => (card.group === 'alert' && card.rule === 'views' ? [card] : []))
}

/** The fixture with one more semantic model, `stores`: a copy of `customers` under its own name. */
const withStores = (file: Manifest): Manifest => {
  type Model = Manifest['semantic_models'][number] & {
    name: string
    entities: { name: string }[]
  }
  const models = file.semantic_models as Model[]
  const stores = structuredClone(models.find((model) => model.name === 'customers')!)
  stores.name = 'stores'
  for (const entity of stores.entities) entity.name = `store_${entity.name}`
  return { ...file, semantic_models: [...models, stores] }
}

beforeAll(async () => {
  await foundation(client)
  await login('admin')
}, 120_000)
afterAll(async () => {
  await app.close()
  await rm(folder, { recursive: true, force: true })
})

describe("the approved set of the server's own source", () => {
  it('reads every model until an admin chooses, and Choose lists each one', async () => {
    expect(await read()).toMatchObject({ status: 'ok' })
    // dbt's metrics built from two models are in a group of their own.
    expect((await current()).map((row) => row.model)).toEqual(['_shared', 'customers', 'orders'])
    const before = await settings()
    expect(before).toMatchObject({
      origin: 'server',
      allGroups: true,
      scopes: [],
      kept: [],
      config: {},
      secrets: [],
      changedAt: null,
    })
    // Its test reads it as the server set it, every model with what it holds, keeping nothing.
    const test = await ok<SourceCheck>('POST', '/sources/test', {
      id,
      type: id,
      config: {},
      secrets: {},
    })
    expect(test.ok).toBe(true)
    expect(test.scopes?.map((scope) => scope.id)).toEqual(['_shared', 'customers', 'orders'])
    // Test connection on its page: the folder the server names, read as it is saved.
    const check = await ok<SourceCheck>('POST', `/sources/${id}/check`, {})
    expect(check).toMatchObject({
      ok: true,
      steps: [
        {
          id: 'reach',
          title: 'Reach the folder on the server',
          status: 'ok',
          detail: `${folder}, set in FOOTNOTE_SERVER_FOLDERS.`,
        },
      ],
      chosen: { all: true, groups: 3, missing: [] },
    })
  }, 120_000)

  it('reads only the models chosen, each in its domain, with one line in the history log', async () => {
    const response = await choose([{ id: 'orders', domain: 'finance' }], false)
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json<SourceSettings>()).toMatchObject({
      origin: 'server',
      allGroups: false,
      scopes: [{ id: 'orders', title: 'orders', domain: 'finance' }],
    })
    const [line, ...others] = await history()
    expect(others).toEqual([])
    expect(line?.action).toBe('source.changed')
    expect(line?.details).toMatchObject({
      scopes: [{ id: 'orders', title: 'orders', domain: 'finance' }],
      allGroups: false,
      reason: 'Only the validated models',
    })
    expect(await read()).toMatchObject({ status: 'ok' })
    expect(await current()).toEqual([{ model: 'orders', domains: ['finance'] }])
    // The model left out leaves Definitions and the names card, and is never deleted.
    const refs = await named()
    expect(refs.length).toBeGreaterThan(0)
    expect(refs.every((ref) => ref.startsWith('dbt:orders.'))).toBe(true)
    const { rows } = await client.query<{ n: number }>(
      `select count(*)::int as n from definitions
        where connector_id = $1 and ref like 'dbt:customers.%' and missing_since_snapshot is not null`,
      [id],
    )
    expect(rows[0]!.n).toBeGreaterThan(0)
    // Its row keeps the set the admin chose, not what the read was narrowed to.
    expect((await settings()).scopes).toEqual([
      { id: 'orders', title: 'orders', domain: 'finance' },
    ])
    // Its test reads every model, and finds the one chosen there.
    expect((await ok<SourceCheck>('POST', `/sources/${id}/check`, {})).chosen).toEqual({
      all: false,
      groups: 1,
      missing: [],
    })
  }, 120_000)

  it('keeps the domain of a model left out, for when it is chosen again', async () => {
    expect(
      (
        await choose(
          [
            { id: 'orders', domain: 'finance' },
            { id: 'customers', domain: 'marketing' },
          ],
          false,
          'Customers are validated too',
        )
      ).statusCode,
    ).toBe(200)
    expect(
      (await choose([{ id: 'orders', domain: 'finance' }], false, 'Customers are not validated'))
        .statusCode,
    ).toBe(200)
    expect((await settings()).kept).toEqual([
      { id: 'customers', title: 'customers', domain: 'marketing' },
    ])
    // Chosen again, it is read in its domain, and no longer kept aside.
    expect(
      (
        await choose(
          [
            { id: 'orders', domain: 'finance' },
            { id: 'customers', domain: 'marketing' },
          ],
          false,
          'Customers are validated again',
        )
      ).statusCode,
    ).toBe(200)
    expect((await settings()).kept).toEqual([])
    expect(await read()).toMatchObject({ status: 'ok' })
    expect(await current()).toEqual([
      { model: 'customers', domains: ['marketing'] },
      { model: 'orders', domains: ['finance'] },
    ])
    expect((await history()).map((line) => line.action)).toEqual(
      Array.from({ length: 4 }, () => 'source.changed'),
    )
  }, 120_000)

  it('refuses a change on a revision someone else saved over, and a domain it does not have', async () => {
    const stale = (await settings()).revision - 1
    const conflict = await api('PUT', `/sources/${id}/groups`, {
      id,
      revision: stale,
      scopes: [{ id: 'orders', title: 'orders', domain: 'finance' }],
      allGroups: false,
      reason: 'Late',
    })
    expect(conflict.statusCode, conflict.body).toBe(409)
    const unknown = await choose([{ id: 'orders', domain: 'nowhere' }], false)
    expect(unknown.statusCode, unknown.body).toBe(422)
    // Only an admin chooses in this slice.
    const owner = await api(
      'PUT',
      `/sources/${id}/groups`,
      {
        id,
        revision: (await settings()).revision,
        scopes: [],
        allGroups: true,
        reason: 'Mine',
      },
      'owner',
    )
    expect(owner.statusCode).toBe(403)
  }, 120_000)

  it('raises one card for the admins when the file adds a model not chosen, until they choose', async () => {
    expect((await choose([{ id: 'orders', domain: 'finance' }], false)).statusCode).toBe(200)
    expect(await read()).toMatchObject({ status: 'ok' })
    // The model the admin left out is no news.
    expect(await cards()).toEqual([])
    expect(await read(withStores(legacyManifest))).toMatchObject({ status: 'ok' })
    const [card, ...more] = await cards()
    expect(more).toEqual([])
    expect(card).toMatchObject({
      title: 'dbt MetricFlow definitions: 1 new view not chosen (stores)',
      subject: { connector: id },
    })
    // Owners are not told: the approved set is the admins' in this slice.
    expect(await cards('owner')).toEqual([])
    // Nothing of the new model is read meanwhile.
    expect((await current()).map((row) => row.model)).toEqual(['orders'])
    // The admins choose again, with the new model left out: the card goes, and no other comes.
    expect((await choose([{ id: 'orders', domain: 'finance' }], false)).statusCode).toBe(200)
    expect(await cards()).toEqual([])
    expect(await read(withStores(legacyManifest))).toMatchObject({ status: 'ok' })
    expect(await cards()).toEqual([])
  }, 120_000)
})

describe('the same step for a source an admin added', () => {
  const list = 'static-list'
  const entries = (...groups: string[]) =>
    JSON.stringify(
      groups.map((group) => ({
        kind: 'metric',
        name: `${group}.orders`,
        title: `${group} orders`,
      })),
    )
  const config = (...groups: string[]) => ({ definitions: entries(...groups) })
  const settingsOf = () => ok<SourceSettings>('GET', `/sources/${list}`)
  const readList = async () => {
    await queueReads(client, [list])
    await connectorSyncJob(registry, { clock }).run({
      database,
      logger,
      signal: new AbortController().signal,
    })
  }
  const listed = async () =>
    (
      await client.query<{ name: string; area_hint: string | null }>(
        `select name, area_hint from definitions
          where connector_id = $1 and missing_since_snapshot is null order by name`,
        [list],
      )
    ).rows

  it('chooses the groups of a static list, and keeps the domain of one left out', async () => {
    // One definitions integration is on at a time (CON-120): the server's own makes room.
    const off = await api('PUT', '/sources/dbt-metricflow/paused', {
      paused: true,
      reason: 'Read our validated list instead',
    })
    expect(off.statusCode, off.body).toBe(200)
    const added = await api('POST', '/sources', {
      type: 'static-definitions',
      name: 'Static list',
      config: config('payments', 'stock'),
      secrets: {},
      scopes: [
        { id: 'payments', title: 'payments', domain: 'finance' },
        { id: 'stock', title: 'stock', domain: 'marketing' },
      ],
      allGroups: false,
      reason: 'Our validated list',
    })
    expect(added.statusCode, added.body).toBe(201)
    await readList()
    expect(await listed()).toEqual([
      { name: 'payments.orders', area_hint: 'finance' },
      { name: 'stock.orders', area_hint: 'marketing' },
    ])
    // The views-only step: one line in the history log, and the group left out keeps its domain.
    const before = await settingsOf()
    expect(before.origin).toBe('workspace')
    const chosen = await api('PUT', `/sources/${list}/groups`, {
      id: list,
      revision: before.revision,
      scopes: [{ id: 'payments', title: 'payments', domain: 'finance' }],
      allGroups: false,
      reason: 'Stock is not validated',
    })
    expect(chosen.statusCode, chosen.body).toBe(200)
    expect(chosen.json<SourceSettings>().kept).toEqual([
      { id: 'stock', title: 'stock', domain: 'marketing' },
    ])
    await readList()
    expect(await listed()).toEqual([{ name: 'payments.orders', area_hint: 'finance' }])
    // Change settings keeps it aside too, while the list gains a group nobody chose.
    const after = await settingsOf()
    const changed = await api('PUT', `/sources/${list}`, {
      id: list,
      revision: after.revision,
      name: 'Static list',
      config: config('payments', 'stock', 'returns'),
      secrets: {},
      reason: 'Returns are listed too',
    })
    expect(changed.statusCode, changed.body).toBe(200)
    expect(changed.json<SourceSettings>().kept).toEqual([
      { id: 'stock', title: 'stock', domain: 'marketing' },
    ])
    await readList()
    await readList()
    expect(await listed()).toEqual([{ name: 'payments.orders', area_hint: 'finance' }])
    // A group that comes with a change of settings is no news: whoever saved it chose without it.
    await raiseAlerts(database, clock, createBundleCache(), ['views'])
    await relayOutbox(database)
    const feed = await ok<Feed>('GET', '/inbox/feed')
    expect(
      feed.cards.filter(
        (card) =>
          card.group === 'alert' &&
          card.rule === 'views' &&
          'connector' in card.subject &&
          card.subject.connector === list,
      ),
    ).toEqual([])
  }, 120_000)
})
