import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { moveFormerKeyFile } from '../../src/server/config/former-key-files.ts'
import { loadStateKey } from '../../src/server/mcp/state-key.ts'
import { cookieToken } from '../../src/server/modules/auth/cookie-token.ts'
import { sessionCookies, sessionToken } from '../../src/server/modules/auth/sessions.ts'
import { browserToken } from '../../src/server/modules/oauth/service.ts'

/*
  What an install made before the product was renamed Footnote keeps under the old name, Heed:
  its browsers' cookies and its key files. The service reads or moves them, so the upgrade signs
  nobody out and keeps every connected agent connected (docs/operations.md, "Upgrade from Heed 0.1").
*/

const token = 'a'.repeat(64)
const other = 'b'.repeat(64)

describe('the cookies under their former names', () => {
  it('reads the new name, else the former one, never a bad or doubled value', () => {
    expect(cookieToken(`footnote_session=${token}`, 'footnote_session')).toBe(token)
    expect(cookieToken(`theme=dark; heed_session=${token}`, 'footnote_session')).toBe(token)
    expect(
      cookieToken(`heed_session=${other}; footnote_session=${token}`, 'footnote_session'),
    ).toBe(token)
    // A bad value under the new name is not made good by an old one.
    expect(cookieToken(`footnote_session=x; heed_session=${token}`, 'footnote_session')).toBe(
      undefined,
    )
    expect(cookieToken(`heed_session=${token}; heed_session=${other}`, 'footnote_session')).toBe(
      undefined,
    )
    expect(cookieToken(undefined, 'footnote_session')).toBe(undefined)
  })

  it("reads a browser's sign-in of before the upgrade, for people and for agents", () => {
    expect(sessionToken(`heed_session=${token}`)).toBe(token)
    expect(browserToken(`heed_oauth_browser=${token}`)).toBe(token)
  })

  it('clears the former session cookie when the browser still sends it, and only then', () => {
    expect(sessionCookies(undefined, token, true, 60)).toBe(
      `footnote_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=60; Secure`,
    )
    expect(sessionCookies(`heed_session=${other}`, '', false, 0)).toEqual([
      'footnote_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
      'heed_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
    ])
  })
})

describe('the key files under their former default names', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'footnote-former-keys-'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(dir, { recursive: true, force: true })
  })

  it('moves the old key to the new name once, so the same key keeps signing', async () => {
    const old = join(dir, '.heed-mcp-state.key')
    await writeFile(old, `${'c'.repeat(64)}\n`, { mode: 0o600 })
    const key = await loadStateKey(join(dir, '.footnote-mcp-state.key'), 'production')
    expect(Buffer.from(key!).toString('hex')).toBe('c'.repeat(64))
    expect((await stat(join(dir, '.footnote-mcp-state.key'))).mode & 0o777).toBe(0o600)
    await expect(stat(old)).rejects.toThrow()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('.heed-mcp-state.key'))
  })

  it('keeps a new key that exists, and moves nothing for a name of its own', async () => {
    await writeFile(join(dir, '.heed-oauth-key.pem'), 'old', { mode: 0o600 })
    await writeFile(join(dir, '.footnote-oauth-key.pem'), 'new', { mode: 0o600 })
    expect(await moveFormerKeyFile(join(dir, '.footnote-oauth-key.pem'))).toBe(false)
    expect(await readFile(join(dir, '.footnote-oauth-key.pem'), 'utf8')).toBe('new')
    expect(await readFile(join(dir, '.heed-oauth-key.pem'), 'utf8')).toBe('old')
    expect(await moveFormerKeyFile(join(dir, 'oauth-key.pem'))).toBe(false)
    expect(await moveFormerKeyFile(join(dir, '.footnote-dev-key.pem'))).toBe(false)
  })
})
