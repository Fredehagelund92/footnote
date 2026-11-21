import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { Catalogue } from '../../src/contract/index.ts'
import type { NamesRead } from '../../src/contract/inbox.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import {
  ConnectorRegistry,
  ConnectorService,
  configuredSources,
} from '../../src/server/modules/connectors/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { legacyManifest } from '../server/connectors/dbt-metricflow-fixture.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation } from './fixtures.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  What a reader is shown of a dbt project in a folder on the server (CON-119), on the real service
  and PostgreSQL 18: the server reads the file, an admin publishes its names, and the catalogue
  gives each definition its own dbt ref and no file address, since a dbt file names no model file
  (N1, N2 of the local install). A metric titled with its semantic model's words keeps its title
  (N4), and a description keeps the backticks the source wrote, for the app to draw as code (N3).
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
let folder = ''
let registry: ConnectorRegistry
let app: ReturnType<typeof buildApp>
let headers: Record<string, string> = {}

/** The fixture's file with a metric dbt titles after its semantic model, and quotes a column of. */
function withEuroOrders() {
  const file = structuredClone(legacyManifest)
  const revenue = file.metrics.find((metric) => metric.name === 'revenue')!
  file.metrics.push({
    ...structuredClone(revenue),
    name: 'orders_eur',
    label: 'Orders (EUR)',
    description: 'The amount ordered in EUR, as `amount_eur`.',
  })
  return file
}

const call = (method: 'GET' | 'POST', path: string, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers, 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })

beforeAll(async () => {
  await foundation(client)
  folder = await mkdtemp(join(tmpdir(), 'footnote-server-folder-catalogue-'))
  await writeFile(join(folder, 'semantic_manifest.json'), JSON.stringify(withEuroOrders()))
  registry = new ConnectorRegistry(
    configuredSources({
      cubeModelDir: undefined,
      domainOverridesFile: undefined,
      renamesFile: undefined,
      serverFolders: { 'dbt-metricflow': folder },
    }),
  )
  app = buildApp({
    database,
    jobs: idleJobs(),
    sources: registry,
    logger: createLogger({ level: 'silent' }),
    clock: systemClock('2026-10-08'),
    devPeople: [{ name: 'admin', email: 'admin@example.test', roles: [] }],
  })
  const signedIn = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { origin: 'http://localhost', 'x-footnote-csrf': 'dev-sign-in' },
    payload: { email: 'admin@example.test' },
  })
  expect(signedIn.statusCode, signedIn.body).toBe(200)
  headers = {
    origin: 'http://localhost',
    cookie: signedIn.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    'x-footnote-csrf': signedIn.json<{ csrfToken: string }>().csrfToken,
  }
  expect(await new ConnectorService(database, registry).sync('dbt-metricflow')).toMatchObject({
    status: 'ok',
  })
  const read = await call('GET', '/inbox/names')
  expect(read.statusCode, read.body).toBe(200)
  const { revision, names } = read.json<NamesRead>()
  const accept = names.filter((name) => name.state === 'ready').map(({ key }) => ({ key }))
  const decided = await call('POST', '/inbox/names/decide', { revision, accept, leaveOut: [] })
  expect(decided.statusCode, decided.body).toBe(200)
}, 120_000)
afterAll(async () => {
  await app.close()
  await rm(folder, { recursive: true, force: true })
})

const term = async (name: string) => {
  const response = await call('GET', '/catalogue')
  expect(response.statusCode, response.body).toBe(200)
  return response.json<Catalogue>().terms.find((t) => t.name === name)
}

it('names a dbt definition by its dbt ref, with no file to link to', async () => {
  expect((await term('Revenue'))?.definition).toMatchObject({
    ref: 'dbt:orders.revenue',
    name: 'orders.revenue',
    tool: 'dbt',
    connector: 'dbt-metricflow',
    fileUrl: null,
  })
})

it('keeps a title that starts with its semantic model’s words, and the source’s backticks', async () => {
  expect((await term('Orders (EUR)'))?.definition).toMatchObject({
    ref: 'dbt:orders.orders_eur',
    descriptionCopy: 'The amount ordered in EUR, as `amount_eur`.',
  })
  expect(await term('(EUR)')).toBeUndefined()
})
