import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { LookupEvent } from '../../src/contract/answer.ts'
import type { ObsFeedback } from '../../src/contract/observability.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, servingEdition } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Good and Bad answer in Ask (FR-712): a rating keeps the verdict, the domain of the answer's
  metrics and the hour, and nothing of who rated or what was asked. Feedback counts it, a count
  under the minimum hidden (FR-614), and a second click takes it back. The clock is today's: a
  rating takes the database's hour.
*/

const { client, url } = testDatabase()
const app = buildApp({
  database: apiDatabase(url),
  jobs: idleJobs(),
  logger: createLogger({ level: 'silent' }),
  devPeople: ['owner', 'admin'].map((name) => ({
    email: `${name}@example.test`,
    name,
    roles: [],
  })),
  clock: systemClock(),
})
const origin = 'http://localhost'
const sessions: Record<string, Record<string, string>> = {}

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
async function send(name: string, method: 'GET' | 'POST', path: string, payload?: object) {
  const response = await app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...(await login(name)), 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
  expect(response.statusCode, response.body).toBe(200)
  return response
}
const call = async <T>(name: string, method: 'GET' | 'POST', path: string, payload?: object) =>
  (await send(name, method, path, payload)).json<T>()

/** What a person asked in Ask read, as metric keys: what Good answer sends with the verdict. */
async function askedMetrics(question: string) {
  const { body } = await send('owner', 'POST', '/ask/lookup', { question })
  const sent = body
    .split('\n\n')
    .map((block) => block.split('\n').find((line) => line.startsWith('data:')))
    .filter((line): line is string => !!line)
    .map((line) => JSON.parse(line.slice(5).trim()) as LookupEvent)
  const last = sent.at(-1) as Extract<LookupEvent, { type: 'turn' }>
  return (last.turn.subject?.about ?? []).filter((id) => id.startsWith('metric:'))
}

const rate = (metrics: string[], verdict: 'helpful' | 'wrong' = 'helpful') =>
  call<{ id: string }>('owner', 'POST', '/ask/ratings', { verdict, metrics })
const takeBack = (id: string) =>
  call<{ taken: boolean }>('owner', 'POST', '/ask/ratings/take-back', { id })
const feedbackWeek = async () =>
  (await call<ObsFeedback>('admin', 'GET', '/observability/feedback?range=7')).week

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    await servingEdition(client)
  })
  await client.query(
    `insert into global_role_grants (person_id, role)
     select id, 'administrator' from people where email = 'admin@example.test'
     on conflict do nothing`,
  )
  await app.ready()
})
afterAll(async () => {
  await app.close()
})

it('keeps a Good answer as its verdict, domain and hour only, counts it on Feedback, and takes it back', async () => {
  const metrics = await askedMetrics('How many orders did we have in Norway?')
  expect(metrics).toEqual(['metric:orders'])
  const { id } = await rate(metrics)
  // One row, with only its id, the verdict, the domain and the hour: this hour.
  const { rows } = await client.query<Record<string, unknown>>('select * from assistant_ratings')
  expect(rows.map((row) => Object.keys(row))).toEqual([
    ['id', 'verdict', 'area_id', 'created_hour'],
  ])
  expect(rows[0]).toMatchObject({ id, verdict: 'helpful', area_id: 'finance' })
  const { rows: hour } = await client.query(
    `select created_hour = date_trunc('hour', now(), 'UTC') as now from assistant_ratings`,
  )
  expect(hour).toEqual([{ now: true }])
  // Feedback counts whole days, up to yesterday: the ratings are moved a day back to be counted.
  const yesterday = () =>
    client.query(
      `update assistant_ratings set created_hour = date_trunc('hour', now(), 'UTC') - interval '1 day'`,
    )
  // One rating is under the minimum, so Feedback hides it; five are counted.
  await yesterday()
  expect((await feedbackWeek()).good).toBeNull()
  const more = await Promise.all([1, 2, 3, 4].map(() => rate(metrics)))
  await rate(metrics, 'wrong')
  await yesterday()
  expect(await feedbackWeek()).toMatchObject({ good: 5, wrong: null })
  // A second click on Good answer takes that one rating back, once.
  expect(await takeBack(more[0]!.id)).toEqual({ taken: true })
  expect(await takeBack(more[0]!.id)).toEqual({ taken: false })
  expect((await feedbackWeek()).good).toBeNull()
  const left = await client.query<{ verdict: string; n: number }>(
    `select verdict::text, count(*)::int as n from assistant_ratings group by 1 order by 1`,
  )
  expect(left.rows).toEqual([
    { verdict: 'helpful', n: 4 },
    { verdict: 'wrong', n: 1 },
  ])
})

it('keeps no domain for metrics of no domain, and refuses anything beside the verdict and metrics', async () => {
  const { id } = await rate([])
  const { rows } = await client.query('select area_id from assistant_ratings where id = $1', [id])
  expect(rows).toEqual([{ area_id: null }])
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/ask/ratings',
    headers: { ...(await login('owner')), 'idempotency-key': randomUUID() },
    payload: { verdict: 'helpful', question: 'How many orders?' },
  })
  expect(response.statusCode).toBe(400)
})
