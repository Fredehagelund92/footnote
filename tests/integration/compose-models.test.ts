import { readFile } from 'node:fs/promises'
import { afterAll, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { loadConfig } from '../../src/server/config/env.ts'
import {
  checkModelSettings,
  createModelPort,
  fillModelSettings,
  providerEnvNames,
  readModelSettings,
} from '../../src/server/modules/models/index.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  A real model in one line (docs/model-providers.md, "Start on a real model"):
  `MODELS=live ANTHROPIC_API_KEY=... docker compose up` and no other step. compose.yaml passes the
  model setting and each provider's key and address from the shell, and a new database's model
  settings start on the provider whose key that line gives, or on FOOTNOTE_MODEL. Unset, the
  service gets nothing and stays on the scripted models.
*/

type Compose = { services: Record<string, { environment?: Record<string, string | null> }> }
const compose = parse(
  await readFile(new URL('../../compose.yaml', import.meta.url), 'utf8'),
) as Compose
const environment = compose.services['footnote']!.environment!
const passed = [
  'MODELS',
  ...providerEnvNames(),
  'FOOTNOTE_MODEL',
  'FOOTNOTE_MODEL_PRICES',
  'FOOTNOTE_JUDGE_MODEL',
  'FOOTNOTE_JUDGE_MODEL_PRICES',
]

/** The service's model environment, as compose writes it from the shell's: set names only. */
const fromShell = (shell: Record<string, string>) =>
  Object.fromEntries(passed.flatMap((name) => (name in shell ? [[name, shell[name]]] : [])))

const { url } = testDatabase()
// The service's own role, as it reads the settings at start-up.
const database = apiDatabase(url)
/** A new database's model settings, as the first test reads them. */
let settingsBefore: Awaited<ReturnType<typeof readModelSettings>>
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
    settingsBefore = settings
  })

  it('starts every role of a new database on FOOTNOTE_MODEL when the line gives only OPENAI_*', async () => {
    const config = loadConfig({
      DATABASE_URL: url,
      ...fromShell({
        MODELS: 'live',
        OPENAI_BASE_URL: 'http://host.docker.internal:11434/v1',
        FOOTNOTE_MODEL: 'openai:gpt-oss:20b',
        FOOTNOTE_MODEL_PRICES: '0,0',
        FOOTNOTE_JUDGE_MODEL: 'openai:qwen3:8b',
        FOOTNOTE_JUDGE_MODEL_PRICES: '0,0',
      }),
    })
    const port = createModelPort({ mode: config.models, env: config.modelEnv })
    // Before the fill, the installed settings need an Anthropic key this line does not give.
    expect(() => checkModelSettings(port, settingsBefore)).toThrow(/needs ANTHROPIC_API_KEY/)
    expect(await fillModelSettings(database, port, config.startModels)).toEqual([
      'models.eval_answer',
      'models.judge',
      'models.assistant',
      'models.test_authoring',
    ])
    const settings = await readModelSettings(database)
    const free = { input: 0, output: 0 }
    expect(settings).toEqual({
      eval_answer: { provider: 'openai', model: 'gpt-oss:20b', prices: free },
      judge: { provider: 'openai', model: 'qwen3:8b', prices: free },
      assistant: { provider: 'openai', model: 'gpt-oss:20b', prices: free },
      test_authoring: { provider: 'openai', model: 'gpt-oss:20b', prices: free },
    })
    expect(() => checkModelSettings(port, settings)).not.toThrow()
    // A setting already changed is kept: the line fills only what no one has set.
    const again = {
      ...config.startModels,
      model: { provider: 'openai', model: 'other', prices: free },
    }
    expect(await fillModelSettings(database, port, again)).toEqual([])
    expect(await readModelSettings(database)).toEqual(settings)
  })

  it('refuses a one-line model its provider cannot serve, naming the variable', async () => {
    const port = createModelPort({ mode: 'live', env: {} })
    await expect(
      fillModelSettings(database, port, {
        model: { provider: 'openai', model: 'gpt-6-luna', prices: { input: 1, output: 1 } },
        judge: undefined,
      }),
    ).rejects.toThrow('FOOTNOTE_MODEL uses provider openai, which needs OPENAI_API_KEY')
  })

  it('stays on the scripted models when the shell names none', () => {
    const config = loadConfig({ DATABASE_URL: url, ...fromShell({}) })
    expect(config.models).toBe('mock')
    expect(config.modelEnv).toEqual({})
  })
})
