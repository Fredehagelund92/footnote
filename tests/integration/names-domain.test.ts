import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { NamesDecision, NamesRead } from '../../src/contract/inbox.ts'
import type { SourceSettings } from '../../src/contract/sources.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import {
  ConnectorRegistry,
  configuredSources,
  connectorSyncJob,
} from '../../src/server/modules/connectors/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { legacyManifest } from '../server/connectors/dbt-metricflow-fixture.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, queueReads, testDatabase } from './support.ts'

/*
  The domain made with the names (F08 of the cold first use scout), end to end on the real service
  and PostgreSQL 18: a dbt folder on the server whose `orders` model names the domain `sales`,
  which this workspace does not have, and whose `customers` model names none. The names card
  offers Sales as a new domain; publishing the names under it makes the domain, owned by the admin
  who publishes, puts every name with no domain in it, and maps the views the tool names no domain
  for, so the read after gives them the same one. Nothing else is asked.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const logger = createLogger({ level: 'silent' })
const clock = systemClock()
const folder = await mkdtemp(join(tmpdir(), 'footnote-names-domain-'))
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
const api = async (method: 'GET' | 'POST', path: string, payload?: object, as = 'admin') =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...(await login(as)), 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
async function ok<T>(method: 'GET' | 'POST', path: string, payload?: object, as = 'admin') {
  const response = await api(method, path, payload, as)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<T>()
}

async function read() {
  await writeFile(join(folder, 'semantic_manifest.json'), JSON.stringify(legacyManifest))
  await queueReads(client, [id])
  await connectorSyncJob(registry, { clock }).run({
    database,
    logger,
    signal: new AbortController().signal,
  })
}
/** The domains the current definitions of each model have. */
const domains = async () =>
  (
    await client.query<{ model: string; domains: (string | null)[] }>(
      `select split_part(substr(ref, 5), '.', 1) as model, array_agg(distinct area_hint) as domains
         from definitions where connector_id = $1 and missing_since_snapshot is null
        group by 1 order by split_part(substr(ref, 5), '.', 1) collate "C"`,
      [id],
    )
  ).rows

beforeAll(async () => {
  await foundation(client)
  await login('admin')
  await read()
}, 120_000)
afterAll(async () => {
  await app.close()
  await rm(folder, { recursive: true, force: true })
})

describe('the domain made with the names', () => {
  it('offers the domain the tool names to an admin, and nothing to an owner', async () => {
    const names = await ok<NamesRead>('GET', '/inbox/names')
    const open = names.names.filter((name) => name.state !== 'left_out')
    expect(open.length).toBeGreaterThan(0)
    expect(open.every((name) => name.areaId === null)).toBe(true)
    expect(names.place).toEqual({ id: null, name: 'Sales', names: open.length })
    // An owner of another domain reads none of these names, and is offered nothing.
    expect((await ok<NamesRead>('GET', '/inbox/names', undefined, 'owner')).place).toBeNull()
  })

  it('refuses the sandbox, which agents never read', async () => {
    await client.query(`insert into areas (id, name, is_demo) values ('sandbox', 'Sandbox', true)`)
    const names = await ok<NamesRead>('GET', '/inbox/names')
    const pick = names.names.find((name) => name.state === 'ready')!
    const refused = await api('POST', '/inbox/names/decide', {
      revision: names.revision,
      accept: [{ key: pick.key }],
      leaveOut: [],
      domain: { id: 'sandbox' },
    })
    expect(refused.statusCode, refused.body).toBe(422)
    expect((await ok<NamesRead>('GET', '/inbox/names')).revision).toBe(names.revision)
  })

  it('publishes them under it, made and owned by the admin, and maps the other views', async () => {
    const names = await ok<NamesRead>('GET', '/inbox/names')
    const ready = names.names.filter((name) => name.state === 'ready')
    const decided = await ok<NamesDecision>('POST', '/inbox/names/decide', {
      revision: names.revision,
      accept: ready.map((name) => ({ key: name.key })),
      leaveOut: [],
      domain: { name: 'Sales' },
    })
    expect(decided.accepted).toBeGreaterThan(0)
    const area = await client.query<{ name: string; owners: string[] }>(
      `select a.name, array(select x.person_id::text from area_assignments x
                             where x.area_id = a.id and x.role = 'owner') as owners
         from areas a where a.id = 'sales'`,
    )
    expect(area.rows).toEqual([{ name: 'Sales', owners: [people.admin] }])
    const live = await client.query<{ key: string; area: string | null }>(
      `select key, area_id as area from serving_vocabulary((select seq from live_edition))
        where key = any($1)`,
      [ready.map((name) => name.key)],
    )
    expect(live.rows.length).toBeGreaterThan(0)
    expect(live.rows.every((row) => row.area === 'sales')).toBe(true)
    // The views the tool names no domain for are mapped to it; `orders` names sales itself.
    const settings = await ok<SourceSettings>('GET', `/sources/${id}`)
    expect(settings.allGroups).toBe(true)
    expect(settings.scopes.map((scope) => [scope.id, scope.domain])).toEqual(
      expect.arrayContaining([['customers', 'sales']]),
    )
    expect(settings.scopes.some((scope) => scope.id === 'orders')).toBe(false)
    // The read after gives every model the domain, with nothing left to place.
    await read()
    expect((await domains()).every((row) => row.domains.join() === 'sales')).toBe(true)
    expect((await ok<NamesRead>('GET', '/inbox/names')).place).toBeNull()
  }, 120_000)
})
