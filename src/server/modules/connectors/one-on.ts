import { ORPCError } from '@orpc/client'
import type { Queryable } from '../../db/database.ts'

/*
  One definitions integration is on at a time (CON-120): a connector whose kind is definitions,
  whatever its tool, so a connector added later follows the rule too. One is on while it is
  switched on and connected; paused or disconnected, it is off, its definitions are not listed and
  agents do not get them (`serving_vocabulary`). A content source is not one and is never counted.
  The database holds the rule as well (`connectors_one_definitions_source`); this says why, in
  words, before it would refuse.

  The server's demo (two invented definitions, read when the server names no folder) is never in
  the way: whatever is turned on in its place turns it off.
*/

/** The definitions integration that is on, other than `except`; null when none is. */
export async function definitionsOn(
  tx: Queryable,
  except: string | null = null,
): Promise<{ id: string; name: string; type: string } | null> {
  const [row] = await tx.query<{ id: string; name: string; type: string }>(
    `select id, name, type from connectors
      where kind = 'definition_source' and enabled and id is distinct from $1`,
    [except],
  )
  return row ?? null
}

/** Why another definitions integration cannot be on, and how to switch, in plain words. */
export const oneOnWords = (on: string, wanted: string) =>
  `Only one definitions integration is on at a time, and ${on} is on. To read ${wanted} instead, turn ${on} off, then turn ${wanted} on.`

/**
 * Makes room for the definitions integration `id` (or one being connected, with no id yet) to be
 * on: refused, with why and how to switch, while another one is on, and the demo turned off when
 * it is the one. Run in the transaction that turns it on, which this serializes.
 */
export async function makeRoomFor(tx: Queryable, id: string | null, wanted: string): Promise<void> {
  await tx.query("select pg_advisory_xact_lock(hashtextextended('footnote.definitions.on', 0))")
  const on = await definitionsOn(tx, id)
  if (!on) return
  if (on.type !== 'demo') throw new ORPCError('CONFLICT', { message: oneOnWords(on.name, wanted) })
  await tx.query('update connectors set enabled = false where id = $1', [on.id])
}
