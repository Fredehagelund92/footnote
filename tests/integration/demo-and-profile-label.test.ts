import { describe, expect, it } from 'vitest'
import { buildApp } from '../../src/server/app.ts'
import { createDevSignIn } from '../../src/server/modules/auth/index.ts'
import { createModelPort } from '../../src/server/modules/models/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  What the reads the app already makes say of the install, so knowing it costs no call of its own.
  auth.methods, which the sign-in page reads first, says whether this is the demo, so the page says
  its company is invented only on the demo's picker or with the demo loaded, and the label
  FOOTNOTE_PROFILE_LABEL names it by. auth.session, which every signed-in page reads first, carries the
  label for the header, and whether an AI model is connected, so Ask says when none answers. An
  install on the dev picker with its own data, a private profile say, is not the demo.
*/

const { client, url } = testDatabase()
const person = { name: 'Ada', email: 'ada@example.test', roles: [] }
const install = (
  options: { method?: 'dev' | 'demo'; profileLabel?: string; live?: boolean } = {},
) =>
  buildApp({
    database: apiDatabase(url),
    logger: createLogger({ level: 'silent' }),
    jobs: idleJobs(),
    signIn: createDevSignIn([person], 'test', { method: options.method ?? 'dev' }),
    ...(options.profileLabel ? { profileLabel: options.profileLabel } : {}),
    ...(options.live ? { models: { ...createModelPort({ mode: 'mock' }), mode: 'live' } } : {}),
  })
const methods = async (options?: Parameters<typeof install>[0]) => {
  const response = await install(options).inject({ method: 'GET', url: '/api/v1/auth/methods' })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ method: string; demo: boolean; profileLabel: string | null }>()
}

describe('what the sign-in method says of the install', () => {
  it('on the dev picker with its own data: not the demo, and no label unless one is set', async () => {
    expect(await methods()).toMatchObject({ method: 'dev', demo: false, profileLabel: null })
    expect(await methods({ profileLabel: 'Local trial' })).toMatchObject({
      demo: false,
      profileLabel: 'Local trial',
    })
  })

  it("on the demo's picker: the demo, whatever the data", async () => {
    expect(await methods({ method: 'demo' })).toMatchObject({ method: 'demo', demo: true })
  })

  it("with the demo loaded: the demo, by the sandbox domain only the demo's seed makes", async () => {
    await client.query(
      "insert into areas (id, name, is_demo) values ('area_sandbox', 'Sandbox', true)",
    )
    expect(await methods()).toMatchObject({ method: 'dev', demo: true, profileLabel: null })
    await client.query("delete from areas where id = 'area_sandbox'")
  })
})

describe('what the session says of the install', () => {
  it('carries the label from sign-in on, and null when none is set', async () => {
    for (const profileLabel of ['Local trial', undefined]) {
      const app = install(profileLabel ? { profileLabel } : {})
      const signedIn = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/sign-in',
        headers: { origin: 'http://localhost', 'x-footnote-csrf': 'dev-sign-in' },
        payload: { email: person.email },
      })
      expect(signedIn.statusCode, signedIn.body).toBe(200)
      expect(signedIn.json()).toMatchObject({ profileLabel: profileLabel ?? null })
      const session = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        headers: { cookie: signedIn.cookies.map((c) => `${c.name}=${c.value}`).join('; ') },
      })
      expect(session.statusCode, session.body).toBe(200)
      expect(session.json()).toMatchObject({ profileLabel: profileLabel ?? null })
    }
  })

  it('says whether an AI model is connected: not on the scripted mock, as the demo runs', async () => {
    for (const live of [false, true]) {
      const app = install({ live })
      const signedIn = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/sign-in',
        headers: { origin: 'http://localhost', 'x-footnote-csrf': 'dev-sign-in' },
        payload: { email: person.email },
      })
      expect(signedIn.json()).toMatchObject({ modelConnected: live })
      const session = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        headers: { cookie: signedIn.cookies.map((c) => `${c.name}=${c.value}`).join('; ') },
      })
      expect(session.json()).toMatchObject({ modelConnected: live })
    }
  })
})
