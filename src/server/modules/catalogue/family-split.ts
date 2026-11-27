import { ORPCError } from '@orpc/client'
import type { FamilyChange, FamilyJoined, FamilySplit } from '../../../contract/index.ts'
import { wordRefusal, termWord } from '../../../domain/terms.ts'
import type { Queryable } from '../../db/database.ts'
import { liveSeq, standingSplits } from '../../db/family-splits.ts'
import { recordAudit } from '../admin/index.ts'
import { connectorType, reconcileSourceFlags } from '../connectors/index.ts'
import { lockReleases } from '../editions/index.ts'
import { acceptTermVersions, type TermVersion } from '../review/index.ts'
import { wordHolders } from '../terms/index.ts'

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

const iso = (column: string) =>
  `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

/**
 * Splits a family of metrics back into its variants, and joins them again (FR-142, D2-D4). An
 * owner of the family's domain or an admin splits one; a family its tool declares is split there.
 * Each variant becomes a metric of its own, under the name it has, as Keep them separate publishes
 * them on the Names card. The family leaves Definitions and search, and its history, meaning and
 * usual variant are kept. Context items about the family keep reaching agents through its former
 * variants while the split stands, each flagged for its owner to check which of them it is about.
 * The next read keeps them apart, since only variants that are not live yet make a family.
 * The metrics of a family kept separate on the Names card are made one family the same way.
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

  /** What each domain of the metrics is decided in: the database wants an owner of each one's own domain. */
  async function capacities(terms: readonly LiveTerm[], verb: string) {
    const by = new Map<string | null, 'owner' | 'administrator'>()
    for (const term of terms)
      if (!by.has(term.areaId)) by.set(term.areaId, await mayDecide(term.areaId, verb))
    return (term: LiveTerm) => by.get(term.areaId)!
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
    await mayDecide(area!.id, 'split it')
    const capacityOf = await capacities(variants, 'split it')
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
        capacity: capacityOf(variant),
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

  /**
   * Makes metrics one family after an owner kept them separate when they were published (D1, Keep
   * them separate): the family Footnote suggested then, by its key and name, of the metrics it had,
   * while each stands as a metric of its own.
   */
  async function joinApart(key: string): Promise<FamilyJoined | null> {
    const [kept] = await tx.query<{
      id: string
      name: string
      areaId: string | null
      variants: string[]
      archived: boolean
    }>(
      `select k.id::text, k.name, k.area_id as "areaId", k.variants,
              k.area_id is not null and not exists (select 1 from areas a
                where a.id=k.area_id and a.archived_at is null) as archived
         from family_kept_apart k where k.family_key=$1 and k.joined_in is null`,
      [key],
    )
    if (!kept) return null
    // A domain deleted since: the family comes in none, as deleting it left the metrics.
    const areaId = kept.archived ? null : kept.areaId
    const capacity = await mayDecide(areaId, 'make them one family')
    const variants = await tx.query<LiveTerm>(`${live} where t.key=any($1::text[])`, [
      kept.variants,
    ])
    const gone = kept.variants.find(
      (variant) => !variants.some((term) => term.key === variant && term.parentKey === null),
    )
    if (gone)
      throw new ORPCError('CONFLICT', {
        message: `The metrics of ${kept.name} changed since they were kept separate, so they can't be one family here.`,
      })
    // One word has one meaning (FR-138): a name given to something else since stays with it.
    const word = termWord(kept.name)
    const held = wordRefusal(
      kept.name,
      ((await wordHolders(tx, [word])).get(word) ?? []).filter(
        (holder) => holder.origin === 'term' || holder.ref !== key,
      ),
      null,
    )
    if (held)
      throw new ORPCError('CONFLICT', {
        message: `${held.message} So ${kept.name} can't be one family under that name.`,
      })
    const capacityOf = await capacities(variants, 'make them one family')
    await tx.query(
      `insert into vocab_terms(key,kind) values($1,'metric_group') on conflict (key) do nothing`,
      [key],
    )
    const edition = await acceptTermVersions(
      tx,
      [
        {
          key,
          kind: 'metric_group',
          parentKey: null,
          name: kept.name,
          aliases: [],
          areaId,
          definitionRefs: [
            ...new Set(variants.flatMap((variant) => variant.definitionRefs)),
          ].sort(),
          action: 'create',
          base: null,
          capacity,
        },
        ...variants.map((variant): TermVersion => ({
          key: variant.key,
          kind: 'metric',
          parentKey: key,
          name: variant.name,
          aliases: variant.aliases,
          areaId: variant.areaId,
          definitionRefs: variant.definitionRefs,
          action: 'change',
          base: variant.versionId,
          capacity: capacityOf(variant),
        })),
      ],
      {
        channel: 'form',
        reason: `Made ${kept.name} one family of the metrics kept separate when they were published.`,
        change: { note: `Joined ${kept.name}` },
        areaId,
      },
    )
    await tx.query(
      `update family_kept_apart set joined_by=cl_person(),joined_in=(select seq from editions where label=$2)
        where id=$1`,
      [kept.id, edition.label],
    )
    await recordAudit(tx, {
      action: 'family.joined',
      subjectType: 'vocabulary',
      subjectId: key,
      areaId,
      details: { name: kept.name, metrics: kept.variants, edition: edition.label },
    })
    return { edition: edition.label, name: kept.name }
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
    if (!standing) {
      const apart = await joinApart(key)
      if (apart) return apart
      throw new ORPCError('NOT_FOUND', {
        message: 'This family is not split, and its metrics are not kept apart. Look at it again.',
      })
    }
    await mayDecide(standing.areaId, 'make them one family again')
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
    const capacityOf = await capacities(variants, 'make them one family again')
    // A family whose domain was deleted while it was split comes back in none, as deleting it left
    // the others.
    const [kept] = await tx.query<{
      name: string
      aliases: string[]
      definitionRefs: string[]
      archived: boolean
    }>(
      `select v.name, v.aliases,
              coalesce((select array_agg(r.definition_ref order by r.definition_ref collate "C")
                          from vocab_term_refs r where r.version_id=v.id), '{}') as "definitionRefs",
              v.area_id is not null and not exists (select 1 from areas a
                where a.id=v.area_id and a.archived_at is null) as archived
         from vocab_term_versions v where v.id=$1`,
      [standing.version],
    )
    const familyAgain: TermVersion[] = kept!.archived
      ? [
          {
            key,
            kind: 'metric_group',
            parentKey: null,
            name: kept!.name,
            aliases: kept!.aliases,
            areaId: null,
            definitionRefs: kept!.definitionRefs,
            action: 'change',
            base: standing.version,
            capacity: await mayDecide(null, 'make them one family again'),
          },
        ]
      : []
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
      [
        ...familyAgain,
        ...variants.map((variant): TermVersion => ({
          key: variant.key,
          kind: 'metric',
          parentKey: key,
          name: variant.name,
          aliases: variant.aliases,
          areaId: variant.areaId,
          definitionRefs: variant.definitionRefs,
          action: 'change',
          base: variant.versionId,
          capacity: capacityOf(variant),
        })),
      ],
      {
        channel: 'form',
        reason: `Made ${standing.name} one family again.`,
        change: { note: `Joined ${standing.name}` },
        areaId: standing.areaId,
        serveAgain: familyAgain.length ? [] : [standing.version],
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

  /**
   * Who published the family, split it and made it one family again, newest first (FR-142): the
   * people who decided, never the tool that read its metrics. Metrics kept apart and made one
   * family later were first published as a family by that join.
   */
  async function changes(key: string): Promise<FamilyChange[]> {
    const rows = await tx.query<FamilyChange & { found: boolean }>(
      `with first as (
         select d.decided_by, d.decided_at from vocab_term_versions v
           join decisions d on d.vocab_version_id=v.id
          where v.term_key=$1 and v.version_no=1),
       changes as (
         select case when exists (select 1 from family_kept_apart k
                                   where k.family_key=$1 and k.joined_in is not null)
                     then 'joined' else 'published' end as kind,
                f.decided_by as person, f.decided_at as at from first f
         union all
         select 'split', x.split_by, x.split_at from family_splits x where x.family_key=$1
         union all
         select 'joined', x.joined_by, x.joined_at from family_splits x
          where x.family_key=$1 and x.joined_by is not null)
       select c.kind, c.person::text as "personId", ${iso('c.at')} as at, true as found
         from changes c
       union all
       select null, null, null, false
        where not exists (select 1 from vocab_terms t where t.key=$1 and t.kind='metric_group')
       order by at desc nulls last`,
      [key],
    )
    if (rows.some((row) => !row.found))
      throw new ORPCError('NOT_FOUND', {
        message: "We couldn't find this family of metrics. Its tool may no longer read it.",
      })
    return rows.map(({ kind, personId, at }) => ({ kind, personId, at }))
  }

  return { split, join, changes }
}
