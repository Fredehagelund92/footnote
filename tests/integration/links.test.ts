import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import Fastify from 'fastify'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createDevVerifier, mintDevToken } from '../../src/server/mcp/auth.ts'
import { registerMcpRoutes } from '../../src/server/mcp/gateway.ts'
import { createAnonymousStore } from '../../src/server/mcp/store.ts'
import { createEditionSource } from '../../src/server/modules/editions/index.ts'
import { accept, foundation, openEdition, people, version } from './fixtures.ts'
import { servingPool, testDatabase, transaction } from './support.ts'

/*
  Access across links (FR-314, FR-333 to FR-335) through the real serving role and MCP wire. A
  hidden item carries a canary marker in its title, summary and body; a retired item carries
  another in its own text. Whatever an agent asks, with the links every read gives, no reply may
  hold the hidden item's id, any canary, or the retired item's content: only the author's words.
*/
const { client: admin, url } = testDatabase()
const pool = servingPool(url)
const source = createEditionSource(pool)
const app = Fastify({ logger: false })
const resource = 'http://localhost:3000/mcp'
const { privateKey } = generateKeyPairSync('ed25519')
registerMcpRoutes(app, {
  source,
  store: createAnonymousStore(pool),
  resource,
  verifier: createDevVerifier(privateKey, resource, 'test'),
  now: () => new Date('2026-10-07T12:00:00Z'),
})
const canary = `CANARY${randomBytes(6).toString('hex')}`
const retiredText = `RETIRED${randomBytes(6).toString('hex')}`
const ids = { hidden: '', retired: '', closure: '', mentioning: '' }
let wire: Client

const mention = (
  versionId: string,
  field: 'summary' | 'body',
  position: number,
  target: { term?: string; item?: string },
  label: string,
) =>
  admin.query(
    'insert into item_version_mentions (version_id,field,position,term_key,item_id,label) values ($1,$2,$3,$4,$5,$6)',
    [versionId, field, position, target.term ?? null, target.item ?? null, label],
  )

beforeAll(async () => {
  await foundation(admin)
  await transaction(admin, async () => {
    const hidden = await version(admin, {
      title: `${canary} title`,
      summary: `Orders ${canary}`,
      body: `Only the secret group may read ${canary}.`,
      audience: ['secret'],
      owner: people.owner,
    })
    const retired = await version(admin, {
      title: `${retiredText} title`,
      summary: `Orders ${retiredText}`,
      owner: people.owner,
    })
    ids.hidden = hidden.item
    ids.retired = retired.item
    const closure = await version(admin, {
      title: 'Norway closure',
      summary: 'Orders',
      markup: '@[Orders](metric:orders)',
      body: 'See the restricted note and the old rule.',
      bodyMarkup: `See @[the restricted note](item:${hidden.item}) and @[the old rule](item:${retired.item}).`,
      owner: people.owner,
    })
    ids.closure = closure.item
    await mention(closure.id, 'summary', 0, { term: 'metric:orders' }, 'Orders')
    await mention(closure.id, 'body', 0, { item: hidden.item }, 'the restricted note')
    await mention(closure.id, 'body', 1, { item: retired.item }, 'the old rule')
    const mentioning = await version(admin, {
      title: 'Tax change',
      summary: 'Orders',
      body: 'Compare with the closure.',
      bodyMarkup: `Compare with @[the closure](item:${closure.item}).`,
      owner: people.owner,
    })
    ids.mentioning = mentioning.item
    await mention(mentioning.id, 'body', 0, { item: closure.item }, 'the closure')
    for (const v of [hidden, retired, closure, mentioning]) await accept(admin, v.id)
    const first = await openEdition(admin)
    for (const v of [hidden, retired, closure, mentioning])
      await admin.query('select edition_serve_item_version($1,$2)', [first, v.id])
    const term = await admin.query<{ id: string }>(
      "with v as (insert into vocab_term_versions (term_key,version_no,name,area_id,content_digest) values('metric:orders',1,'Orders','finance',sha256('orders')) returning id), r as (insert into vocab_term_refs (version_id,definition_ref) select id,'demo:orders' from v where 'demo:orders'::text is not null) select id from v",
    )
    const proposal = await admin.query<{ id: string }>(
      "insert into proposals (subject,action,state,area_id,vocab_version_id,proposer_id,channel) values ('vocabulary','create','submitted','finance',$1,$2,'form') returning id",
      [term.rows[0]!.id, people.author],
    )
    await admin.query(
      "insert into decisions (proposal_id,vocab_version_id,area_id,decided_by,capacity,outcome,reason) values ($1,$2,'finance',$3,'owner','accept','Reviewed vocabulary')",
      [proposal.rows[0]!.id, term.rows[0]!.id, people.owner],
    )
    await admin.query('select edition_serve_vocab_version($1,$2)', [first, term.rows[0]!.id])
    await admin.query('select edition_seal($1)', [first])
    await admin.query('select edition_publish($1)', [first])
    // The rule is retired in the next edition; the closure still mentions it.
    await admin.query(
      "insert into decisions (item_version_id,area_id,decided_by,capacity,outcome,reason) values ($1,'finance',$2,'owner','retire','Ended')",
      [retired.id, people.owner],
    )
    const second = await openEdition(admin)
    await admin.query('select edition_close_item($1,$2)', [second, retired.item])
    await admin.query('select edition_seal($1)', [second])
    await admin.query('select edition_publish($1)', [second])
  })
  const base = await app.listen({ host: '127.0.0.1', port: 0 })
  wire = new Client({ name: 'links', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } })
  await wire.connect(
    new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
      requestInit: {
        headers: { Authorization: `Bearer ${await mintDevToken(privateKey, resource)}` },
      },
    }),
  )
})
afterAll(async () => {
  await wire?.close()
  await app.close()
  await pool.end()
})

const ask = async (name: string, args: Record<string, unknown>) => {
  const reply = await wire.callTool({ name, arguments: args })
  return { reply, text: JSON.stringify(reply) }
}

type Read = {
  status: string
  message?: string
  links_out: { rel: string; target: { id: string; status: string; label: string } }[]
  links_in: { count: number; items: { rel: string; id: string }[] }
  check_report: { links_withheld: number }
}
const read = async (args: Record<string, unknown>) =>
  (await ask('read_context', args)).reply.structuredContent as Read

it('offers no tool of its own for links: every read_context gives them', async () => {
  const names = (await wire.listTools()).tools.map((t) => t.name)
  expect(names).not.toContain('get_related')
  const out = await read({ id: ids.closure })
  expect(out.status).toBe('matched')
  expect(out.links_out.length).toBeGreaterThan(0)
})

it('gives visible links both ways and shows a retired target only as the author’s words', async () => {
  const out = await read({ id: ids.closure })
  const links = out.links_out.map((l) => [l.rel, l.target.id, l.target.status, l.target.label])
  expect(links).toContainEqual(['mentions', ids.retired, 'retired', 'the old rule'])
  expect(links.map(([rel, id]) => [rel, id])).toEqual(
    expect.arrayContaining([
      ['mentions', 'metric:orders'],
      ['applies_to', 'metric:orders'],
    ]),
  )
  expect(out.links_in.count).toBe(1)
  expect(out.links_in.items.map((l) => [l.rel, l.id])).toEqual([['mentioned_by', ids.mentioning]])
  // The hidden note is one withheld link, never named.
  expect(out.check_report.links_withheld).toBe(1)
})

it('never names a hidden target, nor shows a canary, through any tool', async () => {
  const replies = await Promise.all([
    ask('get_context', { question: 'Orders in August 2026' }),
    ask('get_context', { question: 'Orders in August 2026', response_format: 'full' }),
    ask('find_context', { query: canary }),
    ask('find_context', {}),
    ask('find_context', { kind: 'rule' }),
    ask('read_context', { id: ids.closure }),
    ask('read_context', { id: ids.mentioning }),
    ask('read_context', { id: ids.closure, relations: ['mentions', 'mentioned_by', 'in_area'] }),
    ask('read_context', { id: 'metric:orders' }),
    ask('read_context', { id: ids.hidden }),
    ask('read_context', { id: ids.retired }),
  ])
  for (const { text } of replies) {
    expect(text).not.toContain(canary)
    expect(text).not.toContain(ids.hidden)
    expect(text).not.toContain(retiredText)
  }
  // The delivery itself is unchanged by links: the hidden and retired items are not in it (FR-335).
  const delivered = (replies[0].reply.structuredContent as { context: { id: string }[] }).context
  expect(delivered.map((i) => i.id).sort()).toEqual([ids.closure, ids.mentioning].sort())
})

it('answers a hidden or retired item exactly as one that does not exist', async () => {
  const missing = await read({ id: 'itm_doesnotexist' })
  for (const id of [ids.hidden, ids.retired]) expect(await read({ id })).toEqual(missing)
  expect(missing).toMatchObject({ status: 'no_match', message: 'Not found' })
})

it('hides a stopped item at once, as one read and as a link', async () => {
  await admin.query(
    "insert into overlay_events (kind,scope,item_id,reason) values ('stop_on','item',$1,'Stop')",
    [ids.closure],
  )
  try {
    expect(await read({ id: ids.closure })).toMatchObject({ message: 'Not found' })
    const from = await read({ id: ids.mentioning })
    expect(from.links_out.map((l) => l.target.id)).not.toContain(ids.closure)
    expect(from.links_in.items.map((l) => l.id)).not.toContain(ids.closure)
    expect(from.check_report.links_withheld).toBe(1)
  } finally {
    await admin.query(
      "insert into overlay_events (kind,scope,item_id,reason) values ('stop_off','item',$1,'Resume')",
      [ids.closure],
    )
  }
})
