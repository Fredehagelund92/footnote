import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DefinitionBuiltFrom, DefinitionRelations } from '../../src/contract/catalogue.ts'
import type { NamesDecision, NamesRead } from '../../src/contract/inbox.ts'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { ReviewProposal } from '../../src/contract/review.ts'
import type { SourceSettings } from '../../src/contract/sources.ts'
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
import { apiDatabase, queueReads, testDatabase } from './support.ts'

/*
  What a metric is built from (FR-143) on the real service and PostgreSQL 18: a read of an
  invented partner programme's dbt project keeps each metric's inputs by name, and a metric's
  relations say what it is converted from and to, built from and used by. A read replaces them,
  so a rename moves them and an input that left the source says so; they never flag an item, and
  no answer holds a calculation. Every name is made up.
*/

const TOKEN = 'relations-it-token-0c41d9a2'
const { client, url } = testDatabase()
const database = apiDatabase(url)
const logger = createLogger({ level: 'silent' })
const clock = systemClock('2026-11-21')
const secretsDir = await mkdtemp(join(tmpdir(), 'footnote-relations-'))
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

const call = (method: 'GET' | 'POST', path: string, who: Who, payload?: object) =>
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

type Manifest = ReturnType<typeof partnerManifest>
const small = () => partnerManifest({ pairs: 2, summed: 1, locals: 1, forecasts: 1 })
const commit = (file: Manifest) =>
  host.commit('partners', { 'semantic/semantic_manifest.json': JSON.stringify(file) })

/** One run of the sources' job, with the source made due. */
async function read() {
  await queueReads(client)
  await connectorSyncJob(registry, { clock }).run({
    database,
    logger,
    signal: new AbortController().signal,
  })
}

/** Every name the read made, published. */
async function publishNames() {
  const { revision, names } = await ok<NamesRead>(call('GET', '/inbox/names', 'admin'))
  const ready = names.filter((name) => name.state === 'ready').map(({ key }) => ({ key }))
  if (ready.length)
    await ok<NamesDecision>(
      call('POST', '/inbox/names/decide', 'admin', { revision, accept: ready, leaveOut: [] }),
    )
}

/** The live metric that names a definition: a family's variant, not the family. */
async function keyOf(metric: string) {
  const { rows } = await client.query<{ key: string }>(
    `select key from serving_vocabulary((select seq from live_edition))
      where kind = 'metric' and $1 = any(definition_refs)`,
    [`dbt:partner_results.${metric}`],
  )
  return rows[0]!.key
}

const answers: string[] = []
async function relationsOf(metric: string) {
  const response = await call('GET', `/definitions/relations?key=${await keyOf(metric)}`, 'member')
  answers.push(response.body)
  return (await ok<DefinitionRelations>(Promise.resolve(response))).relations
}
/** What a metric is built from at every depth, each as its name in the source and its inputs. */
async function treeOf(metric: string) {
  const response = await call('GET', `/definitions/built-from?key=${await keyOf(metric)}`, 'member')
  answers.push(response.body)
  const { metrics } = await ok<DefinitionBuiltFrom>(Promise.resolve(response))
  const last = (ref: string) => ref.split('.').at(-1)
  return metrics.map((m) => [last(m.ref), m.key !== null, m.from.map(last)])
}
/** Each metric of a tree as the name a reader sees. */
async function treeNames(metric: string) {
  const response = await call('GET', `/definitions/built-from?key=${await keyOf(metric)}`, 'member')
  return (await ok<DefinitionBuiltFrom>(Promise.resolve(response))).metrics.map((m) => m.name)
}
/** Each relation as `kind name`, with its column for a conversion. */
const said = (relations: DefinitionRelations['relations']) =>
  relations.map((r) => [r.kind, r.ref ? r.ref.split('.').at(-1) : `column ${r.name}`, r.by])

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
    'semantic/semantic_manifest.json': JSON.stringify(small()),
  })
  await ok<SourceSettings>(
    call('POST', '/sources', 'admin', {
      type: 'dbt-metricflow',
      name: 'dbt',
      config: {
        location: 'git',
        repository: host.address('partners'),
        ref: 'main',
        folder: 'semantic',
        file: 'semantic_manifest.json',
      },
      secrets: { token: TOKEN },
      reason: 'Our partner metrics live in dbt',
    }),
    201,
  )
  await read()
  await publishNames()
}, 300_000)
afterAll(async () => {
  await app.close()
  await host.close()
  await rm(secretsDir, { recursive: true, force: true })
})

describe('a read of the source', () => {
  it('keeps each metric’s inputs by name, and nothing of its calculation', async () => {
    const { rows } = await client.query<{ name: string; refs: string[]; columns: string[] }>(
      `select name, built_from_refs as refs, built_from_columns as columns from definitions
        where name in ('partner_results.net_revenue_online_usd', 'partner_results.signup_rate')
        order by name`,
    )
    expect(rows).toEqual([
      {
        name: 'partner_results.net_revenue_online_usd',
        refs: [],
        columns: ['net_revenue_online_eur', 'exchange_rate_usd'],
      },
      {
        name: 'partner_results.signup_rate',
        refs: ['dbt:partner_results.signups', 'dbt:partner_results.clicks'],
        columns: [],
      },
    ])
    // The database refuses an expression where a column's name goes.
    await expect(
      client.query(
        `update definitions set built_from_columns = array['x_eur * rate'] where name = $1`,
        ['partner_results.signups'],
      ),
    ).rejects.toThrow(/definitions_built_from_check/)
  })
})

describe('a metric’s relations', () => {
  it('say a USD twin is converted from its EUR one, by the rate column, and the EUR one converted to it', async () => {
    expect(said(await relationsOf('net_revenue_retail_usd'))).toEqual([
      ['converted_from', 'net_revenue_retail_eur', 'exchange_rate_usd'],
      ['built_from', 'column net_revenue_retail_eur', null],
      ['built_from', 'column exchange_rate_usd', null],
    ])
    const eur = await relationsOf('net_revenue_retail_eur')
    expect(said(eur)).toEqual([
      ['converted_to', 'net_revenue_retail_usd', 'exchange_rate_usd'],
      ['built_from', 'column net_revenue_retail_eur', null],
    ])
    // It links to the live term's page by its name.
    expect(eur[0]).toMatchObject({ key: await keyOf('net_revenue_retail_usd'), missing: false })
    // The same for SUM(x_eur * rate) against SUM(x_eur).
    expect(said(await relationsOf('accrued_share_1_usd'))[0]).toEqual([
      'converted_from',
      'accrued_share_1_eur',
      'exchange_rate_usd',
    ])
  })

  it('pair no forecast, local currency or product line', async () => {
    for (const metric of [
      'forecast_net_revenue_retail_eur',
      'net_revenue_retail_local',
      'net_revenue_eur',
    ])
      expect((await relationsOf(metric)).map((r) => r.kind)).not.toContain('converted_from')
    expect((await relationsOf('net_revenue_online_eur')).map((r) => r.kind)).toEqual([
      'converted_to',
      'built_from',
    ])
  })

  it('say a ratio and a derived metric are built from their inputs, and each input used by them', async () => {
    expect(said(await relationsOf('signup_rate'))).toEqual([
      ['built_from', 'signups', null],
      ['built_from', 'clicks', null],
    ])
    expect(said(await relationsOf('net_revenue_per_signup'))).toEqual([
      ['built_from', 'net_revenue_eur', null],
      ['built_from', 'signups', null],
    ])
    expect(said(await relationsOf('signups'))).toEqual([
      ['built_from', 'column signup_count', null],
      ['used_by', 'net_revenue_per_signup', null],
      ['used_by', 'signup_rate', null],
    ])
  })

  it('say what a derived metric is built from at every depth, each metric once, with its term', async () => {
    expect(await treeOf('net_revenue_per_signup')).toEqual([
      ['net_revenue_per_signup', true, ['net_revenue_eur', 'signups']],
      ['net_revenue_eur', true, []],
      ['signups', true, []],
    ])
    expect(await treeOf('signups')).toEqual([['signups', true, []]])
    const response = await call('GET', '/definitions/built-from?key=metric:nothing_here', 'member')
    expect(response.statusCode).toBe(404)
  })

  it('never hold an expression, an operator or a literal', () => {
    expect(answers.length).toBeGreaterThanOrEqual(5)
    for (const body of answers) expect(body).not.toMatch(/SUM\(|CASE|\*|'/i)
  })

  it('are refused for a key no live metric has', async () => {
    const response = await call('GET', '/definitions/relations?key=metric:nothing_here', 'member')
    expect(response.statusCode).toBe(404)
  })
})

describe('a later read', () => {
  it('flags no item on the USD twin when only the EUR one changes', async () => {
    const usd = await keyOf('net_revenue_retail_usd')
    const created = await ok<ProposalRecord>(
      call('POST', '/proposals', 'author', {
        draft: {
          areaId: 'partners',
          title: 'Retail net revenue in USD uses the booking day’s rate',
          summary: 'Retail net revenue in USD takes the rate of the day the booking was made.',
          scope: { metrics: [usd], dimensions: [], dimensionValues: [] },
          validity: { start: '2026-11-02', end: null },
          evidence: [{ url: 'https://example.test/rate', quote: 'Noted', date: '2026-11-02' }],
        },
      }),
    )
    const submitted = await ok<ProposalRecord>(
      call('POST', `/proposals/${created.id}/submit`, 'author', { revision: created.revision }),
    )
    const sheet = await ok<{ proposal: ReviewProposal; clashes: { itemId: string }[] }>(
      call('GET', `/review/${submitted.id}/sheet`, 'owner'),
    )
    await ok(
      call('POST', `/review/${submitted.id}/publish`, 'owner', {
        revision: sheet.proposal.revision,
        relations: sheet.clashes.map((clash) => ({ itemId: clash.itemId, relation: 'unrelated' })),
      }),
    )
    const file = small()
    file.metrics.find((m) => m.name === 'net_revenue_retail_eur')!.description =
      'Retail net revenue in EUR, after returns.'
    await commit(file)
    await read()
    const { rows: moved } = await client.query(
      `select d.name from definition_marks m join definitions d on d.ref = m.definition_ref
        group by d.name having count(*) > 1`,
    )
    expect(moved).toEqual([{ name: 'partner_results.net_revenue_retail_eur' }])
    const flags = await client.query("select item_id from overlay_events where kind = 'flag_on'")
    expect(flags.rows).toEqual([])
  }, 120_000)

  it('moves a relation with a rename, and says an input that left the source is no longer there', async () => {
    const file = small()
    const signups = file.metrics.find((m) => m.name === 'signups')!
    signups.name = 'sign_ups'
    for (const metric of file.metrics) {
      const params = metric.type_params as {
        numerator?: { name: string }
        metrics?: { name: string }[]
      }
      if (params.numerator?.name === 'signups') params.numerator.name = 'sign_ups'
      for (const input of params.metrics ?? [])
        if (input.name === 'signups') input.name = 'sign_ups'
    }
    // Clicks is hidden in dbt now: still the ratio's input, no longer a definition.
    ;(
      file.metrics.find((m) => m.name === 'clicks')!.type_params as { is_private: boolean }
    ).is_private = true
    await commit(file)
    await read()
    const rate = await relationsOf('signup_rate')
    expect(rate.map((r) => [r.ref, r.missing])).toEqual([
      ['dbt:partner_results.sign_ups', false],
      ['dbt:partner_results.clicks', true],
    ])
    // Nobody has published the new name yet: it is named by the source, and opens nothing.
    expect(rate[0]).toMatchObject({ name: 'partner_results.sign_ups', key: null })
    // The name that was live keeps its term, which says its input left the source.
    expect(rate[1]).toMatchObject({ key: await keyOf('clicks') })
    expect(said(await relationsOf('net_revenue_per_signup'))[1]).toEqual([
      'built_from',
      'sign_ups',
      null,
    ])
  }, 120_000)

  it('names an input no definition has by its name in the source, without the connector prefix', async () => {
    const file = small()
    const rate = file.metrics.find((m) => m.name === 'signup_rate')!
    ;(rate.type_params as { numerator: { name: string } }).numerator.name = 'ghost_signups'
    await commit(file)
    await read()
    const names = await treeNames('signup_rate')
    expect(names).toContain('partner_results.ghost_signups')
    expect(names.some((name) => name.startsWith('dbt:'))).toBe(false)
  }, 120_000)
})
