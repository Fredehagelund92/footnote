import { describe, expect, it } from 'vitest'
import { buildApp } from '../../src/server/app.ts'
import { createDevSignIn, type DevPerson } from '../../src/server/modules/auth/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  Who you are on an install of your own data (the cold first use scout, call 2). The picker has no
  sample people there: its first visitor says their name, their email and the workspace's name,
  becomes its admin and is signed in. After that the picker offers the people of the workspace. The
  demo keeps its sample people, and a list of people the host gave is offered as it is.
*/

const { client, url } = testDatabase()
// A workspace of its own for the two visits at once: nobody is ever deleted from one.
const race = testDatabase()
const sample: DevPerson[] = [
  { name: 'Ravi Kapoor', email: 'per_ravi@example.test', roles: ['administrator'] },
  { name: 'Jon Abara', email: 'per_jon@example.test', roles: [] },
]
const install = (options: { listed?: DevPerson[]; method?: 'dev' | 'demo'; url?: string } = {}) =>
  buildApp({
    database: apiDatabase(options.url ?? url),
    logger: createLogger({ level: 'silent' }),
    jobs: idleJobs(),
    signIn: createDevSignIn(options.listed ?? [], 'test', {
      method: options.method ?? 'dev',
      sample,
    }),
  })
type App = ReturnType<typeof install>
const origin = 'http://localhost'
const first = { name: 'Kim Larsen', email: 'Kim@Tallyfield.example', workspace: 'Tallyfield' }

const methods = async (app: App) => {
  const response = await app.inject({ method: 'GET', url: '/api/v1/auth/methods' })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ method: string; demo: boolean; first: boolean }>()
}
const offered = async (app: App) => {
  const response = await app.inject({ method: 'GET', url: '/api/v1/auth/people' })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ name: string; email: string; roles: string[] }[]>()
}
const setUp = (app: App, payload: object = first, headers: Record<string, string> = {}) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/auth/first-person',
    headers: { origin, 'x-footnote-csrf': 'dev-sign-in', ...headers },
    payload,
  })
const cookieOf = (response: Awaited<ReturnType<typeof setUp>>) =>
  response.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
const peopleCount = async () =>
  (await client.query<{ n: number }>('select count(*)::int as n from people')).rows[0]!.n

describe('the first person of a workspace on its own data', () => {
  it('offers nobody and asks who the first person is', async () => {
    const app = install()
    expect(await methods(app)).toMatchObject({ method: 'dev', demo: false, first: true })
    expect(await offered(app)).toEqual([])
    expect(await peopleCount()).toBe(0)
  })

  it('refuses a first person with no name, no workspace name or no real address', async () => {
    const app = install()
    for (const wrong of [
      { ...first, name: ' ' },
      { ...first, workspace: '' },
      { ...first, email: 'kim' },
      { ...first, name: 'Kim\nLarsen' },
      { ...first, admin: true },
    ]) {
      const response = await setUp(app, wrong)
      expect(response.statusCode, JSON.stringify(wrong)).toBe(400)
    }
    // As any change from a browser: only from the app's own address, with the sign-in's header.
    expect((await setUp(app, first, { origin: 'http://elsewhere.example' })).statusCode).toBe(403)
    expect((await setUp(app, first, { 'x-footnote-csrf': 'none' })).statusCode).toBe(403)
    expect(await peopleCount()).toBe(0)
  })

  it('makes the first person the admin, names the workspace and signs them in', async () => {
    const app = install()
    const response = await setUp(app)
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toMatchObject({
      person: { name: 'Kim Larsen', permissions: { roles: ['administrator'], assignments: [] } },
    })
    const cookie = cookieOf(response)
    const session = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie },
    })
    expect(session.json()).toMatchObject({ person: { name: 'Kim Larsen' } })
    const workspace = await app.inject({
      method: 'GET',
      url: '/api/v1/workspace',
      headers: { cookie },
    })
    expect(workspace.json()).toEqual({ name: 'Tallyfield', writingHelp: false })
    // The address is kept in lower case, and the name's history names who gave it.
    const people = await client.query(
      'select email, display_name, last_signed_in_at is not null as signed from people',
    )
    expect(people.rows).toEqual([
      { email: 'kim@tallyfield.example', display_name: 'Kim Larsen', signed: true },
    ])
    const named = await client.query(
      `select s.reason, p.display_name as by from settings_versions s join people p on p.id = s.changed_by
        where s.key = 'workspace.name' order by s.version desc limit 1`,
    )
    expect(named.rows).toEqual([
      { reason: 'Named when the workspace was set up.', by: 'Kim Larsen' },
    ])
  })

  it('then offers the people of the workspace, and never the first screen again', async () => {
    const app = install()
    expect(await methods(app)).toMatchObject({ first: false })
    expect(await offered(app)).toEqual([
      expect.objectContaining({
        name: 'Kim Larsen',
        email: 'kim@tallyfield.example',
        roles: ['administrator'],
      }),
    ])
    const again = await setUp(app, { ...first, name: 'Someone Else', email: 'else@example.test' })
    expect(again.statusCode).toBe(409)
    expect(again.json()).toMatchObject({
      message: 'Someone has set this workspace up already. Sign in instead.',
    })
    expect(await peopleCount()).toBe(1)
    // The one person signs in again by a press, as on any picker.
    const signedIn = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin, 'x-footnote-csrf': 'dev-sign-in' },
      payload: { email: 'kim@tallyfield.example' },
    })
    expect(signedIn.statusCode, signedIn.body).toBe(200)
    // Nobody the workspace does not hold signs in, a sample person least of all.
    const stranger = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin, 'x-footnote-csrf': 'dev-sign-in' },
      payload: { email: sample[0]!.email },
    })
    expect(stranger.statusCode).toBe(401)
    expect(await peopleCount()).toBe(1)
  })
})

describe('two first visits at once', () => {
  it('make one person: whoever comes second is told someone is there already', async () => {
    const app = install({ url: race.url })
    const answers = await Promise.all([
      setUp(app, { ...first, email: 'a@tallyfield.example' }),
      setUp(app, { ...first, email: 'b@tallyfield.example' }),
    ])
    expect(answers.map((a) => a.statusCode).sort()).toEqual([200, 409])
    const people = await race.client.query('select count(*)::int as n from people')
    expect(people.rows).toEqual([{ n: 1 }])
  })
})

describe('where the picker has people of its own', () => {
  it('keeps the sample people on the demo, with no first screen', async () => {
    const app = install({ method: 'demo' })
    expect(await methods(app)).toMatchObject({ demo: true, first: false })
    expect((await offered(app)).map((p) => p.name)).toEqual(['Ravi Kapoor', 'Jon Abara'])
    expect((await setUp(app)).statusCode).toBe(409)
  })

  it('keeps them with the demo loaded, by the sandbox domain only its seed makes', async () => {
    await client.query(
      "insert into areas (id, name, is_demo) values ('area_sandbox', 'Sandbox', true)",
    )
    const app = install()
    expect(await methods(app)).toMatchObject({ method: 'dev', demo: true, first: false })
    expect((await offered(app)).map((p) => p.name)).toEqual(['Ravi Kapoor', 'Jon Abara'])
    await client.query("delete from areas where id = 'area_sandbox'")
  })

  it('offers a list the host gave as it is, and nobody else', async () => {
    const listed = [{ name: 'Ada Holm', email: 'ada@example.test', roles: [] }]
    const app = install({ listed })
    expect(await methods(app)).toMatchObject({ demo: false, first: false })
    expect((await offered(app)).map((p) => p.name)).toEqual(['Ada Holm'])
    expect((await setUp(app)).statusCode).toBe(409)
  })
})
