import type { RecordsItem } from '../../../domain/records.ts'
import { metricKeyOf } from '../../../domain/vocabulary.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import type { ScopedIndex } from '../library/index.ts'

/*
  The context's own records as Ask's loop reads them (src/domain/records.ts), from the reads the
  person's own request already makes, so row security and the audience rule apply to every count
  and every title. The items are the Context list's (`library.index`: published and archived,
  never a draft, a suggestion or a deleted item, and never one an audience rule hides). Their
  times come from the editions that served them, for those items only.
*/

const DAY = 86_400_000

/**
 * The service's own moment, and what moves a stamp to it: a demo or a test may pin the day
 * (`FOOTNOTE_FIXED_TODAY`), and then every time the database stamped while it runs is moved by the same
 * days, onto the day it keeps. A day pinned in the past is kept whole: its moment is the end of that
 * day, so all it holds has happened, at any hour it runs. A stamp already on or before that moment
 * is the day it says, as the Context list shows it: it is left alone.
 */
export function momentOf(clock: Clock): { now: string; moved: (iso: string) => string } {
  const real = clock.now()
  const kept = Date.parse(clock.today())
  const gap = kept - Date.parse(real.toISOString().slice(0, 10))
  const shift = Math.round(gap / DAY) * DAY
  const now = new Date(shift < 0 ? kept + DAY - 1 : real.getTime() + gap).toISOString()
  return {
    now,
    moved: (iso) =>
      shift > 0 || Date.parse(iso) > Date.parse(now)
        ? new Date(Date.parse(iso) + shift).toISOString()
        : iso,
  }
}

/** When each listed item was first served and last left service. */
async function timesOf(
  tx: Queryable,
  items: readonly { id: string; version: number }[],
): Promise<Map<string, { published: string | null; ended: string | null }>> {
  if (!items.length) return new Map()
  const iso = (column: string) =>
    `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
  // Only the items the person's index listed; an edition's time is when it was made.
  const rows = await tx.query<{ id: string; published: string | null; ended: string | null }>(
    `with listed as materialized (
       select * from unnest($1::text[], $2::int[]) as l(id, version)),
     served as (
       select s.item_id as id, min(lo.created_at) as published, max(up.created_at) as ended
         from item_version_service s
         join listed l on l.id = s.item_id
         join editions lo on lo.seq = lower(s.editions)
         left join editions up on up.seq = upper(s.editions)
        group by s.item_id)
     select l.id, ${iso('s.published')} as published, ${iso('s.ended')} as ended
       from listed l left join served s on s.id = l.id`,
    [items.map((i) => i.id), items.map((i) => i.version)],
  )
  return new Map(rows.map((r) => [r.id, r]))
}

/**
 * The Context list's items as the records keep them, with their times moved to the service's day.
 * Each date is the field the list shows: the last check is its `lastChecked`, and an item is due
 * when its `trust` says so.
 */
export async function itemsOf(
  tx: Queryable,
  index: ScopedIndex,
  moment: Pick<ReturnType<typeof momentOf>, 'moved'>,
  dated = true,
): Promise<RecordsItem[]> {
  const listed = index.items
  const times = await timesOf(tx, dated ? listed : [])
  const moved = (iso: string | null | undefined) => (iso ? moment.moved(iso) : null)
  return listed.map((i) => {
    const t = times.get(i.id)
    return {
      id: i.id,
      kind: i.kind,
      areaId: i.areaId,
      title: i.title,
      status: i.status === 'retired' ? 'archived' : i.trust === 'needs_check' ? 'due' : 'live',
      reviewDate: i.reviewDate,
      checkFlag: i.checkFlag,
      publishedAt: moved(t?.published),
      changedAt: moved(i.updatedAt),
      checkedAt: i.lastChecked ? moved(`${i.lastChecked.on}T00:00:00.000Z`) : null,
      archivedAt: i.status === 'retired' ? moved(t?.ended) : null,
      owners: i.owners,
      metrics: i.scope.metrics.map(metricKeyOf),
      values: i.scope.dimensionValues.map((v) => `val:${v.dimension}/${v.value}`),
    }
  })
}
