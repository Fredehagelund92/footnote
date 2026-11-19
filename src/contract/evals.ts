import * as z from 'zod/mini'
import { passRules, questionSplits } from '../domain/golden-question.ts'

/** Test questions, evaluation runs, transcripts and scorecards (requirements section 5.5). */

const areaId = z.string().check(z.regex(/^[a-z][a-z0-9_]{1,39}$/))
const uuid = z.string().check(z.regex(/^[0-9a-f-]{36}$/))
/** A question's verdict in a run; null when it has none on that side. */
export const verdictSchema = z.nullable(z.enum(['pass', 'fail', 'no_answer']))
export const importSchema = z.object({
  content: z.string().check(z.minLength(1), z.maxLength(1_000_000)),
  dryRun: z._default(z.boolean(), true),
})
export const importReportSchema = z.object({
  applied: z.boolean(),
  created: z.array(z.string()),
  updated: z.array(z.string()),
  unchanged: z.array(z.string()),
  errors: z.array(z.object({ index: z.number(), id: z.nullable(z.string()), message: z.string() })),
})

export const runStates = [
  'awaiting_approval',
  'queued',
  'running',
  'finished',
  'failed',
  'cancelled',
  // Stopped before every answer was made; resumable (R6).
  'incomplete',
] as const
export const runSchema = z.object({
  id: z.string(),
  kind: z.enum([
    'full',
    'scheduled',
    'links',
    // The sealed held-out questions of an area, run with none of their words kept (FR-525).
    'held_out',
  ]),
  state: z.enum(runStates),
  areaId: z.nullable(z.string()),
  edition: z.string(),
  modelId: z.string(),
  judgeModelId: z.nullable(z.string()),
  /** The provider that served each model, such as `anthropic` or `vercel-gateway`. */
  modelProvider: z.string(),
  judgeProvider: z.string(),
  /** Vendor and model line, such as `anthropic/claude-sonnet`, whichever provider served it. */
  modelFamily: z.string(),
  judgeFamily: z.string(),
  /** The judge is the answering model's own line, which may favour its answers. */
  judgeSameFamily: z.boolean(),
  /** The company whose model it is, such as `anthropic`. */
  modelVendor: z.string(),
  judgeVendor: z.string(),
  /** A different model line is not a different company: true when one vendor served both. */
  judgeSameVendor: z.boolean(),
  /** Why a full run started without a person: a change the review gate does not see. */
  trigger: z.nullable(z.enum(['source_sync', 'tool_descriptions', 'date_expiry'])),
  toolSchemaDigest: z.string(),
  testSetDigest: z.string(),
  tries: z.number(),
  flipRepeats: z.number(),
  questions: z.number(),
  setAside: z.number(),
  estimatedCostMicros: z.number(),
  /** Every model call of the run as metered, retries and calls of unfinished answers included. */
  actualCostMicros: z.number(),
  /** The most the run may spend, as approved at the command line; null when only the caps apply. */
  costCeilingMicros: z.nullable(z.number()),
  /** How tries decide a wording: the majority (FR-515), or `all`, every try (pass^k). */
  passRule: z.enum(passRules),
  requestedBy: z.nullable(z.string()),
  approvedBy: z.nullable(z.string()),
  failure: z.nullable(z.string()),
  createdAt: z.string(),
  startedAt: z.nullable(z.string()),
  finishedAt: z.nullable(z.string()),
})
export type EvalRun = z.infer<typeof runSchema>

/**
 * One side of a question split into its layers: code checks the tool results and the answer
 * text (delivered, not delivered, cited, linked, status), the judge model the answer (caveat,
 * cause claimed, clarifying question, rubrics). A null layer checks nothing for the question.
 */
const questionLayersSchema = z.object({
  code: verdictSchema,
  judge: verdictSchema,
  failedChecks: z.array(z.string()),
})
const layerCount = z.object({ passed: z.number(), failed: z.number() })
/**
 * Where the judge and the code checks disagreed: questions one layer passed and the other failed,
 * by id (a held-out one as `held-out`), and answered tries by count. A judge that passes what code
 * fails is more lenient than the record of what reached the agent.
 */
export const agreementSchema = z.object({
  questions: z.number(),
  judgePassedCodeFailed: z.array(z.string()),
  codePassedJudgeFailed: z.array(z.string()),
  tries: z.object({
    compared: z.number(),
    judgePassedCodeFailed: z.number(),
    codePassedJudgeFailed: z.number(),
  }),
})
/**
 * Why an answer could not be made: never a quality result (R6). `tool`: the tool server refused
 * one of the answer's tool calls.
 */
export const failureKinds = ['throttled', 'provider', 'tool', 'error'] as const
export const scorecardSchema = z.object({
  edition: z.string(),
  questions: z.number(),
  passed: z.number(),
  failed: z.number(),
  noAnswer: z.number(),
  setAside: z.number(),
  failing: z.array(z.string()),
  regressions: z.array(z.string()),
  baselineRun: z.nullable(z.string()),
  /** The section 1.7 targets on the held-out part (FR-503): counts, and whether they are met. */
  heldOut: z.object({
    questions: z.number(),
    answers: z.number(),
    caveats: z.object({ required: z.number(), present: z.number() }),
    causeClaims: z.number(),
    acceptable: z.number(),
    meetsTargets: z.boolean(),
  }),
  /** Questions passing and failing per layer. */
  layers: z.object({ code: layerCount, judge: layerCount }),
  /** How many questions each check failed. */
  failedChecks: z.record(z.string(), z.number()),
  /** Judge against code; null on a run with no questions. */
  agreement: z.nullable(agreementSchema),
})
const armSummary = z.object({
  answers: z.number(),
  /** Mean tool calls per answer: over-following shows here (R20). */
  calls: z.number(),
  /** Mean cost per answer in micros, counting a reused answer at its original cost. */
  costMicros: z.number(),
  causeClaims: z.number(),
})
/**
 * A links run (FR-523): get_related off (baseline) and on (candidate). `gain` is true when some
 * questions pass only with links, none fail because of them, and no new cause claims appear.
 */
export const linkResultSchema = z.object({
  gained: z.array(z.string()),
  lost: z.array(z.string()),
  arms: z.object({ baseline: armSummary, candidate: armSummary }),
  gain: z.boolean(),
})
export const runDetailSchema = z.object({
  run: runSchema,
  results: z.array(
    z.object({
      id: z.string(),
      baseline: verdictSchema,
      candidate: verdictSchema,
      flip: z.nullable(z.enum(['pass_to_fail', 'fail_to_pass'])),
      layers: z.object({
        baseline: questionLayersSchema,
        candidate: z.nullable(questionLayersSchema),
      }),
    }),
  ),
  flips: z.array(z.object({ id: z.string(), flip: z.enum(['pass_to_fail', 'fail_to_pass']) })),
  scorecard: z.nullable(scorecardSchema),
  links: z.nullable(linkResultSchema),
  /** Judge against code, per side; null on runs that did not finish or had no questions. */
  agreement: z.nullable(
    z.object({ baseline: agreementSchema, candidate: z.nullable(agreementSchema) }),
  ),
  /**
   * The answers the judge was asked to grade, and how many of them it gave no verdict it could use
   * for after its retry: no rubric left out, none twice, none the question does not have. Such an
   * answer is neither a pass nor a fail; `errors / judged` is the run's judge-error rate.
   */
  judging: z.object({ judged: z.number(), errors: z.number() }),
  /** Why an incomplete run stopped, and the answers it still lacks; null otherwise. */
  stopped: z.nullable(
    z.object({
      reason: z.enum(['infrastructure', 'cap', 'ceiling', 'stopped']),
      failed: z.partialRecord(z.enum([...failureKinds, 'missing']), z.number()),
      cells: z.number(),
      at: z.string(),
    }),
  ),
  cells: z.array(
    z.object({
      id: z.string(),
      questionId: z.string(),
      wording: z.number(),
      arm: z.enum(['baseline', 'candidate']),
      trial: z.number(),
      state: z.enum(runStates),
      passed: z.nullable(z.boolean()),
      refused: z.boolean(),
      reused: z.boolean(),
      error: z.nullable(z.string()),
      /** Why the answer could not be made, when it could not. */
      failureKind: z.nullable(z.enum(failureKinds)),
      costMicros: z.number(),
    }),
  ),
})
export const runListSchema = z.object({
  area: z.optional(areaId),
  limit: z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(100))),
})
export const runIdSchema = z.object({ id: uuid })

/**
 * The retrieval pass (no model): every sealed edition, and the live edition each day, over the
 * whole active test set. A question passes when every wording is served, delivers its expected
 * items, leaves out the forbidden ones and gives the expected status. Ids and booleans only.
 */
const retrievalChecksSchema = z.object({
  served: z.boolean(),
  delivered: z.boolean(),
  not_delivered: z.boolean(),
  status: z.optional(z.boolean()),
})
export const retrievalResultSchema = z.object({
  id: z.string(),
  revision: z.number(),
  area: z.string(),
  split: z.enum(questionSplits),
  passed: z.boolean(),
  checks: retrievalChecksSchema,
  wordings: z.array(
    z.object({
      passed: z.boolean(),
      status: z.nullable(z.string()),
      /** Expected items that were not delivered. */
      missing: z.array(z.string()),
      /** Forbidden items that were delivered. */
      forbidden: z.array(z.string()),
    }),
  ),
})
