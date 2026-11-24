import { generateKeyPairSync } from 'node:crypto'
import Fastify from 'fastify'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { canRead } from '../../src/domain/links.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createDevVerifier, mintDevToken } from '../../src/server/mcp/auth.ts'
import { registerMcpRoutes } from '../../src/server/mcp/gateway.ts'
import { createServingReads } from '../../src/server/mcp/reads.ts'
import { createAnonymousStore } from '../../src/server/mcp/store.ts'
import { createEditionSource, loadLiveBundle } from '../../src/server/modules/editions/index.ts'
import type { ServingBundle } from '../../src/server/modules/editions/index.ts'
import { openEdition, version } from './fixtures.ts'
import { apiDatabase, servingPool, testDatabase, transaction } from './support.ts'

/*
  read_context reads one definition in full (FR-353), on the demo, through the real MCP server as
  an agent reaches it. Asked what a metric means when no context item is about it, an agent had no
  way to read the definition: read_context took a context item's id only, get_context gave the
  first sentence of the definition, and list_definitions one line. Now read_context reads it by a
  name, another name or its key: the source's words whole, where they come from, its owner as a
  role, and the published items about it, none here. Only what agents get is read: never a
  suggestion or a draft, a paused domain, or a person. Deterministic: no model.
*/

const { client: admin, url } = testDatabase({ seeded: true })
const pool = servingPool(url)
const database = apiDatabase(url)
const today = '2026-10-12'
const app = Fastify({ logger: false })
const resource = 'http://localhost:3000/mcp'
const { privateKey } = generateKeyPairSync('ed25519')
registerMcpRoutes(app, {
  source: createEditionSource(pool),
  store: createAnonymousStore(pool),
  resource,
  verifier: createDevVerifier(privateKey, resource, 'test'),
  now: () => new Date(`${today}T12:00:00Z`),
  wallClock: () => new Date(),
  reads: createServingReads(database, systemClock(today)),
})
let wire: Client, bundle: ServingBundle
/** The demo's return on ad spend: two sentences in Cube, and every context item about it closed. */
const roas = {
  name: 'Return on ad spend',
  words:
    'Net revenue attributed to paid media divided by paid media spend. Attribution is the last click within 30 days.',
}
let roasKey = ''
/** A suggestion about it that waits for its owner, and a draft never sent: words no agent reads. */
const waiting = { title: 'Glimmerquay attribution suggestion' }
const unsent = { title: 'Glimmerquay attribution draft' }

type Definition = {
  key: string
  name: string
  kind: string
  domain: string | null
  owner: { role: string; team: string | null }
  other_names: string[]
  words: string | null
  words_from: string
  shortened?: true
  source?: { tool: string; source: string; name: string; read_on?: string; state: string }
  context: { count: number; items: { id: string; title: string }[] }
  url: string
}
type Read = {
  status: string
  say: string
  next?: string
  message?: string
  definition?: Definition
  context?: unknown
  options?: { field: string; input: string; options: string[] }[]
  next_cursor?: string | null
}

async function read(id: string, more: Record<string, unknown> = {}) {
  const reply = await wire.callTool({ name: 'read_context', arguments: { id, ...more } })
  expect(reply.isError, JSON.stringify(reply.content)).not.toBe(true)
  return { reply: reply.structuredContent as Read, text: JSON.stringify(reply.content) }
}

beforeAll(async () => {
  const live = (await database.transaction(null, loadLiveBundle))!
  roasKey = live.terms.find((t) => t.name === roas.name)!.key
  // No context item is about it any more: a new edition closes each one that was.
  const about = live.items.filter((i) => i.scope.metrics.includes(roasKey))
  expect(about.length).toBeGreaterThan(0)
  // Each one retired by an admin, as an admin archives an item.
  for (const item of about)
    await admin.query(
      `insert into decisions (item_version_id,area_id,decided_by,capacity,outcome,reason)
       select s.version_id,$2,g.person_id,'administrator','retire','Archived for these tests'
         from item_version_service s,
              (select person_id from global_role_grants where role = 'administrator'
                 and valid_at @> now() order by person_id limit 1) g
        where s.item_id = $1 and upper_inf(s.editions)`,
      [item.id, item.areaId],
    )
  const seq = await openEdition(admin)
  for (const item of about) await admin.query('select edition_close_item($1,$2)', [seq, item.id])
  await admin.query('select edition_seal($1)', [seq])
  await admin.query('select edition_publish($1)', [seq])
  // A suggestion and a draft about it: neither is published, so neither is counted or named.
  const [person] = (await admin.query<{ id: string }>('select id from people order by id limit 1'))
    .rows
  const area = live.metricArea[roasKey]!
  await transaction(admin, async () => {
    const suggested = await version(admin, {
      title: waiting.title,
      author: person!.id,
      area,
      scope: false,
    })
    await admin.query('insert into item_version_metrics values ($1,$2)', [suggested.id, roasKey])
    await admin.query(
      `insert into proposals (action,state,area_id,item_id,item_version_id,proposer_id,channel,submitted_at)
       values ('create','submitted',$1,$2,$3,$4,'form',now())`,
      [area, suggested.item, suggested.id, person!.id],
    )
  })
  await admin.query(
    `insert into proposals (action,state,area_id,proposer_id,channel,draft,draft_saved_at)
     values ('create','draft',$1,$2,'form',$3,now())`,
    [area, person!.id, JSON.stringify({ title: unsent.title, summary: unsent.title })],
  )
  bundle = (await database.transaction(null, loadLiveBundle))!
  await admin.query(
    `insert into settings_versions (key,version,value,reason)
     select 'limits.mcp_requests_per_minute',max(version)+1,'{"client":10000,"person":10000}','test'
       from settings_versions where key='limits.mcp_requests_per_minute'`,
  )
  await admin.query('update client_policies set rate_per_minute = 10000')
  const base = await app.listen({ host: '127.0.0.1', port: 0 })
  wire = new Client(
    { name: 'read-definition', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  )
  await wire.connect(
    new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
      requestInit: {
        headers: { Authorization: `Bearer ${await mintDevToken(privateKey, resource)}` },
      },
    }),
  )
}, 300_000)
afterAll(async () => {
  await wire?.close()
  await app.close()
  await pool.end()
  await database.close()
})

describe('a metric no context item is about', () => {
  it('was only its first sentence before: get_context gives no more of its words', async () => {
    const reply = await wire.callTool({
      name: 'get_context',
      arguments: { question: 'What is return on ad spend?', metrics: [roas.name] },
    })
    const defined = JSON.stringify((reply.structuredContent as { defined?: unknown }).defined)
    expect(defined).toContain('Net revenue attributed to paid media divided by paid media spend.')
    expect(defined).not.toContain('Attribution is the last click')
  })

  it('reads in full by its name: its words whole, from Cube, with no context item', async () => {
    const { reply, text } = await read(roas.name)
    expect(reply.status).toBe('matched')
    expect(reply.say).toBe(
      `This is the whole definition of ${roas.name}, a metric. No published context item is about it.`,
    )
    expect(reply.next).toContain('get_context')
    const d = reply.definition!
    expect(d).toMatchObject({
      key: roasKey,
      name: roas.name,
      kind: 'metric',
      words: roas.words,
      source: { tool: 'Cube', name: expect.stringMatching(/return_on_ad_spend$/) as string },
      context: { count: 0, items: [] },
      url: `/definitions/${encodeURIComponent(roas.name)}`,
    })
    expect(d.words_from).toMatch(/^Cube's own words, read through Sources/)
    expect(d.shortened).toBeUndefined()
    expect(d.source!.read_on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(d.owner.role).toBe(`the owner of ${d.domain}`)
    // The page to open, after the JSON, as for every item a read gives.
    expect(text).toContain(`Open in Footnote - ${roas.name}: /definitions/`)
    expect(reply.context).toBeUndefined()
  })

  it('reads the same by its key, by its member name in Cube, and in any case', async () => {
    const byName = (await read(roas.name)).reply.definition
    expect((await read(roasKey)).reply.definition).toEqual(byName)
    expect((await read(byName!.source!.name)).reply.definition).toEqual(byName)
    expect((await read('RETURN ON AD SPEND')).reply.definition).toEqual(byName)
  })

  it('never counts or names a suggestion or a draft about it', async () => {
    const { text } = await read(roas.name)
    expect(text).not.toContain(waiting.title)
    expect(text).not.toContain(unsent.title)
  })
})

describe('a metric with context items', () => {
  it('names the published items about it an agent may read, by title, 20 to a page', async () => {
    const orders = bundle.terms.find((t) => t.name === 'Orders')!
    const readable = bundle.items
      .filter((i) => i.scope.metrics.includes(orders.key) && canRead(bundle, i, today))
      .sort((a, b) => a.title.localeCompare(b.title, 'en') || (a.id < b.id ? -1 : 1))
    expect(readable.length).toBeGreaterThan(20)
    const first = (await read('Orders')).reply
    expect(first.definition!.context.count).toBe(readable.length)
    expect(first.definition!.context.items).toEqual(
      readable.slice(0, 20).map((i) => ({ id: i.id, title: i.title })),
    )
    // Titles only: never an item's text.
    expect(JSON.stringify(first)).not.toContain(readable[0]!.summary)
    const second = (await read('Orders', { cursor: first.next_cursor })).reply
    expect(second.definition!.context.items[0]).toEqual({
      id: readable[20]!.id,
      title: readable[20]!.title,
    })
  })

  it('still reads a context item by its id', async () => {
    const item = bundle.items.find((i) => canRead(bundle, i, today))!
    const { reply } = await read(item.id)
    expect(reply).toMatchObject({ status: 'matched', context: { id: item.id } })
    expect(reply.definition).toBeUndefined()
  })
})

describe('words that name no definition', () => {
  it('come back with the closest names and where to find one', async () => {
    const { reply } = await read('Return on add spend')
    expect(reply.status).toBe('no_match')
    expect(reply.say).toBe(
      "There's no definition or context item by that name or id that you can read.",
    )
    expect(reply.next).toBe(
      'Call again with one of options, the closest names, or find it with list_definitions or find_context.',
    )
    expect(reply.options![0]!.options[0]).toBe(`${roasKey} (${roas.name})`)
    expect(reply.message).toContain('Find definitions with list_definitions or find_context.')
    expect(reply.definition).toBeUndefined()
  })

  it('come back alike for a source member no published definition names', async () => {
    const { reply } = await read('zzqx_unpublished_member')
    expect(reply).toMatchObject({ status: 'no_match' })
    expect(reply.options).toBeUndefined()
  })
})

describe('what agents may read', () => {
  it('answers a definition in a paused domain like one that does not exist', async () => {
    const paused = bundle.terms.find((t) => t.kind === 'metric' && t.areaId)!
    await admin.query(
      "insert into overlay_events (kind,scope,area_id,reason) values ('stop_on','area',$1,'test')",
      [paused.areaId],
    )
    try {
      const { reply } = await read(paused.name)
      expect(reply.status).toBe('no_match')
      expect(reply.definition).toBeUndefined()
      expect(JSON.stringify(reply.options ?? [])).not.toContain(paused.key)
    } finally {
      await admin.query(
        "insert into overlay_events (kind,scope,area_id,reason) values ('stop_off','area',$1,'test')",
        [paused.areaId],
      )
    }
    expect((await read(paused.name)).reply.status).toBe('matched')
  })

  it('names no person, by name or email: an owner is a role and a team', async () => {
    const people = (
      await admin.query<{ name: string; email: string }>(
        'select display_name as name, email from people',
      )
    ).rows
    for (const name of ['Orders', roas.name, 'Market']) {
      const { reply } = await read(name)
      // The definition's own words, beside the titles of the items about it.
      const { context: _items, ...own } = reply.definition!
      const said = JSON.stringify({ ...reply, definition: own })
      for (const person of people) {
        expect(said).not.toContain(person.email)
        expect(said).not.toContain(person.name)
      }
    }
  })

  it('reads nothing once read_context is switched off for every agent', async () => {
    await admin.query("update tool_config set enabled=false where tool='read_context'")
    try {
      expect((await wire.listTools()).tools.map((t) => t.name)).not.toContain('read_context')
      await expect(
        wire.callTool({ name: 'read_context', arguments: { id: roas.name } }),
      ).rejects.toThrow('Tool is not enabled for this client')
    } finally {
      await admin.query("update tool_config set enabled=true where tool='read_context'")
    }
  })
})
