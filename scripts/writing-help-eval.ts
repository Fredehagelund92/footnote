import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { modelName, modelPrices, unlistedModel } from '../src/server/config/env.ts'
import { createModelPort, ModelConfigError } from '../src/server/modules/models/index.ts'

/*
  Writing help's drafting evaluation from the command line (docs/evaluations.md, "Writing help's
  drafting evaluation"). With no flags it plays every case with the scripted writer, as every
  build does, and prints the report. With --real a real model writes each case's turn, stopping
  before --max-cost-usd is spent. It runs in a database of its own, copied from the test template,
  so it never reads or writes another one.

    npm run eval:writing-help
    npm run eval:writing-help -- --real --max-cost-usd 0.50 [--tries 1] [--cases F01,S05]
      [--model <provider>:<model> [--prices <input>,<output>]] [--out report.json]

  --model names the model, on any provider in the registry, as FOOTNOTE_MODEL does
  (docs/model-providers.md); it is Claude Haiku 5.5 through the Vercel gateway unless named. A
  model its provider does not list needs its prices, in US dollars per million tokens. The
  provider's key is read from the environment and never printed.
*/

const { values } = parseArgs({
  options: {
    real: { type: 'boolean', default: false },
    'max-cost-usd': { type: 'string' },
    tries: { type: 'string' },
    cases: { type: 'string' },
    out: { type: 'string' },
    model: { type: 'string' },
    prices: { type: 'string' },
  },
})

const fail = (message: string): never => {
  console.error(message)
  process.exit(2)
}

const env: Record<string, string> = {}
if ((values.model !== undefined || values.prices !== undefined) && !values.real)
  fail('--model names the model of a real run: add --real.')
if (values.real) {
  const usd = Number(values['max-cost-usd'])
  if (!values['max-cost-usd'] || !Number.isFinite(usd) || usd <= 0)
    fail('A real run needs --max-cost-usd, the most it may spend in US dollars.')
  let model = { provider: 'vercel-gateway', model: 'anthropic/claude-haiku-5.5' } as {
    provider: string
    model: string
    prices?: { input: number; output: number }
  }
  if (values.model !== undefined) {
    const ref = modelName.safeParse(values.model)
    if (!ref.success) fail('--model is <provider>:<model>, such as openai:gpt-oss:20b.')
    const priced = values.prices === undefined ? undefined : modelPrices.safeParse(values.prices)
    if (priced && !priced.success)
      fail('--prices is <input>,<output> in US dollars per million tokens, such as 0.5,2.')
    if (!priced && unlistedModel(ref.data!))
      fail(
        `Provider ${ref.data!.provider} does not list ${ref.data!.model}: give its prices with --prices <input>,<output> in US dollars per million tokens, 0,0 for a model that costs nothing.`,
      )
    model = { ...ref.data!, ...(priced?.data ? { prices: priced.data } : {}) }
  } else if (values.prices !== undefined) fail('--prices needs --model.')
  // The model's provider and key, refused here by the flag that names it.
  try {
    createModelPort({ mode: 'live', env: process.env }).check('--model', model)
  } catch (error) {
    if (!(error instanceof ModelConfigError)) throw error
    fail(error.message)
  }
  env.WRITING_HELP_EVAL_REAL = '1'
  env.WRITING_HELP_EVAL_MAX_MICROS = String(Math.round(usd * 1e6))
  env.WRITING_HELP_EVAL_MODEL = JSON.stringify(model)
}
if (values.tries) env.WRITING_HELP_EVAL_TRIES = values.tries
if (values.cases) env.WRITING_HELP_EVAL_CASES = values.cases
const out = values.out ?? join(mkdtempSync(join(tmpdir(), 'writing-help-eval-')), 'report.json')
env.WRITING_HELP_EVAL_OUT = out

const run = spawnSync(
  'npx',
  [
    'vitest',
    'run',
    '--project',
    'integration',
    'tests/web/integration/writing-help-eval.test.ts',
    '--hookTimeout=600000',
  ],
  { stdio: 'inherit', env: { ...process.env, ...env } },
)

try {
  readFileSync(out, 'utf8')
  console.log(`\nEvery turn, with what it wrote and how it was graded: ${out}`)
} catch {
  console.error('The run wrote no report.')
}
process.exit(run.status ?? 1)
