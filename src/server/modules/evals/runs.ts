import type {
  Agreement,
  CellScore,
  PassRule,
  QuestionLayers,
  Verdict,
} from '../../../domain/golden-question.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { toolSchemaDigest } from '../../mcp/tools.ts'
import {
  enabledTools,
  loadServingBundle,
  loadServingPolicy,
  type ServingBundle,
  type ServingPolicy,
} from '../editions/index.ts'
import {
  differentFamily,
  testRunRefusal,
  withJsonText,
  type JudgeSetting,
  type ModelChecks,
  type ModelChoice,
  type ModelPort,
} from '../models/index.ts'
import { answerPromptDigest } from './answer.ts'
import { evalClient } from './arm.ts'
import {
  estimate,
  loadActiveQuestions,
  loadRevisions,
  planQuestions,
  testSetDigest,
  type ArmName,
  type ArmTools,
  type Models,
  type PlannedQuestion,
} from './plan.ts'
import { readEvalSettings, type EvalSettings } from './settings.ts'

/**
 * Evaluation runs. A run is planned and costed without a model, stored, and then worked by the
 * `evals.work` job. Scheduled runs score a live area every week and move its baseline (FR-517,
 * FR-518). No suggestion waits for answer tests: every item passes levels 1 to 3 only (FR-513).
 */

/**
 * `checks`: the model check (models/capability.ts), with real models. A run then answers only on a
 * model that calls tools, and its judge asks for JSON text when it cannot keep to a JSON schema.
 */
export type EvalDeps = { port: ModelPort; clock: Clock; checks?: ModelChecks }
/** `held_out`: the sealed held-out questions of an area, run with nothing of them kept. */
export type RunKind = 'full' | 'scheduled' | 'held_out'
export type RunState =
  'awaiting_approval' | 'queued' | 'running' | 'finished' | 'failed' | 'cancelled' | 'incomplete'
/** Why a full run was queued without a person: a change that bypasses the review gate. */
export type RunTrigger = 'source_sync' | 'tool_descriptions' | 'date_expiry'

export type RunSummary = {
  edition: string
  plan: { questions: PlannedQuestion[]; setAside: string[] }
  estimate: { cells: number; cached: number; micros: number }
  /** The tools each side offered. */
  tools: ArmTools
  /**
   * About our business and the calendar the eval client's server instructions said when the run
   * was planned: its cells are keyed on them, so its arms say the same however the settings
   * change before the run is worked or resumed.
   */
  policy: PlannedPolicy
  /** A run a person started themself counts against their daily limit. */
  manual?: boolean
  trigger?: RunTrigger
  /** How tries decide a wording; absent means `majority` (FR-515). */
  passRule?: PassRule
  /** Why the run last stopped before it finished, and what was missing then. */
  stopped?: RunStop
  /** How often the run was resumed after it stopped. */
  resumes?: number
  /** A held-out run (withheld.ts): the area and how many questions, never which. */
  heldOut?: { area: string; questions: number }
  result?: RunResult
}
/**
 * Why a run ended incomplete: answers the provider or the tool server kept from being made
 * (`infrastructure`), a spending cap (`cap`), the run's own cost ceiling (`ceiling`), or the
 * command that worked it was stopped (`stopped`). None of it is a quality result.
 */
export type RunStop = {
  reason: 'infrastructure' | 'cap' | 'ceiling' | 'stopped'
  /** Answers not made yet, by why they failed (`missing`: not tried before the stop). */
  failed: Partial<Record<'throttled' | 'provider' | 'tool' | 'error' | 'missing', number>>
  cells: number
  at: string
}
export type QuestionResult = {
  id: string
  baseline: Verdict | null
  candidate: Verdict | null
  flip: 'pass_to_fail' | 'fail_to_pass' | null
  /** Each side split into the code-checked and judge-checked layers. */
  layers: { baseline: QuestionLayers; candidate: QuestionLayers | null }
}
export type RunResult = {
  questions: QuestionResult[]
  scorecard?: Scorecard
  /** Judge against code, per side; absent on a run with no questions. */
  agreement?: { baseline: Agreement; candidate: Agreement | null }
}
export type Scorecard = {
  edition: string
  questions: number
  passed: number
  failed: number
  noAnswer: number
  setAside: number
  failing: string[]
  regressions: string[]
  baselineRun: string | null
  heldOut: HeldOut
  /**
   * Questions passing and failing in each layer, and how many questions each check failed, so a
   * drop can be traced to retrieval and citing (code) or to caveats, causes and rubrics (judge).
   */
  layers: Record<'code' | 'judge', { passed: number; failed: number }>
  failedChecks: Record<string, number>
  /** Where the judge and the code checks disagreed; absent on a run with no questions. */
  agreement?: Agreement
}
/**
 * The quality targets of requirements section 1.7, on the held-out part: at least 90 percent of
 * required caveats appear (strict), at most 5 percent of answers claim an unproven cause, at least
 * 80 percent of answers are acceptable. Counts come with the rates.
 */
export type HeldOut = {
  questions: number
  answers: number
  caveats: { required: number; present: number }
  causeClaims: number
  acceptable: number
  meetsTargets: boolean
}

export type RunRow = {
  id: string
  kind: RunKind
  state: RunState
  area_id: string | null
  baseline_edition_seq: string | null
  model_id: string
  judge_model_id: string | null
  answer_family: string
  judge_family: string
  answer_provider: string
  judge_provider: string
  answer_vendor: string
  judge_vendor: string
  tries: number
  flip_repeats: number
  estimated_cost_micros: string
  actual_cost_micros: string
  requested_by: string | null
  approved_by: string | null
  /** The most the run may spend, as approved; null when only the spending caps apply. */
  cost_ceiling_micros: string | null
  /** The worker holding the run's lease, while one works it. */
  worker: string | null
  summary: RunSummary
  failure: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}
export const runColumns = `id::text,kind::text,state::text,area_id,
  baseline_edition_seq::text,model_id,judge_model_id,answer_provider,judge_provider,answer_family,judge_family,answer_vendor,judge_vendor,tries,flip_repeats,estimated_cost_micros::text,
  actual_cost_micros::text,requested_by::text,approved_by::text,cost_ceiling_micros::text,worker,summary,failure,created_at::text,
  started_at::text,finished_at::text`

/**
 * The answering model and its judge. By default the judge comes from another family than the
 * answering model line, so it does not grade its own line's answers; it stays with the answering
 * model's provider and vendor. A named judge (which may be another vendor) is used as set, and a
 * run records both providers, families and vendors either way.
 */
export function modelsFor(port: ModelPort, settings: EvalSettings): Models {
  const answer = port.choose('eval_answer', settings.models.eval_answer)
  return { answer, judge: judgeFor(port, answer, settings.models.judge) }
}

/** A test run that cannot start on its answering model; its message says why. */
export class TestRunRefused extends Error {
  override name = 'TestRunRefused'
}

/**
 * The models a run is worked with, checked first where the service keeps model checks: a run whose
 * answering model failed the tool call is refused (`TestRunRefused`), and a judge that failed the
 * JSON schema asks for JSON text.
 */
export async function checkedModelsFor(deps: EvalDeps, settings: EvalSettings): Promise<Models> {
  const models = modelsFor(deps.port, settings)
  if (!deps.checks) return models
  const [answer, judge] = await Promise.all([
    deps.checks.of(models.answer, 'eval_answer'),
    deps.checks.of(models.judge, 'judge'),
  ])
  const refusal = testRunRefusal(answer)
  if (refusal) throw new TestRunRefused(refusal)
  return { answer: models.answer, judge: withJsonText(models.judge, judge) }
}

function judgeFor(port: ModelPort, answer: ModelChoice, setting: JudgeSetting): ModelChoice {
  return setting === differentFamily
    ? port.otherLine('judge', answer)
    : port.choose('judge', setting)
}

export type Head = { seq: string; label: string; overlay: string }
export async function liveHead(tx: Queryable): Promise<Head | null> {
  const [head] = await tx.query<Head>(
    `select e.seq::text,e.label,coalesce((select seq::text from serving_overlay),'0') as overlay
       from editions e join live_edition l on l.seq=e.seq`,
  )
  return head ?? null
}
export async function headAt(tx: Queryable, seq: string): Promise<Head> {
  const [head] = await tx.query<Head>(
    `select e.seq::text,e.label,coalesce((select seq::text from serving_overlay),'0') as overlay
       from editions e where e.seq=$1`,
    [seq],
  )
  if (!head) throw new Error('The run edition does not exist')
  return head
}

/** The side a run answers on: the edition it was planned on. */
export async function sidesFor(
  tx: Queryable,
  head: Head,
): Promise<Partial<Record<ArmName, ServingBundle>>> {
  return { baseline: await loadServingBundle(tx, head) }
}

/** The tools switched on now. The `eval` client's own policy still applies on top, in the gateway. */
export async function armTools(tx: Queryable): Promise<ArmTools> {
  const on = await enabledTools(tx)
  return { baseline: on, candidate: on }
}

export async function insertRun(
  tx: Queryable,
  values: {
    kind: RunKind
    state: RunState
    area: string | null
    head: Head
    models: Models
    settings: EvalSettings
    planned: PlannedQuestion[]
    summary: RunSummary
    requestedBy: string | null
    costCeilingMicros?: number | null
  },
): Promise<RunRow> {
  const [row] = await tx.query<RunRow>(
    `insert into eval_runs(kind,state,area_id,baseline_edition_seq,
       tool_schema_digest,model_id,judge_model_id,client_label,test_set_digest,tries,flip_repeats,
       estimated_cost_micros,requested_by,system_prompt_digest,summary,answer_family,judge_family,answer_vendor,judge_vendor,
       answer_provider,judge_provider,cost_ceiling_micros)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) returning ${runColumns}`,
    [
      values.kind,
      values.state,
      values.area,
      values.head.seq,
      toolSchemaDigest,
      values.models.answer.id,
      values.models.judge.id,
      evalClient,
      Buffer.from(testSetDigest(values.planned), 'hex'),
      values.settings.tries,
      values.settings.flipRepeats,
      values.summary.estimate.micros,
      values.requestedBy,
      answerPromptDigest,
      JSON.stringify(values.summary),
      values.models.answer.family,
      values.models.judge.family,
      values.models.answer.vendor,
      values.models.judge.vendor,
      values.models.answer.provider,
      values.models.judge.provider,
      values.costCeilingMicros ?? null,
    ],
  )
  return row!
}

/** An area run's kind: the whole set, started by hand or by a change, or scheduled. */
export type AreaRunKind = 'full' | 'scheduled'

export type PlannedPolicy = Pick<ServingPolicy, 'about' | 'calendar'>

/** What of the eval client's policy a run fixes when it is planned (`RunSummary.policy`). */
export async function plannedPolicy(tx: Queryable): Promise<PlannedPolicy> {
  const { about, calendar } = await loadServingPolicy(tx, evalClient)
  return { about, calendar }
}

/** Plans an area's whole active set on the live edition, without saving anything (FR-516). */
export async function planArea(tx: Queryable, deps: EvalDeps, area: string) {
  const head = await liveHead(tx)
  if (!head) return null
  const settings = await readEvalSettings(tx)
  const models = modelsFor(deps.port, settings)
  const { questions, setAside } = await loadActiveQuestions(tx, [area])
  const tools = await armTools(tx)
  const policy = await plannedPolicy(tx)
  const planned = await planQuestions(
    questions,
    await sidesFor(tx, head),
    deps.clock,
    models,
    tools,
    policy,
  )
  const cost = await estimate(tx, planned, settings.tries, models)
  return { head, settings, models, planned, setAside, cost, tools, policy }
}

/**
 * A run of an area's whole active set on the live edition: scheduled weekly, started by hand, or
 * queued by a change that bypasses the review gate.
 */
export async function queueAreaRun(
  tx: Queryable,
  deps: EvalDeps,
  area: string,
  kind: AreaRunKind,
  manual: boolean,
  trigger?: RunTrigger,
  options: { passRule?: PassRule; costCeilingMicros?: number | null } = {},
): Promise<RunRow | null> {
  const planned = await planArea(tx, deps, area)
  if (!planned) return null
  const { head, settings, models, cost } = planned
  const run = await insertRun(tx, {
    kind,
    state: cost.micros > settings.runBudgetMicros ? 'awaiting_approval' : 'queued',
    area,
    head,
    models,
    settings,
    planned: planned.planned,
    summary: {
      edition: head.label,
      plan: { questions: planned.planned, setAside: planned.setAside },
      estimate: cost,
      tools: planned.tools,
      policy: planned.policy,
      manual,
      ...(trigger ? { trigger } : {}),
      ...(options.passRule && options.passRule !== 'majority'
        ? { passRule: options.passRule }
        : {}),
    },
    requestedBy: manual ? await person(tx) : null,
    costCeilingMicros: options.costCeilingMicros ?? null,
  })
  if (!planned.planned.length) return finishRun(tx, run, [])
  return run
}

async function person(tx: Queryable): Promise<string | null> {
  const [row] = await tx.query<{ id: string | null }>('select cl_person()::text as id')
  return row?.id ?? null
}

/** Records the scorecard and, for a scheduled run, the baseline. */
export async function finishRun(
  tx: Queryable,
  run: RunRow,
  questions: QuestionResult[],
  agreement?: NonNullable<RunResult['agreement']>,
): Promise<RunRow> {
  const result: RunResult = { questions, ...(agreement ? { agreement } : {}) }
  result.scorecard = await scorecard(tx, run, questions)
  if (agreement) result.scorecard.agreement = agreement.baseline
  if (run.kind === 'scheduled') {
    // FR-518: only a finished full scheduled run on the live edition moves the baseline.
    await tx.query('insert into eval_baselines(area_id,run_id,edition_seq) values($1,$2,$3)', [
      run.area_id,
      run.id,
      run.baseline_edition_seq,
    ])
    await tx.query(
      `insert into outbox_events(topic,area_id,aggregate_type,aggregate_id,payload)
       values('eval.scorecard',$1,'eval_run',$2,$3)`,
      [run.area_id, run.id, JSON.stringify(result.scorecard)],
    )
  }
  const [row] = await tx.query<RunRow>(
    `update eval_runs set state='finished',finished_at=now(),started_at=coalesce(started_at,now()),
       worker=null,lease_until=null,summary=(summary-'stopped')||jsonb_build_object('result',$2::jsonb)
     where id=$1 returning ${runColumns}`,
    [run.id, JSON.stringify(result)],
  )
  return row!
}

async function scorecard(
  tx: Queryable,
  run: RunRow,
  questions: QuestionResult[],
): Promise<Scorecard> {
  const [baseline] = await tx.query<{ run: string; summary: RunSummary }>(
    `select r.id::text as run,r.summary from eval_baselines b join eval_runs r on r.id=b.run_id
      where b.area_id=$1 order by b.set_at desc limit 1`,
    [run.area_id],
  )
  const before = new Map(
    (baseline?.summary.result?.questions ?? []).map((q) => [q.id, q.baseline] as const),
  )
  const failing = questions.filter((q) => q.baseline === 'fail').map((q) => q.id)
  const bodies = await loadRevisions(tx, run.summary.plan.questions)
  const heldOutIds = new Set(
    [...bodies].filter(([, body]) => body.split === 'held_out').map(([id]) => id),
  )
  const cells = await tx.query<{ question: string; scores: CellScore }>(
    `select question_id as question,scores from eval_cells
      where run_id=$1 and state='finished' and passed is not null and question_id=any($2)`,
    [run.id, [...heldOutIds]],
  )
  const required = cells.filter((c) => c.scores.caveat !== null)
  const caveats = {
    required: required.length,
    present: required.filter((c) => c.scores.caveat).length,
  }
  const causeClaims = cells.filter((c) => c.scores.checks.no_cause_claim === false).length
  const acceptable = questions.filter((q) => heldOutIds.has(q.id) && q.baseline === 'pass').length
  const heldOut: HeldOut = {
    questions: heldOutIds.size,
    answers: cells.length,
    caveats,
    causeClaims,
    acceptable,
    meetsTargets:
      heldOutIds.size > 0 &&
      cells.length > 0 &&
      caveats.present >= 0.9 * caveats.required &&
      causeClaims <= 0.05 * cells.length &&
      acceptable >= 0.8 * heldOutIds.size,
  }
  const layers = { code: { passed: 0, failed: 0 }, judge: { passed: 0, failed: 0 } }
  const failedChecks: Record<string, number> = {}
  for (const q of questions) {
    for (const layer of ['code', 'judge'] as const) {
      const verdict = q.layers.baseline[layer]
      if (verdict === 'pass') layers[layer].passed++
      if (verdict === 'fail') layers[layer].failed++
    }
    for (const check of q.layers.baseline.failedChecks)
      failedChecks[check] = (failedChecks[check] ?? 0) + 1
  }
  return {
    edition: run.summary.edition,
    questions: questions.length,
    passed: questions.filter((q) => q.baseline === 'pass').length,
    failed: failing.length,
    noAnswer: questions.filter((q) => q.baseline === 'no_answer').length,
    setAside: run.summary.plan.setAside.length,
    failing,
    regressions: failing.filter((id) => before.get(id) === 'pass'),
    baselineRun: baseline?.run ?? null,
    heldOut,
    layers,
    failedChecks,
  }
}

/** Stops a run with a reason. */
export async function failRun(tx: Queryable, run: RunRow, reason: string): Promise<void> {
  await tx.query(
    `update eval_runs set state='failed',failure=$2,finished_at=now(),worker=null,lease_until=null
      where id=$1 and state='running'`,
    [run.id, reason.slice(0, 500)],
  )
}

/** What a stopped run says, in words: why, and what is missing. */
export function stopWords(stop: RunStop): string {
  const missing = Object.values(stop.failed).reduce((sum, n) => sum + (n ?? 0), 0)
  const kinds: [keyof RunStop['failed'], string][] = [
    ['throttled', 'refused for the provider’s rate limit'],
    ['provider', 'failed at the provider'],
    ['tool', 'with a tool call the tool server refused'],
    ['error', 'failed for another reason'],
    ['missing', 'not tried yet'],
  ]
  const parts = kinds
    .filter(([kind]) => stop.failed[kind])
    .map(([kind, words]) => `${stop.failed[kind]} ${words}`)
  const why =
    stop.reason === 'cap'
      ? 'A spending cap stopped it. '
      : stop.reason === 'ceiling'
        ? 'It reached its cost ceiling. '
        : stop.reason === 'stopped'
          ? 'It was stopped before it finished. '
          : ''
  return (
    `${why}${missing} of ${stop.cells} answer${stop.cells === 1 ? '' : 's'} not made` +
    `${parts.length ? ` (${parts.join(', ')})` : ''}. ` +
    'They count as neither a pass nor a fail; resuming the run makes only those.'
  ).slice(0, 500)
}

/**
 * Stops a run before it finished (R6): its finished answers stay, nothing is scored, and resuming
 * it makes only the missing ones. A paired run records nothing on the version: the gate says the
 * answer tests did not finish.
 */
export async function stopRun(
  tx: Queryable,
  run: Pick<RunRow, 'id'>,
  reason: RunStop['reason'],
  detail?: string,
): Promise<RunStop> {
  const counts = await tx.query<{ kind: string; n: number }>(
    `select coalesce(failure_kind,case when state='failed' then 'error' else 'missing' end) as kind,count(*)::int as n
       from eval_cells where run_id=$1 and state<>'finished' group by 1`,
    [run.id],
  )
  const [planned] = await tx.query<{ cells: number; finished: number }>(
    `select (select count(*)::int from eval_cells where run_id=$1) as cells,
            (select count(*)::int from eval_cells where run_id=$1 and state='finished') as finished`,
    [run.id],
  )
  const stop: RunStop = {
    reason,
    failed: Object.fromEntries(counts.map((c) => [c.kind, c.n])),
    cells: planned?.cells ?? 0,
    at: new Date().toISOString(),
  }
  await tx.query(
    `update eval_runs set state='incomplete',finished_at=now(),worker=null,lease_until=null,failure=$2,
       summary=summary||jsonb_build_object('stopped',$3::jsonb)
     where id=$1 and state='running'`,
    [run.id, `${detail ? `${detail} ` : ''}${stopWords(stop)}`.slice(0, 500), JSON.stringify(stop)],
  )
  return stop
}

/**
 * The kinds the worker never takes: the held-out questions are worked by the command that runs
 * them. Queued again, such a run would wait for nobody.
 */
export const commandKinds: readonly string[] = ['held_out']
const commandRunNotResumed =
  'This test run is worked only by the command that started it, so it is not resumed. Run that command again (for held-out cases, npm run held-out -- eval --area <domain id>).'

/**
 * Whether a run may be queued again, and why not (#194): only a run that stopped before it
 * finished, of a kind the worker takes. The transition table allows `incomplete -> queued` for
 * every kind; this is the part that depends on the kind. The service, the command line and the
 * job's housekeeping all resume through `resumeRun`, which asks it.
 */
export function canResume(run: {
  kind: string
  state: string
}): { resume: true } | { resume: false; why: string } {
  if (run.state !== 'incomplete')
    return {
      resume: false,
      why: 'Only a test run that stopped before it finished can be resumed.',
    }
  if (commandKinds.includes(run.kind)) return { resume: false, why: commandRunNotResumed }
  return { resume: true }
}

/**
 * Queues an incomplete run again: the worker skips every finished answer and makes only the
 * missing ones. `costCeilingMicros` replaces the run's ceiling when given (the whole run's,
 * what it spent so far included). Returns false when `canResume` refuses the run.
 */
export async function resumeRun(
  tx: Queryable,
  id: string,
  options: { costCeilingMicros?: number | null } = {},
): Promise<boolean> {
  const [run] = await tx.query<{ kind: string; state: string }>(
    'select kind::text,state::text from eval_runs where id=$1 for update',
    [id],
  )
  if (!run || !canResume(run).resume) return false
  await tx.query(
    `update eval_runs set state='queued',finished_at=null,failure=null,worker=null,lease_until=null,
       cost_ceiling_micros=case when $2::boolean then $3::bigint else cost_ceiling_micros end,
       summary=summary||jsonb_build_object('resumes',coalesce((summary->>'resumes')::int,0)+1)
     where id=$1`,
    [id, options.costCeilingMicros !== undefined, options.costCeilingMicros ?? null],
  )
  return true
}
