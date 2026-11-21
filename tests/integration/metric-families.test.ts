import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Catalogue } from '../../src/contract/catalogue.ts'
import type { NamesDecision, NamesRead } from '../../src/contract/inbox.ts'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { ReviewProposal } from '../../src/contract/review.ts'
import type { SourceSettings } from '../../src/contract/sources.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createDevVerifier, mintDevToken } from '../../src/server/mcp/auth.ts'
import { registerMcpRoutes } from '../../src/server/mcp/gateway.ts'
import { createAnonymousStore } from '../../src/server/mcp/store.ts'
import {
  ConnectorRegistry,
  connectorSyncJob,
  createWorkspaceSources,
  openLocalSecretStore,
} from '../../src/server/modules/connectors/index.ts'
import { createEditionSource } from '../../src/server/modules/editions/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { gitHost, type GitHost } from '../server/connectors/git-server.ts'
import { fiveThousand, variantManifest } from '../server/connectors/metric-variants-fixture.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, queueReads, servingPool, testDatabase } from './support.ts'

/*
  Families of metrics (FR-142) on the real service and PostgreSQL 18, from an empty install: a read
  of an invented shop's dbt project with a metric per currency and channel, 20 measures by 50
  currencies by 5 channels, 5,000 metrics. The read finds 20 families from the calculations' shape,
  the Names card offers each as one name, one press publishes a family with its 250 variants, the
  catalogue lists one entry per family, an item on the family publishes and an agent gets it for
  "revenue", and a change to the shared calculation flags that item once. Every name is made up.
*/

const TOKEN = 'families-it-token-5b20c7e1'
const { client, url } = testDatabase()
const database = apiDatabase(url)
const logger = createLogger({ level: 'silent' })
const clock = systemClock('2026-10-08')
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
const serving = servingPool(url)
const mcp = Fastify({ logger: false })
const resource = 'http://localhost:3000/mcp'
const { privateKey } = generateKeyPairSync('ed25519')
registerMcpRoutes(mcp, {
  source: createEditionSource(serving),
  store: createAnonymousStore(serving),
  resource,
  verifier: createDevVerifier(privateKey, resource, 'test'),
  now: () => new Date('2026-10-08T12:00:00Z'),
})
let host: GitHost
let agent: Client
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

const names = () => ok<NamesRead>(call('GET', '/inbox/names', 'admin'))
const decide = (input: object) =>
  ok<NamesDecision>(call('POST', '/inbox/names/decide', 'admin', input))
const catalogue = () => ok<Catalogue>(call('GET', '/catalogue', 'admin'))
const commit = (file: unknown) =>
  host.commit('shop', { 'semantic/semantic_manifest.json': JSON.stringify(file) })

/** One run of the sources' job, with the source made due. */
async function read() {
  await queueReads(client)
  await connectorSyncJob(registry, { clock }).run({
    database,
    logger,
    signal: new AbortController().signal,
  })
}

/** get_context as an agent calls it. */
async function getContext(args: Record<string, unknown>) {
  const reply = await agent.callTool({ name: 'get_context', arguments: args })
  expect(reply.isError).not.toBe(true)
  return reply.structuredContent as Record<string, unknown>
}

/** The shop's model, with Revenue's calculation as `expr` says. */
function shop(revenue = 'amount') {
  const file = variantManifest(fiveThousand) as {
    semantic_models: { measures: { name: string; expr: string }[] }[]
  }
  file.semantic_models[0]!.measures.find((m) => m.name === 'revenue_amount')!.expr = revenue
  return file
}

beforeAll(async () => {
  await foundation(client)
  await client.query("insert into areas (id,name) values ('sales','Sales')")
  await client.query(
    `insert into area_assignments (area_id,person_id,role) values ('sales',$1,'owner')`,
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
  await host.repository('shop', { 'semantic/semantic_manifest.json': JSON.stringify(shop()) })
  await ok<SourceSettings>(
    call('POST', '/sources', 'admin', {
      type: 'dbt-metricflow',
      name: 'dbt',
      config: {
        location: 'git',
        repository: host.address('shop'),
        ref: 'main',
        folder: 'semantic',
        file: 'semantic_manifest.json',
      },
      secrets: { token: TOKEN },
      reason: 'Our metrics live in dbt',
    }),
    201,
  )
  await read()
  const base = await mcp.listen({ host: '127.0.0.1', port: 0 })
  agent = new Client(
    { name: 'metric-families', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  )
  await agent.connect(
    new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
      requestInit: {
        headers: { Authorization: `Bearer ${await mintDevToken(privateKey, resource)}` },
      },
    }),
  )
}, 300_000)
afterAll(async () => {
  await agent?.close()
  await mcp.close()
  await app.close()
  await serving.end()
  await host.close()
  await rm(secretsDir, { recursive: true, force: true })
})

describe('the Names card on a model with a metric per currency and channel', () => {
  it('offers 20 families, each one name for its 250 variants by currency and channel', async () => {
    const { names: all } = await names()
    const families = all.filter((name) => name.kind === 'metric_group')
    expect(families).toHaveLength(20)
    expect(families.find((name) => name.name === 'Revenue')).toMatchObject({
      key: 'group:revenue',
      state: 'ready',
      areaId: 'sales',
      family: { variants: 250, by: ['Currency', 'Channel'] },
    })
    expect(families.every((name) => name.family?.variants === 250)).toBe(true)
    // No variant is a name of its own on the card.
    expect(all.filter((name) => name.kind === 'metric')).toEqual([])
    expect(all.map((name) => name.name)).not.toContain('Revenue (EUR) web')
  }, 120_000)

  it('publishes a family and its members with one press', async () => {
    const { revision } = await names()
    const decided = await decide({ revision, accept: [{ key: 'group:revenue' }], leaveOut: [] })
    expect(decided).toMatchObject({ accepted: 251, leftOut: 0 })
    const live = await client.query<{ key: string; kind: string; parent: string | null }>(
      `select key,kind::text,parent_key as parent from serving_vocabulary((select seq from live_edition))
        where key='group:revenue' or parent_key='group:revenue'`,
    )
    expect(live.rows).toHaveLength(251)
    expect(live.rows.filter((row) => row.kind === 'metric').every((row) => row.parent)).toBe(true)
    const { names: rest } = await names()
    expect(rest.map((name) => name.key)).not.toContain('group:revenue')
    await decide({
      revision: (await names()).revision,
      accept: rest.filter((name) => name.state === 'ready').map(({ key }) => ({ key })),
      leaveOut: [],
    })
    expect((await names()).names.filter((name) => name.state !== 'left_out')).toEqual([])
  }, 300_000)
})

describe('the catalogue', () => {
  it('lists one entry per family and no variant, with the variants in the family', async () => {
    const { terms, coverage } = await catalogue()
    const metrics = terms.filter((term) => term.kind === 'metric')
    expect(metrics).toHaveLength(20)
    expect(metrics.every((term) => term.family?.variants.length === 250)).toBe(true)
    expect(coverage.metrics).toBe(20)
    expect(terms.map((term) => term.name)).not.toContain('Revenue (EUR) web')
    const revenue = metrics.find((term) => term.key === 'group:revenue')!
    expect(revenue.family?.by).toEqual(['Currency', 'Channel'])
    expect(revenue.group?.name).toBeTruthy()
    expect(revenue.family?.variants).toContainEqual(
      expect.objectContaining({ name: 'Revenue (EUR) web', values: ['EUR', 'web'] }),
    )
    expect(revenue.definition).toMatchObject({ tool: 'dbt', descriptionCopy: null })
  })

  it('is searched by family: a variant’s words find its family, never the variant', async () => {
    const found = await ok<{ definitions: { key: string; name: string }[] }>(
      call('GET', `/search?q=${encodeURIComponent('Revenue (EUR) web')}`, 'author'),
    )
    // "Gross revenue (EUR) web" holds the words too: each family once, Revenue first.
    expect(found.definitions.map((d) => d.name)).toEqual([
      'Revenue',
      'Gross revenue',
      'Net revenue',
      'Subscription revenue',
    ])
    expect(found.definitions[0]).toMatchObject({ key: 'group:revenue', kind: 'metric' })
    const picked = await ok<{ metrics: { key: string; name: string; variants: number | null }[] }>(
      call('GET', `/vocabulary/search?q=${encodeURIComponent('revenue eur web')}`, 'author'),
    )
    expect(picked.metrics[0]).toMatchObject({ key: 'group:revenue', variants: 250 })
    expect(picked.metrics.every((hit) => hit.key.startsWith('group:'))).toBe(true)
    const { families } = await ok<{ families: { key: string; variants: number }[] }>(
      call('GET', '/vocabulary', 'author'),
    )
    expect(families).toHaveLength(20)
    expect(families.find((f) => f.key === 'group:revenue')?.variants).toBe(250)
  })
})

describe('an item on a family', () => {
  let itemId = ''

  it('publishes, and an agent gets it for "revenue", Checked', async () => {
    const created = await ok<ProposalRecord>(
      call('POST', '/proposals', 'author', {
        draft: {
          areaId: 'sales',
          title: 'Revenue counts a gift card when it is spent',
          summary: 'Revenue counts a gift card when it is spent, not when it is sold.',
          scope: { metrics: ['group:revenue'], dimensions: [], dimensionValues: [] },
          validity: { start: '2026-08-04', end: null },
          evidence: [{ url: 'https://example.test/note', quote: 'Noted', date: '2026-08-04' }],
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
    itemId = submitted.itemId!
    // It records every variant's definition, so a change to any of them can flag it.
    const refs = await client.query(
      `select r.definition_ref from item_version_refs r join item_versions v on v.id=r.version_id
        where v.item_id=$1`,
      [itemId],
    )
    expect(refs.rowCount).toBe(250)
    const reply = await getContext({ question: 'What should I know about revenue today?' })
    // matched is the reply's status for Checked.
    expect(reply.status).toBe('matched')
    expect((reply.context as { id: string }[]).map((item) => item.id)).toEqual([itemId])
    // The family is one metric to answer about: the reply never lists its variants.
    expect(JSON.stringify(reply)).not.toMatch(/Revenue \([A-Z]{3}\)/)
    // A question about one variant gets the family's item too.
    const one = await getContext({
      question: 'What should I know about Revenue (EUR) web?',
      window: { from: '2026-10-01', to: '2026-10-31' },
    })
    expect((one.context as { id: string }[]).map((item) => item.id)).toEqual([itemId])
    const { terms } = await catalogue()
    expect(terms.find((term) => term.key === 'group:revenue')?.shelf.items).toBe(1)
  }, 120_000)

  it('is flagged once, with one Inbox entry, when the shared calculation changes', async () => {
    await commit(shop('amount - gift_card_amount'))
    await read()
    const marks = await client.query(
      `select 1 from definition_marks m join definitions d on d.ref=m.definition_ref
        where d.ref like 'dbt:orders.revenue_%' group by m.definition_ref having count(*)=2`,
    )
    expect(marks.rowCount).toBe(250)
    const flags = await client.query<{ item_id: string; flag: string }>(
      "select item_id,flag::text from overlay_events where kind='flag_on'",
    )
    expect(flags.rows).toEqual([{ item_id: itemId, flag: 'needs_check' }])
    // Publishing 5,000 names wrote thousands of events before it: relay them all.
    while (
      (await client.query<{ relayed: number }>('select relayed from cl_outbox_relay(1000)')).rows[0]
        ?.relayed
    );
    const entries = await client.query<{ subject: string }>(
      "select subject_id as subject from inbox_items where kind='item.flagged' and person_id=$1",
      [people.owner],
    )
    expect(entries.rows).toEqual([{ subject: itemId }])
  }, 300_000)
})
