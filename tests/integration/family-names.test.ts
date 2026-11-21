import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Catalogue } from '../../src/contract/catalogue.ts'
import type { NamesRead } from '../../src/contract/inbox.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import {
  ConnectorRegistry,
  connectorSyncJob,
  createCubeSource,
} from '../../src/server/modules/connectors/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, queueReads, testDatabase } from './support.ts'

/*
  One word, one meaning for families of metrics (FR-138, FR-142), on the real service and
  PostgreSQL 18: an invented booking model has a commission in EUR and in USD, joined into two
  views, so each view has a family called "Commission". Published one at a time, the second family
  may not take the word the first holds; offered with its view's name, it goes live beside it.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const logger = createLogger({ level: 'silent' })
const clock = systemClock('2026-10-08')
const folder = await mkdtemp(join(tmpdir(), 'footnote-family-names-'))
const view = (name: string) => [
  `  - name: ${name}`,
  '    meta:',
  '      domain: sales',
  '    cubes:',
  '      - join_path: bookings',
  "        includes: '*'",
]
await writeFile(
  join(folder, 'model.yml'),
  [
    'cubes:',
    '  - name: bookings',
    '    public: false',
    '    sql: SELECT * FROM bookings',
    '    measures:',
    '      - name: commission_eur',
    '        type: sum',
    '        sql: commission',
    '        title: "Commission (EUR)"',
    '        description: The commission on each booking, in EUR.',
    '      - name: commission_usd',
    '        type: sum',
    '        sql: "commission * fx_rate"',
    '        title: "Commission (USD)"',
    "        description: The EUR amount multiplied by the row's exchange rate.",
    '    dimensions:',
    '      - name: market',
    '        type: string',
    '        sql: market',
    '        title: Market',
    'views:',
    ...view('affiliates'),
    ...view('partners'),
    '',
  ].join('\n'),
)
const registry = new ConnectorRegistry([createCubeSource({ modelDir: folder })])
const app = buildApp({
  database,
  jobs: idleJobs(),
  sources: registry,
  logger,
  clock,
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
})
type Who = keyof typeof people
const headers: Partial<Record<Who, Record<string, string>>> = {}

const call = (method: 'GET' | 'POST', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
const ok = async <T>(response: Promise<{ statusCode: number; body: string; json: <U>() => U }>) => {
  const r = await response
  expect(r.statusCode, r.body).toBe(200)
  return r.json<T>()
}
const families = async () => {
  const read = await ok<NamesRead>(call('GET', '/inbox/names', 'admin'))
  return { ...read, families: read.names.filter((name) => name.kind === 'metric_group') }
}

beforeAll(async () => {
  await foundation(client)
  await client.query("insert into areas (id,name) values ('sales','Sales')")
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
  await queueReads(client)
  await connectorSyncJob(registry, { clock }).run({
    database,
    logger,
    signal: new AbortController().signal,
  })
}, 120_000)
afterAll(async () => {
  await app.close()
  await rm(folder, { recursive: true, force: true })
})

describe('two families of one name in two views', () => {
  it('offers the second with its view’s name, and flags both', async () => {
    const { families: offered } = await families()
    expect(offered.map((name) => [name.key, name.name, name.state])).toEqual([
      ['group:commission', 'Commission', 'flagged'],
      ['group:partners_commission', 'Commission (partners)', 'flagged'],
    ])
  })

  it('refuses the second the first one’s word once the first is live, published one at a time', async () => {
    const first = await families()
    await ok(
      call('POST', '/inbox/names/decide', 'admin', {
        revision: first.revision,
        accept: [{ key: 'group:commission' }],
        leaveOut: [],
      }),
    )
    const { revision, families: waiting } = await families()
    expect(waiting.map((name) => [name.key, name.name])).toEqual([
      ['group:partners_commission', 'Commission (partners)'],
    ])
    expect(waiting[0]!.flags.map((flag) => flag.code)).toContain('taken')
    const refused = await call('POST', '/inbox/names/decide', 'admin', {
      revision,
      accept: [{ key: 'group:partners_commission', name: 'Commission' }],
      leaveOut: [],
    })
    expect(refused.statusCode, refused.body).toBe(422)
    expect(refused.json<{ message: string }>().message).toBe(
      'Another definition is already called “Commission”.',
    )
    // As suggested, it goes live beside the first: two families, two words.
    await ok(
      call('POST', '/inbox/names/decide', 'admin', {
        revision,
        accept: [{ key: 'group:partners_commission' }],
        leaveOut: [],
      }),
    )
    const { terms } = await ok<Catalogue>(call('GET', '/catalogue', 'admin'))
    expect(terms.filter((term) => term.family).map((term) => term.name)).toEqual([
      'Commission',
      'Commission (partners)',
    ])
    const shared = await client.query(
      `select lower(v.name) as word from vocab_term_service s
         join vocab_term_versions v on v.id = s.version_id
        where s.editions @> (select seq from live_edition)
        group by 1 having count(distinct s.term_key) > 1`,
    )
    expect(shared.rows).toEqual([])
  }, 120_000)

  it('is a family in search everywhere, found by a currency word with the variant it matched (F4, F5)', async () => {
    type Found = { definitions: { name: string; kind: string; family: unknown }[] }
    const search = (q: string) =>
      ok<Found>(call('GET', `/search?q=${encodeURIComponent(q)}`, 'author'))
    expect((await search('commission')).definitions).toEqual([
      expect.objectContaining({ name: 'Commission', family: { variants: 2, matched: null } }),
      expect.objectContaining({
        name: 'Commission (partners)',
        family: { variants: 2, matched: null },
      }),
    ])
    const usd = await search('commission usd')
    expect(usd.definitions.map((d) => [d.name, d.family])).toEqual([
      ['Commission', { variants: 2, matched: 'Commission (USD)' }],
      ['Commission (partners)', { variants: 2, matched: 'Commission (USD) (partners)' }],
    ])
  })
})
