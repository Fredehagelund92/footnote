import type pg from 'pg'
import type { AnonymousRecord, AnonymousStore, DeliveryRecord } from './records.ts'

export function createAnonymousStore(pool: pg.Pool): AnonymousStore {
  return {
    /**
     * One transaction and three set-based statements per batch, so a burst of calls is written as
     * fast as it arrives and the bounded queue does not drop records (and with them, counts).
     */
    async write(records) {
      const client = await pool.connect()
      try {
        await client.query('begin')
        await writeRecords(client, records)
        await client.query('commit')
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
      if (records.some((r) => r.kind === 'delivery' && foundNothing(r.value)))
        await firstQuestions(pool)
    },
    async reportGap(topic, note) {
      const row = await pool.query<{ id: string }>(
        'select serving_report_gap($1,$2,$3,$4,$5,$6,$7) as id',
        [
          topic.key,
          topic.area,
          topic.metrics,
          topic.values,
          topic.dimensions,
          topic.month,
          note ?? null,
        ],
      )
      return row.rows[0]!.id
    },
    async feedback({ delivery, verdict, client, note, area, item }) {
      await pool.query(
        'insert into feedback (delivery_id,verdict,client_label,note,area_id,item_id) values ($1,$2,$3,$4,$5,$6)',
        [delivery, verdict, client, note ?? null, area ?? null, item ?? null],
      )
      if (verdict !== 'helpful') await firstQuestions(pool)
    },
    async reply(id) {
      const row = await pool.query<{ area: string | null }>(
        'select area_id as area from serving_reply($1)',
        [id],
      )
      return row.rows[0]
    },
  }
}

/** An agent's call that found nothing written: what a Nothing written yet card counts (FR-606 case 1). */
const foundNothing = (delivery: DeliveryRecord) =>
  delivery.caller === 'agent' && delivery.status === 'no_match'

/**
 * While fewer than five people have signed in, what agents found nothing for, or reported, reaches
 * its owners now and not at the detection job's next turn (FR-606). What was written is kept
 * whatever happens here: a detection that fails is left to the job.
 */
async function firstQuestions(pool: pg.Pool): Promise<void> {
  await pool.query('select serving_first_questions()').catch(() => undefined)
}

/**
 * One batch of records in three set-based statements, on a connection inside a transaction the
 * caller holds: the store's own, or the demo seed's (db/seed/story.ts).
 */
export async function writeRecords(
  client: Pick<pg.ClientBase, 'query'>,
  records: readonly AnonymousRecord[],
): Promise<void> {
  const deliveries = records.flatMap((r) => (r.kind === 'delivery' ? [r.value] : []))
  const requests = records.flatMap((r) => (r.kind === 'request' ? [r.value] : []))
  const topics = [
    ...new Map(deliveries.flatMap((d) => (d.topic ? [[d.topic.key, d.topic]] : []))).values(),
  ]
  if (topics.length)
    await client.query(
      `insert into topics (key,area_id,metric_keys,value_keys,dimension_keys,month)
         select t.key, t.area, t.metrics, t.value_keys, t.dimensions, t.month
           from jsonb_to_recordset($1) as t(key text, area text, metrics text[], value_keys text[],
                  dimensions text[], month date)
         on conflict (key) do nothing`,
      [JSON.stringify(topics.map(({ values, ...t }) => ({ ...t, value_keys: values })))],
    )
  if (deliveries.length)
    await client.query(
      `insert into deliveries (id,delivered_hour,client_label,caller,edition_seq,overlay_seq,tool_schema_digest,scope,status,answer_state,app_family,delivered,withheld,cut,response_bytes,duration_ms,topic_id)
         select d.id, d.hour, d.client, d.caller::caller_kind, d.edition, d.overlay, d.digest, coalesce(d.scope, '{}'),
                d.status::delivery_status, d.state, coalesce(d.family, 'unknown'), d.delivered, d.withheld, d.cut, d.bytes, d.duration, t.id
           from jsonb_to_recordset($1) as d(id uuid, hour timestamptz, client text, caller text, edition bigint,
                  overlay bigint, digest text, scope jsonb, status text, state text, family text, delivered jsonb, withheld jsonb, cut boolean,
                  bytes int, duration int, topic text)
           left join topics t on t.key = d.topic`,
      [JSON.stringify(deliveries.map((d) => ({ ...d, topic: d.topic?.key ?? null })))],
    )
  if (requests.length)
    await client.query(
      `insert into mcp_requests (id,hour,client_label,app_family,tool,status,result_status,duration_ms,edition_seq,response_bytes)
         select r.id, r.hour, r.client, r.family, r.tool, r.status, r.result, r.duration, r.edition, r.bytes
           from jsonb_to_recordset($1) as r(id uuid, hour timestamptz, client text, family text, tool text,
                  status text, result text, duration int, edition bigint, bytes int)`,
      [JSON.stringify(requests)],
    )
}
