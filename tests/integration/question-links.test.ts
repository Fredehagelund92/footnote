import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Feed } from '../../src/contract/inbox.ts'
import type { Question, QuestionLink } from '../../src/contract/questions.ts'
import type { ReviewSheet } from '../../src/contract/review-path.ts'
import { buildApp } from '../../src/server/app.ts'
import type { DevPerson } from '../../src/server/modules/auth/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { accept, foundation, people, publish, servingEdition, version } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Ask someone who knows: an owner copies a card's link, anyone signed in answers its one question
  as themselves, and a suggestion sent without a source waits for its owner to add or confirm one.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const devPeople: DevPerson[] = ['owner', 'member', 'admin'].map((name) => ({
  email: `${name}@example.test`,
  name,
  roles: [],
}))
const app = buildApp({
  database,
  jobs: idleJobs(),
  logger: createLogger({ level: 'silent' }),
  devPeople,
  clock: { now: () => new Date(), today: () => new Date().toISOString().slice(0, 10) },
})
const origin = 'http://localhost'
const sessions: Record<string, Record<string, string>> = {}
const today = () => new Date().toISOString().slice(0, 10)
const thisMonth = () => today().slice(0, 7) + '-01'

async function login(name: string) {
  if (sessions[name]) return sessions[name]
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { origin, 'x-footnote-csrf': 'dev-sign-in' },
    payload: { email: `${name}@example.test` },
  })
  expect(response.statusCode, response.body).toBe(200)
  return (sessions[name] = {
    cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    'x-footnote-csrf': response.json<{ csrfToken: string }>().csrfToken,
    origin,
  })
}
async function api(name: string | null, method: 'GET' | 'POST', path: string, payload?: object) {
  return app.inject({
    method,
    url: '/api/v1' + path,
    headers: {
      ...(name ? await login(name) : { origin }),
      'idempotency-key': randomUUID(),
    },
    ...(payload ? { payload } : {}),
  })
}

/** An open Not found gap about Orders this month, in Finance, with `calls` calls this week. */
async function gap(calls: number) {
  const topic = await client.query<{ id: string }>(
    `insert into topics (key,area_id,metric_keys,value_keys,month)
     values ($1,'finance','{metric:orders}','{}',$2) returning id`,
    [`test|${randomUUID()}`, thisMonth()],
  )
  const created = await client.query<{ id: string }>(
    `insert into gaps (topic_id,type,opened_by_case) values ($1,'missing',1) returning id::text`,
    [topic.rows[0]!.id],
  )
  const id = created.rows[0]!.id
  await client.query(
    `insert into gap_weekly_counts (gap_id,week,no_item_calls)
     values ($1,date_trunc('week', now() at time zone 'UTC')::date,$2)`,
    [id, calls],
  )
  return id
}
const copy = async (name: string, card: string) => {
  const response = await api(name, 'POST', '/questions/links', { card })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<QuestionLink>()
}
const question = async (name: string, id: string) => {
  const response = await api(name, 'GET', `/questions/${id}`)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<Question>()
}
const sheet = async (id: string) => {
  const response = await api('owner', 'GET', `/review/${id}/sheet`)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<ReviewSheet>()
}
const feed = async () => (await api('owner', 'GET', '/inbox/feed?tab=all')).json<Feed>()

let dueItem: string

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    await servingEdition(client)
    // An item whose check date passed: a Due for a check card.
    const due = await version(client, {
      title: 'Orders count returns separately',
      summary: 'Returns are counted apart from orders.',
      owner: people.owner,
      reviewDate: '2026-01-02',
      validity: { from: '2026-01-01', until: null },
    })
    await accept(client, due.id)
    await publish(client, due.id)
    dueItem = due.item
  })
  await app.ready()
})
afterAll(async () => {
  await app.close()
})

describe('copying a link', () => {
  it('is for the owners of the domain and the admins, one link a card', async () => {
    const id = await gap(3)
    const first = await copy('owner', `gap:${id}`)
    expect(first.copiedOn).toBe(today())
    expect((await copy('admin', `gap:${id}`)).id).toBe(first.id)
    // Someone who does not manage the card finds no card to pass on.
    const refused = await api('member', 'POST', '/questions/links', { card: `gap:${id}` })
    expect(refused.statusCode).toBe(404)
    const card = (await feed()).cards.find((c) => c.id === `gap:${id}`)
    expect(card).toMatchObject({ group: 'gap', asked: { copiedOn: today() } })
  })
})

describe('the page a link opens', () => {
  it('shows the topic and a hidden small count, to anyone signed in, and to nobody else', async () => {
    const link = await copy('owner', `gap:${await gap(3)}`)
    const read = await question('member', link.id)
    const next = new Date(Date.UTC(Number(today().slice(0, 4)), Number(today().slice(5, 7)), 1))
    expect(read).toEqual({
      id: link.id,
      kind: 'gap',
      topic: 'Orders',
      dates: { start: thisMonth(), end: next.toISOString().slice(0, 10) },
      times: null,
      minimum: 5,
      item: null,
      domain: 'Finance',
      owners: ['owner'],
      open: true,
    })
    expect((await api(null, 'GET', `/questions/${link.id}`)).statusCode).toBe(401)
    expect((await api('member', 'GET', `/questions/${randomUUID()}`)).statusCode).toBe(404)
  })
})

describe('an answer to a Nothing written yet card', () => {
  const words =
    'A carrier strike stopped deliveries for three days. Orders waited in the warehouse.'
  const answer = async (id: string, link?: string) => {
    const response = await api('member', 'POST', '/questions/answer', {
      id,
      kind: 'gap',
      words,
      dates: { start: thisMonth(), end: today() > thisMonth() ? today() : '2099-01-01' },
      ...(link ? { link } : {}),
    })
    expect(response.statusCode, response.body).toBe(200)
    return response.json<{ proposalId: string }>().proposalId
  }

  it('is a suggestion under their name, for the gap, that may come without a source', async () => {
    const id = await gap(6)
    const link = await copy('owner', `gap:${id}`)
    const proposal = await answer(link.id)
    const row = await client.query<{
      state: string
      channel: string
      gap: string
      proposer: string
      sources: number
    }>(
      `select p.state, p.channel, p.source_gap_id::text as gap, p.proposer_id::text as proposer,
              (select count(*)::int from item_version_evidence e where e.version_id=p.item_version_id) as sources
         from proposals p where p.id=$1`,
      [proposal],
    )
    expect(row.rows).toEqual([
      { state: 'submitted', channel: 'question', gap: id, proposer: people.member, sources: 0 },
    ])
    const review = await sheet(proposal)
    expect(review.readiness).toMatchObject({ state: 'no_source', title: 'Add a source first' })
    expect(review.canPublish).toBe(false)
    const refused = await api('owner', 'POST', `/review/${proposal}/publish`, {
      id: proposal,
      revision: review.proposal.revision,
    })
    expect(refused.statusCode).toBe(422)
    expect(refused.json<{ message: string }>().message).toMatch(/^Add a source before you publish/)
  })

  it('keeps a link it gave for the owner to confirm, and publishes once they did', async () => {
    const id = await gap(6)
    const link = await copy('owner', `gap:${id}`)
    const proposal = await answer(link.id, 'https://carrier.example/notice')
    const review = await sheet(proposal)
    expect(review.readiness).toMatchObject({ state: 'confirm_source' })
    expect(review.fields.after?.sources).toEqual([
      { url: 'https://carrier.example/notice', quote: null },
    ])
    // Edit then publish: the owner copies the sentence that says it.
    const draft = (await api('owner', 'GET', `/proposals/${proposal}`)).json<{
      draft: Record<string, unknown>
    }>().draft
    const published = await api('owner', 'POST', '/items/publish', {
      draftId: proposal,
      draft: {
        ...draft,
        evidence: [
          {
            url: 'https://carrier.example/notice',
            quote: 'Deliveries stop for three days.',
            date: today(),
          },
        ],
      },
    })
    expect(published.statusCode, published.body).toBe(200)
    expect(published.json()).toMatchObject({ published: true })
    const status = await client.query('select status::text from gaps where id=$1', [id])
    expect(status.rows).toEqual([{ status: 'resolved' }])
    // Covered, the link asks nothing more.
    expect((await question('member', link.id)).open).toBe(false)
    const again = await api('member', 'POST', '/questions/answer', {
      id: link.id,
      kind: 'gap',
      words,
      dates: { start: thisMonth(), end: '2099-01-01' },
    })
    expect(again.statusCode).toBe(409)
  })
})

describe('an answer to a Due for a check card', () => {
  it('reaches the card under their name, and the owner still does the check', async () => {
    const link = await copy('owner', `check:${dueItem}`)
    expect(await question('member', link.id)).toMatchObject({
      kind: 'check',
      topic: 'Orders count returns separately',
      item: { summary: 'Returns are counted apart from orders.' },
      dates: { start: '2026-01-01', end: null },
      owners: ['owner'],
      open: true,
    })
    const missingDay = await api('member', 'POST', '/questions/answer', {
      id: link.id,
      kind: 'check',
      answer: 'ended',
    })
    expect(missingDay.statusCode).toBe(422)
    const sent = await api('member', 'POST', '/questions/answer', {
      id: link.id,
      kind: 'check',
      answer: 'ended',
      endedOn: '2026-03-31',
      words: 'Returns are in orders since April.',
    })
    expect(sent.statusCode, sent.body).toBe(200)
    const card = (await feed()).cards.find((c) => c.id === `check:${dueItem}`)
    expect(card).toMatchObject({
      group: 'check',
      done: null,
      asked: { copiedOn: today() },
      answers: [
        {
          by: 'member',
          answer: 'ended',
          endedOn: '2026-03-31',
          words: 'Returns are in orders since April.',
          link: null,
        },
      ],
    })
    // Agents never read an answer: the serving role has no grant on it.
    const grants = await client.query(
      `select grantee from information_schema.role_table_grants
        where table_name in ('question_links','question_answers') and grantee like 'context_layer_serve%'`,
    )
    expect(grants.rows).toEqual([])
  })
})
