import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  Catalogue,
  DefinitionRelations,
  FamilyMeaningVersion,
} from '../../src/contract/catalogue.ts'
import type { NamesDecision, NamesRead } from '../../src/contract/inbox.ts'
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
import { gitHost, type GitHost } from '../server/connectors/git-server.ts'
import { partnerManifest } from '../server/connectors/partner-relations-fixture.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, askToolsAs, queueReads, testDatabase } from './support.ts'

/*
  Families in the order of trust (FR-142, D1, D2, D9) on the real service and PostgreSQL 18: an
  invented partner programme's dbt project declares one family of its product lines in
  `meta.footnote`, keeps amounts in EUR with USD twins one rate converts, a fee in EUR and USD in
  columns of their own, and one declaration that does not hold. Test connection says what does not
  hold; the Names card offers the declared family and the converted ones, each marked, and holds
  the fee whose names alone look alike for the owner, who publishes it apart; the family pages say
  how each was found and which variant is converted from which. Every name is made up.
*/

const TOKEN = 'families-it-token-7d1e40b3'
const { client, url } = testDatabase()
const database = apiDatabase(url)
const logger = createLogger({ level: 'silent' })
const clock = systemClock('2026-11-21')
const secretsDir = await mkdtemp(join(tmpdir(), 'footnote-families-'))
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
let host: GitHost
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

type Metric = ReturnType<typeof partnerManifest>['metrics'][number] & {
  label?: string
  config: { meta: Record<string, unknown> }
}

/**
 * The product lines in EUR and USD as one declared family, two amounts that one rate converts,
 * a fee kept in EUR and USD columns of its own and labelled by currency, and a family of one.
 */
function project() {
  const file = partnerManifest({ pairs: 3, summed: 2, locals: 0, forecasts: 0 })
  const metrics = file.metrics as Metric[]
  for (const metric of metrics) {
    const line = /^net_revenue_(retail|online|wholesale)_(eur|usd)$/.exec(metric.name)
    if (line)
      metric.config.meta = {
        footnote: {
          family: 'net_revenue_by_line',
          by: { sales_line: line[1], currency: line[2]!.toUpperCase() },
          family_description: 'Revenue from partners after refunds, by sales line.',
        },
      }
    if (metric.name === 'signups')
      metric.config.meta = { footnote: { family: 'sign_up_counts', by: { kind: 'all' } } }
  }
  // A fee in each currency, each a column of its own: nothing says one is worked out from the other.
  const fee = (code: 'eur' | 'usd') => ({
    name: `partner_fee_${code}`,
    label: `Partner fee (${code.toUpperCase()})`,
    description: `The fee partners pay, in ${code.toUpperCase()}.`,
    type: 'simple',
    type_params: {
      expr: `partner_fee_${code}`,
      metrics: [],
      metric_aggregation_params: {
        semantic_model: 'partner_results',
        agg: 'sum',
        agg_time_dimension: 'booked_at',
      },
      is_private: false,
    },
    filter: null,
    config: { meta: {} },
  })
  return { ...file, metrics: [...metrics, fee('eur'), fee('usd')] as unknown[] }
}

const route = () => ({
  type: 'dbt-metricflow',
  config: {
    location: 'git',
    repository: host.address('partners'),
    ref: 'main',
    folder: 'semantic',
    file: 'semantic_manifest.json',
  },
  secrets: { token: TOKEN },
})

/** One run of the sources' job, with the source made due. */
async function read() {
  await queueReads(client)
  await connectorSyncJob(registry, { clock }).run({
    database,
    logger,
    signal: new AbortController().signal,
  })
}

const names = () => ok<NamesRead>(call('GET', '/inbox/names', 'admin'))
const named = (list: NamesRead, name: string) => list.names.find((n) => n.name === name)

beforeAll(async () => {
  await foundation(client)
  await client.query("insert into areas (id,name) values ('partners','Partners')")
  await client.query(
    `insert into area_assignments (area_id,person_id,role) values ('partners',$1,'owner')`,
    [people.owner],
  )
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
  host = await gitHost({ token: TOKEN })
  await host.repository('partners', {
    'semantic/semantic_manifest.json': JSON.stringify(project()),
  })
}, 300_000)
afterAll(async () => {
  await app.close()
  await host.close()
  await rm(secretsDir, { recursive: true, force: true })
})

describe('Test connection', () => {
  it('says a declared family does not hold, and reads its metric on its own', async () => {
    const check = await ok<SourceCheck>(call('POST', '/sources/test', 'admin', route()))
    expect(check.ok).toBe(true)
    expect(check.warnings.filter((w) => w.code.startsWith('family'))).toEqual([
      { code: 'family_one_member', target: 'sign_up_counts' },
    ])
  })
})

describe('the Names card', () => {
  beforeAll(async () => {
    await ok<SourceSettings>(
      call('POST', '/sources', 'admin', {
        ...route(),
        name: 'dbt',
        reason: 'Our partner metrics live in dbt',
      }),
      201,
    )
    await read()
  }, 300_000)

  it('keeps a family that holds, and leaves out the one that does not', async () => {
    const { rows } = await client.query<{ name: string; family: string | null }>(
      `select name, family_name as family from definitions
        where name in ('partner_results.net_revenue_online_usd', 'partner_results.signups')
        order by name`,
    )
    expect(rows).toEqual([
      { name: 'partner_results.net_revenue_online_usd', family: 'net_revenue_by_line' },
      { name: 'partner_results.signups', family: null },
    ])
  })

  it('offers the declared family and the converted ones, each marked, ready to publish', async () => {
    const list = await names()
    expect(named(list, 'Net revenue by line')).toMatchObject({
      kind: 'metric_group',
      state: 'ready',
      family: { variants: 6, by: ['Sales line', 'Currency'], found: 'declared', names: [] },
    })
    for (const stem of ['Accrued share 1', 'Accrued share 2'])
      expect(named(list, stem)).toMatchObject({
        kind: 'metric_group',
        state: 'ready',
        family: { variants: 2, by: ['Currency'], found: 'calculation' },
      })
    // A variant is never a name of its own on the card.
    expect(list.names.map((n) => n.name)).not.toContain('Net revenue retail eur')
  })

  it('holds the names that only look alike for the owner, with what they differ by', async () => {
    const fee = named(await names(), 'Partner fee')
    expect(fee).toMatchObject({
      kind: 'metric_group',
      state: 'flagged',
      flags: [
        {
          code: 'look_alike',
          message: 'Their names differ only by EUR and USD. Publish them as one family, or apart.',
        },
      ],
      family: { found: 'names', names: ['Partner fee (EUR)', 'Partner fee (USD)'] },
    })
  })

  it('refuses to publish apart a family its source declares or its calculation finds', async () => {
    const list = await names()
    for (const name of ['Net revenue by line', 'Accrued share 1']) {
      const response = await call('POST', '/inbox/names/decide', 'admin', {
        revision: list.revision,
        accept: [{ key: named(list, name)!.key, apart: true }],
        leaveOut: [],
      })
      expect(response.statusCode, response.body).toBe(422)
    }
  })

  it('publishes them apart at one press, each by its own name, and no family', async () => {
    const list = await names()
    const fee = named(list, 'Partner fee')!
    const ready = list.names.filter((n) => n.state === 'ready').map(({ key }) => ({ key }))
    const decided = await ok<NamesDecision>(
      call('POST', '/inbox/names/decide', 'admin', {
        revision: list.revision,
        accept: [...ready, { key: fee.key, apart: true }],
        leaveOut: [],
      }),
    )
    expect(decided.waiting.names.filter((n) => n.state !== 'left_out')).toEqual([])
    const { rows } = await client.query<{ key: string; kind: string; parent: string | null }>(
      `select t.key, t.kind::text as kind, t.parent_key as parent
         from serving_vocabulary((select seq from live_edition)) t
        where t.key like '%partner_fee%' or t.key = $1 order by t.key`,
      [fee.key],
    )
    expect(rows.map((r) => [r.kind, r.parent])).toEqual([
      ['metric', null],
      ['metric', null],
    ])
  })
})

describe('a family’s page', () => {
  const family = async (name: string) =>
    (await ok<Catalogue>(call('GET', '/catalogue', 'member'))).terms.find((t) => t.name === name)

  it('says how each family was found', async () => {
    expect((await family('Net revenue by line'))?.family).toMatchObject({
      found: 'declared',
      by: ['Sales line', 'Currency'],
      conversions: expect.arrayContaining([
        expect.objectContaining({ by: 'exchange_rate_usd' }),
      ]) as unknown,
    })
    expect((await family('Accrued share 1'))?.family?.found).toBe('calculation')
  })

  it('says which variant is converted from which, by the column', async () => {
    const accrued = (await family('Accrued share 1'))!.family!
    const keyOf = (code: string) => accrued.variants.find((v) => v.values[0] === code)!.key
    expect(accrued.conversions).toEqual([
      { from: keyOf('EUR'), to: keyOf('USD'), by: 'exchange_rate_usd' },
    ])
    const relations = await ok<DefinitionRelations>(
      call('GET', `/definitions/relations?key=${keyOf('USD')}`, 'member'),
    )
    expect(relations.relations[0]).toMatchObject({
      kind: 'converted_from',
      key: keyOf('EUR'),
      by: 'exchange_rate_usd',
    })
  })
})

describe('what a family means (M1)', () => {
  const family = async (name: string) =>
    (await ok<Catalogue>(call('GET', '/catalogue', 'member'))).terms.find((t) => t.name === name)!
  const choose = (key: string, who: Who, body: object) =>
    call('PUT', `/definitions/families/${encodeURIComponent(key)}/meaning`, who, body)

  it('is the words its source declares for it, which nobody replaces here', async () => {
    const line = await family('Net revenue by line')
    expect(line.family!.meaning).toMatchObject({
      source: 'declared',
      words: 'Revenue from partners after refunds, by sales line.',
      chosen: null,
      revision: 0,
    })
    // The family's definition still never speaks with one variant's words.
    expect(line.definition?.descriptionCopy).toBeNull()
    const refused = await choose(line.key, 'owner', {
      key: line.key,
      choice: 'written',
      words: 'Something else.',
      revision: 0,
    })
    expect(refused.statusCode, refused.body).toBe(409)
  })

  it('is the base variant’s words for a pair one rate converts, and names the other', async () => {
    const accrued = (await family('Accrued share 1')).family!
    const keyOf = (code: string) => accrued.variants.find((v) => v.values[0] === code)!.key
    expect(accrued.meaning.base).toBe(keyOf('EUR'))
    if (accrued.meaning.source === 'base') {
      expect(accrued.meaning.member).toBe(keyOf('EUR'))
      expect(accrued.meaning.differing).toEqual([keyOf('USD')])
    } else expect(accrued.meaning.source).toBe('common')
  })

  it('is changed by an owner of its domain only, against the meaning they read, with history', async () => {
    const accrued = await family('Accrued share 1')
    const eur = accrued.family!.variants.find((v) => v.values[0] === 'EUR')!
    const written = {
      key: accrued.key,
      choice: 'written',
      words: '  The share of a partner contract booked up front.  ',
      revision: 0,
    }
    const forbidden = await choose(accrued.key, 'member', written)
    expect(forbidden.statusCode, forbidden.body).toBe(403)
    const first = await ok<FamilyMeaningVersion>(choose(accrued.key, 'owner', written))
    expect(first).toMatchObject({
      revision: 1,
      choice: 'written',
      words: 'The share of a partner contract booked up front.',
      personId: people.owner,
    })
    expect((await family('Accrued share 1')).family!.meaning).toMatchObject({
      source: 'written',
      words: 'The share of a partner contract booked up front.',
      chosen: { choice: 'written', personId: people.owner },
      revision: 1,
    })
    // Someone who read the meaning before that change is told so.
    const stale = await choose(accrued.key, 'admin', written)
    expect(stale.statusCode, stale.body).toBe(409)

    if (eur.description) {
      await ok(
        choose(accrued.key, 'admin', {
          key: accrued.key,
          choice: 'member',
          member: eur.key,
          revision: 1,
        }),
      )
      expect((await family('Accrued share 1')).family!.meaning).toMatchObject({
        source: 'member',
        member: eur.key,
        words: eur.description,
      })
    } else await ok(choose(accrued.key, 'admin', { key: accrued.key, choice: 'auto', revision: 1 }))
    const history = await ok<FamilyMeaningVersion[]>(
      call(
        'GET',
        `/definitions/families/${encodeURIComponent(accrued.key)}/meaning/history`,
        'member',
      ),
    )
    expect(history.map((v) => [v.revision, v.personId])).toEqual([
      [2, people.admin],
      [1, people.owner],
    ])
    // History is append only, even for the service's own role.
    await expect(
      database.query(`update family_meaning_versions set words = 'x' where family_key = $1`, [
        accrued.key,
      ]),
    ).rejects.toThrow()
  })

  it('refuses a variant of another family, and an unknown family', async () => {
    const accrued = await family('Accrued share 1')
    const other = (await family('Accrued share 2')).family!.variants[0]!.key
    const wrong = await choose(accrued.key, 'admin', {
      key: accrued.key,
      choice: 'member',
      member: other,
      revision: 2,
    })
    expect(wrong.statusCode, wrong.body).toBe(404)
    const unknown = await choose('group:no_such_family', 'admin', {
      key: 'group:no_such_family',
      choice: 'auto',
      revision: 0,
    })
    expect(unknown.statusCode, unknown.body).toBe(404)
  })

  it('is not declared by words only a variant the source stopped reading still has', async () => {
    await client.query(
      `update definitions set family_description = null where family_name = 'net_revenue_by_line'`,
    )
    const [{ id }] = (
      await client.query<{ id: string }>(
        `insert into connector_snapshots (connector_id, status, definitions_seen)
         select connector_id, 'ok', 1 from definitions where family_name = 'net_revenue_by_line'
          limit 1 returning id`,
      )
    ).rows as [{ id: string }]
    await client.query(
      `update definitions set family_description = 'Old words.', missing_since_snapshot = $1
        where ref = (select ref from definitions where family_name = 'net_revenue_by_line'
                      order by ref limit 1)`,
      [id],
    )
    const line = await family('Net revenue by line')
    expect(line.family!.meaning.source).not.toBe('declared')
    const changed = await choose(line.key, 'owner', {
      key: line.key,
      choice: 'written',
      words: 'Revenue after refunds.',
      revision: 0,
    })
    expect(changed.statusCode, changed.body).toBe(200)
  })
})

describe('Ask on a family', () => {
  it("gives the family's own words with the look-up of it, the variants' with them", async () => {
    // Asked why its USD variant differs from its EUR one, Ask read only the look-up and said
    // nothing was written (captain's install, 21 November 2026): the words were only in Definitions.
    const read = (await askToolsAs(database, clock)(people.member, (tools) =>
      tools.run('get_context', {
        about: 'why is net revenue by line in USD different from EUR',
        no_period: true,
      }),
    )) as { definitions?: { name: string; from: string; words: string | null }[] }
    expect(read.definitions?.map((d) => [d.name, d.from])).toEqual([['Net revenue by line', 'dbt']])
    expect(read.definitions?.[0]?.words).toMatch(
      /^A family of 6 near-identical metrics, one for each sales line and currency\./,
    )
  })
})
