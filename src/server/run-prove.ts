import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { parse } from 'yaml'
import {
  PROOF_TRIES,
  proofProblems,
  proofSetSchema,
  proofTable,
  type ProofQuestion,
} from '../domain/proof.ts'
import { productName } from './brand.ts'
import { systemClock } from './clock.ts'
import { ConfigError, loadConfig } from './config/env.ts'
import { createDatabase, type Database } from './db/database.ts'
import {
  checkedModelsFor,
  modelsFor,
  planProof,
  proofDigest,
  readEvalSettings,
  runProof,
  TestRunRefused,
  type EvalDeps,
  type ProofOptions,
  type ProofPlan,
  type ProofRun,
} from './modules/evals/index.ts'
import {
  checkModelSettings,
  createModelChecks,
  createModelPort,
  formatUsd,
  ModelConfigError,
  readModelSettings,
  startCreditsCheck,
} from './modules/models/index.ts'
import { createLogger } from './observability/logger.ts'

/*
  `npm run footnote -- prove`: the proof. The same questions about a period and a market asked
  three ways through one agent (no context, the same facts as one plain file, Footnote), each try
  of each question, then a table of what each way got right, the model, whose items and questions
  they were, and what it spent. It runs on the live edition of the database in DATABASE_URL: the
  invented company's, or a team's own.

  The questions come from a file (--questions, the format of docs/templates/prove-questions.yaml).
  Without one it asks the invented company's questions, once they are opened
  (db/seed/prove-questions.yml). Until then they are sealed, and only their key holder runs them,
  with `npm run held-out -- prove`, which shares this command's flow and prints the same table.

  It uses the scripted mock model unless --real, which needs --cap at or above the estimate and a
  yes typed before any model is called. The cap holds for the whole run: no answer starts once it
  could be passed. Nothing of a question is kept: the run records its model calls, its cost and its
  counts (src/server/modules/evals/proof.ts).
*/

export const proveUsage =
  'Usage: npm run footnote -- prove [--questions <file>] [--tries <n>] [--real --cap <dollars>]'

/** The invented company's questions, once they are opened after the funded run. */
export const openedQuestions = fileURLToPath(
  new URL('../../db/seed/prove-questions.yml', import.meta.url),
)

/** Why there is nothing to ask while the invented company's questions are still sealed. */
export const stillSealed =
  "The invented company's questions are sealed until its first funded run, so only their key holder can run its proof (npm run held-out -- prove). Run your own questions with --questions <file>; docs/templates/prove-questions.yaml shows the format."

/** Where the questions come from, and how they are planned and asked. */
export type ProofSource = {
  /** Sealed questions: the flow names no item a question is about, and shows counts only. */
  sealed: boolean
  /** Whose questions, in words. */
  questions: string
  plan(database: Database, deps: EvalDeps, tries: number): Promise<ProofPlan & { digest: string }>
  run(
    database: Database,
    deps: EvalDeps,
    options: Omit<ProofOptions, 'questions'>,
  ): Promise<ProofRun>
}

/** The questions of a plain file, asked as they are. */
export function fileSource(questions: readonly ProofQuestion[], whose: string): ProofSource {
  return {
    sealed: false,
    questions: whose,
    plan: async (database, deps, tries) => ({
      ...(await planProof(database, deps, questions, tries)),
      digest: await proofDigest(questions),
    }),
    run: (database, deps, options) => runProof(database, deps, { ...options, questions }),
  }
}

/** A file's questions, or where it fails the format. */
export async function readProofFile(
  file: string,
): Promise<{ questions: ProofQuestion[] } | { problems: string[] }> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    return {
      problems: [`Cannot read ${file}: ${(error as NodeJS.ErrnoException).code ?? 'error'}`],
    }
  }
  let value: unknown
  try {
    value = parse(text, { maxAliasCount: 0 })
  } catch {
    return { problems: [`${file} is neither YAML nor JSON`] }
  }
  const problems = proofProblems(value)
  return problems.length ? { problems } : { questions: proofSetSchema.parse(value).questions }
}

export type ProveIo = {
  stdout(line: string): void
  stderr(line: string): void
  /** Asks a question and gives back what was typed; empty at the end of the input. */
  ask(question: string): Promise<string>
}

const plural = (n: number, word: string, many = `${word}s`) =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? word : many}`
const dollars = (micros: number) => `USD ${formatUsd(micros).slice(1)}`

/** Why a real run may not start with this cap: none was given, or it is below the estimate. */
export function capRefusal(estimateMicros: number, cap: number | null): string | null {
  if (cap !== null && cap >= estimateMicros) return null
  return `Estimated cost: ${dollars(estimateMicros)}. Run again with --cap ${(estimateMicros / 1_000_000).toFixed(2)} or more.`
}

/** Only a yes goes on: "y" or "yes", in any case. Anything else, or nothing, stops it. */
export const saidYes = (answer: string) => /^y(es)?$/i.test(answer.trim())

/**
 * The flow both commands share: the plan, the estimate and the cap, a yes before a real run, the
 * run, and the table. 0: it finished; 2: it stopped before every answer was made; 1: otherwise.
 */
export async function prove(
  io: ProveIo,
  flags: { tries: number; real: boolean; cap: number | null },
  source: ProofSource,
  env: Record<string, string | undefined>,
): Promise<number> {
  let config
  try {
    config = loadConfig({ ...env, MODELS: flags.real ? 'live' : 'mock' })
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    io.stderr(error.message)
    return 1
  }
  const logger = createLogger({ level: 'warn' })
  const database = createDatabase(config.databaseUrl, logger)
  // Ctrl-C stops the run after the answers in flight; it ends incomplete.
  const controller = new AbortController()
  const interrupt = () => controller.abort(new Error('Stopped from the command line'))
  process.once('SIGINT', interrupt)
  try {
    const deps: EvalDeps = {
      port: createModelPort({ mode: config.models, env: config.modelEnv }),
      clock: systemClock(config.fixedToday),
      ...(flags.real ? { checks: createModelChecks({ database }) } : {}),
    }
    // The settings only, before the yes: no model is called yet.
    const settings = await readEvalSettings(database)
    try {
      checkModelSettings(deps.port, await readModelSettings(database))
      modelsFor(deps.port, settings)
    } catch (error) {
      if (!(error instanceof ModelConfigError)) throw error
      io.stderr(error.message)
      return 1
    }
    const plan = await source.plan(database, deps, flags.tries)
    if (!plan.edition) {
      io.stderr('There is no live edition yet: publish context first.')
      return 1
    }
    const items = plan.demo ? 'the invented company' : "this workspace's published context"
    io.stdout(
      `${plural(plan.questions, 'question')} about a period and a market, asked three ways, ${plural(plan.tries, 'try', 'tries')} each: ${plural(plan.answers, 'answer')}.`,
    )
    io.stdout(
      `Items: ${items}, edition ${plan.edition}, ${plural(plan.notes, 'note')} agents are told; as one plain file, about ${plural(plan.fileTokens, 'token')}.`,
    )
    io.stdout(`Questions: ${source.questions} (digest ${plan.digest}).`)
    if (plan.unserved.length) {
      io.stderr(
        source.sealed
          ? `${plural(plan.unserved.length, 'note')} the questions name ${plan.unserved.length === 1 ? 'is' : 'are'} not published for every agent in this edition, so the questions do not fit these items.`
          : `These notes are not published for every agent in this edition, so the questions do not fit these items: ${plan.unserved.join(', ')}.`,
      )
      return 1
    }
    io.stdout(`Model: ${plan.model}, judged by ${plan.judge}.`)
    if (!flags.real) {
      io.stdout(
        'Scripted model: no AI model is called and nothing is spent. The table shows that the command works, not how an agent answers. Run with --real --cap <dollars> to ask a real agent.',
      )
    } else {
      const refusal = capRefusal(plan.costMicros, flags.cap)
      if (refusal || flags.cap === null) {
        io.stderr(refusal ?? '')
        return 1
      }
      io.stdout(
        `Estimated cost: ${dollars(plan.costMicros)}. Cap: ${dollars(flags.cap)}. It sends the questions and the published notes to ${plan.recipients}.`,
      )
      if (!saidYes(await io.ask('Go on? '))) {
        io.stdout('Nothing was asked.')
        return 1
      }
    }
    let credits = null
    if (flags.real) {
      // Now the models are checked: three tiny calls each (models:check), refused before any
      // question is sent when the answering model cannot call tools.
      try {
        const models = await checkedModelsFor(deps, settings)
        credits = await startCreditsCheck(deps.port, database, [
          models.answer.provider,
          models.judge.provider,
        ])
      } catch (error) {
        if (!(error instanceof ModelConfigError || error instanceof TestRunRefused)) throw error
        io.stderr(error.message)
        return 1
      }
    }
    const run = await source.run(database, deps, {
      tries: flags.tries,
      about: `Items: ${items}. Questions: ${source.questions}.`,
      person: null,
      ceilingMicros: flags.real ? flags.cap : null,
      signal: controller.signal,
      logger,
    })
    io.stdout('')
    for (const line of proofTable(run.results, plan.questions, plan.nothing, productName))
      io.stdout(line)
    io.stdout('')
    const noAnswer = run.results.reduce((n, r) => n + r.noAnswer, 0)
    if (noAnswer)
      io.stdout(
        `${plural(noAnswer, 'answer')} counted in no column: refused, or the judge gave no grade it could use (${run.judging.errors}).`,
      )
    if (run.stopped) io.stdout(`It stopped early: ${run.stopped}`)
    io.stdout(
      `Model: ${plan.model}, judged by ${plan.judge}. Items: ${items}. Questions: ${source.questions}. Spent: ${dollars(run.costMicros)}${flags.real && flags.cap !== null ? ` of a ${dollars(flags.cap)} cap` : ''}.`,
    )
    for (const line of (await credits?.finish([run.runId])) ?? []) io.stdout(line)
    if (run.state === 'incomplete' || run.state === 'cancelled') return 2
    return 0
  } finally {
    process.off('SIGINT', interrupt)
    await database.close()
  }
}

/** The command's flags, or a usage problem. */
export function proveFlags(
  argv: readonly string[],
): { tries: number; real: boolean; cap: number | null; questions?: string } | null {
  let values
  try {
    values = parseArgs({
      args: [...argv],
      options: {
        questions: { type: 'string' },
        tries: { type: 'string' },
        real: { type: 'boolean', default: false },
        cap: { type: 'string' },
      },
      strict: true,
    }).values
  } catch {
    return null
  }
  const tries = values.tries === undefined ? PROOF_TRIES : Number(values.tries)
  const cap = values.cap === undefined ? null : Math.round(Number(values.cap) * 1_000_000)
  if (!Number.isInteger(tries) || tries < 1 || tries > 10) return null
  if (cap !== null && !(cap >= 0)) return null
  return {
    tries,
    real: values.real,
    cap,
    ...(values.questions !== undefined ? { questions: values.questions } : {}),
  }
}

/** Reads one answer from the terminal, or from the input a script pipes in. */
async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await new Promise<string>((done) => {
      rl.once('close', () => done(''))
      rl.question(question).then(done, () => done(''))
    })
  } finally {
    rl.close()
  }
}

async function main(): Promise<number> {
  const flags = proveFlags(process.argv.slice(2))
  if (!flags) {
    console.error(proveUsage)
    return 2
  }
  const file = flags.questions ?? (existsSync(openedQuestions) ? openedQuestions : null)
  if (!file) {
    console.error(stillSealed)
    return 1
  }
  const read = await readProofFile(file)
  if ('problems' in read) {
    console.error(`${file} does not fit the question format:\n  ${read.problems.join('\n  ')}`)
    return 1
  }
  const whose = flags.questions ? file : "the invented company's"
  return prove(
    {
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      ask,
    },
    flags,
    fileSource(read.questions, whose),
    process.env,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main()
