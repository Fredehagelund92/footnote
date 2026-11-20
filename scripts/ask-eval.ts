import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { modelName, modelPrices, unlistedModel } from '../src/server/config/env.ts'
import { createModelPort, ModelConfigError } from '../src/server/modules/models/index.ts'

/*
  Ask's evaluation harness from the command line (docs/evaluations.md, "Ask's evaluation
  harness"). With no flags it runs Ask's loop on the demo week on the last real run's steps, with
  no model, as every build does, and prints the report. With --real it asks a real model: the judge's agreement with its
  labels first (--no-judge-set leaves it out), then every case three times, each reply a model
  wrote read by the judge, stopping before --max-cost-usd is spent. It runs in a database of its
  own, copied from the test template, so it never reads or writes another one.

    npm run eval:ask-harness
    npm run eval:ask-harness -- --real --max-cost-usd 0.50 [--tries 3] [--record]
      [--model <provider>:<model> [--prices <input>,<output>]]
      [--judge <provider>:<model> [--judge-prices <input>,<output>]]
      [--no-judge-set] [--cases C1,K04] [--out report.json] [--resume earlier-report.json.jsonl]
    npm run eval:ask-harness -- --replay earlier-report.json.jsonl

  --model names the answering model and --judge the judge, each on any provider in the registry,
  as FOOTNOTE_MODEL does (docs/model-providers.md); both are Claude Haiku 5.5 through the Vercel
  gateway unless named. A model its provider does not list needs its prices, in US dollars per
  million tokens. --record keeps the loop's steps and the judge's verdicts the builds
  replay, so it takes only those default models. A real run journals each graded try next to its
  report (<out>.jsonl), with what it has spent; --resume goes on with such a run, asking only what
  it had not, and counts its spend against the same ceiling; --replay grades such a run's replies
  and judge findings again with no model, after a grader changes. Each provider's key is read from
  the environment and never printed.
*/

const { values } = parseArgs({
  options: {
    real: { type: 'boolean', default: false },
    'max-cost-usd': { type: 'string' },
    tries: { type: 'string' },
    record: { type: 'boolean', default: false },
    cases: { type: 'string' },
    out: { type: 'string' },
    resume: { type: 'string' },
    replay: { type: 'string' },
    'no-judge-set': { type: 'boolean', default: false },
    model: { type: 'string' },
    prices: { type: 'string' },
    judge: { type: 'string' },
    'judge-prices': { type: 'string' },
  },
})

const fail = (message: string): never => {
  console.error(message)
  process.exit(2)
}

/** The model a flag names, with its prices: the default when it names none. */
function modelOf(flag: string, name: string | undefined, prices: string | undefined) {
  if (name === undefined) {
    if (prices !== undefined) fail(`--${flag === 'model' ? '' : 'judge-'}prices needs --${flag}.`)
    return defaultModel
  }
  const ref = modelName.safeParse(name)
  if (!ref.success) fail(`--${flag} is <provider>:<model>, such as openai:gpt-oss:20b.`)
  const priced = prices === undefined ? undefined : modelPrices.safeParse(prices)
  const pricesFlag = flag === 'model' ? '--prices' : '--judge-prices'
  if (priced && !priced.success)
    fail(`${pricesFlag} is <input>,<output> in US dollars per million tokens, such as 0.5,2.`)
  if (!priced && unlistedModel(ref.data!))
    fail(
      `Provider ${ref.data!.provider} does not list ${ref.data!.model}: give its prices with ${pricesFlag} <input>,<output> in US dollars per million tokens, 0,0 for a model that costs nothing.`,
    )
  return { ...ref.data!, ...(priced?.data ? { prices: priced.data } : {}) }
}
const defaultModel = { provider: 'vercel-gateway', model: 'anthropic/claude-haiku-5.5' }

const env: Record<string, string> = {}
const named = [values.model, values.prices, values.judge, values['judge-prices']].some(
  (v) => v !== undefined,
)
if (named && !values.real) fail('--model and --judge name the models of a real run: add --real.')
if (values.real) {
  const usd = Number(values['max-cost-usd'])
  if (!values['max-cost-usd'] || !Number.isFinite(usd) || usd <= 0)
    fail('A real run needs --max-cost-usd, the most it may spend in US dollars.')
  const answer = modelOf('model', values.model, values.prices)
  const judge = modelOf('judge', values.judge, values['judge-prices'])
  // The builds replay Claude Haiku 5.5's recordings and judge against its verdicts.
  if (
    values.record &&
    JSON.stringify([answer, judge]) !== JSON.stringify([defaultModel, defaultModel])
  )
    fail(
      "--record keeps what every build replays, which is the default models' only: leave out --model and --judge.",
    )
  // Each model's provider and key, refused here by the flag that names it.
  const port = createModelPort({ mode: 'live', env: process.env })
  try {
    port.check('--model', answer)
    port.check('--judge', judge)
  } catch (error) {
    if (!(error instanceof ModelConfigError)) throw error
    fail(error.message)
  }
  env.ASK_EVAL_REAL = '1'
  env.ASK_EVAL_MAX_MICROS = String(Math.round(usd * 1e6))
  env.ASK_EVAL_MODEL = JSON.stringify(answer)
  env.ASK_EVAL_JUDGE = JSON.stringify(judge)
}
if (values.tries) env.ASK_EVAL_TRIES = values.tries
if (values.record) env.ASK_EVAL_RECORD = '1'
if (values.cases) env.ASK_EVAL_CASES = values.cases
if (values.resume) env.ASK_EVAL_RESUME = values.resume
if (values.replay) env.ASK_EVAL_REPLAY = values.replay
if (values['no-judge-set']) env.ASK_EVAL_JUDGE_SET = '0'
const out = values.out ?? join(mkdtempSync(join(tmpdir(), 'ask-eval-')), 'report.json')
env.ASK_EVAL_OUT = out

const run = spawnSync(
  'npx',
  [
    'vitest',
    'run',
    '--project',
    'integration',
    'tests/web/integration/ask-eval-loop.test.ts',
    '--hookTimeout=600000',
  ],
  { stdio: 'inherit', env: { ...process.env, ...env } },
)

try {
  const written = JSON.parse(readFileSync(out, 'utf8')) as { text?: string }
  if (written.text) console.log(`\n${written.text}`)
  console.log(`\nThe whole run, open cases only: ${out}`)
} catch {
  console.error('The run wrote no report.')
}
process.exit(run.status ?? 1)
