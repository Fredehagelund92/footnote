import { readFileSync } from 'node:fs'
import type { ConfigEnv, Plugin, UserConfig } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  renamedSettings,
  renamedSettingsWarning,
  withRenamedSettings,
} from '../../src/domain/renamed-settings.ts'

/*
  The settings were named HEED_ before the rename to Footnote (src/domain/renamed-settings.ts). For one release an
  old name still works when the new one is unset, and a process that reads one warns once.
*/

const databaseUrl = 'postgres://localhost:5432/context_layer_dev'
const token = 'f'.repeat(40)

/** env.ts as a new process loads it: it has warned of nothing yet. */
async function freshConfig() {
  vi.resetModules()
  return import('../../src/server/config/env.ts')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the renamed settings', () => {
  it('pairs each old name with the same name after FOOTNOTE_', () => {
    for (const [oldName, newName] of Object.entries(renamedSettings))
      expect(newName).toBe(oldName.replace(/^HEED_/, 'FOOTNOTE_'))
  })

  it('lets an old name override a shipped default, with its warning, and a new name win over both', () => {
    const shipped = { FOOTNOTE_DEFAULT_OAUTH_SIGNING_KEY_FILE: '/var/lib/footnote/oauth-key.pem' }
    expect(withRenamedSettings(shipped).environment.FOOTNOTE_OAUTH_SIGNING_KEY_FILE).toBe(
      '/var/lib/footnote/oauth-key.pem',
    )
    expect(withRenamedSettings(shipped).oldNames).toEqual([])
    expect(
      withRenamedSettings({ ...shipped, HEED_OAUTH_SIGNING_KEY_FILE: '/keys/mine.pem' }),
    ).toMatchObject({
      environment: { FOOTNOTE_OAUTH_SIGNING_KEY_FILE: '/keys/mine.pem' },
      oldNames: ['HEED_OAUTH_SIGNING_KEY_FILE'],
    })
    expect(
      withRenamedSettings({
        ...shipped,
        HEED_OAUTH_SIGNING_KEY_FILE: '/keys/old.pem',
        FOOTNOTE_OAUTH_SIGNING_KEY_FILE: '/keys/new.pem',
      }),
    ).toMatchObject({
      environment: { FOOTNOTE_OAUTH_SIGNING_KEY_FILE: '/keys/new.pem' },
      oldNames: [],
    })
  })

  it('no longer reads the CL_ names of before 0.1.0', () => {
    expect(withRenamedSettings({ CL_AUTH: 'demo' })).toEqual({
      environment: { CL_AUTH: 'demo' },
      oldNames: [],
    })
  })

  it('lists every new name in .env.example', () => {
    const example = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8')
    for (const newName of Object.values(renamedSettings)) expect(example).toContain(`${newName}=`)
  })

  it('takes an old name only when the new one is unset or empty', () => {
    expect(withRenamedSettings({ FOOTNOTE_AUTH: 'oidc' })).toEqual({
      environment: { FOOTNOTE_AUTH: 'oidc' },
      oldNames: [],
    })
    expect(withRenamedSettings({ HEED_AUTH: 'demo', FOOTNOTE_SECRETS_DIR: '' })).toMatchObject({
      environment: { FOOTNOTE_AUTH: 'demo' },
      oldNames: ['HEED_AUTH'],
    })
    expect(
      withRenamedSettings({ HEED_AUTH: 'demo', FOOTNOTE_AUTH: '' }).environment.FOOTNOTE_AUTH,
    ).toBe('demo')
    expect(withRenamedSettings({ HEED_AUTH: 'demo', FOOTNOTE_AUTH: 'oidc' })).toMatchObject({
      environment: { FOOTNOTE_AUTH: 'oidc' },
      oldNames: [],
    })
    expect(withRenamedSettings({ HEED_AUTH: '' }).oldNames).toEqual([])
  })

  it('warns with the names, never a value', () => {
    expect(renamedSettingsWarning(['HEED_AUTH', 'HEED_METRICS_TOKEN'])).toBe(
      'Renamed settings: HEED_AUTH is now FOOTNOTE_AUTH, HEED_METRICS_TOKEN is now FOOTNOTE_METRICS_TOKEN. The old names work in this release only (docs/operations.md, "Settings that started with HEED_").',
    )
  })
})

describe('loadConfig with the renamed settings', () => {
  it('reads the FOOTNOTE_ names without a warning', async () => {
    const { loadConfig } = await freshConfig()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(
      loadConfig({
        DATABASE_URL: databaseUrl,
        FOOTNOTE_TRUSTED_PROXIES: 'uniquelocal',
        FOOTNOTE_METRICS_TOKEN: token,
      }),
    ).toMatchObject({ trustedProxies: ['uniquelocal'], metricsToken: token })
    expect(warn).not.toHaveBeenCalled()
  })

  it('falls back to an old name and warns exactly once in a process', async () => {
    const { loadConfig } = await freshConfig()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const environment = {
      DATABASE_URL: databaseUrl,
      HEED_TRUSTED_PROXIES: 'uniquelocal',
      HEED_METRICS_TOKEN: token,
    }
    expect(loadConfig(environment)).toMatchObject({
      trustedProxies: ['uniquelocal'],
      metricsToken: token,
    })
    loadConfig(environment)
    loadConfig({ DATABASE_URL: databaseUrl, HEED_AUTH: 'demo' })
    expect(warn).toHaveBeenCalledTimes(1)
    const [line] = warn.mock.calls[0] as [string]
    expect(line).toContain('HEED_METRICS_TOKEN is now FOOTNOTE_METRICS_TOKEN')
    expect(line).toContain('HEED_TRUSTED_PROXIES is now FOOTNOTE_TRUSTED_PROXIES')
    expect(line).not.toContain(token)
    expect(line).not.toContain('uniquelocal')
  })

  it('lets the FOOTNOTE_ name win when both are set, without a warning', async () => {
    const { loadConfig } = await freshConfig()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(
      loadConfig({
        DATABASE_URL: databaseUrl,
        FOOTNOTE_AUTH: 'demo',
        HEED_AUTH: 'oidc',
        FOOTNOTE_SESSION_IDLE_HOURS: '2',
        HEED_SESSION_IDLE_HOURS: '30',
      }),
    ).toMatchObject({ auth: 'demo', oidc: null, sessions: { idleHours: 2 } })
    expect(warn).not.toHaveBeenCalled()
  })

  it('names the new setting when an old one has a bad value', async () => {
    const { loadConfig } = await freshConfig()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, HEED_AUTH: 'nobody' })).toThrow(
      /FOOTNOTE_AUTH:/,
    )
  })
})

describe('the web build with the renamed settings', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  async function runConfigHook() {
    vi.resetModules()
    const { renamedWebSettings } = await import('../../vite.config.ts')
    const plugin: Plugin = renamedWebSettings()
    const config = plugin.config as (config: UserConfig, env: ConfigEnv) => void
    config({}, { mode: 'production', command: 'build' })
  }

  it('builds with an old name as its new one, warning once', async () => {
    vi.stubEnv('FOOTNOTE_PRODUCT_NAME', undefined)
    vi.stubEnv('FOOTNOTE_SUPPORT_EMAIL', undefined)
    vi.stubEnv('HEED_PRODUCT_NAME', 'Acme Ledger')
    vi.stubEnv('HEED_SUPPORT_EMAIL', 'help@acme.example')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await runConfigHook()
    expect(process.env.FOOTNOTE_PRODUCT_NAME).toBe('Acme Ledger')
    expect(process.env.FOOTNOTE_SUPPORT_EMAIL).toBe('help@acme.example')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('HEED_PRODUCT_NAME is now FOOTNOTE_PRODUCT_NAME')
    expect(warn.mock.calls[0]?.[0]).not.toContain('Acme Ledger')
  })

  it('keeps a new name that is set', async () => {
    vi.stubEnv('FOOTNOTE_PRODUCT_NAME', 'Footnote Inc')
    vi.stubEnv('HEED_PRODUCT_NAME', 'Acme Ledger')
    vi.stubEnv('HEED_SUPPORT_EMAIL', undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await runConfigHook()
    expect(process.env.FOOTNOTE_PRODUCT_NAME).toBe('Footnote Inc')
    expect(warn).not.toHaveBeenCalled()
  })
})
