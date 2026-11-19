import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

/*
  `npm run eval:ask-harness` on any provider (P6): --model and --judge name the answering model
  and the judge as FOOTNOTE_MODEL does, and each is refused by its flag before a model is called
  or a test starts. No key is set here, so nothing reaches a provider.
*/

const root = fileURLToPath(new URL('../../', import.meta.url))
const harnessIn = (env: Record<string, string>, ...args: string[]) =>
  promisify(execFile)(process.execPath, ['scripts/ask-eval.ts', ...args], {
    cwd: root,
    env: { PATH: process.env.PATH ?? '', ...env },
    timeout: 60_000,
  }).then(
    () => ({ code: 0, stderr: '' }),
    (error: { code: number; stderr: string }) => error,
  )
const harness = (...args: string[]) => harnessIn({}, ...args)
const real = ['--real', '--max-cost-usd', '0.10']

// Each test starts the command a few times, which takes seconds on a loaded machine.
describe('the harness on any provider', { timeout: 120_000 }, () => {
  it('names the models of a real run only', async () => {
    expect(await harness('--model', 'openai:gpt-oss:20b')).toMatchObject({
      code: 2,
      stderr: '--model and --judge name the models of a real run: add --real.\n',
    })
    expect((await harness(...real, '--model', 'gpt-oss')).stderr).toBe(
      '--model is <provider>:<model>, such as openai:gpt-oss:20b.\n',
    )
    expect((await harness(...real, '--prices', '0,0')).stderr).toBe('--prices needs --model.\n')
  })

  it('asks for the prices of a model its provider does not list, by the flag that takes them', async () => {
    expect((await harness(...real, '--model', 'openai:gpt-oss:20b')).stderr).toBe(
      'Provider openai does not list gpt-oss:20b: give its prices with --prices <input>,<output> in US dollars per million tokens, 0,0 for a model that costs nothing.\n',
    )
    expect(
      (await harness(...real, '--judge', 'openai:gpt-oss:20b', '--judge-prices', 'free')).stderr,
    ).toBe('--judge-prices is <input>,<output> in US dollars per million tokens, such as 0.5,2.\n')
  })

  it('refuses a provider without its key, naming the flag, whichever provider it is', async () => {
    const local = await harness(...real, '--model', 'openai:gpt-6-luna', '--prices', '0.1,0.5')
    expect(local).toMatchObject({ code: 2 })
    expect(local.stderr).toMatch(/^--model uses provider openai, which needs OPENAI_API_KEY\./)
    // A model server on this computer needs no key: the judge is the one refused.
    const judge = await harnessIn(
      { OPENAI_BASE_URL: 'http://127.0.0.1:9/v1' },
      ...real,
      '--model',
      'openai:gpt-oss:20b',
      '--prices',
      '0,0',
      '--judge',
      'anthropic:claude-opus-5-5',
    )
    expect(judge.stderr).toMatch(
      /^--judge uses provider anthropic, which needs ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN\./,
    )
    // Unnamed, both are Claude Haiku 5.5 through the Vercel gateway.
    expect((await harness(...real)).stderr).toMatch(
      /^--model uses provider vercel-gateway, which needs VERCEL_AI_GATEWAY_API_KEY\./,
    )
  })

  it('records only on the default models, which every build replays', async () => {
    expect(
      (await harness(...real, '--record', '--judge', 'anthropic:claude-opus-5-5')).stderr,
    ).toBe(
      "--record keeps what every build replays, which is the default models' only: leave out --model and --judge.\n",
    )
  })
})
