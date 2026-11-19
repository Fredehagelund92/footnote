import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { testDatabase } from './support.ts'

/*
  With real models the service checks every role's provider and model before it listens, against
  the settings in its database, and names the setting that cannot be served. No model is called.
*/

const { client, url } = testDatabase()
const root = fileURLToPath(new URL('../../', import.meta.url))

function start(env: Record<string, string>) {
  const child = spawn(process.execPath, ['src/server/main.ts'], {
    cwd: root,
    // USER is the database user when the URL names none, as it does in the local test setup.
    env: {
      PATH: process.env.PATH ?? '',
      USER: process.env.USER ?? '',
      DATABASE_URL: url,
      PORT: '0',
      ...env,
    },
  })
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve))
  return { child, exited, output: () => output }
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function healthy(port: number, deadline: number): Promise<boolean> {
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).status === 200) return true
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return false
}

const setJudge = (value: unknown) =>
  client.query(
    `insert into settings_versions(key,version,value,reason)
     select 'models.judge',max(version)+1,$1,'test' from settings_versions where key='models.judge'`,
    [JSON.stringify(value)],
  )

describe('the model settings at start-up', () => {
  it('refuses to start live without the key of a role provider, naming the setting', async () => {
    const server = start({ MODELS: 'live' })
    expect(await server.exited).toBe(1)
    expect(server.output()).toContain(
      'models.eval_answer uses provider anthropic, which needs ANTHROPIC_API_KEY',
    )
  }, 60_000)

  it('names the judge setting when it asks for a provider without its key', async () => {
    await setJudge({ provider: 'vercel-gateway', model: 'anthropic/claude-opus-5.5' })
    const secret = 'sk-ant-placeholder-not-a-key'
    const server = start({ MODELS: 'live', ANTHROPIC_API_KEY: secret })
    expect(await server.exited).toBe(1)
    expect(server.output()).toContain(
      'models.judge uses provider vercel-gateway, which needs VERCEL_AI_GATEWAY_API_KEY',
    )
    // The key that was given is never printed.
    expect(server.output()).not.toContain(secret)
    await setJudge('different_family')
  }, 60_000)

  it('starts live on a local model server from FOOTNOTE_MODEL alone, logging its prices', async () => {
    const port = await freePort()
    const server = start({
      MODELS: 'live',
      PORT: String(port),
      // Nothing listens there: the service calls no model before it answers.
      OPENAI_BASE_URL: 'http://127.0.0.1:9/v1',
      FOOTNOTE_MODEL: 'openai:gpt-oss:20b',
      FOOTNOTE_MODEL_PRICES: '0,0',
    })
    try {
      expect(await healthy(port, Date.now() + 50_000), server.output()).toBe(true)
      const { rows } = await client.query<{ key: string; value: unknown; reason: string }>(
        `select key, v.value, v.reason from settings_current join settings_versions v using (key, version)
          where key like 'models.%' and key <> 'models.call_limits' order by key`,
      )
      const local = { provider: 'openai', model: 'gpt-oss:20b', prices: { input: 0, output: 0 } }
      // The judge was changed before, so it keeps its own setting.
      expect(rows).toEqual([
        { key: 'models.assistant', value: local, reason: 'FOOTNOTE_MODEL at start-up' },
        { key: 'models.eval_answer', value: local, reason: 'FOOTNOTE_MODEL at start-up' },
        { key: 'models.judge', value: 'different_family', reason: 'test' },
        { key: 'models.test_authoring', value: local, reason: 'FOOTNOTE_MODEL at start-up' },
      ])
      expect(server.output()).toContain('model setting filled at start-up')
      expect(server.output()).toContain('model priced by its setting')
    } finally {
      server.child.kill('SIGTERM')
      await server.exited
    }
  }, 60_000)
})
