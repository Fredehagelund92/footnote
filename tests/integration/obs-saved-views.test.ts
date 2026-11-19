import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ObsView } from '../../src/contract/observability.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import type { DevPerson } from '../../src/server/modules/auth/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation } from './fixtures.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  Overview's saved views by keys (FR-620): a view keeps a dimension's chip by its values' keys, up
  to 20 chips, and reads back as it was saved.
*/

const { client, url } = testDatabase()
const devPeople: DevPerson[] = ['owner', 'admin'].map((name) => ({
  email: `${name}@example.test`,
  name,
  roles: [],
}))
const app = buildApp({
  database: apiDatabase(url),
  jobs: idleJobs(),
  logger: createLogger({ level: 'silent' }),
  devPeople,
  clock: systemClock('2026-10-23'),
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
async function api(name: string, method: 'GET' | 'POST', path: string, payload?: object) {
  return app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...(await login(name)), 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
}

beforeAll(async () => {
  await foundation(client)
  await app.ready()
})
afterAll(async () => {
  await app.close()
})

describe('a saved view by keys', () => {
  it('reads back every chip as it was saved: fields, dimensions by keys, any value, in order', async () => {
    const chips = [
      { key: 'dim:store', not: true, values: ['val:store/alder', 'val:store/birch_quay'] },
      { key: 'answer', values: ['missing'] },
      { key: 'dim:channel', values: ['*'] },
      ...Array.from({ length: 17 }, (_, i) => ({ key: `dim:d${i}`, values: [`val:d${i}/v`] })),
    ]
    const saved = await api('owner', 'POST', '/observability/views', {
      name: 'Twenty chips',
      filters: { chips },
    })
    expect(saved.statusCode, saved.body).toBe(200)
    const listed = await api('admin', 'GET', '/observability/views')
    expect(listed.json<ObsView[]>().find((v) => v.name === 'Twenty chips')!.filters).toEqual({
      chips,
    })
  })

  it('refuses a 21st chip, a dimension twice, and a value of another dimension', async () => {
    const save = (name: string, chips: object[]) =>
      api('owner', 'POST', '/observability/views', { name, filters: { chips } })
    const many = Array.from({ length: 21 }, (_, i) => ({ key: `dim:d${i}`, values: ['*'] }))
    expect((await save('Too many', many)).statusCode).toBe(400)
    const store = { key: 'dim:store', values: ['val:store/alder'] }
    expect((await save('Twice', [store, store])).statusCode).toBe(400)
    expect(
      (await save('Not its own', [{ key: 'dim:store', values: ['val:channel/alder'] }])).statusCode,
    ).toBe(400)
  })
})
