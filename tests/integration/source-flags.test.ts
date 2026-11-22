import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { ReviewProposal } from '../../src/contract/review.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createToolService } from '../../src/server/mcp/service.ts'
import {
  ConnectorRegistry,
  ConnectorService,
  createCubeSource,
} from '../../src/server/modules/connectors/index.ts'
import type { DefinitionSource } from '../../src/server/modules/connectors/types.ts'
import { createEditionSource } from '../../src/server/modules/editions/index.ts'
import { readConnectors } from '../../src/server/modules/jobs/operations.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, servingPool, testDatabase, transaction } from './support.ts'

/*
  S12b end to end on recorded Cube model files (CON-108): a change in the Cube model reaches the
  items that reference or mention it. A referenced definition that changed flags its items
  `needs_check`, one that disappeared flags them `source_missing` with the renamed id; both are
  delivered as unverified and their owners are told. A definition an item only mentions never
  flags it: the link shows `source_changed` or `source_missing`, the database's stale links hold
  it, and the owner is informed. An outage changes nothing (CON-213, CON-214).
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const app = buildApp({
  database,
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock: systemClock('2026-10-08'),
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
})
const servePool = servingPool(url)
const refuse = (): Promise<never> => Promise.reject(new Error('not recorded in this test'))
const execute = createToolService(
  createEditionSource(servePool, 0),
  { write: refuse, reportGap: refuse, feedback: refuse },
  () => new Date('2026-10-08T12:00:00Z'),
)

const fixture = fileURLToPath(new URL('../fixtures/cube/model/model.yml', import.meta.url))
let modelDir = ''
let configDir = ''
let renamesFile = ''
let cube: ConnectorService
/** The same source once its connector computes marks another way: the next mark version. */
let recomputed: ConnectorService
/** Its first read under that version, which could not read the member no item uses. */
let recomputedInPart: ConnectorService
/**
 * Writes the model folder as a change in the Cube repository would leave it. Every view used here
 * belongs to the finance domain, so the accepted items match their definitions' domains.
 */
async function writeModel(transform: (text: string) => string = (text) => text) {
  const base = (await readFile(fixture, 'utf8'))
    .replace('        meta:\n          domain: commerce\n', '')
    .replace('domain: marketing', 'domain: finance')
  await writeFile(join(modelDir, 'model.yml'), transform(base))
}
const withCountDescription = (text: string) =>
  text.replace('type: count\n', 'type: count\n        description: Orders placed.\n')
const withGrowthRenamed = (text: string) => text.replace('- name: growth', '- name: expansion')

/**
 * A source whose connector moved its mark version: every mark is new, nothing else is. With
 * `leftOut`, the read is in part and lacks that member.
 */
function nextMarkVersion(source: DefinitionSource, leftOut?: string): DefinitionSource {
  return {
    ...source,
    markVersion: source.markVersion + 1,
    async read(context) {
      const read = await source.read(context)
      return {
        ...read,
        complete: read.complete && leftOut === undefined,
        definitions: read.definitions
          .filter((definition) => definition.ref !== leftOut)
          .map((definition) => ({
            ...definition,
            changeMark: createHash('sha256').update(`next ${definition.changeMark}`).digest('hex'),
          })),
      }
    },
  }
}

type Link = {
  rel: string
  target: { id: string; label: string; status: string; renamed_to?: string }
}
type Delivered = {
  id: string
  freshness: string
  unverified_reason?: string
  links: Link[]
}
async function deliveries(): Promise<Delivered[]> {
  const result = await execute(
    'get_context',
    {
      question: '',
      metrics: ['metric:order_count', 'metric:revenue', 'metric:growth_revenue'],
      window: { from: '2026-08-10', to: '2026-08-20' },
      response_format: 'full',
    },
    { client: 'claude-code', scopes: ['read'], caller: 'agent', canSelectEdition: false },
    200000,
    () => {},
  )
  return (result.structuredContent as { context: Delivered[] }).context
}
const delivery = async (id: string) => (await deliveries()).find((item) => item.id === id)
const mention = (item: Delivered | undefined) => item?.links.find((l) => l.rel === 'mentions')

type Who = keyof typeof people
const headers: Record<string, Record<string, string>> = {}
const call = (method: 'GET' | 'POST', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
function ok<T>(response: Awaited<ReturnType<typeof call>>): T {
  expect(response.statusCode, response.body).toBe(200)
  return response.json<T>()
}
/** The owner publishes a suggestion, as the review in the Inbox does: unrelated to any clash. */
async function decide(id: string) {
  const sheet = ok<{ proposal: ReviewProposal; clashes: { itemId: string }[] }>(
    await call('GET', `/review/${id}/sheet`, 'owner'),
  )
  return ok(
    await call('POST', `/review/${id}/publish`, 'owner', {
      revision: sheet.proposal.revision,
      relations: sheet.clashes.map((clash) => ({ itemId: clash.itemId, relation: 'unrelated' })),
    }),
  )
}
/** A low-risk note proposed by the author and accepted by the owner, live in a new edition. */
async function accepted(extra: Draft, itemId?: string): Promise<string> {
  const created = ok<ProposalRecord>(
    await call('POST', '/proposals', 'author', {
      draft: {
        areaId: 'finance',
        validity: { start: '2026-08-04', end: null },
        evidence: [{ url: 'https://example.test/note', quote: 'Noted', date: '2026-08-04' }],
        ...extra,
      },
      ...(itemId ? { itemId } : {}),
    }),
  )
  const submitted = ok<ProposalRecord>(
    await call('POST', `/proposals/${created.id}/submit`, 'author', {
      revision: created.revision,
    }),
  )
  await decide(submitted.id)
  return submitted.itemId!
}

async function relay() {
  await client.query('select * from cl_outbox_relay(1000)')
}
/** The owner's inbox entries about sources, oldest first, after the relay ran. */
async function ownerNotices() {
  await relay()
  const rows = await client.query<{ kind: string; subject: string; state: string }>(
    `select kind, subject_id as subject, payload->>'state' as state from inbox_items
      where person_id = $1 and kind in ('item.flagged', 'item.links_stale', 'vocabulary.domain_changed')
      order by event_seq`,
    [people.owner],
  )
  return rows.rows
}
const activeFlags = async () =>
  (
    await client.query<{ item_id: string; flag: string; reason: string }>(
      "select item_id, flag::text, reason from v_overlay_on where kind = 'flag_on' order by item_id, flag",
    )
  ).rows
/** Mentions in live items whose target went stale: item and status, by item. */
const staleLinks = async () =>
  (
    await client.query<{ item_id: string; status: string }>(
      'select item_id, status from v_stale_links order by item_id, field, position',
    )
  ).rows
const overlayEvents = async () =>
  (await client.query<{ n: number }>('select count(*)::int as n from overlay_events')).rows[0]!.n

const items = { a: '', b: '', c: '', d: '' }
let noticesBefore = 0

beforeAll(async () => {
  modelDir = await mkdtemp(join(tmpdir(), 'footnote-flags-model-'))
  configDir = await mkdtemp(join(tmpdir(), 'footnote-flags-config-'))
  renamesFile = join(configDir, 'renames.json')
  await writeModel()
  await writeFile(renamesFile, JSON.stringify({}))
  const source = createCubeSource({ modelDir, renamesFile })
  cube = new ConnectorService(database, new ConnectorRegistry([source]))
  recomputed = new ConnectorService(database, new ConnectorRegistry([nextMarkVersion(source)]))
  recomputedInPart = new ConnectorService(
    database,
    new ConnectorRegistry([nextMarkVersion(source, 'cube:sales.country')]),
  )
  await foundation(client)
  expect((await cube.sync('cube')).status).toBe('ok')
  await transaction(client, async () => {
    await client.query(`insert into vocab_terms(key,kind) values
      ('metric:order_count','metric'),('metric:revenue','metric'),('metric:growth_revenue','metric')`)
    // The first edition is a bootstrap: its vocabulary needs no decision.
    const [{ seq }] = (
      await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
    ).rows as [{ seq: string }]
    for (const [key, name, ref] of [
      ['metric:order_count', 'Orders', 'cube:sales.count'],
      ['metric:revenue', 'Revenue', 'cube:sales.revenue'],
      ['metric:growth_revenue', 'Growth revenue', 'cube:growth.revenue'],
    ]) {
      const term = await client.query<{ id: string }>(
        `with v as (insert into vocab_term_versions (term_key,version_no,name,area_id,content_digest) values($1,1,$2,'finance',sha256(convert_to($1,'UTF8'))) returning id), r as (insert into vocab_term_refs (version_id,definition_ref) select id,$3 from v where $3::text is not null) select id from v`,
        [key, name, ref],
      )
      await client.query(
        "insert into vocab_term_service(term_key,version_id,editions) values($1,$2,int8range($3,null,'[)'))",
        [key, term.rows[0]!.id, seq],
      )
    }
    await client.query('select edition_seal($1)', [seq])
    await client.query('select edition_publish($1)', [seq])
  })
  for (const name of Object.keys(people)) {
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
  // A and C reference a definition through their scope; B and D only mention one.
  items.a = await accepted({
    title: 'Order count caveat',
    summary: 'Orders were double counted',
    scope: { metrics: ['metric:order_count'], dimensions: [], dimensionValues: [] },
  })
  items.b = await accepted({
    title: 'Revenue note',
    summary: 'Revenue dipped while @[orders](metric:order_count) held',
    scope: { metrics: ['metric:revenue'], dimensions: [], dimensionValues: [] },
  })
  items.c = await accepted({
    title: 'Growth revenue caveat',
    summary: 'Growth revenue excludes refunds',
    scope: { metrics: ['metric:growth_revenue'], dimensions: [], dimensionValues: [] },
  })
  items.d = await accepted({
    title: 'Revenue and growth',
    summary: 'Compare with @[growth revenue](metric:growth_revenue)',
    scope: { metrics: ['metric:revenue'], dimensions: [], dimensionValues: [] },
  })
  noticesBefore = (await ownerNotices()).length
}, 60_000)

afterAll(async () => {
  await app.close()
  await servePool.end()
  await rm(modelDir, { recursive: true, force: true })
  await rm(configDir, { recursive: true, force: true })
})

describe('Cube change flags, the needs-check flow and stale links', () => {
  it('starts verified, with current links and nothing flagged', async () => {
    const all = await deliveries()
    expect(all.map((item) => item.id).sort()).toEqual(Object.values(items).sort())
    expect(all.every((item) => item.freshness === 'verified')).toBe(true)
    expect(mention(await delivery(items.b))?.target.status).toBe('current')
    expect(await activeFlags()).toEqual([])
    expect(await staleLinks()).toEqual([])
    expect(noticesBefore).toBe(0)
  })

  it('flags a referencing item needs_check and only informs about an item that mentions it', async () => {
    await writeModel(withCountDescription)
    const result = await cube.sync('cube')
    expect(result).toMatchObject({
      status: 'ok',
      flags: { raised: 1, cleared: 0 },
      staleLinkNotices: 1,
      domainNotices: 0,
    })
    expect(await activeFlags()).toEqual([
      { item_id: items.a, flag: 'needs_check', reason: 'Definition changed: cube:sales.count' },
    ])
    // The owner's Due for a check card names the definition that changed, and the day it did.
    const feed = ok<{ cards: { id: string; group: string; changed?: unknown }[] }>(
      await call('GET', '/inbox/feed?tab=all', 'owner'),
    )
    const today = await client.query<{ day: string }>(
      "select (now() at time zone 'UTC')::date::text as day",
    )
    expect(feed.cards.find((c) => c.id === `check:${items.a}`)).toMatchObject({
      group: 'check',
      reason: 'source',
      // The published term's name, not the tool's title 'Sales Count'.
      changed: [{ name: 'Orders', on: today.rows[0]!.day }],
    })
    // The name is one the owner's Definitions list has, so the card's button finds its page.
    const listed = ok<{ terms: { name: string; definitions: { ref: string }[] }[] }>(
      await call('GET', '/catalogue', 'owner'),
    )
    expect(
      listed.terms.filter((t) => t.definitions.some((d) => d.ref === 'cube:sales.count')),
    ).toEqual([expect.objectContaining({ name: 'Orders' })])
    // C18: still delivered, labelled unverified with the state needs_check.
    expect(await delivery(items.a)).toMatchObject({
      freshness: 'unverified',
      unverified_reason: 'needs_check',
    })
    // L05 for a change: B mentions the metric, so it is delivered as before with a stale link.
    const b = await delivery(items.b)
    expect(b?.freshness).toBe('verified')
    expect(mention(b)?.target).toMatchObject({
      id: 'metric:order_count',
      label: 'orders',
      status: 'source_changed',
    })
    expect(await ownerNotices()).toEqual([
      { kind: 'item.flagged', subject: items.a, state: 'needs_check' },
      { kind: 'item.links_stale', subject: items.b, state: 'stale' },
    ])
    expect(await staleLinks()).toEqual([{ item_id: items.b, status: 'source_changed' }])
    // A second read of the same model changes nothing and tells nobody again.
    expect(await cube.sync('cube')).toMatchObject({
      flags: { raised: 0, cleared: 0 },
      staleLinkNotices: 0,
    })
    expect(await ownerNotices()).toHaveLength(2)
  }, 30_000)

  it('keeps every flag, link status and reply while the source cannot be read', async () => {
    const events = await overlayEvents()
    const before = await deliveries()
    const stale = await staleLinks()
    await writeFile(join(modelDir, 'model.yml'), 'cubes: [')
    const result = await cube.sync('cube')
    expect(result).toMatchObject({ status: 'failed', flags: { raised: 0, cleared: 0 } })
    expect(await overlayEvents()).toBe(events)
    expect(await deliveries()).toEqual(before)
    expect(await staleLinks()).toEqual(stale)
    expect(await ownerNotices()).toHaveLength(2)
  }, 30_000)

  it('flags a referencing item source_missing with the renamed id, and marks mentions of it', async () => {
    await writeFile(
      renamesFile,
      JSON.stringify({ 'cube:growth.revenue': 'cube:expansion.revenue' }),
    )
    await writeModel((text) => withGrowthRenamed(withCountDescription(text)))
    const result = await cube.sync('cube')
    expect(result).toMatchObject({
      status: 'ok',
      flags: { raised: 1, cleared: 0 },
      staleLinkNotices: 1,
    })
    expect(await activeFlags()).toContainEqual({
      item_id: items.c,
      flag: 'source_missing',
      reason: 'Definition missing: cube:growth.revenue (now cube:expansion.revenue)',
    })
    expect(await delivery(items.c)).toMatchObject({
      freshness: 'unverified',
      unverified_reason: 'source_missing',
    })
    // L05: D only mentions the missing metric. It is still delivered, verified, and the link
    // says the source is missing and where it went.
    const d = await delivery(items.d)
    expect(d?.freshness).toBe('verified')
    expect(mention(d)?.target).toEqual({
      type: 'metric',
      id: 'metric:growth_revenue',
      label: 'growth revenue',
      status: 'source_missing',
      renamed_to: 'cube:expansion.revenue',
    })
    expect((await ownerNotices()).slice(2)).toEqual([
      { kind: 'item.flagged', subject: items.c, state: 'source_missing' },
      { kind: 'item.links_stale', subject: items.d, state: 'stale' },
    ])
    expect((await staleLinks()).map((link) => [link.item_id, link.status])).toEqual(
      [
        [items.b, 'source_changed'],
        [items.d, 'source_missing'],
      ].sort((x, y) => (x[0]! < y[0]! ? -1 : 1)),
    )
    // Sources lists the rename the server's file gave, and the view the member left.
    const [source] = await readConnectors(database)
    expect(source?.renames).toEqual([{ from: 'cube:growth.revenue', to: 'cube:expansion.revenue' }])
    expect(source?.views.map((view) => view.name)).toContain('expansion')
    expect(source?.views.map((view) => view.name)).not.toContain('growth')
  }, 30_000)

  it('clears needs_check when an owner says it is still true, and refreshes mentions', async () => {
    // The Inbox's Due for a check card, Still true (FR-139).
    const still = (item: string, reason: string) =>
      call('POST', '/inbox/cards/decide', 'owner', {
        card: `check:${item}`,
        action: 'still_true',
        reason,
      })
    const rechecked = await still(items.a, 'The new description does not change this caveat')
    expect(rechecked.statusCode, rechecked.body).toBe(200)
    expect((await activeFlags()).map((f) => f.item_id)).toEqual([items.c])
    expect(await delivery(items.a)).toMatchObject({ freshness: 'verified' })
    const cleared = await client.query<{ reason: string }>(
      "select reason from overlay_events where item_id = $1 and kind = 'flag_off'",
      [items.a],
    )
    expect(cleared.rows).toEqual([{ reason: 'The new description does not change this caveat' }])
    // B only had a stale mention: the recheck records the current mark, so the link is current.
    const again = await still(items.b, 'Still right with the new order count description')
    expect(again.statusCode, again.body).toBe(200)
    expect(mention(await delivery(items.b))?.target.status).toBe('current')
    expect((await staleLinks()).map((link) => link.item_id)).toEqual([items.d])
  }, 30_000)

  it('informs about a changed domain without flagging anything', async () => {
    const events = await overlayEvents()
    await writeModel((text) =>
      withGrowthRenamed(withCountDescription(text)).replace('domain: finance', 'domain: treasury'),
    )
    const result = await cube.sync('cube')
    expect(result).toMatchObject({ status: 'ok', flags: { raised: 0, cleared: 0 } })
    expect(result.domainNotices).toBe(2)
    expect(await overlayEvents()).toBe(events)
    expect((await ownerNotices()).slice(4)).toEqual([
      { kind: 'vocabulary.domain_changed', subject: 'metric:order_count', state: 'treasury' },
      { kind: 'vocabulary.domain_changed', subject: 'metric:revenue', state: 'treasury' },
    ])
    // Serving keeps the accepted area; C still waits for its missing definition.
    expect(
      (await deliveries())
        .filter((item) => item.id !== items.c)
        .every((item) => item.freshness === 'verified'),
    ).toBe(true)
  }, 30_000)

  it('tells the owners only: the author has no source notice', async () => {
    await relay()
    const author = await client.query<{ kind: string }>(
      'select kind from inbox_items where person_id = $1',
      [people.author],
    )
    expect(author.rows.some((row) => row.kind.startsWith('item.'))).toBe(false)
    expect(author.rows.some((row) => row.kind.startsWith('vocabulary.domain'))).toBe(false)
  })
})

describe('mention marks', () => {
  it('are recorded by the database and cannot be forged by the writer', async () => {
    const rows = await client.query<{ definition_ref: string; change_mark: string; now: string }>(
      `select m.definition_ref, m.change_mark, d.change_mark as now
         from item_version_mentions m join item_versions v on v.id = m.version_id
         join definitions d on d.ref = m.definition_ref
        where v.item_id = $1 order by v.version_no desc limit 1`,
      [items.b],
    )
    expect(rows.rows[0]).toMatchObject({ definition_ref: 'cube:sales.count' })
    expect(rows.rows[0]!.change_mark).toBe(rows.rows[0]!.now)
    const serving = await servePool.query(
      'select count(*)::int as n from serving_links((select seq from live_edition)) where change_mark is not null',
    )
    expect(serving.rows[0]).toEqual({ n: 2 })
    await expect(
      servePool.query('select * from v_stale_links'),
      'the serving role reads links only through serving_links',
    ).rejects.toThrow(/permission denied/)
  })
})

/*
  CON-116: a read whose connector computes marks another way stores the new marks without
  flagging. A reference whose recorded mark matched the definition's mark still matches, one that
  did not still flags, the read records it, and the owners are told once.
*/
describe('a change of mark version', () => {
  const model = (text: string) => withGrowthRenamed(withCountDescription(text))
  const rebaselineNotices = async () => {
    await relay()
    return (
      await client.query<{ area: string; subject: string; items: string[] }>(
        `select area_id as area, subject_id as subject, payload->'items' as items from inbox_items
          where person_id = $1 and kind = 'source.marks_rebaselined' order by event_seq`,
        [people.owner],
      )
    ).rows
  }
  const newestRead = async () =>
    (
      await client.query<{ mark_version: number; rebaselined: number }>(
        `select mark_version, rebaselined from connector_snapshots
          where connector_id = 'cube' order by fetched_at desc limit 1`,
      )
    ).rows[0]

  it('keeps every reference, flag and link as it was, records it and tells the owners once', async () => {
    // A changed before the new version: its reference no longer matches, and must stay flagged.
    await writeModel((text) => model(text).replace('Orders placed.', 'Orders paid for.'))
    expect((await cube.sync('cube')).flags).toEqual({ raised: 1, cleared: 0 })
    const flags = await activeFlags()
    expect(flags.map((flag) => [flag.item_id, flag.flag])).toEqual(
      [
        [items.a, 'needs_check'],
        [items.c, 'source_missing'],
      ].sort((x, y) => (x[0]! < y[0]! ? -1 : 1)),
    )
    const before = await deliveries()
    const stale = await staleLinks()
    const events = await overlayEvents()
    const notices = (await ownerNotices()).length
    const marks = (await client.query('select 1 from definition_marks')).rowCount
    expect(await newestRead()).toEqual({ mark_version: 2, rebaselined: 0 })

    const result = await recomputedInPart.sync('cube')
    expect(result).toMatchObject({
      status: 'partial',
      flags: { raised: 0, cleared: 0 },
      staleLinkNotices: 0,
      domainNotices: 0,
      rebaselined: result.definitionsSeen,
    })
    expect(await activeFlags()).toEqual(flags)
    expect(await overlayEvents()).toBe(events)
    expect(await deliveries()).toEqual(before)
    expect(await staleLinks()).toEqual(stale)
    expect(await ownerNotices()).toHaveLength(notices)
    // No definition changed: no topic is told its context may be out of date.
    expect((await client.query('select 1 from definition_marks')).rowCount).toBe(marks)
    expect(await newestRead()).toEqual({ mark_version: 3, rebaselined: result.definitionsSeen })
    // One notice for the finance owners, naming the live items whose references were kept.
    expect(await rebaselineNotices()).toEqual([
      {
        area: 'finance',
        subject: 'cube',
        items: [items.a, items.b, items.d].sort(),
      },
    ])
  }, 30_000)

  it('keeps the mark of a member the next read reaches, and tells nobody again', async () => {
    const events = await overlayEvents()
    // The first read under the new version did not reach the country; this one does.
    const result = await recomputed.sync('cube')
    expect(result).toMatchObject({ status: 'ok', flags: { raised: 0, cleared: 0 }, rebaselined: 1 })
    expect(await newestRead()).toEqual({ mark_version: 3, rebaselined: 1 })
    expect(await overlayEvents()).toBe(events)
    // No item uses the country, so nobody is told, and a read after it keeps nothing apart.
    expect(await rebaselineNotices()).toHaveLength(1)
    expect(await recomputed.sync('cube')).toMatchObject({ rebaselined: 0 })
    expect(await newestRead()).toEqual({ mark_version: 3, rebaselined: 0 })
    expect(await rebaselineNotices()).toHaveLength(1)
  }, 30_000)

  it('flags the next change of meaning as before', async () => {
    await writeModel((text) =>
      model(text)
        .replace('Orders placed.', 'Orders paid for.')
        .replace('Total order revenue.', 'Revenue after refunds.'),
    )
    const result = await recomputed.sync('cube')
    expect(result).toMatchObject({ status: 'ok', flags: { raised: 2, cleared: 0 }, rebaselined: 0 })
    expect((await activeFlags()).filter((flag) => flag.flag === 'needs_check')).toEqual(
      [items.a, items.b, items.d].sort().map((item) => ({
        item_id: item,
        flag: 'needs_check',
        reason:
          item === items.a
            ? 'Definition changed: cube:sales.count'
            : 'Definition changed: cube:sales.revenue',
      })),
    )
    expect(await rebaselineNotices()).toHaveLength(1)
  }, 30_000)

  it('keeps the recorded mark of a member that goes missing and returns unchanged', async () => {
    const later = nextMarkVersion(nextMarkVersion(createCubeSource({ modelDir, renamesFile })))
    const without = (ref: string): DefinitionSource => ({
      ...later,
      async read(context) {
        const read = await later.read(context)
        return { ...read, definitions: read.definitions.filter((d) => d.ref !== ref) }
      },
    })
    const serviceOf = (source: DefinitionSource) =>
      new ConnectorService(database, new ConnectorRegistry([source]))
    const markOf = async () =>
      (
        await client.query<{ change_mark: string }>(
          "select change_mark from definitions where ref = 'cube:sales.revenue'",
        )
      ).rows[0]!.change_mark
    expect((await serviceOf(later).sync('cube')).rebaselined).toBeGreaterThan(0)
    const kept = await markOf()
    const flagged = await activeFlags()

    expect(await serviceOf(without('cube:sales.revenue')).sync('cube')).toMatchObject({
      status: 'ok',
    })
    expect(
      (await activeFlags()).filter((flag) => flag.flag === 'source_missing').map((f) => f.item_id),
    ).toEqual(expect.arrayContaining([items.b, items.d]))

    expect(await serviceOf(later).sync('cube')).toMatchObject({ status: 'ok', rebaselined: 0 })
    expect(await markOf()).toBe(kept)
    expect(await activeFlags()).toEqual(flagged)
  }, 30_000)

  it('keeps the recorded marks when another source of the same kind takes the refs over', async () => {
    const later = nextMarkVersion(nextMarkVersion(createCubeSource({ modelDir, renamesFile })))
    await new ConnectorService(database, new ConnectorRegistry([later])).sync('cube')
    const flagged = await activeFlags()
    await client.query(
      `update connectors set removed_at = now(), removed_by = $1, enabled = false, secret_ref = null,
              origin = 'workspace' where id = 'cube'`,
      [people.owner],
    )
    const successor: DefinitionSource = {
      ...nextMarkVersion(later),
      id: 'cube-successor',
    }
    const result = await new ConnectorService(database, new ConnectorRegistry([successor])).sync(
      'cube-successor',
    )
    expect(result).toMatchObject({ status: 'ok', flags: { raised: 0, cleared: 0 } })
    expect(result.rebaselined).toBeGreaterThan(0)
    expect(await activeFlags()).toEqual(flagged)
  }, 30_000)
})
