import { settingSchemas } from '../../../contract/admin.ts'
import type { RateAnswer, Rating, TakeBackRating } from '../../../contract/reports.ts'
import { areaOfMetrics } from '../../../domain/gap-reports.ts'
import type { Queryable } from '../../db/database.ts'
import { loadLiveBundle } from '../editions/index.ts'

/*
  A person marks an answer of Ask good or wrong (FR-712), as an agent gives feedback with
  give_feedback (FR-309). Only the verdict, the domain of the answer's metrics on the live edition
  (taken as a gap's topic takes it, so the two always agree) and the hour are stored, with a
  random id. Nothing here reads the person, logs or audits who rated, or keeps the metrics
  themselves (FR-613), and the write keeps no retry record, which would hold the person beside
  the id. The id goes back to the page that rated, which holds it in memory only, so a second
  click takes that one rating back; nothing else can find it. Feedback counts the ratings
  (src/server/modules/observability/service.ts, feedback()).
*/

export async function rateAnswer(tx: Queryable, input: RateAnswer): Promise<Rating> {
  const bundle = await loadLiveBundle(tx)
  const area = bundle ? areaOfMetrics(input.metrics ?? [], bundle.metricArea) : null
  const [row] = await tx.query<Rating>(
    'insert into assistant_ratings (verdict, area_id) values ($1, $2) returning id::text',
    [input.verdict, area],
  )
  return row!
}

/** Removes the one rating with this id; false when it is already gone. */
export async function takeBackRating(
  tx: Queryable,
  input: TakeBackRating,
): Promise<{ taken: boolean }> {
  const removed = await tx.query('delete from assistant_ratings where id = $1 returning 1', [
    input.id,
  ])
  return { taken: removed.length > 0 }
}

/** The baseline's default, for a database that has lost the setting. */
const DEFAULT_RATINGS_PER_MINUTE = 20

/** A person's ratings per minute (`limits.assistant_ratings_per_minute`, FR-408). */
export async function ratingsPerMinute(tx: Queryable): Promise<number> {
  const [row] = await tx.query<{ value: unknown }>(
    "select value from settings_current where key = 'limits.assistant_ratings_per_minute'",
  )
  const parsed = settingSchemas['limits.assistant_ratings_per_minute'].safeParse(row?.value)
  return parsed.success ? parsed.data.person : DEFAULT_RATINGS_PER_MINUTE
}
