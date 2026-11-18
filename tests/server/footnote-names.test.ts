import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../../src/server/config/env.ts'
import { sessionCookie, sessionToken } from '../../src/server/modules/auth/sessions.ts'
import { browserToken } from '../../src/server/modules/oauth/service.ts'

/*
  The names a machine reads, each said once as Footnote: the settings start FOOTNOTE_ and the
  cookies footnote_. Nothing else is read in their place (tests/lint/product-name-word.test.ts keeps
  any other name out of the repository).
*/

const databaseUrl = 'postgres://localhost:5432/context_layer_dev'
const token = 'f'.repeat(64)
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the settings', () => {
  it('are read under their FOOTNOTE_ names, without a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(
      loadConfig({
        DATABASE_URL: databaseUrl,
        FOOTNOTE_AUTH: 'demo',
        FOOTNOTE_TRUSTED_PROXIES: 'uniquelocal',
        FOOTNOTE_METRICS_TOKEN: 'm'.repeat(40),
        FOOTNOTE_SESSION_IDLE_HOURS: '2',
      }),
    ).toMatchObject({
      auth: 'demo',
      trustedProxies: ['uniquelocal'],
      metricsToken: 'm'.repeat(40),
      sessions: { idleHours: 2 },
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('name a bad value by its FOOTNOTE_ name', () => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, FOOTNOTE_AUTH: 'nobody' })).toThrow(
      /FOOTNOTE_AUTH:/,
    )
  })

  it('are each listed in .env.example', () => {
    const names = [...read('src/server/config/env.ts').matchAll(/^\s+(FOOTNOTE_[A-Z0-9_]+):/gm)]
    expect(names.length).toBeGreaterThan(20)
    const example = read('.env.example')
    for (const [, name] of names) expect(example, name).toContain(`${name}=`)
  })
})

describe('the cookies', () => {
  it('are set and read as footnote_session and footnote_oauth_browser', () => {
    expect(sessionCookie(token, true, 60)).toBe(
      `footnote_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=60; Secure`,
    )
    expect(sessionToken(`theme=dark; footnote_session=${token}`)).toBe(token)
    expect(browserToken(`footnote_oauth_browser=${token}`)).toBe(token)
  })

  it('give no token for a doubled or malformed value, or under any other name', () => {
    expect(sessionToken(`footnote_session=${token}; footnote_session=${token}`)).toBeUndefined()
    expect(sessionToken('footnote_session=short')).toBeUndefined()
    expect(sessionToken(`session=${token}`)).toBeUndefined()
    expect(
      browserToken(`footnote_oauth_browser=${token}; footnote_oauth_browser=x`),
    ).toBeUndefined()
    expect(browserToken(`oauth_browser=${token}`)).toBeUndefined()
  })
})
