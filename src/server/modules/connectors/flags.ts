import type { CheckFlag } from '../../../domain/item.ts'
import type { Queryable } from '../../db/database.ts'
import { liveSeq, standingSplits } from '../../db/family-splits.ts'

type Reference = { ref: string; renamedTo: string | null; off?: boolean }
type FlagChange = {
  itemId: string
  areaId: string
  flag: CheckFlag
  raise: boolean
  refs: Reference[]
  /** The families it is about that were split, by name (FR-142). */
  families: string[]
}

/** Overlay reasons hold at most 500 characters. */
function clip(text: string): string {
  const characters = Array.from(text)
  return characters.length > 500 ? characters.slice(0, 499).join('') + '…' : text
}

function flagReason(change: FlagChange): string {
  if (change.flag === 'needs_check')
    return clip(
      [
        change.families.length ? `Family split: ${change.families.join(', ')}` : '',
        change.refs.length ? `Definition changed: ${change.refs.map((r) => r.ref).join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('; '),
    )
  const gone = change.refs.filter((r) => !r.off)
  const off = change.refs.filter((r) => r.off)
  return clip(
    [
      gone.length
        ? `Definition missing: ${gone
            .map((r) => (r.renamedTo ? `${r.ref} (now ${r.renamedTo})` : r.ref))
            .join(', ')}`
        : '',
      off.length ? `Its integration is off: ${off.map((r) => r.ref).join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; '),
  )
}

/**
 * Brings the source flags of live items in line with their definitions (CON-209, CON-210). An item
 * is `needs_check` while a definition its live version references has another change mark than
 * the one recorded at review, or while it is about a family that was split back into its metrics
 * (FR-142), and `source_missing` while such a definition has disappeared or its integration is
 * off (CON-120): the item is still served, and told as relying on what is not read now. Only
 * stored marks are compared, so an outage, which stores none, never flags (CON-213), and a mark
 * that is unknown never counts as checked (CON-212). Mentions are not references and never flag.
 *
 * Runs after every successful sync, in every publish transaction, and when a definitions
 * integration is turned on or off or disconnected, so a recheck or a newer
 * accepted version clears the flag in the edition that serves it. Repeating it changes nothing.
 * Each new flag tells the area's owners and deputies (their inbox, through the outbox).
 */
export async function reconcileSourceFlags(
  tx: Queryable,
  cause: { snapshotId?: string | null; reason?: string | null } = {},
): Promise<{ raised: number; cleared: number }> {
  await tx.query("select pg_advisory_xact_lock(hashtextextended('context_layer.source_flags',0))")
  const changes = await tx.query<FlagChange>(
    `with live as (
       select s.item_id, s.version_id, v.area_id from item_version_service s
         join item_versions v on v.id = s.version_id
        where s.editions @> (select seq from live_edition)),
     reasons as (
       select l.item_id, l.area_id, f.flag,
              jsonb_build_object('ref', r.definition_ref, 'renamedTo', d.renamed_to)
                || case when c.enabled then '{}'::jsonb else jsonb_build_object('off', true) end as ref,
              null::text as family
         from live l
         join item_version_refs r on r.version_id = l.version_id
         join definitions d on d.ref = r.definition_ref
         join connectors c on c.id = d.connector_id
         cross join lateral (select case when d.missing_since_snapshot is not null or not c.enabled then 'source_missing'
                                         when d.change_mark <> r.change_mark then 'needs_check' end as flag) f
        where f.flag is not null
       union all
       -- A family split while the item is about it: no word of the item changed, so it still
       -- reaches agents through the family's former metrics, flagged until its owner points it.
       select l.item_id, l.area_id, 'needs_check', null, x.name
         from live l
         join item_version_metrics m on m.version_id = l.version_id
         join ${standingSplits(liveSeq)} x on x.family_key = m.metric_key),
     wanted as (
       select item_id, area_id, flag,
              coalesce(jsonb_agg(ref order by ref->>'ref') filter (where ref is not null), '[]') as refs,
              coalesce(jsonb_agg(family order by family) filter (where family is not null), '[]') as families
         from reasons
        group by item_id, area_id, flag),
     active as (select o.item_id, o.flag::text as flag from v_overlay_on o where o.kind = 'flag_on')
     select w.item_id as "itemId", w.area_id as "areaId", w.flag, true as raise, w.refs, w.families
       from wanted w
      where not exists (select 1 from active a where a.item_id = w.item_id and a.flag = w.flag)
     union all
     select a.item_id, l.area_id, a.flag, false, '[]'::jsonb, '[]'::jsonb
       from active a join live l on l.item_id = a.item_id
      where not exists (select 1 from wanted w where w.item_id = a.item_id and w.flag = a.flag)
     order by 1, 3`,
  )
  for (const change of changes) {
    await tx.query(
      `insert into overlay_events(kind,scope,item_id,flag,reason,actor_id,snapshot_id)
       values($1,'item',$2,$3,$4,cl_person(),$5)`,
      [
        change.raise ? 'flag_on' : 'flag_off',
        change.itemId,
        change.flag,
        change.raise
          ? flagReason(change)
          : clip(cause.reason ?? 'The served version matches its definitions'),
        cause.snapshotId ?? null,
      ],
    )
    await tx.query(
      `insert into outbox_events(topic,area_id,aggregate_type,aggregate_id,payload)
       values($1,$2,'item',$3,$4)`,
      [
        change.raise ? 'item.flagged' : 'item.unflagged',
        change.areaId,
        change.itemId,
        JSON.stringify(
          change.raise
            ? {
                state: change.flag,
                flag: change.flag,
                definitions: change.refs,
                ...(change.families.length ? { families: change.families } : {}),
              }
            : { state: 'cleared', flag: change.flag },
        ),
      ],
    )
  }
  return {
    raised: changes.filter((change) => change.raise).length,
    cleared: changes.filter((change) => !change.raise).length,
  }
}

/**
 * Tells the owners about mentions that went stale in one snapshot (CON-209, CON-210 for a
 * definition an item only mentions): one inbox entry per item, never a flag. Definitions the item
 * also references are left out, because the flag already tells them.
 */
export async function noticeStaleLinks(tx: Queryable, snapshotId: string): Promise<number> {
  const items = await tx.query<{ itemId: string; areaId: string; links: unknown[] }>(
    `select l.item_id as "itemId", l.area_id as "areaId",
            jsonb_agg(jsonb_build_object('target', l.target, 'status', l.status,
              'definition', l.definition_ref, 'renamedTo', l.renamed_to)
              order by l.field, l.position) as links
       from v_stale_links l join definitions d on d.ref = l.definition_ref
      where l.status in ('source_changed', 'source_missing')
        and (d.missing_since_snapshot = $1
             or exists (select 1 from definition_marks k where k.definition_ref = d.ref and k.snapshot_id = $1))
        and not exists (select 1 from item_version_refs r
                         where r.version_id = l.version_id and r.definition_ref = d.ref)
      group by l.item_id, l.area_id
      order by l.item_id`,
    [snapshotId],
  )
  for (const item of items)
    await tx.query(
      `insert into outbox_events(topic,area_id,aggregate_type,aggregate_id,payload)
       values('item.links_stale',$1,'item',$2,$3)`,
      [item.areaId, item.itemId, JSON.stringify({ state: 'stale', links: item.links })],
    )
  return items.length
}

/**
 * A read that stored new marks without flagging, because its connector computes them another way
 * now (CON-116): the owners of each domain with a live item that references or mentions one of
 * those definitions are told once, for the whole read, with the items it kept as they were.
 */
export async function noticeRebaselined(
  tx: Queryable,
  read: { sourceId: string; snapshotId: string; refs: readonly string[] },
): Promise<number> {
  const areas = await tx.query<{ areaId: string; items: string[] }>(
    `with live as (
       select s.item_id, s.version_id, v.area_id from item_version_service s
         join item_versions v on v.id = s.version_id
        where s.editions @> (select seq from live_edition))
     select l.area_id as "areaId", array_agg(distinct l.item_id order by l.item_id) as items
       from live l
      where exists (select 1 from item_version_refs r
                     where r.version_id = l.version_id and r.definition_ref = any($1::text[]))
         or exists (select 1 from item_version_mentions m
                     where m.version_id = l.version_id and m.definition_ref = any($1::text[]))
      group by l.area_id
      order by l.area_id`,
    [read.refs],
  )
  for (const area of areas)
    await tx.query(
      `insert into outbox_events(topic,area_id,aggregate_type,aggregate_id,payload)
       values('source.marks_rebaselined',$1,'source',$2,$3)`,
      [
        area.areaId,
        read.sourceId,
        JSON.stringify({
          state: 'rebaselined',
          source: read.sourceId,
          read: read.snapshotId,
          items: area.items,
        }),
      ],
    )
  return areas.length
}

export type DomainChange = { ref: string; from: string | null; to: string | null }

/**
 * A domain that changed in the source for a term already in the vocabulary (plan 4.3, step 7):
 * the term's owners are told, nothing is flagged, and serving keeps the accepted area until a
 * vocabulary proposal changes it.
 */
export async function noticeDomainChanges(
  tx: Queryable,
  changes: readonly DomainChange[],
): Promise<number> {
  let noticed = 0
  for (const change of changes) {
    const terms = await tx.query<{ key: string; area_id: string | null }>(
      `select key, area_id from serving_vocabulary((select seq from live_edition))
        where $1 = any(definition_refs) order by key`,
      [change.ref],
    )
    for (const term of terms) {
      await tx.query(
        `insert into outbox_events(topic,area_id,aggregate_type,aggregate_id,payload)
         values('vocabulary.domain_changed',$1,'vocabulary',$2,$3)`,
        [
          term.area_id,
          term.key,
          JSON.stringify({
            state: change.to ?? 'none',
            definition: change.ref,
            from: change.from,
            to: change.to,
          }),
        ],
      )
      noticed++
    }
  }
  return noticed
}
