import type { ConnectorManifest } from '../../../domain/connector-manifest.ts'
import type { Queryable } from '../../db/database.ts'

/*
  What kind of read a source gets, for both pipelines. A cursor is good only for the settings it
  was left under, so every read keeps the settings revision it ran under
  (`connector_snapshots.settings_revision`), and a read rests on an earlier one only under the
  revision the source has now. A read holds no row while it is out, so Pause, Save and Disconnect
  answer at once: it takes the source's row only to store what it found, and a read whose source
  was changed, paused or disconnected meanwhile keeps nothing (`stillCurrent`). A change queues
  the source, so the job's next turn reads it under the new settings.
*/

/** How often a connector that reads changes lists everything again, in days. */
export const FULL_READ_EVERY_DAYS = 7

/** A read's start: the settings revision it runs under, the cursor it is handed, and its kind. */
export interface ReadKind {
  revision: number
  /** Where the read may start; null asks for a full read. */
  cursor: string | null
  /** Whether what the read leaves out is gone: a full listing, or a read from no cursor. */
  full: boolean
}

/**
 * One read of a source at a time, without holding its row: two reads of one source wait on each
 * other here, and nothing else does. Held until the transaction ends.
 */
export async function holdRead(tx: Queryable, sourceId: string): Promise<void> {
  await tx.query("select pg_advisory_xact_lock(hashtextextended('heed.read:' || $1, 0))", [
    sourceId,
  ])
}

/**
 * The read a source gets now. The newest read that was not a failure hands on its cursor when it
 * ran under the current settings revision; one from before a change of settings hands on none. A
 * connector that reads changes and sends tombstones (`both`) is handed none either once its last
 * good full read under these settings is older than `FULL_READ_EVERY_DAYS`, so it lists
 * everything again, which finds what a change list missed (a folder just ticked has no changes).
 */
export async function readKindOf(
  tx: Queryable,
  sourceId: string,
  deletions: ConnectorManifest['capabilities']['deletions'],
): Promise<ReadKind> {
  const [row] = await tx.query<{ revision: number; cursor: string | null; full: boolean }>(
    `select c.revision,
            (select case when s.settings_revision = c.revision then s.cursor end
               from connector_snapshots s where s.connector_id = c.id and s.status <> 'failed'
              order by s.fetched_at desc limit 1) as cursor,
            exists (select 1 from connector_snapshots f
                     where f.connector_id = c.id and f.status = 'ok' and f.full_read
                       and f.settings_revision = c.revision
                       and f.fetched_at > now() - make_interval(days => $2)) as full
       from connectors c where c.id = $1`,
    [sourceId, FULL_READ_EVERY_DAYS],
  )
  if (!row) throw new Error(`Unknown connector: ${sourceId}`)
  const cursor = deletions === 'both' && !row.full ? null : row.cursor
  return {
    revision: row.revision,
    cursor,
    full: deletions === 'full-listing' || (deletions === 'both' && cursor === null),
  }
}

/**
 * Takes the source's row to store a read, and says whether the read still stands: the source is
 * on, and its settings are the ones the read ran under.
 */
export async function stillCurrent(
  tx: Queryable,
  sourceId: string,
  kind: ReadKind,
): Promise<boolean> {
  const [row] = await tx.query<{ revision: number; enabled: boolean }>(
    'select revision, enabled from connectors where id = $1 for update',
    [sourceId],
  )
  return row?.enabled === true && row.revision === kind.revision
}
