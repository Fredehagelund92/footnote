import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ModelCheckRow, Setting } from '../../src/contract/index.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import {
  createModelChecks,
  createModelPort,
  type ModelCheck,
} from '../../src/server/modules/models/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  The model check over HTTP (P5): what it found for each role's model, for Settings, and a check
  made again after a model setting changes; the check's calls are replaced there. Then
  `npm run models:check` against a stub model server, metered in the spend ledger.
*/

const { client, url } = testDatabase()
// Every model on this computer's server fails the tool call; Claude passes everything.
const check = vi.fn((choice: { id: string }): Promise<ModelCheck> =>
  Promise.resolve({
    model: choice.id,
    at: '2026-10-08T12:00:00.000Z',
    tools: choice.id.startsWith('openai/') ? 'fail' : 'pass',
    noTools: 'pass',
    json: 'pass',
    notes: choice.id.startsWith('openai/') ? ['tools: HTTP 400'] : [],
  }),
)
const modelChecks = createModelChecks({ check })
const app = buildApp({
  database: apiDatabase(url),
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock: systemClock('2026-10-08'),
  models: createModelPort({
    mode: 'live',
    env: { ANTHROPIC_API_KEY: 'sk-ant-placeholder', OPENAI_BASE_URL: 'http://127.0.0.1:9/v1' },
  }),
  modelChecks,
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
})

type Who = keyof typeof people
const headers: Partial<Record<Who, Record<string, string>>> = {}
const call = (method: 'GET' | 'PUT', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
async function ok<T>(method: 'GET' | 'PUT', path: string, who: Who, payload?: object) {
  const response = await call(method, path, who, payload)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<T>()
}

beforeAll(async () => {
  await transaction(client, async () => {
    await foundation(client)
  })
  for (const name of ['admin', 'author'] as Who[]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin: 'http://localhost', 'x-footnote-csrf': 'dev-sign-in' },
      payload: { email: `${name}@example.test` },
    })
    expect(response.statusCode, response.body).toBe(200)
    headers[name] = {
      origin: 'http://localhost',
      cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-footnote-csrf': response.json<{ csrfToken: string }>().csrfToken,
    }
  }
})
afterAll(() => app.close())

describe('the model check over HTTP', () => {
  it('lists each role’s model, with nothing found before the check is made', async () => {
    expect(await ok<ModelCheckRow[]>('GET', '/models/checks', 'admin')).toEqual([
      { role: 'assistant', model: 'anthropic/claude-sonnet-5-5', check: null, words: null },
      { role: 'eval_answer', model: 'anthropic/claude-sonnet-5-5', check: null, words: null },
      { role: 'judge', model: 'anthropic/claude-opus-5-5', check: null, words: null },
    ])
    expect(check).not.toHaveBeenCalled()
    expect((await call('GET', '/models/checks', 'author')).statusCode).toBe(403)
  })

  it('checks each role’s model after a model setting changes, and says what it found', async () => {
    const [current] = (await ok<Setting[]>('GET', '/settings', 'admin')).filter(
      (s) => s.key === 'models.assistant',
    )
    await ok<Setting>('PUT', '/settings/models.assistant', 'admin', {
      version: current!.version,
      value: { provider: 'openai', model: 'gpt-oss:20b', prices: { input: 0, output: 0 } },
      reason: 'Ask on the local model',
    })
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(3))
    const rows = await ok<ModelCheckRow[]>('GET', '/models/checks', 'admin')
    expect(rows.map((r) => [r.role, r.model, r.check?.tools, r.words])).toEqual([
      ['assistant', 'openai/gpt-oss:20b', 'fail', 'Can’t call tools, which Ask needs to read'],
      ['eval_answer', 'anthropic/claude-sonnet-5-5', 'pass', 'Calls tools, as answer tests need'],
      ['judge', 'anthropic/claude-opus-5-5', 'pass', 'Keeps to a JSON schema, as judging needs'],
    ])
    expect(rows[0]!.check?.notes).toEqual(['tools: HTTP 400'])
  })
})

describe('npm run models:check', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  /** A local model server that turns away every request with tools, and answers the rest. */
  async function toolless() {
    let calls = 0
    const server = createServer((request, response) => {
      let text = ''
      request.on('data', (chunk: Buffer) => (text += chunk.toString()))
      request.on('end', () => {
        calls++
        const body = JSON.parse(text) as Record<string, unknown>
        response.setHeader('content-type', 'application/json')
        if (body.tools) {
          response.statusCode = 400
          response.end(JSON.stringify({ error: { message: 'model does not support tools' } }))
          return
        }
        response.end(
          JSON.stringify({
            id: 'chatcmpl-1',
            object: 'chat.completion',
            created: 1_791_500_000,
            model: 'gpt-oss:20b',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: '{"city":"Oslo","count":3}' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 60, completion_tokens: 12, total_tokens: 72 },
          }),
        )
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }
    return { base: `http://127.0.0.1:${port}/v1`, calls: () => calls, server }
  }
  const run = (args: string[], env: Record<string, string>) =>
    promisify(execFile)(process.execPath, ['src/server/run-models-check.ts', ...args], {
      cwd: root,
      // USER is the database user when the URL names none, as it does in the local test setup.
      env: {
        PATH: process.env.PATH ?? '',
        USER: process.env.USER ?? '',
        DATABASE_URL: url,
        ...env,
      },
      timeout: 60_000,
    }).then(
      ({ stdout }) => ({ code: 0, stdout, stderr: '' }),
      (error: { code: number; stdout: string; stderr: string }) => error,
    )

  it('checks a model before any setting names it, says what it found and meters the calls', async () => {
    const stub = await toolless()
    try {
      const before = await client.query<{ calls: number }>(
        "select coalesce(sum(calls),0)::int as calls from llm_spend_monthly where provider='openai'",
      )
      const result = await run(['--model', 'openai:gpt-oss:20b', '--prices', '0,0'], {
        OPENAI_BASE_URL: stub.base,
      })
      // 1: a role's model cannot do what the role needs.
      expect(result.code, result.stderr).toBe(1)
      expect(result.stdout).toContain(
        "Checking each role's model: three tiny calls a model, to this computer, with no company data.",
      )
      expect(result.stdout).toContain(
        'models.assistant: openai/gpt-oss:20b: tools fail, no tools when told fail, JSON schema pass. Can’t call tools, which Ask needs to read.',
      )
      expect(result.stdout).toContain('  tools: HTTP 400: model does not support tools')
      expect(result.stdout).toContain(
        'models.judge: openai/gpt-oss:20b: tools fail, no tools when told fail, JSON schema pass. Keeps to a JSON schema, as judging needs.',
      )
      // One model for every role: checked once, three calls and a plain one. The two answered are
      // metered; the two turned away used nothing.
      expect(stub.calls()).toBe(4)
      const after = await client.query<{ calls: number }>(
        "select coalesce(sum(calls),0)::int as calls from llm_spend_monthly where provider='openai'",
      )
      expect(after.rows[0]!.calls - before.rows[0]!.calls).toBe(2)
    } finally {
      await new Promise((resolve) => stub.server.close(resolve))
    }
  }, 90_000)

  it('refuses a model it cannot serve before it calls any', async () => {
    const unpriced = await run(['--model', 'openai:gpt-oss:20b'], {})
    expect(unpriced.code).toBe(1)
    expect(unpriced.stderr).toContain(
      'Provider openai does not list gpt-oss:20b: give its prices with --prices <input>,<output>',
    )
    // The settings name Claude for the answer tests, and no Anthropic key is set.
    const settings = await run([], { OPENAI_BASE_URL: 'http://127.0.0.1:9/v1' })
    expect(settings.code).toBe(1)
    expect(settings.stderr).toContain(
      'models.eval_answer uses provider anthropic, which needs ANTHROPIC_API_KEY',
    )
  }, 90_000)
})
