import { randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import {
  questionVerdict,
  wordingVerdict,
  type CellScore,
  type GoldenQuestion,
  type Judging,
  type PassRule,
  type Verdict,
} from '../../../domain/golden-question.ts'
import { onDay } from '../../clock.ts'
import type { Database } from '../../db/database.ts'
import type { CallLimiter, Sleep } from '../models/index.ts'
import { tryQuestion } from './answer.ts'
import { openArm, type Arm } from './arm.ts'
import { endCommandRun, stoppedWords, workCommandRun } from './command-run.ts'
import { cellEstimateMicros } from './plan.ts'
import {
  armTools,
  checkedModelsFor,
  insertRun,
  liveHead,
  modelsFor,
  plannedPolicy,
  sidesFor,
  type EvalDeps,
} from './runs.ts'
import { readEvalSettings } from './settings.ts'
import { LEASE } from './worker.ts'

/*
  An area run of questions held in memory, of which nothing is kept (FR-525): the sealed held-out
  questions, which only the code that opened them hands over (db/seed/held-out-runs.ts). It is the
  same runner as every area run: the live edition, the eval client's tools through the real MCP
  wire, each question on its own as-of day, the same answer, judge and score (`tryQuestion`), the
  run's tries and pass rule, the call limits, the spending caps and a cost ceiling. But no
  question's words, expectations, answer or transcript reach the database or a log: there are no
  cells and no transcripts, and the run is recorded only for its model calls and cost (kind
  `held_out`, no area, no question ids), with counts in words. The caller gets a verdict per
  question, in the order given, and says nothing more than counts.

  No worker takes such a run, so the runner holds a lease on it and works it as every command's
  run is worked (command-run.ts), and then leaves the run as it was ended.
*/

export type WithheldOptions = {
  area: string
  questions: readonly GoldenQuestion[]
  /** Who the run counts against for the daily limit; null at the command line. */
  person: string | null
  /** The most the run may spend, in micros; null when only the spending caps apply. */
  ceilingMicros: number | null
  passRule?: PassRule
  signal: AbortSignal
  logger: Logger
  limiter?: CallLimiter
  wait?: Sleep
}

export type WithheldRun = {
  runId: string
  /**
   * `incomplete` when an answer could not be made, the run stopped at a cap or its ceiling, or its
   * lease ran out; `cancelled` when someone cancelled it.
   */
  state: 'finished' | 'incomplete' | 'cancelled'
  /** One per question, in the order given; `no_answer` for one that was not answered. */
  verdicts: Verdict[]
  judging: Judging
  costMicros: number
  /** Why the run stopped before every answer was made, in words without a question in them. */
  stopped: string | null
}

/** What a run of these questions would make and cost: counts and money only. */
export async function estimateWithheld(
  database: Database,
  deps: EvalDeps,
  questions: readonly GoldenQuestion[],
): Promise<{ edition: string | null; cells: number; costMicros: number }> {
  return database.transaction(null, async (tx) => {
    const head = await liveHead(tx)
    const settings = await readEvalSettings(tx)
    const models = modelsFor(deps.port, settings)
    const cells = questions.reduce((n, q) => n + q.wordings.length * settings.tries, 0)
    return { edition: head?.label ?? null, cells, costMicros: cells * cellEstimateMicros(models) }
  })
}

/** Runs the questions as one area run, keeping none of their words. */
export async function runWithheld(
  database: Database,
  deps: EvalDeps,
  options: WithheldOptions,
): Promise<WithheldRun> {
  const { questions, person, signal } = options
  const worker = randomUUID()
  const rule = options.passRule ?? 'majority'
  // The models are checked before the run is made, outside its transaction: a run on a model
  // that cannot call tools is refused (`TestRunRefused`) and none is made.
  const settings = await database.transaction(person, (tx) => readEvalSettings(tx))
  const models = await checkedModelsFor(deps, settings)
  const prepared = await database.transaction(person, async (tx) => {
    const head = await liveHead(tx)
    if (!head) throw new Error('There is no live edition yet')
    const tools = await armTools(tx)
    const policy = await plannedPolicy(tx)
    const bundle = (await sidesFor(tx, head)).baseline!
    const cells = questions.reduce((n, q) => n + q.wordings.length * settings.tries, 0)
    const run = await insertRun(tx, {
      kind: 'held_out',
      state: 'running',
      // No area: the run is listed for administrators and its requester, not in an area's runs.
      area: null,
      head,
      models,
      settings,
      planned: [],
      summary: {
        edition: head.label,
        plan: { questions: [], setAside: [] },
        estimate: { cells, cached: 0, micros: cells * cellEstimateMicros(models) },
        tools,
        policy,
        manual: person !== null,
        heldOut: { area: options.area, questions: questions.length },
        ...(rule !== 'majority' ? { passRule: rule } : {}),
      },
      requestedBy: person,
      costCeilingMicros: options.ceilingMicros,
    })
    await tx.query(
      `update eval_runs set started_at=now(),worker=$2,lease_until=now()+interval '${LEASE}' where id=$1`,
      [run.id, worker],
    )
    return { run, tools, policy, bundle }
  })
  const { run, tools, policy, bundle } = prepared
  const estimate = cellEstimateMicros(models)
  // Each question's tries, one list per wording; a try not made stays out.
  const scores = questions.map((q) => q.wordings.map((): CellScore[] => []))
  const arms = new Map<string, Promise<Arm>>()
  const armOn = (day: string) => {
    let arm = arms.get(day)
    if (!arm) {
      arm = openArm(bundle, database, onDay(deps.clock, day), { tools: tools.baseline, ...policy })
      arms.set(day, arm)
    }
    return arm
  }
  const tasks = questions.flatMap((q, question) =>
    q.wordings.flatMap((_, wording) =>
      Array.from({ length: settings.tries }, () => ({
        task: { question, wording },
        estimateMicros: estimate,
      })),
    ),
  )
  const total = tasks.length
  let work
  try {
    work = await workCommandRun(
      database,
      {
        runId: run.id,
        worker,
        settings,
        person,
        ceilingMicros: options.ceilingMicros,
        signal,
        logger: options.logger,
        failure: 'held-out answer failed',
        ...(options.limiter ? { limiter: options.limiter } : {}),
        ...(options.wait ? { wait: options.wait } : {}),
      },
      tasks,
      async ({ question, wording }, meter) => {
        const body = questions[question]!
        const made = await tryQuestion(
          await armOn(body.as_of ?? deps.clock.today()),
          {
            answer: meter.wrap(models.answer, { role: 'eval_answer' }),
            judge: meter.wrap(models.judge, { role: 'judge' }),
          },
          body,
          wording,
          signal,
        )
        await meter.settled()
        scores[question]![wording]!.push(made.score)
      },
    )
  } finally {
    for (const arm of arms.values()) await (await arm.catch(() => null))?.close()
  }

  const verdicts = scores.map((wordings) =>
    questionVerdict(wordings.map((tries) => wordingVerdict(tries, rule))),
  )
  const tries = scores.flat(2)
  const judging = {
    judged: tries.filter((t) => t.passed !== null || t.judgeError).length,
    errors: tries.filter((t) => t.judgeError).length,
  }
  const stopped = stoppedWords(work, total)
  const count = (verdict: Verdict) => verdicts.filter((v) => v === verdict).length
  const words =
    `Held-out questions: ${count('pass')} passed, ${count('fail')} failed, ` +
    `${count('no_answer')} without an answer, of ${questions.length}.`
  const ended = stopped ? 'incomplete' : 'finished'
  const row = await endCommandRun(
    database,
    person,
    { id: run.id, worker },
    {
      state: ended,
      failure: `${stopped ? `${stopped} ` : ''}${words}`,
      summary: { judging },
    },
  )
  const state = row.state
  return {
    runId: run.id,
    state,
    verdicts,
    judging,
    costMicros: row.costMicros,
    stopped: state === ended ? stopped : (stopped ?? 'It was ended before it finished.'),
  }
}
