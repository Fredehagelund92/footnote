import { generateKeyPairSync } from 'node:crypto'
import pg from 'pg'
import Fastify from 'fastify'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { canRead, termShown } from '../../src/domain/links.ts'
import { createEditionSource, loadLiveBundle } from '../../src/server/modules/editions/index.ts'
import type { ServingBundle } from '../../src/server/modules/editions/index.ts'
import { createAnonymousStore } from '../../src/server/mcp/store.ts'
import { registerMcpRoutes } from '../../src/server/mcp/gateway.ts'
import { createDevVerifier, mintDevToken } from '../../src/server/mcp/auth.ts'
import { version } from './fixtures.ts'
import { apiDatabase, ignoreTeardownDisconnects, testDatabase, transaction } from './support.ts'

/*
  The list tools on the demo (FR-351, FR-352), through the real MCP server as an agent reaches it.
  Asked "give me 10 random metrics", an agent had no tool that lists: find_context searches words
  and get_context answers a question, so it picked ten by name search and said it could not
  sample. Now it lists every metric a page at a time and picks from them. Both tools read the live
  edition only: a draft or a suggestion waiting for review is never listed, nor an item an agent
  may not read, and an owner is a role, never a person. Deterministic: no model.
*/

const { client: admin, url } = testDatabase({ seeded: true })
const pool = ignoreTeardownDisconnects(
  new pg.Pool({
    connectionString: url,
    options: '-c role=context_layer_serve',
    types: {
      getTypeParser(oid, format): (value: string) => unknown {
        return oid === pg.types.builtins.DATE
          ? (value) => value
          : (pg.types.getTypeParser(oid, format) as (value: string) => unknown)
      },
    },
  }),
)
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
})
let wire: Client, bundle: ServingBundle
/** A suggestion that waits for its owner, and a draft never sent: words no agent may read. */
const waiting = { title: 'Glimmerquay harbour suggestion' }
const unsent = { title: 'Glimmerquay harbour draft' }
let waitingItem: string

beforeAll(async () => {
  const [person] = (await admin.query<{ id: string }>('select id from people order by id limit 1'))
    .rows
  const [area] = (await admin.query<{ id: string }>("select id from areas where name = 'Sales'"))
    .rows
  await transaction(admin, async () => {
    const suggested = await version(admin, {
      title: waiting.title,
      author: person!.id,
      area: area!.id,
    })
    waitingItem = suggested.item
    await admin.query(
      `insert into proposals (action,state,area_id,item_id,item_version_id,proposer_id,channel,submitted_at)
       values ('create','submitted',$1,$2,$3,$4,'form',now())`,
      [area!.id, suggested.item, suggested.id, person!.id],
    )
  })
  await admin.query(
    `insert into proposals (action,state,area_id,proposer_id,channel,draft,draft_saved_at)
     values ('create','draft',$1,$2,'form',$3,now())`,
    [area!.id, person!.id, JSON.stringify({ title: unsent.title, summary: unsent.title })],
  )
  bundle = (await database.transaction(null, loadLiveBundle))!
  // Room for every page these tests read, beside the call limits the gateway checks.
  await admin.query(
    `insert into settings_versions (key,version,value,reason)
     select 'limits.mcp_requests_per_minute',max(version)+1,'{"client":10000,"person":10000}','test'
       from settings_versions where key='limits.mcp_requests_per_minute'`,
  )
  await admin.query('update client_policies set rate_per_minute = 10000')
  const base = await app.listen({ host: '127.0.0.1', port: 0 })
  wire = new Client(
    { name: 'list-tools', version: '1.0.0' },
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

type Definition = {
  key: string
  name: string
  kind: 'metric' | 'dimension' | 'term'
  domain: string | null
  owner: { role: string; team: string | null }
  family: boolean
  members?: number
  meaning?: string
  url: string
}
type Listed = {
  id: string
  title: string
  kind: string
  domain: string
  applies: string
  when: string
  checked?: { role: string; date: string }
  may_be_out_of_date?: true
  url: string
}
type Page<T> = {
  status: string
  say: string
  next?: string
  total: number
  next_cursor: string | null
  definitions?: T[]
  context?: T[]
  options?: { field: string; options: string[] }[]
}

async function call<T>(name: string, args: Record<string, unknown>) {
  const reply = await wire.callTool({ name, arguments: args })
  return { reply, page: reply.structuredContent as Page<T> }
}
/** Every page of a list, by its cursors, with the replies' totals. */
async function everything<T>(name: string, args: Record<string, unknown>) {
  const all: T[] = []
  const totals = new Set<number>()
  let cursor: string | null | undefined
  do {
    const { reply, page } = await call<T>(name, { ...args, ...(cursor ? { cursor } : {}) })
    expect(reply.isError).not.toBe(true)
    all.push(...(page.definitions ?? page.context ?? []))
    totals.add(page.total)
    cursor = page.next_cursor
  } while (cursor)
  expect([...totals]).toEqual([all.length])
  return all
}
/** A fixed sequence of picks, so the sample is the same on every run. */
function picks(seed: number) {
  let state = seed
  return (below: number) => {
    state = (state * 1103515245 + 12345) % 2 ** 31
    return state % below
  }
}
const byName = (a: string, b: string) => a.localeCompare(b, 'en')

describe('give me 10 random metrics', () => {
  it('had no tool that lists: words name no metric, and get_context needs one', async () => {
    const found = await call('find_context', { query: 'metrics' })
    expect(found.page.status).toBe('no_match')
    const asked = await call('get_context', { question: 'give me 10 random metrics' })
    expect(asked.page.status).toBe('need_more_detail')
    // What the agent has now, beside them.
    const names = (await wire.listTools()).tools.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['list_definitions', 'list_context']))
  })

  it('lists every metric a page at a time, so an agent picks ten at random', async () => {
    const metrics = await everything<Definition>('list_definitions', {
      kind: 'metric',
      limit: 100,
    })
    // Every metric Definitions shows: each one outside a family, and each family once.
    const families = new Set(
      bundle.terms
        .filter((t) => t.kind === 'metric_group' && t.definitionRefs.length)
        .map((t) => t.key),
    )
    const expected = bundle.terms.filter(
      (t) =>
        termShown(bundle, t) &&
        (t.kind === 'metric' ? !(t.parentKey && families.has(t.parentKey)) : families.has(t.key)),
    )
    expect(metrics.map((m) => m.key).sort()).toEqual(expected.map((t) => t.key).sort())
    expect(metrics.length).toBeGreaterThan(20)
    expect(new Set(metrics.map((m) => m.key)).size).toBe(metrics.length)
    expect(metrics.every((m) => m.kind === 'metric')).toBe(true)
    expect(metrics.map((m) => m.name)).toEqual(metrics.map((m) => m.name).sort(byName))

    const pick = picks(7)
    const sample = new Set<string>()
    while (sample.size < 10) sample.add(metrics[pick(metrics.length)]!.key)
    expect(sample.size).toBe(10)
    for (const key of sample) expect(bundle.terms.some((t) => t.key === key)).toBe(true)
  })

  it('says what each one is, with its owner as a role and never a person', async () => {
    const all = await everything<Definition>('list_definitions', { limit: 100 })
    // Metrics, then dimensions, then terms.
    const kinds = all.map((d) => d.kind)
    const order = ['metric', 'dimension', 'term']
    expect(kinds).toEqual([...kinds].sort((a, b) => order.indexOf(a) - order.indexOf(b)))
    expect(new Set(kinds)).toEqual(
      new Set(['metric', 'dimension', ...(bundle.written.some((t) => !t.sameAs) ? ['term'] : [])]),
    )
    for (const d of all) {
      expect(d.owner.role).toBe(d.domain === null ? 'an admin' : `the owner of ${d.domain}`)
      expect(d.url).toBe(`/definitions/${encodeURIComponent(d.name)}`)
      expect(d.family).toBe(d.members !== undefined)
    }
    // A family is one entry, with how many metrics it has.
    const families = all.filter((d) => d.family)
    expect(families.map((d) => d.key).sort()).toEqual(
      bundle.terms
        .filter((t) => t.kind === 'metric_group' && t.definitionRefs.length && termShown(bundle, t))
        .map((t) => t.key)
        .sort(),
    )
    for (const family of families)
      expect(family.members).toBe(bundle.terms.filter((t) => t.parentKey === family.key).length)
    expect(all.some((d) => d.meaning)).toBe(true)
    // No person and no email: the people of the demo are named nowhere.
    const { rows } = await admin.query<{ name: string; email: string | null }>(
      'select display_name as name, email from people',
    )
    const text = JSON.stringify(all)
    expect(text).not.toMatch(/@/)
    for (const person of rows) {
      expect(text).not.toContain(`"${person.name}"`)
      if (person.email) expect(text).not.toContain(person.email)
    }
  })

  it('pages in a fixed order without a repeat, and refuses a cursor of other filters', async () => {
    const first = await call<Definition>('list_definitions', { limit: 10 })
    expect(first.page.definitions).toHaveLength(10)
    expect(first.page.say).toMatch(/^There are [\d,]+ definitions; 1 to 10 are shown\.$/)
    expect(first.page.next).toContain('Pass next_cursor as cursor for the next page.')
    const again = await call<Definition>('list_definitions', { limit: 10 })
    expect(again.page.definitions).toEqual(first.page.definitions)
    const second = await call<Definition>('list_definitions', {
      limit: 10,
      cursor: first.page.next_cursor,
    })
    expect(second.page.say).toMatch(/; 11 to 20 are shown\.$/)
    const keys = [...first.page.definitions!, ...second.page.definitions!].map((d) => d.key)
    expect(new Set(keys).size).toBe(20)
    const whole = await call<Definition>('list_definitions', { limit: 20 })
    expect(whole.page.definitions!.map((d) => d.key)).toEqual(keys)
    // A cursor belongs to its filters.
    const other = await call('list_definitions', {
      kind: 'dimension',
      cursor: first.page.next_cursor,
    })
    expect(other.reply.isError).toBe(true)
    expect(other.page.status).toBe('check_failed')
  })

  it('takes 25 to a page by default and never more than 100', async () => {
    const plain = await call<Definition>('list_definitions', {})
    expect(plain.page.definitions).toHaveLength(25)
    const most = await call<Definition>('list_definitions', { limit: 100 })
    expect(most.page.definitions!.length).toBeLessThanOrEqual(100)
    const over = await call('list_definitions', { limit: 101 })
    expect(over.reply.isError).toBe(true)
    expect(JSON.stringify(over.reply)).toMatch(/limit/)
    const contextOver = await call('list_context', { limit: 500 })
    expect(contextOver.reply.isError).toBe(true)
    // A page that cannot fit the size limit ends sooner, and the next one starts where it ends.
    const small = await call<Listed>('list_context', { limit: 100, max_bytes: 4000 })
    expect(small.reply.isError).not.toBe(true)
    const shown = small.page.context!.length
    expect(shown).toBeGreaterThan(0)
    expect(shown).toBeLessThan(100)
    const next = await call<Listed>('list_context', {
      limit: 100,
      cursor: small.page.next_cursor,
    })
    const straight = await call<Listed>('list_context', { limit: shown + 1 })
    expect(next.page.context![0]!.id).toBe(straight.page.context![shown]!.id)
  })

  it('filters by domain, kind and words, and says when a domain is not known', async () => {
    const sales = await everything<Definition>('list_definitions', { domain: 'Sales', limit: 100 })
    expect(sales.length).toBeGreaterThan(0)
    expect(new Set(sales.map((d) => d.domain))).toEqual(new Set(['Sales']))
    const dimensions = await everything<Definition>('list_definitions', {
      kind: 'dimension',
      limit: 100,
    })
    expect(dimensions.every((d) => d.kind === 'dimension')).toBe(true)
    const revenue = await everything<Definition>('list_definitions', {
      query: 'revenue',
      limit: 100,
    })
    expect(revenue.length).toBeGreaterThan(0)
    expect(revenue.every((d) => /revenue/i.test(d.name) || d.kind !== 'term')).toBe(true)
    const none = await call<Definition>('list_definitions', { query: 'zebrafjord' })
    expect(none.page).toMatchObject({ status: 'no_match', total: 0, next_cursor: null })
    const unknown = await call<Definition>('list_definitions', { domain: 'Atlantis' })
    expect(unknown.page.status).toBe('need_more_detail')
    expect(unknown.page.say).toBe("There's no domain by that name, so nothing was listed.")
    expect(unknown.page.options![0]!.options).toContain('Sales')
  })
})

describe('list_context', () => {
  it('lists every published item an agent may read, and never a draft or a suggestion', async () => {
    const listed = await everything<Listed>('list_context', { limit: 100 })
    const readable = bundle.items.filter(
      (item) => item.status === 'accepted' && canRead(bundle, item, today),
    )
    expect(listed.map((i) => i.id).sort()).toEqual(readable.map((i) => i.id).sort())
    expect(listed.length).toBeGreaterThan(100)
    // Some items the demo holds are not listed: an agent may not read them.
    expect(bundle.items.length).toBeGreaterThan(listed.length)
    expect(listed.map((i) => i.title)).toEqual(listed.map((i) => i.title).sort(byName))

    // A suggestion waiting for review, or a draft never sent, is no item an agent reads (as
    // decided for agents): neither its words nor its id show, listed whole or by its words.
    const text = JSON.stringify(listed)
    for (const words of ['Glimmerquay', waitingItem]) expect(text).not.toContain(words)
    const searched = await call<Listed>('list_context', { query: 'Glimmerquay harbour' })
    expect(searched.page).toMatchObject({ status: 'no_match', total: 0 })

    // Titles and dates only: never a body, a summary or a source.
    for (const item of listed) {
      expect(Object.keys(item)).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^(body|summary|evidence|source)$/)]),
      )
      expect(item.when.length).toBeGreaterThan(0)
      expect(item.url).toBe(`/context/${item.id}`)
    }
    // Due for a check, as get_context says it.
    const due = listed.filter((i) => i.may_be_out_of_date)
    const unverified = readable.filter(
      (i) => i.checkFlag !== null || (i.reviewDate !== null && i.reviewDate < today),
    )
    expect(due.map((i) => i.id).sort()).toEqual(unverified.map((i) => i.id).sort())
  })

  it('filters by kind, domain and words of the title', async () => {
    const events = await everything<Listed>('list_context', { kind: 'event', limit: 100 })
    expect(events.length).toBeGreaterThan(0)
    expect(events.every((i) => i.kind === 'event')).toBe(true)
    const sales = await everything<Listed>('list_context', { domain: 'Sales', limit: 100 })
    expect(sales.length).toBeGreaterThan(0)
    expect(sales.every((i) => i.domain === 'Sales')).toBe(true)
    const word = events[0]!.title.split(' ')[0]!
    const titled = await everything<Listed>('list_context', { query: word, limit: 100 })
    expect(titled.map((i) => i.id)).toContain(events[0]!.id)
    const { page } = await call<Listed>('list_context', { query: 'zebrafjord' })
    expect(page).toMatchObject({ status: 'no_match', total: 0, next_cursor: null })
    expect(page.next).toMatch(/proves nothing about a question: call get_context/)
  })
})
