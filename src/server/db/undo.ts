import type { UndoOffer } from '../../contract/undo.ts'
import type { Queryable } from './database.ts'

/**
 * The Undo a write in this transaction offers (FR-227): its token, and the end of the window the
 * row policies hold (`cl_undo_until`), from the transaction's time, which the write's rows carry.
 */
export async function undoOffer(tx: Queryable, token: string): Promise<UndoOffer> {
  const [row] = await tx.query<{ until: Date }>('select cl_undo_until(now()) as until')
  return { token, until: row!.until.toISOString() }
}

/** An Undo the service takes at any time, as opening a set-aside gap again. */
export const lastingUndo = (token: string): UndoOffer => ({ token, until: null })
