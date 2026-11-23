import { ORPCError } from '@orpc/client'
import type { FamilyJoined, FamilySplit } from '../../../contract/index.ts'
import type { Queryable } from '../../db/database.ts'
import { liveSeq, standingSplits } from '../../db/family-splits.ts'
import { recordAudit } from '../admin/index.ts'
import { connectorType, reconcileSourceFlags } from '../connectors/index.ts'
import { lockReleases } from '../editions/index.ts'
import { acceptTermVersions } from '../review/index.ts'

/** A live term as `serving_vocabulary` reads it, with the version agents get now. */
type LiveTerm = {
  key: string
  kind: 'metric' | 'metric_group'
  name: string
  aliases: string[]
  areaId: string | null
  definitionRefs: string[]
  parentKey: string | null
  versionId: string
}

const live = `select t.key,t.kind::text as kind,t.name,t.aliases,t.area_id as "areaId",
         t.definition_refs as "definitionRefs",t.parent_key as "parentKey",s.version_id::text as "versionId"
    from serving_vocabulary((select seq from live_edition)) t
    join vocab_term_service s on s.term_key=t.key and s.editions @> (select seq from live_edition)`

const notFound = () =>
  new ORPCError('NOT_FOUND', {
    message: "We couldn't find this family of metrics. Its tool may no longer read it.",
  })

/**
 * Splits a family of metrics back into its variants, and joins them again (FR-142, D2-D4). An
 * owner of the family's domain or an admin splits one; a family its tool declares is split there.
 * Each variant becomes a metric of its own, under the name it has, as Keep them separate publishes
 * them on the Names card. The family leaves Definitions and search, and its history, meaning and
 * usual variant are kept. Context items about the family keep reaching agents through its former
 * variants while the split stands, each flagged for its owner to check which of them it is about.
 * The next read keeps them apart, since only variants that are not live yet make a family.
 */
export function createFamilySplitService(tx: Queryable) {
  /** Who may split or join the family of a domain, and the words that say who may when not. */
  async function mayDecide(areaId: string | null, verb: string) {
    const [row] = await tx.query<{ admin: boolean; owner: boolean; name: string | null }>(
      `select cl_is_admin_now() as admin, coalesce(cl_is_owner_now($1), false) as owner,
              (select a.name from areas a where a.id=$1) as name`,
      [areaId],
    )
    if (!row!.admin && !row!.owner)
      throw new ORPCError('FORBIDDEN', {
        message: row!.name
          ? `Only an owner of ${row!.name} or an admin can ${verb}.`
          : `Only an admin can ${verb} in no domain.`,
      })
    return row!.owner ? ('owner' as const) : ('administrator' as const)
  }

  async function split(key: string): Promise<FamilySplit> {
    await lockReleases(tx)
    const terms = await tx.query<LiveTerm>(
      `${live} where (t.key=$1 and t.kind='metric_group' and cardinality(t.definition_refs)>0)
                or (t.kind='metric' and t.parent_key=$1)
        order by t.name collate "en-x-icu", t.key`,
      [key],
    )
    const family = terms.find((term) => term.key === key)
    const variants = terms.filter((term) => term.key !== key)
    if (!family || !variants.length) throw notFound()
    const [area] = await tx.query<{ id: string | null }>('select cl_family_area($1) as id', [key])
    const capacity = await mayDecide(area!.id, 'split it')
    // Its tool is where a declared family is changed (D4): the tool says what it is one of.
    const [declared] = await tx.query<{ type: string; source: string; family: string }>(
      `select c.type, c.name as source, d.family_name as family
         from definitions d join connectors c on c.id=d.connector_id
        where d.ref=any($1::text[]) and d.family_name is not null and d.missing_since_snapshot is null
        limit 1`,
      [variants.flatMap((variant) => variant.definitionRefs)],
    )
    if (declared) {
      const tool = connectorType(declared.type, declared.source).tool
      throw new ORPCError('CONFLICT', {
        message: `${tool} declares “${family.name}” as one family, under the name ${declared.family}. Split it in ${tool}: the next read follows.`,
      })
    }
    const items = await tx.query<{ id: string }>(
      `select distinct s.item_id as id from item_version_service s
         join item_version_metrics m on m.version_id=s.version_id
        where upper_inf(s.editions) and m.metric_key=$1 order by s.item_id`,
      [key],
    )
    const edition = await acceptTermVersions(
      tx,
      variants.map((variant) => ({
        key: variant.key,
        kind: 'metric',
        parentKey: null,
        name: variant.name,
        aliases: variant.aliases,
        areaId: variant.areaId,
        definitionRefs: variant.definitionRefs,
        action: 'change',
        base: variant.versionId,
        capacity,
      })),
      {
        channel: 'form',
        reason: `Split the family ${family.name} into its ${variants.length} metrics.`,
        change: { note: `Split ${family.name}`, closeFamilies: [key] },
        areaId: area!.id,
      },
    )
    // A split the family was served again past, by going back to an edition before it, ends here.
    const [stale] = await tx.query<{ open: number }>(
      'select count(*)::int as open from family_splits where family_key=$1 and joined_in is null',
      [key],
    )
    const closed = await tx.query(
      `update family_splits set joined_by=cl_person(),joined_in=(select seq from editions where label=$2)
        where family_key=$1 and joined_in is null returning id`,
      [key, edition.label],
    )
    if (closed.length < stale!.open)
      throw new ORPCError('CONFLICT', {
        message: `${family.name} was split before, in another domain than it is in now. An owner of that domain or an admin has to make it one family again first.`,
      })
    await tx.query(
      `insert into family_splits(family_key,name,area_id,variants,items,split_by,split_in)
       values($1,$2,$3,$4,$5,cl_person(),(select seq from editions where label=$6))`,
      [
        key,
        family.name,
        area!.id,
        variants.map((variant) => variant.key),
        items.map((item) => item.id),
        edition.label,
      ],
    )
    // The items about it are flagged now that the split stands: each owner checks theirs.
    await reconcileSourceFlags(tx, {})
    await recordAudit(tx, {
      action: 'family.split',
      subjectType: 'vocabulary',
      subjectId: key,
      areaId: area!.id,
      details: {
        name: family.name,
        metrics: variants.map((variant) => variant.key),
        items: items.length,
        edition: edition.label,
      },
    })
    return {
      edition: edition.label,
      metrics: variants.map((variant) => ({ key: variant.key, name: variant.name })),
      items: items.length,
    }
  }

  /** Makes a split family one family again, of the variants it had: Undo, and later too. */
  async function join(key: string): Promise<FamilyJoined> {
    await lockReleases(tx)
    const [standing] = await tx.query<{
      id: string
      name: string
      areaId: string | null
      variants: string[]
      joined: boolean
      version: string
      closedIn: string
    }>(
      `select x.id::text, x.name, x.area_id as "areaId", x.variants, x.joined_in is not null as joined,
              c.version_id::text as version, upper(c.editions)::text as "closedIn"
         from ${standingSplits(liveSeq)} x
         cross join lateral (select s.version_id, s.editions from vocab_term_service s
                              where s.term_key=x.family_key and not upper_inf(s.editions)
                              order by upper(s.editions) desc limit 1) c
        where x.family_key=$1`,
      [key],
    )
    if (!standing)
      throw new ORPCError('NOT_FOUND', { message: 'This family is not split. Look at it again.' })
    const capacity = await mayDecide(standing.areaId, 'make them one family again')
    const variants = await tx.query<LiveTerm>(`${live} where t.key=any($1::text[])`, [
      standing.variants,
    ])
    const gone = standing.variants.find(
      (variant) => !variants.some((term) => term.key === variant && term.parentKey === null),
    )
    if (gone)
      throw new ORPCError('CONFLICT', {
        message: `The metrics of ${standing.name} changed since it was split, so they can't be one family again here.`,
      })
    // A split brought back by going back to an edition from after it, once joined, stands again.
    const [reopened] = standing.joined
      ? await tx.query<{ id: string }>(
          `insert into family_splits(family_key,name,area_id,variants,items,split_by,split_in)
           select family_key,name,area_id,variants,items,cl_person(),$2 from family_splits where id=$1
           returning id::text`,
          [standing.id, standing.closedIn],
        )
      : []
    const edition = await acceptTermVersions(
      tx,
      variants.map((variant) => ({
        key: variant.key,
        kind: 'metric',
        parentKey: key,
        name: variant.name,
        aliases: variant.aliases,
        areaId: variant.areaId,
        definitionRefs: variant.definitionRefs,
        action: 'change',
        base: variant.versionId,
        capacity,
      })),
      {
        channel: 'form',
        reason: `Made ${standing.name} one family again.`,
        change: { note: `Joined ${standing.name}` },
        areaId: standing.areaId,
        serveAgain: [standing.version],
      },
    )
    await tx.query(
      `update family_splits set joined_by=cl_person(),joined_in=(select seq from editions where label=$2)
        where id=$1`,
      [reopened?.id ?? standing.id, edition.label],
    )
    await reconcileSourceFlags(tx, {})
    await recordAudit(tx, {
      action: 'family.joined',
      subjectType: 'vocabulary',
      subjectId: key,
      areaId: standing.areaId,
      details: { name: standing.name, metrics: standing.variants, edition: edition.label },
    })
    return { edition: edition.label, name: standing.name }
  }

  return { split, join }
}
