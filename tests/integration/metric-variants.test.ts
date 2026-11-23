import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { ReviewProposal } from '../../src/contract/review.ts'
import type { SourceCheck } from '../../src/contract/sources.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createDevVerifier, mintDevToken } from '../../src/server/mcp/auth.ts'
import { registerMcpRoutes } from '../../src/server/mcp/gateway.ts'
import { createAnonymousStore } from '../../src/server/mcp/store.ts'
import {
  ConnectorRegistry,
  createWorkspaceSources,
  openLocalSecretStore,
} from '../../src/server/modules/connectors/index.ts'
import { createEditionSource } from '../../src/server/modules/editions/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import {
  asDimensions,
  fiveThousand,
  twentyFiveHundred,
  variantManifest,
  variants,
} from '../server/connectors/metric-variants-fixture.ts'
import { objectHost, type ObjectHost } from '../server/connectors/object-server.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, servingPool, testDatabase, transaction } from './support.ts'

/*
  A model with a metric per currency, on the real service and PostgreSQL 18, with every name
  invented: Test connection reads a 2,500-metric file whole and says the 5,000 one looks like
  variants of 20 metrics, the 20 families the first read would find, while the same shop with currency as a dimension says nothing; a file
  over the cap says its size. One context item applies to 25 variants and publishes in one step,
  and an agent gets it for any one of them; a question that names no metric is offered the metrics
  its words name, and never a market the install does not have.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const clock = systemClock('2026-10-08')
const secretsDir = await mkdtemp(join(tmpdir(), 'footnote-variants-'))
const store = await openLocalSecretStore(join(secretsDir, 'store'))
const registry = new ConnectorRegistry([], { secrets: store })
const app = buildApp({
  database,
  jobs: idleJobs(),
  sources: registry,
  workspaceSources: createWorkspaceSources({ secrets: store, registry }),
  logger: createLogger({ level: 'silent' }),
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
let files: ObjectHost
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
const ok = async <T>(response: Promise<{ statusCode: number; body: string; json: <U>() => U }>) => {
  const r = await response
  expect(r.statusCode, r.body).toBe(200)
  return r.json<T>()
}

/** Test connection on a file at a signed link, as an admin presses it. */
const testFile = (path: string) =>
  ok<SourceCheck>(
    call('POST', '/sources/test', 'admin', {
      type: 'dbt-metricflow',
      config: { location: 'address' },
      secrets: { fileAddress: files.link(path) },
    }),
  )

/** get_context as an agent calls it. */
async function getContext(args: Record<string, unknown>) {
  const reply = await agent.callTool({ name: 'get_context', arguments: args })
  expect(reply.isError).not.toBe(true)
  return reply.structuredContent as Record<string, unknown>
}

/** The shop's 500 metrics, 20 measures by 25 currencies, published as the names of a new install. */
const shop = variants({ measures: 20, currencies: 25, channels: 0 })

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
  files = await objectHost()
  files.put('/link/2500.json', JSON.stringify(variantManifest(twentyFiveHundred)))
  files.put('/link/5000.json', JSON.stringify(variantManifest(fiveThousand)))
  files.put('/link/dimensions.json', JSON.stringify(variantManifest(asDimensions)))
  files.put('/link/huge.json', Buffer.alloc(25_000_000, 0x20))
  await transaction(client, async () => {
    const keys = shop.map((v) => `metric:${v.name}`)
    await client.query(
      "insert into vocab_terms(key,kind) select key,'metric' from unnest($1::text[]) key",
      [keys],
    )
    // The first edition is a bootstrap: its vocabulary needs no decision.
    const [{ seq }] = (
      await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
    ).rows as [{ seq: string }]
    await client.query(
      `with v as (
         insert into vocab_term_versions (term_key,version_no,name,area_id,content_digest)
         select key,1,name,'finance',sha256(convert_to(key,'UTF8'))
           from unnest($1::text[],$2::text[]) as t(key,name)
         returning id, term_key)
       insert into vocab_term_service(term_key,version_id,editions)
       select term_key,id,int8range($3,null,'[)') from v`,
      [keys, shop.map((v) => v.title), seq],
    )
    await client.query('select edition_seal($1)', [seq])
    await client.query('select edition_publish($1)', [seq])
  })
  const base = await mcp.listen({ host: '127.0.0.1', port: 0 })
  agent = new Client(
    { name: 'metric-variants', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  )
  await agent.connect(
    new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
      requestInit: {
        headers: { Authorization: `Bearer ${await mintDevToken(privateKey, resource)}` },
      },
    }),
  )
}, 120_000)
afterAll(async () => {
  await agent?.close()
  await mcp.close()
  await app.close()
  await serving.end()
  await files.close()
  await rm(secretsDir, { recursive: true, force: true })
})

describe('Test connection on a model with a metric per currency', () => {
  it('reads a file of 2,500 metrics whole, and says they look like variants of 20', async () => {
    const check = await testFile('/link/2500.json')
    expect(check).toMatchObject({ ok: true, complete: true, metrics: 2_500 })
    expect(check.variants).toEqual({
      variants: 2_500,
      metrics: 2_500,
      bases: 20,
      // Each word splits as many names, and the read hands them over A to Z, so the words come
      // in that order; the currencies in capitals.
      splits: [
        { words: 5, examples: ['app', 'marketplace', 'store'] },
        { words: 25, examples: ['AED', 'AUD', 'BRL'] },
      ],
    })
    // And it leads with the families the first read would find (D5): each measure's 125 filter
    // variants are one family found from the calculation.
    expect(check.families).toEqual({
      families: 20,
      metrics: 2_500,
      found: { declared: 0, calculation: 20, rate: 0, names: 0 },
      example: 'Chargebacks',
    })
  }, 120_000)

  it('names the shape of 5,000, and says nothing of the same shop with currency as a dimension', async () => {
    expect((await testFile('/link/5000.json')).variants).toMatchObject({
      variants: 5_000,
      bases: 20,
    })
    const dimensions = await testFile('/link/dimensions.json')
    expect(dimensions).toMatchObject({ ok: true, metrics: 20 })
    expect(dimensions).not.toHaveProperty('variants')
    expect(dimensions).not.toHaveProperty('families')
  }, 120_000)

  it('says how large a file over the cap is, and the most it reads', async () => {
    const check = await testFile('/link/huge.json')
    expect(check.ok).toBe(false)
    expect(check.steps.find((step) => step.id === 'read')).toMatchObject({
      status: 'failed',
      detail: 'The file is 25 MB; the most it reads is 20 MB.',
    })
  }, 120_000)
})

describe('one context item on 25 variants', () => {
  const revenue = shop.filter((v) => v.measure === 'revenue')

  it('publishes in one step, and an agent gets it for any one of them', async () => {
    expect(revenue).toHaveLength(25)
    const created = await ok<ProposalRecord>(
      call('POST', '/proposals', 'author', {
        draft: {
          areaId: 'finance',
          title: 'Revenue counts a gift card when it is spent',
          summary: 'Revenue counts a gift card when it is spent, not when it is sold.',
          scope: {
            metrics: revenue.map((v) => `metric:${v.name}`),
            dimensions: [],
            dimensionValues: [],
          },
          validity: { start: '2026-08-04', end: null },
          evidence: [{ url: 'https://example.test/note', quote: 'Noted', date: '2026-08-04' }],
        },
      }),
    )
    const submitted = await ok<ProposalRecord>(
      call('POST', `/proposals/${created.id}/submit`, 'author', { revision: created.revision }),
    )
    expect(
      (
        await client.query<{ level: string; outcome: string }>(
          'select level,outcome from check_results where item_version_id=$1 order by level',
          [submitted.itemVersionId],
        )
      ).rows,
    ).toContainEqual({ level: 'delivery', outcome: 'passed' })
    const sheet = await ok<{ proposal: ReviewProposal; clashes: { itemId: string }[] }>(
      call('GET', `/review/${submitted.id}/sheet`, 'owner'),
    )
    await ok(
      call('POST', `/review/${submitted.id}/publish`, 'owner', {
        revision: sheet.proposal.revision,
        relations: sheet.clashes.map((clash) => ({ itemId: clash.itemId, relation: 'unrelated' })),
      }),
    )
    for (const v of [revenue[0]!, revenue[17]!, revenue.at(-1)!]) {
      const reply = await getContext({
        question: `What should I know about ${v.title}?`,
        window: { from: '2026-10-01', to: '2026-10-31' },
      })
      // matched is the reply's status for Checked.
      expect(reply.status, v.title).toBe('matched')
      expect((reply.context as { id: string }[]).map((item) => item.id)).toEqual([submitted.itemId])
    }
  }, 120_000)

  it('offers a question that names no metric the metrics its words name, and never a market', async () => {
    const reply = await getContext({ question: 'What should I know about revenue?' })
    expect(reply.status).toBe('need_more_detail')
    const said = `${String(reply.say)} ${String(reply.next)}`
    expect(said).toContain('such as Revenue (AED), Revenue (AUD) or Revenue (BRL)')
    expect(JSON.stringify(reply)).not.toMatch(/market/i)
  })
})
