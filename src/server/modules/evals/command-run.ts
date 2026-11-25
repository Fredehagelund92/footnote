import { APICallError } from '@ai-sdk/provider'
import type { Logger } from 'pino'
import type { Database } from '../../db/database.ts'
import { errorCode } from '../../observability/logger.ts'
import {
  createCallMeter,
  ModelCallError,
  readCallLimits,
  testRunRetry,
  type CallLimiter,
  type CallMeter,
  type Sleep,
} from '../models/index.ts'
import { ToolCallRefused } from './arm.ts'
import type { EvalSettings } from './settings.ts'
import { capReached, formatUsd } from './spend.ts'
import { CEILING_MARGIN, HEARTBEAT_MS, LEASE } from './worker.ts'

/*
  The answers of a run that only its command works (withheld.ts, proof.ts): no worker takes such a
  run, so the command holds a lease on it, as a worker does, and renews it while it works. Before
  each answer it checks the lease, the spending caps and the run's ceiling, and every model call
  goes through one meter tied to the run. It starts no answer once the run is no longer its own
  (cancelled, or ended by the job's housekeeping when the lease ran out). A failure is kept only by
  its kind: a provider's message can quote the request, and the request holds a question.
*/

export type CommandRunOptions = {
  runId: string
  /** The lease holder's id, written on the run when it was made. */
  worker: string
  settings: EvalSettings
  /** Who the run counts against for the daily limit; null at the command line. */
  person: string | null
  /** The most the run may spend, in micros; null when only the spending caps apply. */
  ceilingMicros: number | null
  signal: AbortSignal
  logger: Logger
  limiter?: CallLimiter
  wait?: Sleep
  /** What a failed answer is logged as, without its words. */
  failure: string
}

/** One answer to make, with what it is estimated to cost. */
export type CommandTask<T> = { task: T; estimateMicros: number }

export type CommandRunWork = {
  /** Why the run stopped starting answers, in words without a question in them; null if it did not. */
  halt: string | null
  /** Answers that failed, by kind of failure. */
  failed: Record<string, number>
  /** Answers made. */
  made: number
}

/** Why a run stops starting answers: a spending cap, its ceiling, or its lease. */
class Halt extends Error {}

/**
 * Makes each task's answer with `make`, which reaches the models through the meter it is given,
 * as many at once as the call limits allow. An answer that fails is counted by its kind and the
 * run goes on; a cap, the ceiling, a lost lease or the signal stops it starting more.
 */
export async function workCommandRun<T>(
  database: Database,
  options: CommandRunOptions,
  tasks: readonly CommandTask<T>[],
  make: (task: T, meter: CallMeter) => Promise<void>,
): Promise<CommandRunWork> {
  const { runId, worker, settings, person, signal } = options
  const limits = await readCallLimits(database)
  const ceiling = options.ceilingMicros
  let spent = 0
  let reserved = 0
  let made = 0
  const halt: { reason: string | null } = { reason: null }
  const failed: Record<string, number> = {}
  const queue = [...tasks]
  /** Renews the lease; false once the run is no longer this command's to work. */
  const renew = async () =>
    (
      await database.query(
        `update eval_runs set lease_until=now()+interval '${LEASE}'
          where id=$1 and worker=$2 and state='running' returning id`,
        [runId, worker],
      )
    ).length > 0
  const heartbeat = setInterval(() => {
    renew().catch((error: unknown) =>
      options.logger.warn({ err: errorCode(error), run: runId }, 'lease not renewed'),
    )
  }, HEARTBEAT_MS)
  heartbeat.unref()

  async function makeOne({ task, estimateMicros }: CommandTask<T>) {
    if (!(await renew())) throw new Halt('It was ended before it finished.')
    if (await capReached(database, settings, estimateMicros, person))
      throw new Halt('A spending cap stopped it.')
    const hold = Math.ceil(estimateMicros * CEILING_MARGIN)
    if (ceiling !== null && spent + reserved + hold > ceiling)
      throw new Halt(`It spent ${formatUsd(spent)} of its ${formatUsd(ceiling)} ceiling.`)
    reserved += hold
    const meter = createCallMeter({
      database,
      feature: 'eval',
      person,
      runId,
      limits,
      retry: testRunRetry,
      ...(options.limiter ? { limiter: options.limiter } : {}),
      ...(options.wait ? { wait: options.wait } : {}),
      admit: () => {
        if (ceiling !== null && spent >= ceiling)
          throw new Halt(`It spent its ${formatUsd(ceiling)} ceiling.`)
      },
      onCall: (call) => {
        spent += call.costMicros
      },
      onRecordError: (error) =>
        options.logger.error({ err: errorCode(error), run: runId }, 'model call not recorded'),
    })
    try {
      await make(task, meter)
      await meter.settled()
      made++
    } catch (error) {
      await meter.close()
      if (error instanceof Halt || signal.aborted) throw error
      // The kind of failure only: a provider's message can quote the request, question included.
      const kind =
        error instanceof ModelCallError
          ? error.kind
          : error instanceof ToolCallRefused
            ? 'tool'
            : APICallError.isInstance(error)
              ? 'provider'
              : 'error'
      failed[kind] = (failed[kind] ?? 0) + 1
      options.logger.warn({ err: errorCode(error), run: runId, failure: kind }, options.failure)
    } finally {
      reserved -= hold
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(limits.concurrency, queue.length) }, async () => {
        for (let next = queue.shift(); next && !halt.reason; next = queue.shift()) {
          if (signal.aborted) {
            halt.reason = 'It was stopped before it finished.'
            break
          }
          try {
            await makeOne(next)
          } catch (error) {
            if (signal.aborted) halt.reason = 'It was stopped before it finished.'
            else if (error instanceof Halt) halt.reason = error.message
            else throw error
          }
        }
      }),
    )
  } finally {
    clearInterval(heartbeat)
  }
  return { halt: halt.reason, failed, made }
}

/** "3 of 120 answers not made (2 throttled, 1 tool)." after the reason a run stopped, if any. */
export function stoppedWords(work: CommandRunWork, total: number): string | null {
  const missing = total - work.made
  if (!work.halt && !missing) return null
  const failures = Object.entries(work.failed)
    .map(([kind, n]) => `${n} ${kind}`)
    .join(', ')
  return `${work.halt ? `${work.halt} ` : ''}${missing} of ${total} answers not made${failures ? ` (${failures})` : ''}.`
}

/**
 * Ends the run as its command worked it, with its failure words and summary additions. A run that
 * is no longer the command's (cancelled, or ended meanwhile) keeps how it was ended.
 */
export async function endCommandRun<S extends string>(
  database: Database,
  person: string | null,
  run: { id: string; worker: string },
  end: { state: S; failure: string; summary: Record<string, unknown> },
): Promise<{ state: S | 'cancelled' | 'incomplete'; costMicros: number }> {
  const [row] = await database.transaction(person, async (tx) => {
    const [own] = await tx.query<{ state: S; cost: string }>(
      `update eval_runs set state=$2,finished_at=now(),worker=null,lease_until=null,failure=$3,
         summary=summary||$4::jsonb
       where id=$1 and worker=$5 and state='running' returning state::text,actual_cost_micros::text as cost`,
      [run.id, end.state, end.failure.slice(0, 500), JSON.stringify(end.summary), run.worker],
    )
    return own
      ? [own]
      : tx.query<{ state: S | 'cancelled' | 'incomplete'; cost: string }>(
          'select state::text,actual_cost_micros::text as cost from eval_runs where id=$1',
          [run.id],
        )
  })
  return { state: row?.state ?? end.state, costMicros: Number(row?.cost ?? 0) }
}
