import { createHash } from 'node:crypto'
import { demoCases } from '../../../src/server/modules/answer/index.ts'
import type { EvalCase } from './types.ts'

/*
  The held-back split: development cases a fixed hash chose, so nobody chose them. They run with
  the others and every report gives them only as counts: nobody building an answerer reads which
  failed or tunes on them, so a score on the others can be checked against them. A burned case of
  gates 2 and 3 keeps the split it had when it burned: the 40 a hash of their ids drew from every
  case of the time, written out here since most of those cases are gone. The maintainer's own
  chats are never held; any other case is held when its hash falls in the first quarter, whatever
  other cases there are.
*/

/** The burned cases of gates 2 and 3 that were held back when they burned. */
export const HELD_BURNED: ReadonlySet<string> = new Set([
  'F08',
  'F22',
  'FP05',
  'FP06',
  'FP09',
  'G10',
  'G16',
  'G17',
  'G19',
  'G24',
  'G28',
  'GP14',
])

const demoIds = new Set(demoCases.map((c) => c.id))
const isBurned = (id: string) => demoIds.has(id)

const inFirstQuarter = (id: string) =>
  parseInt(createHash('sha256').update(`ask-eval-held-1:${id}`).digest('hex').slice(0, 2), 16) < 64

/** Which of these cases are held back. */
export function heldOf(cases: readonly EvalCase[]): Set<string> {
  return new Set(
    cases
      .filter((c) =>
        isBurned(c.id) ? HELD_BURNED.has(c.id) : c.source !== 'captain' && inFirstQuarter(c.id),
      )
      .map((c) => c.id),
  )
}
