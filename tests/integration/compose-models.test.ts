import { readFile } from 'node:fs/promises'
import { afterAll, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { loadConfig } from '../../src/server/config/env.ts'
import {
  checkModelSettings,
  createModelPort,
  modelProviders,
  readModelSettings,
} from '../../src/server/modules/models/index.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  A real model in one line (docs/self-hosting.md, "Ask on a real model"):
  `MODELS=live ANTHROPIC_API_KEY=... docker compose up` and no other step. compose.yaml passes the
  model setting and each provider's key and address from the shell, and a new database's model
  settings start on the provider whose key that line gives. Unset, the service gets nothing and
  stays on the scripted models.
*/

type Compose = { services: Record<string, { environment?: Record<string, string | null> }> }
const compose = parse(
  await readFile(new URL('../../compose.yaml', import.meta.url), 'utf8'),
) as Compose
const environment = compose.services['heed']!.environment!
const passed = ['MODELS', ...modelProviders.flatMap((p) => [p.apiKeyEnv, p.baseUrlEnv])]

/** The service's model environment, as compose writes it from the shell's: set names only. */
const fromShell = (shell: Record<string, string>) =>
  Object.fromEntries(passed.flatMap((name) => (name in shell ? [[name, shell[name]]] : [])))

const { url } = testDatabase()
// The service's own role, as it reads the settings at start-up.
const database = apiDatabase(url)
afterAll(() => database.close())

describe('a real model from the compose command line', () => {
  it('passes the model setting and every provider key and address through by its own name', () => {
    // A name with no value is taken from the shell when set, and left out when not: never empty.
    for (const name of passed) expect(environment, name).toHaveProperty(name, null)
  })

  it('starts every role of a new database on the key the one line gives', async () => {
    const config = loadConfig({
      DATABASE_URL: url,
      ...fromShell({ MODELS: 'live', ANTHROPIC_API_KEY: 'sk-ant-test' }),
    })
    expect(config.models).toBe('live')
    expect(config.modelEnv).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-test' })
    const port = createModelPort({ mode: config.models, env: config.modelEnv })
    const settings = await readModelSettings(database)
    expect(() => checkModelSettings(port, settings)).not.toThrow()
  })

  it('stays on the scripted models when the shell names none', () => {
    const config = loadConfig({ DATABASE_URL: url, ...fromShell({}) })
    expect(config.models).toBe('mock')
    expect(config.modelEnv).toEqual({})
  })
})
