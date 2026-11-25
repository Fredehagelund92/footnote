import type { Queryable } from '../../db/database.ts'
import { standingSplits } from '../../db/family-splits.ts'
import type pg from 'pg'
import { settingSchemas } from '../../../contract/admin.ts'
import { termDomain } from '../../../domain/catalogue.ts'
import type { CheckFlag, ClaimLevel, ItemKind, RiskLevel } from '../../../domain/item.ts'
import type { AcceptedAs } from '../../../domain/served-review.ts'
import { servedWords, type WrittenTerm } from '../../../domain/served-terms.ts'
import type { Term } from '../../../domain/vocabulary.ts'
import { calendarOf } from '../admin/index.ts'
import { connectorType } from '../connectors/index.ts'
import type {
  ClientPolicy,
  DefinitionState,
  EditionSource,
  McpRates,
  ServingBundle,
  ServingItem,
  ServingPolicy,
} from './types.ts'

type ItemRow = {
  item_id: string
  version_no: number
  area_id: string
  kind: ItemKind
  title: string
  summary: string
  body: string | null
  risk: RiskLevel
  claim: ClaimLevel
  audience_groups: string[] | null
  valid_from: string
  valid_until: string | null
  review_date: string | null
  metrics: string[]
  value_keys: string[]
  dimension_keys: string[]
  conflicts: string[]
  ref_marks: Record<string, string>
  evidence: { url: string; quote: string; read_on: string }[]
  not_to_conclude: string
}
type Overlay = {
  kind: string
  scope: string
  area_id: string | null
  item_id: string | null
  flag: CheckFlag | null
}
type Metadata = Pick<ServingBundle, 'areas' | 'retired'>
type WrittenRow = {
  id: string
  name: string
  meaning: string | null
  same_as: string | null
  area_id: string | null
  written_on: string
  written_as: WrittenTerm['writtenAs']
  conflict: boolean
  also_means: string[]
}
type ReviewRow = {
  item_id: string
  accepted_on: string | null
  accepted_as: AcceptedAs | null
  accepted_area: string | null
  first_edition: string | null
}

/** The tools switched on for every client (FR-407). */
export async function enabledTools(tx: Queryable): Promise<string[]> {
  const rows = await tx.query<{ tool: string }>(
    'select tool from tool_config where enabled order by tool',
  )
  return rows.map((row) => row.tool)
}

/** The baseline's defaults, for a database that has lost the setting. */
export const DEFAULT_MCP_RATES: McpRates = { person: 30, client: 120 }

/**
 * What a client may call and how often, read on every request so an administrator's change
 * reaches the next one: the client's policy, the switched-on tools (FR-407), the per-tool limits
 * and the per-person and per-client rates per minute (FR-408), About our business, which the
 * server instructions end with, and the workspace's calendar, which they name.
 */
export async function loadServingPolicy(tx: Queryable, label: string): Promise<ServingPolicy> {
  // One query at a time: a transaction's client runs one, and pg refuses a second in flight.
  const clients = await tx.query<ClientPolicy>(
    'select * from client_policies where client_label=$1',
    [label],
  )
  const tools = await enabledTools(tx)
  const settings = await tx.query<{ key: string; value: unknown }>(
    "select key,value from settings_current where key in ('limits.mcp_rate_per_minute','limits.mcp_requests_per_minute','business.about','calendar.fiscal_year_start','calendar.time_zone')",
  )
  const value = (key: string) => settings.find((row) => row.key === key)?.value
  const perTool = value('limits.mcp_rate_per_minute')
  const about = value('business.about')
  const rates = settingSchemas['limits.mcp_requests_per_minute'].safeParse(
    value('limits.mcp_requests_per_minute'),
  )
  return {
    client: clients[0] ?? null,
    tools,
    limits:
      perTool && typeof perTool === 'object'
        ? Object.fromEntries(
            Object.entries(perTool).filter(
              (entry): entry is [string, number] =>
                Number.isInteger(entry[1]) && (entry[1] as number) > 0,
            ),
          )
        : {},
    rates: rates.success ? rates.data : DEFAULT_MCP_RATES,
    about: typeof about === 'string' ? about : '',
    calendar: calendarOf(value),
  }
}

/** Pointer checks stay outside the cache: a failed database check must never serve a stale stop switch. */
export function createEditionSource(pool: pg.Pool, capacity = 4): EditionSource {
  const cache = new Map<string, { bundle: ServingBundle; expires: number }>()
  return {
    policy(label) {
      return loadServingPolicy(
        {
          query: async <Row extends pg.QueryResultRow>(sql: string, values?: unknown[]) =>
            (await pool.query<Row>(sql, values)).rows,
        },
        label,
      )
    },
    async bundle(edition) {
      const client = await pool.connect()
      try {
        await client.query('begin isolation level repeatable read read only')
        // The terms people write are read as they are now, whatever the edition, as the overlay
        // is: a write to one, or a sync that gives a word a second meaning, is served on the next read.
        const pointer = await client.query<{
          seq: string
          label: string
          overlay: string
          terms: string
        }>(
          `select e.seq::text,e.label,coalesce((select seq::text from serving_overlay),'0') as overlay,
                  serving_terms_mark() as terms
           from editions e where e.sealed_at is not null and
           (case when $1::text is null then e.seq=(select seq from live_edition) else e.label=$1 end)`,
          [edition ?? null],
        )
        const head = pointer.rows[0]
        if (!head) throw new Error('Edition unavailable')
        const key = `${head.seq}:${head.overlay}:${head.terms}`
        const cached = cache.get(key)
        if (cached && cached.expires > Date.now()) {
          await client.query('commit')
          return cached.bundle
        }
        const bundle = await loadServingBundle(
          {
            query: async <Row extends pg.QueryResultRow>(sql: string, values?: unknown[]) =>
              (await client.query<Row>(sql, values)).rows,
          },
          head,
        )
        await client.query('commit')
        cache.set(key, { bundle, expires: Date.now() + 15000 })
        while (cache.size > capacity) cache.delete(cache.keys().next().value!)
        return bundle
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    },
  }
}

/** The live edition's bundle with the current overlay, read in the caller's transaction. */
export async function loadLiveBundle(tx: Queryable): Promise<ServingBundle | null> {
  const [head] = await tx.query<{ seq: string; label: string; overlay: string }>(
    `select e.seq::text,e.label,coalesce((select seq::text from serving_overlay),'0') as overlay
       from editions e join live_edition l on l.seq=e.seq`,
  )
  return head ? loadServingBundle(tx, head) : null
}

export async function loadServingBundle(
  tx: Queryable,
  head: { seq: string; label: string; overlay: string },
): Promise<ServingBundle> {
  const rows = await tx.query<ItemRow>('select * from serving_items($1)', [head.seq])
  // How each version was accepted (FR-326): the day, the role and domain, and its first edition.
  const reviews = new Map(
    (
      await tx.query<ReviewRow>(
        `select item_id,to_char(accepted_on,'YYYY-MM-DD') as accepted_on,accepted_as,accepted_area,first_edition
           from serving_reviews($1)`,
        [head.seq],
      )
    ).map((row) => [row.item_id, row]),
  )
  const vocab = await tx.query<{
    key: string
    kind: Term['kind']
    parent_key: string | null
    name: string
    aliases: string[]
    area_id: string | null
    definition_refs: string[]
    definitions: DefinitionState[]
    built_from_refs: string[]
    built_from_readable: string[]
    described: {
      ref: string
      title: string | null
      description: string | null
      type: string
      source: string
    } | null
  }>(
    // What the source says is read with the definitions, the first one's words for the term; a
    // definition limited to groups shows nothing of itself (CON-509), as the catalogue leaves it out.
    `select t.*,
       coalesce((select json_agg(json_build_object('ref', d.ref,
           'missing', d.missing_since_snapshot is not null, 'renamedTo', d.renamed_to,
           'changeMark', d.change_mark) order by x.n)
         from unnest(t.definition_refs) with ordinality x(ref, n) join definitions d on d.ref = x.ref), '[]') as definitions,
       (select case when d.visible_groups is not null then null else json_build_object('ref', d.ref,
           'title', d.title, 'description', d.description_copy, 'type', c.type, 'source', c.name) end
          from unnest(t.definition_refs) with ordinality x(ref, n) join definitions d on d.ref = x.ref
          join connectors c on c.id = d.connector_id order by x.n limit 1) as described,
       -- What its definitions take, as the tool says (FR-143): all of it, and which of it every
       -- reader may see at both ends, so a metric built partly from what is hidden is not told.
       coalesce((select array_agg(distinct b.ref)
          from unnest(t.definition_refs) x(ref)
          join definitions d on d.ref = x.ref
          cross join unnest(d.built_from_refs) b(ref)), '{}') as built_from_refs,
       coalesce((select array_agg(distinct b.ref)
          from unnest(t.definition_refs) x(ref)
          join definitions d on d.ref = x.ref and d.visible_groups is null
            and d.missing_since_snapshot is null
          cross join unnest(d.built_from_refs) b(ref)
          join definitions i on i.ref = b.ref and i.visible_groups is null
            and i.missing_since_snapshot is null), '{}') as built_from_readable
     from serving_vocabulary($1) t`,
    [head.seq],
  )
  const links = await tx.query<ServingBundle['links'][number]>('select * from serving_links($1)', [
    head.seq,
  ])
  // With it, in the same statement, the terms and synonyms people write in Definitions, as they
  // are now (FR-138).
  // With them, the families split back into their metrics in this edition: context about one
  // still reaches agents through each of them (FR-142).
  const [served] = await tx.query<{
    doc: Metadata
    written: WrittenRow[]
    splits: { key: string; variants: string[] }[]
  }>(
    `select serving_metadata($1) as doc,
            coalesce((select json_agg(t) from serving_terms() t), '[]') as written,
            coalesce((select json_agg(json_build_object('key', x.family_key, 'variants', x.variants))
                        from ${standingSplits('$1')} x), '[]') as splits`,
    [head.seq],
  )
  const splits = served!.splits
  const metadata = served!.doc
  const overlay = await tx.query<Overlay>(
    'select kind,scope,area_id,item_id,flag from v_overlay_on',
  )
  const sourceDomains = new Map(
    (
      await tx.query<{ key: string; area_id: string }>(
        'select key,area_id from serving_source_domains($1)',
        [head.seq],
      )
    ).map((row) => [row.key, row.area_id]),
  )
  const written = served!.written.map((row): WrittenTerm => ({
    id: row.id,
    name: row.name,
    meaning: row.meaning,
    sameAs: row.same_as,
    areaId: row.area_id,
    writtenOn: row.written_on,
    writtenAs: row.written_as,
    conflict: row.conflict,
    alsoMeans: row.also_means,
  }))
  const vocabulary = vocab.map((v) => ({
    key: v.key,
    kind: v.kind,
    parentKey: v.parent_key,
    name: v.name,
    aliases: v.aliases,
    areaId: v.area_id,
    definitionRefs: v.definition_refs,
    definitions: v.definitions,
    described: v.described
      ? {
          ref: v.described.ref,
          title: v.described.title,
          description: v.described.description,
          tool: connectorType(v.described.type, v.described.source).tool,
          source: v.described.source,
        }
      : null,
  }))
  const stopped = {
    all: overlay.some((o) => o.kind === 'stop_on' && o.scope === 'all'),
    areas: overlay.filter((o) => o.kind === 'stop_on' && o.area_id).map((o) => o.area_id!),
    items: overlay.filter((o) => o.kind === 'stop_on' && o.item_id).map((o) => o.item_id!),
  }
  // A synonym of a metric or a dimension is one of its other names; the words agents get.
  const words = servedWords(vocabulary, written, stopped)
  const terms = words.vocabulary
  const bundle: ServingBundle = {
    seq: head.seq,
    edition: head.label,
    overlay: head.overlay,
    terms,
    written: words.written,
    // Every live term's domain, served or not, so a link to one that isn't served says why.
    writtenAreas: Object.fromEntries(written.map((term) => [term.id, term.areaId])),
    links: links,
    areas: metadata.areas,
    retired: metadata.retired,
    refMarks: Object.fromEntries(rows.map((row) => [row.item_id, row.ref_marks])),
    builtFrom: builtFromOf(vocab),
    // The one domain rule (CON-206, FR-136): the vocabulary's area, else the source's domain that
    // this edition carries. The check report and gap topics read it.
    metricArea: Object.fromEntries(
      terms.flatMap((v) => {
        const { areaId } = termDomain(v.areaId, sourceDomains.get(v.key) ?? null)
        return v.kind === 'metric' && areaId !== null ? [[v.key, areaId]] : []
      }),
    ),
    groupsOfMetric: Object.fromEntries(
      terms
        .filter((v) => v.kind === 'metric')
        .map((v) => [
          v.key,
          [
            ...(v.parentKey ? [v.parentKey] : []),
            ...splits.flatMap((split) => (split.variants.includes(v.key) ? [split.key] : [])),
          ],
        ]),
    ),
    stopped,
    items: rows.map((row) => {
      const flags = overlay
        .filter((o) => o.kind === 'flag_on' && o.item_id === row.item_id)
        .map((o) => o.flag)
      return {
        id: row.item_id,
        version: row.version_no,
        areaId: row.area_id,
        kind: row.kind,
        title: row.title,
        summary: row.summary,
        ...(row.body === null ? {} : { body: row.body }),
        riskLevel: row.risk,
        claim: row.claim,
        audience:
          row.audience_groups === null
            ? { kind: 'everyone' }
            : { kind: 'groups', groups: row.audience_groups },
        validity: { start: row.valid_from, end: row.valid_until },
        reviewDate: row.review_date,
        checkFlag: flags.includes('source_missing')
          ? 'source_missing'
          : flags.includes('needs_check')
            ? 'needs_check'
            : null,
        status: 'accepted',
        proposerId: '',
        conflicts: row.conflicts,
        evidence: row.evidence,
        notToConclude: row.not_to_conclude,
        scope: {
          metrics: row.metrics,
          dimensions: row.dimension_keys,
          dimensionValues: row.value_keys.map((value) => ({
            dimension: `dim:${value.slice(4).split('/')[0]}`,
            value,
          })),
        },
        owner: { team: metadata.areas.find((a) => a.id === row.area_id)?.team ?? null },
        review: servedReview(reviews.get(row.item_id), row.area_id),
      }
    }),
  }
  return bundle
}

/**
 * What each metric is built from, by key: the metrics of the vocabulary that name the definitions
 * its own definitions take, in the order of their keys. A metric with an input that cannot be told
 * (hidden, missing, or no metric of the vocabulary) is built from nothing here: never half of it.
 */
function builtFromOf(
  vocab: readonly {
    key: string
    kind: Term['kind']
    definition_refs: string[]
    built_from_refs: string[]
    built_from_readable: string[]
  }[],
): ServingBundle['builtFrom'] {
  const metricOf = new Map(
    vocab.flatMap((v) =>
      v.kind === 'metric' ? v.definition_refs.map((ref) => [ref, v.key] as const) : [],
    ),
  )
  return Object.fromEntries(
    vocab.flatMap((v) => {
      const readable = new Set(v.built_from_readable)
      const keys = v.built_from_refs.map((ref) =>
        readable.has(ref) ? metricOf.get(ref) : undefined,
      )
      if (keys.some((key) => key === undefined)) return []
      const from = [...new Set(keys as string[])].filter((key) => key !== v.key)
      return from.length ? [[v.key, from.sort()]] : []
    }),
  )
}

/** A version's acceptance as served; null only for a version with no acceptance on record. */
function servedReview(row: ReviewRow | undefined, areaId: string): ServingItem['review'] {
  if (!row?.accepted_on || !row.accepted_as || !row.first_edition) return null
  return {
    acceptedOn: row.accepted_on,
    acceptedAs: row.accepted_as,
    areaId: row.accepted_area ?? areaId,
    edition: row.first_edition,
  }
}

/**
 * The bundle as it serves once nothing stops the area. Stop switches are serving decisions, so
 * checks look at the area's items as if no stop holds them. Every other area keeps its stops: a
 * check never sees an item, term or link of another domain that is stopped, so what it finds is
 * what agents get once the area's stop is lifted.
 */
export function asDelivered(bundle: ServingBundle, areaId: string): ServingBundle {
  const own = new Set(bundle.items.filter((item) => item.areaId === areaId).map((item) => item.id))
  return {
    ...bundle,
    stopped: {
      all: false,
      areas: (bundle.stopped.all
        ? bundle.areas.map((area) => area.id)
        : bundle.stopped.areas
      ).filter((area) => area !== areaId),
      items: bundle.stopped.items.filter((id) => !own.has(id)),
    },
  }
}
