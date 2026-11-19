import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../../src/server/app.ts'
import { systemClock } from '../../../src/server/clock.ts'
import { createLogger } from '../../../src/server/observability/logger.ts'
import { footnoteApiMethods, type FootnoteApi } from '@/api/client'
import { createHttpApi, wiredMethods } from '@/api/http'
import { describeFootnoteApi } from '../conformance/footnote-api'
import { idleJobs } from '../../server/idle-jobs.ts'
import { apiDatabase, testDatabase } from '../../integration/support.ts'
import { devPeople, OWNER, seedDemoWeek, TODAY } from '../http/demo-week.ts'
import { demoLoginServer } from '../http/login.ts'
import { demoCube, demoSecrets, inventedToken, seedDemoFigures } from '../http/demo-figures.ts'
import { gitHost, type GitHost } from '../../server/connectors/git-server.ts'
import {
  ConnectorRegistry,
  createWorkspaceSources,
} from '../../../src/server/modules/connectors/index.ts'

/*
  The app's http binding against the real service and PostgreSQL 18. The conformance suite is the
  one the mock binding passes (tests/web/mock/conformance.test.ts), for the methods wired so far,
  on the demo week (tests/web/http/demo-week.ts): Jon Abara's Inbox, as in the mock.
*/

// Someone else the demo week signs in, the comments' second voice.
const colleague = { name: 'Tomas Eriksen' }
const { client, url } = testDatabase()
// Cube's figures in the demo week: a stand-in Cube over the demo warehouse, its token invented here.
const cubeToken = inventedToken()
let cube: Awaited<ReturnType<typeof demoCube>> | undefined
// The handbook the connect flow's cases connect: Markdown in Git on this machine, behind a token
// invented here.
const handbookToken = inventedToken()
let handbook: GitHost | undefined
const app = buildApp({
  workspaceSources: createWorkspaceSources({
    secrets: demoSecrets(cubeToken),
    registry: new ConnectorRegistry([]),
  }),
  database: apiDatabase(url),
  // Read again queues the sources' job, which this test never runs.
  jobs: { ...idleJobs(), runNow: () => Promise.resolve({ outcome: 'queued', id: 'conformance' }) },
  logger: createLogger({ level: 'silent' }),
  clock: systemClock(TODAY),
  devPeople: devPeople(),
  // The agents the demo week's people connected sign in with the service's own login server.
  login: await demoLoginServer('http://localhost:3000', 'http://localhost:5173'),
})
let api: FootnoteApi | undefined
let base = ''
let address = ''
// A browser keeps the session cookie and sends its origin; this jar does both.
let cookie = ''
const jar: typeof fetch = async (request, init) => {
  const headers = new Headers(
    init?.headers ?? (request instanceof Request ? request.headers : undefined),
  )
  if (cookie) headers.set('cookie', cookie)
  headers.set('origin', address)
  const response = await fetch(request, { ...init, headers })
  const set = response.headers.getSetCookie()
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ')
  return response
}

beforeAll(async () => {
  await client.query('reset role')
  await seedDemoWeek(url)
  const admin = new URL(url)
  admin.pathname = '/postgres'
  cube = await demoCube(admin.href, cubeToken)
  await seedDemoFigures(url, cube.endpoint)
  handbook = await gitHost({ token: handbookToken })
  await handbook.repository('handbook', {
    'docs/sales/orders.md':
      '# Orders in Germany\n\nOrders in Germany include marketplace orders.\n',
    'docs/marketing/campaigns.md': '# Spring campaigns\n\nThe spring sale runs in April.\n',
  })
  // The conformance suite sends more than the default 600 requests a minute as one person; the
  // request limit is not what this file tests.
  await client.query(
    `insert into settings_versions (key, version, value, reason)
     select 'limits.api_rate_per_minute', coalesce(max(version), 0) + 1, '{"person": 10000, "ip": 10000}', 'conformance'
       from settings_versions where key = 'limits.api_rate_per_minute'`,
  )
  address = await app.listen({ host: '127.0.0.1', port: 0 })
  base = `${address}/api/v1`
  api = createHttpApi({ baseUrl: base, fetch: jar })
}, 120_000)
afterAll(async () => {
  await app.close()
  await cube?.drop()
  await handbook?.close()
})

describeFootnoteApi('http binding on PostgreSQL', () => api!, {
  person: OWNER.name,
  wired: wiredMethods,
  colleague: colleague.name,
  // Lars sent the demo week's suggestion to archive, which waits for Jon.
  sender: 'Lars Dahl',
  bystander: 'Ines Duarte',
  // The service reads its Undo window from one setting: closed to nothing for the moment, then
  // opened again, as if the clock had moved past every Undo offered.
  afterUndoWindow: async (run) => {
    const window = (seconds: number | null) =>
      client.query(
        `insert into settings_versions (key, version, value, reason)
         select 'limits.undo_seconds', coalesce(max(version), 0) + 1, $1::jsonb, 'conformance'
           from settings_versions where key = 'limits.undo_seconds'`,
        [JSON.stringify(seconds)],
      )
    const [before] = (
      await client.query<{ value: unknown }>(
        `select value from settings_current where key = 'limits.undo_seconds'`,
      )
    ).rows
    await window(0)
    try {
      await run()
    } finally {
      await window(typeof before?.value === 'number' ? before.value : 15)
    }
  },
  repository: {
    get address() {
      return handbook!.address('handbook')
    },
    token: handbookToken,
  },
})

describe('the http binding', () => {
  it('answers the reads it offers as signed out without a session', async () => {
    await api!.signOut().catch(() => undefined)
    for (const read of [
      () => api!.getLibrary(),
      () => api!.getDefinitions(),
      () => api!.searchAll({ q: 'orders' }),
    ])
      await expect(read()).rejects.toMatchObject({ kind: 'signed-out' })
  })

  it('shows an owner the draft that waits on a Not found topic of their domain, and nobody else', async () => {
    await api!.signIn({ name: OWNER.name })
    const spain = (await api!.askedThisWeek()).rows.find((r) => r.title === 'Orders in Spain')!
    expect(spain).toMatchObject({ state: 'missing', count: '9+' })
    expect(spain.next?.label).toBe('Write it')
    expect(spain.next?.href).toMatch(/^\/context\/new\?gap=[0-9a-f-]{36}$/)
    await api!.signIn({ name: 'Ines Duarte' })
    const asInes = (await api!.askedThisWeek()).rows.find((r) => r.title === 'Orders in Spain')!
    expect(asInes.next).toBeUndefined()
  })

  it("keeps the person's chats in their browser: no chat is sent to the service", async () => {
    await api!.signIn({ name: OWNER.name })
    const sent: string[] = []
    const watched = createHttpApi({
      baseUrl: base,
      fetch: async (request, init) => {
        const body = request instanceof Request ? await request.clone().text() : ''
        sent.push(`${String(request instanceof Request ? request.url : request)} ${body}`)
        return jar(request, init)
      },
    })
    await watched.getSession()
    await watched.saveChat({ id: 'chat-private', question: 'Is the Quillfeather deal in?' })
    await watched.renameChat({ id: 'chat-private', title: 'Quillfeather in October' })
    const { undo } = await watched.deleteChat({ id: 'chat-private' })
    await watched.undo({ token: undo.token })
    expect((await watched.listChats()).map((t) => t.title)).toContain('Quillfeather in October')
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.join('\n')).not.toContain('Quillfeather')
  })

  it("says Usage's median and 95 of 100 as one percentile over the range's calls", async () => {
    await api!.signIn({ name: OWNER.name })
    const { reply } = (await api!.observabilityPage({ section: 'usage', range: 7 })).usage!
    const [range] = (
      await client.query<{ median: number; p95: number }>(
        `select percentile_disc(0.5) within group (order by duration_ms) as median,
                percentile_disc(0.95) within group (order by duration_ms) as p95
           from mcp_requests
          where tool <> 'protocol' and duration_ms is not null
            and hour >= $1::date - 7 and hour < $1::date`,
        [TODAY],
      )
    ).rows
    expect(reply).toEqual(range)
  })

  it('answers every method of the interface on the service: none says not available', () => {
    const unwired = footnoteApiMethods.filter(
      (m) => !(wiredMethods as readonly string[]).includes(m),
    )
    expect(unwired).toEqual([])
  })
})
