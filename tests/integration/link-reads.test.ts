import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { DraftFromText } from '../../src/contract/context.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import {
  createPageReader,
  PageReadError,
  type PageRead,
  type PageReader,
} from '../../src/server/modules/web/index.ts'
import { pageReaderOf } from '../../src/server/service.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  Reading a link a person pastes into Draft from text (FR-144), over authenticated HTTP: the
  service as production builds it reads a link (it never did from 30 Oct to 24 Nov 2026); the
  workspace's switch turns reading off; a host an admin listed, or one under it, is never
  requested; a link with a key, or a sign-in page, drafts nothing; and the limits are counted in
  the database, failed reads too, so two service processes keep one workspace limit. The pages are
  served on this machine; the reader that opens them is the end-to-end tests' loopback reader.
*/

const { client, url } = testDatabase()
const clock = systemClock('2026-11-24')
const hits: string[] = []
let pages: Server | undefined
let base = ''

/** The page reader the app was built with, for this test: a stub, or the loopback reader. */
let reading: PageReader = () => Promise.reject(new Error('No reader set'))
const calls: string[] = []
const readPage: PageReader = (address, options) => {
  calls.push(address)
  return reading(address, options)
}
const build = (reader: PageReader | undefined) =>
  buildApp({
    database: apiDatabase(url),
    logger: createLogger({ level: 'silent' }),
    jobs: idleJobs(),
    clock,
    devPeople: Object.keys(people).map((name) => ({
      name,
      email: `${name}@example.test`,
      roles: [],
    })),
    ...(reader ? { readPage: reader } : {}),
  })
const app = build(readPage)
// A second service process on the same database, for the workspace's limit.
const second = build(readPage)
// One built as production builds it: no reader named, so the service's own.
const production = build(undefined)

type App = typeof app
type Who = keyof typeof people
const sessions = new Map<App, Record<string, Record<string, string>>>()
const fromText = (text: string, who: Who = 'author', on: App = app) =>
  on.inject({
    method: 'POST',
    url: '/api/v1/drafts/from-text',
    headers: { ...sessions.get(on)![who], 'idempotency-key': randomUUID() },
    payload: { text },
  })

async function setting(key: string, value: unknown) {
  await client.query(
    `insert into settings_versions (key, version, value, reason)
     select $1, max(version) + 1, $2, 'test' from settings_versions where key = $1`,
    [key, JSON.stringify(value)],
  )
}

const notice: PageRead = {
  url: 'https://help.example.org/returns',
  finalUrl: 'https://help.example.org/returns',
  contentType: 'text/html',
  charset: 'utf-8',
  bytes: 120,
  title: 'Returns counted on the refund day',
  paragraphs: [
    'From 1 March 2026, returns are counted on the day of the refund, not of the order.',
  ],
}

beforeAll(async () => {
  await foundation(client)
  pages = createServer((request, response) => {
    hits.push(`${request.headers.host} ${request.url}`)
    if (request.url?.startsWith('/private')) {
      response.writeHead(302, { location: '/login' })
      response.end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(
      request.url === '/login'
        ? '<title>Sign in</title><form><input name="email"><input type="password" name="pw"></form>'
        : '<title>Returns</title><p>Returns are counted on the day of the refund.</p>',
    )
  })
  const server = pages
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  for (const on of [app, second, production]) {
    const signed: Record<string, Record<string, string>> = {}
    for (const name of Object.keys(people)) {
      const response = await on.inject({
        method: 'POST',
        url: '/api/v1/auth/sign-in',
        headers: { origin: 'http://localhost', 'x-footnote-csrf': 'dev-sign-in' },
        payload: { email: `${name}@example.test` },
      })
      expect(response.statusCode, response.body).toBe(200)
      signed[name] = {
        origin: 'http://localhost',
        cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
        'x-footnote-csrf': response.json<{ csrfToken: string }>().csrfToken,
      }
    }
    sessions.set(on, signed)
  }
})
afterAll(async () => {
  await Promise.all([app.close(), second.close(), production.close()])
  const server = pages
  if (!server) return
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})
beforeEach(async () => {
  hits.length = 0
  calls.length = 0
  reading = () => Promise.resolve(notice)
  await client.query('delete from link_reads')
  await setting('links.read_pages', true)
  await setting('links.never_read_hosts', [])
  await setting('limits.link_reads', {
    person_per_hour: 20,
    person_per_day: 60,
    workspace_per_day: 300,
  })
})

describe('as production builds the service', () => {
  it('reads a link pasted into Draft from text', async () => {
    const r = await fromText('https://help.example.org/returns')
    expect(r.statusCode, r.body).toBe(200)
    const { draft } = r.json<DraftFromText>()
    expect(draft.title).toBe('Returns counted on the refund day')
    expect(draft.summary).not.toContain('https://')
    expect(draft.evidence).toEqual([
      {
        url: 'https://help.example.org/returns',
        quote: 'From 1 March 2026, returns are counted on the day of the refund, not of the order.',
        date: '2026-11-24',
      },
    ])
    expect(calls).toEqual(['https://help.example.org/returns'])
  })

  it('has a reader of the public web, which refuses this machine', async () => {
    // Before 24 Nov 2026 a service built without the test mode had no reader: the link became
    // the draft's words. Its own reader now opens the link, and refuses this machine.
    const r = await fromText(`${base}/notice`, 'author', production)
    expect(r.statusCode, r.body).toBe(422)
    expect(r.json<{ message: string }>().message).toMatch(/couldn't open that page/)
    expect(hits).toEqual([])
    // The service's wiring: the public web, or this machine too in the test mode only.
    const refused = await pageReaderOf({ webReadLoopback: false })(`${base}/notice`).catch(
      (error: unknown) => error,
    )
    expect(refused).toMatchObject({ reason: 'not_public' })
    expect((await pageReaderOf({ webReadLoopback: true })(`${base}/notice`)).title).toBe('Returns')
  })
})

describe('the workspace’s rules', () => {
  it('reads nothing when an admin turned reading links off, and still drafts pasted text', async () => {
    await setting('links.read_pages', false)
    const r = await fromText('https://help.example.org/returns')
    expect(r.statusCode).toBe(422)
    expect(r.json<{ message: string }>().message).toBe(
      "Reading links is off in this workspace. Paste the page's text instead.",
    )
    expect(calls).toEqual([])
    const words = await fromText('Returns are counted on the day of the refund from 1 March 2026.')
    expect(words.statusCode, words.body).toBe(200)
  })

  it('never requests a host an admin listed, nor its subdomains', async () => {
    reading = createPageReader({ loopback: true })
    await setting('links.never_read_hosts', ['localhost'])
    for (const host of ['localhost', 'docs.localhost']) {
      const r = await fromText(base.replace('127.0.0.1', host) + '/notice')
      expect(r.statusCode, host).toBe(422)
      expect(r.json<{ message: string }>().message).toMatch(/An admin listed that site/)
    }
    expect(hits).toEqual([])
    const read = await fromText(`${base}/notice`)
    expect(read.statusCode, read.body).toBe(200)
    expect(hits).toHaveLength(1)
  })

  it('drafts nothing from a link with a key, or from a sign-in page, and keeps no link', async () => {
    reading = createPageReader({ loopback: true })
    const key = await fromText(`${base}/notice?token=one-time`)
    expect(key.statusCode).toBe(422)
    expect(key.json<{ message: string }>().message).toMatch(/carries a key or a sign-in code/)
    expect(hits).toEqual([])
    const signIn = await fromText(`${base}/private`)
    expect(signIn.statusCode).toBe(422)
    expect(signIn.json<{ message: string }>().message).toMatch(
      /it needs a sign-in, and .+ never signs in as you\. Paste the page's text instead\.$/,
    )
    // Neither response holds a draft, and nothing was saved.
    expect(`${key.body}${signIn.body}`).not.toContain('one-time')
    const [saved] = (await client.query<{ n: number }>('select count(*)::int as n from proposals'))
      .rows
    expect(saved!.n).toBe(0)
  })
})

describe('the limits', () => {
  it('refuses the read after a person’s hourly limit with the time to wait, failed reads counting', async () => {
    await setting('limits.link_reads', {
      person_per_hour: 3,
      person_per_day: 60,
      workspace_per_day: 300,
    })
    reading = (address) =>
      address.includes('broken')
        ? Promise.reject(new PageReadError('unreachable'))
        : Promise.resolve(notice)
    expect((await fromText('https://help.example.org/broken')).statusCode).toBe(422)
    expect((await fromText('https://help.example.org/broken')).statusCode).toBe(422)
    expect((await fromText('https://help.example.org/returns')).statusCode).toBe(200)
    const over = await fromText('https://help.example.org/returns')
    expect(over.statusCode).toBe(429)
    expect(over.json<{ message: string }>().message).toBe(
      "You've read 3 links in the last hour. Try again in 1 hour, or paste the page's text instead.",
    )
    expect(calls).toHaveLength(3)
    // Another person's reads are their own.
    expect((await fromText('https://help.example.org/returns', 'owner')).statusCode).toBe(200)
    // The table keeps who and when, never an address.
    const columns = await client.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'link_reads' order by 1",
    )
    expect(columns.rows.map((c) => c.column_name)).toEqual(['person_id', 'read_at'])
  })

  it('holds the workspace’s limit across two service processes', async () => {
    await setting('limits.link_reads', {
      person_per_hour: 100,
      person_per_day: 100,
      workspace_per_day: 4,
    })
    const who: Who[] = ['author', 'owner', 'member', 'admin']
    const answers = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        fromText('https://help.example.org/returns', who[i % 4], i % 2 ? second : app),
      ),
    )
    const codes = answers.map((a) => a.statusCode).sort()
    expect(codes).toEqual([200, 200, 200, 200, 429, 429, 429, 429, 429, 429])
    expect(answers.find((a) => a.statusCode === 429)!.json<{ message: string }>().message).toMatch(
      /^This workspace has read 4 links in the last 24 hours, the most it may\. Try again in/,
    )
    expect(calls).toHaveLength(4)
  })
})

describe('the settings', () => {
  it('keep a listed host in its own form and refuse what is not a host', async () => {
    const headers = { ...sessions.get(app)!.admin, 'idempotency-key': randomUUID() }
    const list = await app.inject({ method: 'GET', url: '/api/v1/settings', headers })
    const current = list
      .json<{ key: string; version: number }[]>()
      .find((s) => s.key === 'links.never_read_hosts')!
    const put = (value: unknown, version = current.version) =>
      app.inject({
        method: 'PUT',
        url: '/api/v1/settings/links.never_read_hosts',
        headers: { ...headers, 'idempotency-key': randomUUID() },
        payload: { version, value, reason: 'test' },
      })
    expect((await put(['https://intranet.example.com/'])).statusCode).toBe(422)
    const saved = await put([' Intranet.Example.com. ', 'wiki.example.com'])
    expect(saved.statusCode, saved.body).toBe(200)
    expect(saved.json<{ value: unknown }>().value).toEqual([
      'intranet.example.com',
      'wiki.example.com',
    ])
  })
})
