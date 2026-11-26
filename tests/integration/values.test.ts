import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Catalogue } from '../../src/contract/catalogue.ts'
import type { PublishItemResult } from '../../src/contract/context.ts'
import type { Feed, NamesDecision, NamesRead } from '../../src/contract/inbox.ts'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { ReviewSheet } from '../../src/contract/review-path.ts'
import type { AddValuesResult } from '../../src/contract/values.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Values people write (values without figures, V1), on the real service and PostgreSQL 18, on a
  workspace that has none, as a real install has: a writer adds one in "Applies to" and it is
  published with the item; anyone adds some in Definitions, and an owner of the dimension's domain
  or an admin publishes them, at once or from the Names card. `owner` owns Finance, `stranger`
  owns Marketing, `admin` is an administrator and `author` a member. Market has no domain, Channel
  is Marketing's, and Order date holds dates.
*/

const { client, url } = testDatabase()
const app = buildApp({
  database: apiDatabase(url),
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock: systemClock('2026-10-08'),
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
const refused = async (
  response: Promise<{ statusCode: number; body: string; json: <U>() => U }>,
) => {
  const r = await response
  expect(r.statusCode, r.body).toBe(422)
  return r.json<{ message: string }>().message
}

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    await client.query(
      "insert into area_assignments (area_id,person_id,role) values ('marketing',$1,'owner')",
      [people.stranger],
    )
    await client.query(
      `insert into vocab_terms(key,kind) values ('dim:channel','dimension'),('dim:order_date','dimension');
       insert into definitions (ref,connector_id,kind,name,change_mark,value_type) values
         ('demo:orders.market','demo','dimension','orders.market','1','string'),
         ('demo:orders.channel','demo','dimension','orders.channel','1','string'),
         ('demo:orders.order_date','demo','dimension','orders.order_date','1','time')`,
    )
    const [{ seq }] = (
      await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
    ).rows as [{ seq: string }]
    for (const [key, name, area, ref] of [
      ['metric:orders', 'Orders', 'finance', 'demo:orders'],
      ['dim:market', 'Market', null, 'demo:orders.market'],
      ['dim:channel', 'Channel', 'marketing', 'demo:orders.channel'],
      ['dim:order_date', 'Order date', null, 'demo:orders.order_date'],
    ]) {
      const term = await client.query<{ id: string }>(
        `insert into vocab_term_versions (term_key,version_no,name,area_id,content_digest)
         values($1,1,$2,$3,sha256(convert_to($1,'UTF8'))) returning id`,
        [key, name, area],
      )
      await client.query('insert into vocab_term_refs(version_id,definition_ref) values($1,$2)', [
        term.rows[0]!.id,
        ref,
      ])
      await client.query(
        "insert into vocab_term_service(term_key,version_id,editions) values($1,$2,int8range($3,null,'[)'))",
        [key, term.rows[0]!.id, seq],
      )
    }
    await client.query('select edition_seal($1)', [seq])
    await client.query('select edition_publish($1)', [seq])
  })
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
})
afterAll(async () => {
  await app.close()
})

let titles = 0
function draft(scope: NonNullable<Draft['scope']>, extra: Draft = {}): Draft {
  return {
    areaId: 'finance',
    kind: 'event',
    title: `Online sales stopped, number ${++titles}`,
    summary: 'Online sales stopped on 4 August 2026 while the payment page was down.',
    scope,
    validity: { start: '2026-08-04', end: '2026-09-01' },
    evidence: [
      {
        url: 'https://wiki.example/outage',
        quote: 'The payment page was down',
        date: '2026-10-01',
      },
    ],
    ...extra,
  }
}

/** The live values of a dimension, by key, with how the data writes each. */
const liveValues = async (dimension: string) =>
  (
    await client.query<{ key: string; name: string; aliases: string[]; writtenAs: string[] }>(
      `select s.term_key as key,v.name,v.aliases,v.written_as as "writtenAs"
         from vocab_term_service s join vocab_term_versions v on v.id=s.version_id
        where s.editions @> (select seq from live_edition) and v.parent_key=$1 order by s.term_key`,
      [dimension],
    )
  ).rows

const norway = { dimension: 'dim:market', value: 'val:market/norway' }

describe('a workspace with no values', () => {
  it('says that only a question naming the dimension gets an item on any value of it', async () => {
    const sent = await ok<ProposalRecord>(
      call('POST', '/proposals', 'author', {
        draft: draft({
          metrics: ['metric:orders'],
          dimensions: ['dim:channel'],
          dimensionValues: [],
        }),
      }),
    )
    expect(sent.findings).toContainEqual(
      expect.objectContaining({
        code: 'broad_scope',
        message:
          'Broad: it applies to all of Channel. No values of Channel are kept yet, so agents get it only when a question names Channel itself, not one of its values.',
      }),
    )
  })
})

describe('a value added in Applies to', () => {
  it('goes to the owner with the item, and is published with it in its domain', async () => {
    const sent = await ok<PublishItemResult>(
      call('POST', '/items/publish', 'author', {
        draft: draft({ metrics: ['metric:orders'], dimensions: [], dimensionValues: [norway] }),
        newValues: [{ key: 'val:market/norway', name: 'Norway' }],
      }),
    )
    expect(sent.published).toBe(false)
    expect(await liveValues('dim:market')).toEqual([])
    const sheet = await ok<ReviewSheet>(call('GET', `/review/${sent.proposalId}/sheet`, 'owner'))
    expect(sheet.newValues).toEqual([{ name: 'Norway', dimension: 'Market' }])
    expect(sheet.fields.after?.scope).toContain('Norway')
    const published = await ok<{ edition: { label: string } }>(
      call('POST', `/review/${sent.proposalId}/publish`, 'owner', {
        id: sent.proposalId,
        revision: sheet.proposal.revision,
      }),
    )
    expect(await liveValues('dim:market')).toEqual([
      { key: 'val:market/norway', name: 'Norway', aliases: [], writtenAs: [] },
    ])
    // One edition serves the item and its value, and the value takes the item's domain.
    const [value] = (
      await client.query<{ label: string; area: string }>(
        `select e.label,v.area_id as area from vocab_term_service s
           join vocab_term_versions v on v.id=s.version_id join editions e on e.seq=lower(s.editions)
          where s.term_key='val:market/norway'`,
      )
    ).rows
    expect(value).toEqual({ label: published.edition.label, area: 'finance' })
  })

  it('is published at once by an owner who writes in their own domain', async () => {
    const r = await ok<PublishItemResult>(
      call('POST', '/items/publish', 'owner', {
        draft: draft({
          metrics: ['metric:orders'],
          dimensions: [],
          dimensionValues: [{ dimension: 'dim:market', value: 'val:market/sweden' }],
        }),
        newValues: [{ key: 'val:market/sweden', name: 'Sweden' }],
      }),
    )
    expect(r.published).toBe(true)
    expect((await liveValues('dim:market')).map((v) => v.name)).toEqual(['Norway', 'Sweden'])
  })

  it('is refused for a dimension of dates, and an unknown value is still unknown', async () => {
    const dated = await refused(
      call('POST', '/items/publish', 'author', {
        draft: draft({
          metrics: ['metric:orders'],
          dimensions: [],
          dimensionValues: [{ dimension: 'dim:order_date', value: 'val:order_date/august' }],
        }),
        newValues: [{ key: 'val:order_date/august', name: 'August' }],
      }),
    )
    expect(dated).toBeTruthy()
    const sent = await ok<ProposalRecord>(
      call('POST', '/proposals', 'author', {
        draft: draft({
          metrics: ['metric:orders'],
          dimensions: [],
          dimensionValues: [{ dimension: 'dim:market', value: 'val:market/spain' }],
        }),
      }),
    )
    expect(sent.findings).toContainEqual(
      expect.objectContaining({ code: 'unknown_scope', severity: 'error' }),
    )
  })
})

describe('values added in Definitions', () => {
  it('wait for an admin when the dimension has no domain, on the Names card', async () => {
    const added = await ok<AddValuesResult>(
      call('POST', '/vocabulary/values', 'author', {
        dimension: 'dim:market',
        values: [{ name: 'Denmark', aliases: ['Danmark'], writtenAs: ['DK'] }, { name: 'Finland' }],
      }),
    )
    expect(added).toEqual({
      outcome: 'waiting',
      values: [
        { key: 'val:market/denmark', name: 'Denmark' },
        { key: 'val:market/finland', name: 'Finland' },
      ],
      edition: null,
    })
    expect((await ok<NamesRead>(call('GET', '/inbox/names', 'owner'))).values).toEqual([])
    const names = await ok<NamesRead>(call('GET', '/inbox/names', 'admin'))
    expect(names.values.map((v) => [v.name, v.dimension.name, v.by.name])).toEqual([
      ['Denmark', 'Market', 'author'],
      ['Finland', 'Market', 'author'],
    ])
    const feed = await ok<Feed>(call('GET', '/inbox/feed', 'admin'))
    expect(feed.cards.find((card) => card.group === 'names')).toMatchObject({ values: 2 })
    const [denmark, finland] = names.values
    const decided = await ok<NamesDecision>(
      call('POST', '/inbox/names/decide', 'admin', {
        revision: names.revision,
        accept: [],
        leaveOut: [],
        values: { accept: [denmark!.id], leaveOut: [finland!.id] },
      }),
    )
    expect(decided).toMatchObject({ values: { accepted: 1, leftOut: 1 } })
    expect(decided.edition).not.toBeNull()
    expect(decided.waiting.values).toEqual([])
    expect((await liveValues('dim:market')).find((v) => v.name === 'Denmark')).toEqual({
      key: 'val:market/denmark',
      name: 'Denmark',
      aliases: ['Danmark'],
      writtenAs: ['DK'],
    })
    expect((await liveValues('dim:market')).some((v) => v.name === 'Finland')).toBe(false)
  })

  it('are published at once by an owner of the dimension’s domain', async () => {
    const added = await ok<AddValuesResult>(
      call('POST', '/vocabulary/values', 'stranger', {
        dimension: 'dim:channel',
        values: [{ name: 'Webshop', aliases: ['Web'] }, { name: 'Stores' }],
      }),
    )
    expect(added.outcome).toBe('published')
    expect(added.edition).not.toBeNull()
    expect((await liveValues('dim:channel')).map((v) => v.name)).toEqual(['Stores', 'Webshop'])
  })

  it('refuses a word another value has, a dimension of dates, and an address', async () => {
    const add = (dimension: string, name: string) =>
      refused(call('POST', '/vocabulary/values', 'author', { dimension, values: [{ name }] }))
    expect(await add('dim:market', 'Norway')).toBe('Market has Norway already.')
    expect(await add('dim:market', 'danmark')).toBe('Market has Denmark already.')
    expect(await add('dim:order_date', 'August')).toBe(
      'Order date holds dates, numbers or yes and no, which have no values to add.',
    )
    expect(await add('dim:market', 'ola@example.com')).toContain('may not hold an email address')
    const twice = await refused(
      call('POST', '/vocabulary/values', 'author', {
        dimension: 'dim:market',
        values: [{ name: 'Poland' }, { name: 'poland' }],
      }),
    )
    expect(twice).toBe('poland is in the list twice.')
  })

  it('are in the catalogue with the dimension, and in the picker', async () => {
    const catalogue = await ok<Catalogue>(call('GET', '/catalogue', 'author'))
    const market = catalogue.terms.find((term) => term.key === 'dim:market')
    expect(market?.values.map((v) => v.name)).toEqual(['Denmark', 'Norway', 'Sweden'])
    expect(market?.values.find((v) => v.name === 'Denmark')?.writtenAs).toEqual(['DK'])
    const search = await ok<{ groups: { count: number; values: { name: string }[] }[] }>(
      call('GET', '/vocabulary/search?q=norway', 'author'),
    )
    expect(search.groups.flatMap((g) => g.values.map((v) => v.name))).toContain('Norway')
  })
})
