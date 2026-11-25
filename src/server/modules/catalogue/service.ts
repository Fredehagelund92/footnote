import type {
  Catalogue,
  IndexedItem,
  CatalogueDefinition,
  CatalogueSource,
  CatalogueSplit,
  CatalogueTerm,
  DefinitionBuiltFrom,
  DefinitionRelations,
} from '../../../contract/index.ts'
import type { SourceConfig } from '../../../contract/sources.ts'
import {
  catalogueStatus,
  definitionState,
  scopeNames,
  shelfOf,
  speakingDefinition,
  termDomain,
  type ShelfItem,
} from '../../../domain/catalogue.ts'
import type { DeclaredFamily, VariantValue } from '../../../domain/definition-helpers.ts'
import {
  conversionsOf,
  relationsOf,
  treeOf,
  type BuiltFrom,
  type RelationMember,
} from '../../../domain/definition-relations.ts'
import { familyMeaning } from '../../../domain/family-meaning.ts'
import {
  axisWords,
  declaredWords,
  derivationsOf,
  familiesOf,
  familyAxes,
} from '../../../domain/metric-families.ts'
import { modelFileUrl, viewOf } from '../../../domain/source-views.ts'
import { memberName, viewWords } from '../../../domain/term-candidates.ts'
import { metricKeyOf } from '../../../domain/vocabulary.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { liveSeq, standingSplits } from '../../db/family-splits.ts'
import { connectorType, connectorTypes, modelFolderOf } from '../connectors/index.ts'
import { libraryIndexItems } from '../library/index.ts'

const withoutRemoved = <T extends { removed: boolean; modelFolder: string | null }>({
  removed: _removed,
  modelFolder: _folder,
  ...source
}: T) => source

/** The administrator settings that hold a model folder's address, for links to model files. */
const linkSettings = connectorTypes.flatMap((type) =>
  type.modelLinkSetting ? [type.modelLinkSetting] : [],
)

/**
 * The catalogue read model (FR-136): the live vocabulary's metrics and dimensions, joined to what
 * the definition source last read (the `definitions` the connectors store) and to what the
 * library holds about each term. Read only. Footnote stores no calculation (CON-207), so nothing
 * here can return one.
 *
 * It reads as the library does: items for everyone only, while groups are parked (FR-128). A
 * definition the source limits to groups is shown only to a person in one of them (CON-509);
 * nobody has groups yet, so such a term is left out for everyone until groups return.
 */
export interface CatalogueService {
  list(): Promise<Catalogue>
  /**
   * What the metric a live term names is built from and what is built from it (FR-143), from the
   * names its source sent (CON-207); null when no live metric term has that key, or its
   * definition is hidden from the person (CON-509).
   */
  relations(key: string): Promise<DefinitionRelations | null>
  /**
   * What the metric a live term names is built from, at every depth (FR-143): refs and names
   * only, each metric once; null as for `relations`. It changes nothing an agent is given.
   */
  builtFrom(key: string): Promise<DefinitionBuiltFrom | null>
}

type VocabularyRow = {
  key: string
  kind: 'metric' | 'dimension' | 'dimension_value' | 'metric_group'
  parentKey: string | null
  name: string
  aliases: string[]
  areaId: string | null
  /** The domain the definition source gave the term, as the live edition carries it. */
  sourceAreaId: string | null
  definitionRefs: string[]
}

type DefinitionRow = Omit<CatalogueDefinition, 'state' | 'fileUrl'> & {
  /** The model file that defines it, relative to the source's model folder; null for none. */
  modelFile: string | null
  visible: boolean
  missing: boolean
  changedSinceFirstRead: boolean
  itemsWithOlderMark: number
  /** What tells a variant of a family apart, as its source read it (FR-142); null otherwise. */
  variantBy: VariantValue[] | null
  variantShape: string | null
  /** The family its source declares it is a variant of (`meta.footnote`, D9); null for none. */
  declared: DeclaredFamily | null
  /** What it is built from, as its source names it (CON-207); null when the source does not say. */
  builtFrom: BuiltFrom | null
}

const iso = (column: string) =>
  `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en')

/** Whether the groups in `$1` may see a definition `d` (CON-509): it names none, or one of them. */
const visibleTo = '(d.visible_groups is null or d.visible_groups && $1::text[])'

/**
 * The definitions the person's groups may not see, by ref (CON-509): a term that names one is
 * left out of the catalogue, and out of what Ask counts from it. Groups are parked (FR-128), so
 * today that is every definition the source limits to groups.
 */
export async function hiddenDefinitions(
  database: Queryable,
  groups: readonly string[] = [],
): Promise<string[]> {
  const rows = await database.query<{ ref: string }>(
    `select d.ref from definitions d where not ${visibleTo}`,
    [groups],
  )
  return rows.map((row) => row.ref)
}

export function createCatalogueService(
  database: Queryable,
  clock: Clock,
  /** The person's groups. Groups are parked (FR-128), so nobody has any yet. */
  groups: readonly string[] = [],
): CatalogueService {
  /**
   * Everything the catalogue is built from, in one statement: the live vocabulary, what the
   * definition source last read about its terms, the sources, how many items mention each term,
   * the open gaps and the library index. A busy server pays for every round trip, and the
   * catalogue is read again after every edition.
   */
  async function read() {
    const [row] = await database.query<{
      vocabulary: VocabularyRow[]
      definitions: DefinitionRow[]
      familyMembers: (Pick<
        DefinitionRow,
        'ref' | 'name' | 'title' | 'variantBy' | 'variantShape' | 'declared' | 'builtFrom'
      > & { sourceId: string; baseName: string | null })[]
      sources: (Omit<CatalogueSource, 'tool' | 'connector'> & {
        type: string
        removed: boolean
        fromServer: boolean
        config: SourceConfig
      })[]
      settings: { key: string; value: unknown }[]
      meanings: {
        key: string
        choice: 'auto' | 'written'
        words: string | null
        revision: number
        personId: string
        at: string
      }[]
      usuals: {
        key: string
        member: string | null
        revision: number
        personId: string
        at: string
      }[]
      mentions: { key: string; items: number }[]
      splits: (Omit<CatalogueSplit, 'metrics'> & { metrics: string[] })[]
      gaps: string[][]
      items: IndexedItem[]
    }>(
      `with vocabulary as materialized (
         select t.key, t.kind::text as kind, t.parent_key as "parentKey", t.name, t.aliases,
                t.area_id as "areaId", d.area_id as "sourceAreaId", t.definition_refs as "definitionRefs"
           from serving_vocabulary((select seq from live_edition)) t
           left join serving_source_domains((select seq from live_edition)) d on d.key = t.key),
       -- Accepted items that recorded another mark than the definition has now, counted in one
       -- pass over the library: a correlated count would read the item view once per term. The
       -- terms are chosen below, not here: matching the refs here makes PostgreSQL probe the refs
       -- index once per term for every item, seconds at 10,000 items.
       older as materialized (
         select r.definition_ref as ref, count(*)::int as items
           from v_item_list l join item_version_refs r on r.version_id = l.version_id
           join definitions d on d.ref = r.definition_ref
          where l.status = 'accepted' and cl_audience_allows(l.audience_groups)
            and r.change_mark <> d.change_mark
          group by r.definition_ref),
       described as (
         select d.ref, d.connector_id as "sourceId", d.name, d.title,
                d.description_copy as "descriptionCopy", d.value_type as "valueType",
                d.renamed_to as "renamedTo", d.model_file as "modelFile", d.variant_by as "variantBy",
                d.variant_shape as "variantShape",
                case when d.family_name is not null
                     then jsonb_build_object('name', d.family_name, 'by', d.family_by)
                          || case when d.family_description is not null
                                  then jsonb_build_object('description', d.family_description)
                                  else '{}'::jsonb end end as declared,
                case when d.built_from_refs is not null
                     then json_build_object('refs', d.built_from_refs, 'columns', d.built_from_columns)
                end as "builtFrom",
                ${visibleTo} as visible,
                d.missing_since_snapshot is not null as missing,
                ${iso('seen.fetched_at')} as "readAt",
                ${iso('changed.at')} as "changedAt",
                changed.at is not null as "changedSinceFirstRead",
                coalesce(older.items, 0) as "itemsWithOlderMark"
           from definitions d
           left join older on older.ref = d.ref
           left join connector_snapshots seen on seen.id = d.last_seen_snapshot
           left join lateral (
             select max(s.fetched_at) as at from definition_marks m
               join connector_snapshots s on s.id = m.snapshot_id
              where m.definition_ref = d.ref and m.snapshot_id is distinct from d.first_seen_snapshot) changed on true
          where d.ref in (select unnest(v."definitionRefs") from vocabulary v)),
       -- Every metric its sources read, live or not: what makes a family, and a rate, does not
       -- depend on what has been published.
       siblings as (
         select d.ref, d.connector_id as "sourceId", d.name, d.title, d.base_name as "baseName",
                d.variant_by as "variantBy", d.variant_shape as "variantShape",
                case when d.family_name is not null
                     then jsonb_build_object('name', d.family_name, 'by', d.family_by)
                          || case when d.family_description is not null
                                  then jsonb_build_object('description', d.family_description)
                                  else '{}'::jsonb end end as declared,
                case when d.built_from_refs is not null
                     then json_build_object('refs', d.built_from_refs, 'columns', d.built_from_columns)
                end as "builtFrom"
           from definitions d
          where d.kind = 'metric' and d.missing_since_snapshot is null and ${visibleTo}
            and d.connector_id in (select x.connector_id from definitions x
                                    where x.ref in (select unnest(v."definitionRefs") from vocabulary v))),
       sources as (
         select c.id, c.name, c.type, ${iso('ok.fetched_at')} as "readAt", ok.source_version as "sourceVersion",
                coalesce(latest.status = 'failed', false) as failing,
                c.removed_at is not null as removed, c.origin = 'server' as "fromServer", c.config
           from connectors c
           left join lateral (select s.fetched_at, s.source_version from connector_snapshots s
                               where s.connector_id = c.id and s.status <> 'failed'
                               order by s.fetched_at desc limit 1) ok on true
           left join lateral (select s.status from connector_snapshots s where s.connector_id = c.id
                               order by s.fetched_at desc limit 1) latest on true
          where c.kind = 'definition_source'),
       -- Counted as the item list counts mentions: current versions, accepted or retired.
       mentions as (
         select m.term_key as key, count(distinct l.id)::int as items
           from item_version_mentions m join v_item_list l on l.version_id = m.version_id
          where m.term_key is not null and cl_audience_allows(l.audience_groups)
          group by m.term_key)
       select
         (select coalesce(json_agg(v), '[]') from vocabulary v) as vocabulary,
         (select coalesce(json_agg(d), '[]') from described d) as definitions,
         (select coalesce(json_agg(f), '[]') from siblings f) as "familyMembers",
         (select coalesce(json_agg(s order by s.id collate "C"), '[]') from sources s) as sources,
         (select coalesce(json_agg(m), '[]') from mentions m) as mentions,
         (select coalesce(json_agg(json_build_object(
                   'key', f.family_key, 'choice', f.choice, 'words', f.words,
                   'revision', f.revision, 'personId', f.updated_by::text, 'at', ${iso('f.updated_at')})), '[]')
            from family_meanings f) as meanings,
         (select coalesce(json_agg(json_build_object(
                   'key', f.family_key, 'member', f.member_key, 'revision', f.revision,
                   'personId', f.updated_by::text, 'at', ${iso('f.updated_at')})), '[]')
            from family_usual f) as usuals,
         (select coalesce(json_agg(json_build_object(
                   'key', x.family_key, 'name', x.name, 'areaId', x.area_id, 'metrics', x.variants,
                   'items', (select count(distinct s.item_id)::int from item_version_service s
                               join item_version_metrics m on m.version_id = s.version_id
                              where upper_inf(s.editions) and m.metric_key = x.family_key),
                   'personId', t.split_by::text, 'at', ${iso('x.split_at')}) order by x.split_at desc), '[]')
            from ${standingSplits(liveSeq)} x join family_splits t on t.id = x.id) as splits,
         (select coalesce(json_agg(s), '[]') from (
            select distinct on (key) key, value from settings_versions
             where key = any($2::text[]) order by key, version desc) s) as settings,
         (select coalesce(json_agg(t.metric_keys || t.value_keys || t.dimension_keys), '[]')
            from gaps g join topics t on t.id = g.topic_id
           where g.status = 'open') as gaps,
         ${libraryIndexItems} as items`,
      [groups, linkSettings],
    )
    const { vocabulary, definitions, familyMembers, mentions, meanings, usuals, splits, items } =
      row!
    const settings = new Map(row!.settings.map(({ key, value }) => [key, value]))
    // The words on screen name the tool the source reads (CON-101: core names no vendor).
    const sources: (CatalogueSource & { removed: boolean; modelFolder: string | null })[] =
      row!.sources.map(({ type, removed, fromServer, config, ...source }) => ({
        ...source,
        removed,
        tool: connectorType(type, source.name).tool,
        connector: type,
        modelFolder: modelFolderOf({ type, fromServer, config }, (key) => settings.get(key)),
      }))
    const gaps = row!.gaps.map((keys) => ({ keys }))
    return {
      vocabulary,
      definitions,
      familyMembers,
      sources,
      mentions,
      meanings,
      usuals,
      splits,
      gaps,
      items,
    }
  }

  function build(data: Awaited<ReturnType<typeof read>>) {
    const today = clock.today()
    const definitions = new Map(data.definitions.map((row) => [row.ref, row]))
    const groupNames = new Map(
      data.vocabulary.filter((t) => t.kind === 'metric_group').map((t) => [t.key, t.name]),
    )
    const mentionedBy = new Map(data.mentions.map((row) => [row.key, row.items]))
    const chosenMeanings = new Map(data.meanings.map((row) => [row.key, row]))
    const pickedUsual = new Map(data.usuals.map((row) => [row.key, row]))
    // A gap counts once for a term, even when its topic names several of the term's values. A
    // dimension is named by itself or by any of its values.
    const gapsNaming = (key: string) =>
      data.gaps.filter(({ keys }) =>
        keys.some((topicKey) =>
          key.startsWith('dim:')
            ? topicKey === key || topicKey.startsWith(`val:${key.slice(4)}/`)
            : topicKey === key,
        ),
      ).length
    const items = data.items

    const sourceOf = (sourceId: string) => data.sources.find((source) => source.id === sourceId)
    const toolOf = (sourceId: string) => sourceOf(sourceId)?.tool ?? sourceId
    const fileUrlOf = ({ sourceId, modelFile }: DefinitionRow) => {
      const folder = sourceOf(sourceId)?.modelFolder
      return folder && modelFile ? modelFileUrl(folder, modelFile) : null
    }

    // A family (FR-142) is a metric group that names its variants' definitions: one entry for them
    // all. A group that names none is a group of the tool's, as before.
    const families = new Set(
      data.vocabulary
        .filter((t) => t.kind === 'metric_group' && t.definitionRefs.length)
        .map((t) => t.key),
    )
    const variantsOf = new Map<string, VocabularyRow[]>()
    for (const row of data.vocabulary)
      if (row.kind === 'metric' && row.parentKey && families.has(row.parentKey))
        variantsOf.set(row.parentKey, [...(variantsOf.get(row.parentKey) ?? []), row])
    // How each family was found and what tells its variants apart, worked out once over every
    // metric the sources read, live or not: a rate is a rate when it converts more than the one
    // family's pair (D2), whatever has been published.
    const liveName = new Map(
      data.vocabulary.flatMap((row) =>
        row.kind === 'metric' ? row.definitionRefs.map((ref) => [ref, row.name] as const) : [],
      ),
    )
    let sourceFamilies: ReturnType<typeof familiesOf> | null = null
    const foundFamilies = () =>
      (sourceFamilies ??= familiesOf(
        data.familyMembers.map((own) => ({
          ref: own.ref,
          source: own.sourceId,
          name: own.name,
          said:
            liveName.get(own.ref) ??
            memberName({ name: own.name, title: own.title, baseName: own.baseName }),
          variant: own.variantBy ? { shape: own.variantShape ?? '', by: own.variantBy } : null,
          declared: own.declared,
          builtFrom: own.builtFrom,
        })),
      ))
    const dimensionNames = new Map(
      data.vocabulary
        .filter((t) => t.kind === 'dimension')
        .flatMap((t) => t.definitionRefs.map((ref) => [ref, t.name] as const)),
    )

    const listedOf = (row: VocabularyRow): CatalogueDefinition[] | null => {
      const stored = row.definitionRefs.flatMap((ref) => definitions.get(ref) ?? [])
      if (stored.some((definition) => !definition.visible)) return null
      return stored.map((definition) => ({
        ref: definition.ref,
        name: definition.name,
        title: definition.title,
        descriptionCopy: definition.descriptionCopy,
        valueType: definition.valueType,
        state: definitionState(definition),
        renamedTo: definition.renamedTo,
        changedAt: definition.changedAt,
        readAt: definition.readAt,
        sourceId: definition.sourceId,
        tool: toolOf(definition.sourceId),
        connector: sourceOf(definition.sourceId)?.connector ?? definition.sourceId,
        fileUrl: fileUrlOf(definition),
      }))
    }

    /** A family's one entry: its variants, what tells them apart, and the items about any of them. */
    function family(row: VocabularyRow): CatalogueTerm | null {
      const members = (variantsOf.get(row.key) ?? []).sort(byName)
      const listed = listedOf(row)
      if (!listed || !members.length) return null
      const said = members.map((member) => {
        const own = member.definitionRefs.flatMap((ref) => definitions.get(ref) ?? [])[0]
        return {
          member,
          said: member.name,
          ref: own?.ref ?? member.key,
          source: own?.sourceId ?? '',
          name: own?.name ?? member.name,
          variant: own?.variantBy ? { shape: own.variantShape ?? '', by: own.variantBy } : null,
          declared: own && !own.missing ? own.declared : null,
          builtFrom: own?.builtFrom ?? null,
        }
      })
      const found = foundFamilies().find((candidate) =>
        candidate.variants.some(({ ref }) => said.some((entry) => entry.ref === ref)),
      )
      const keyOf = new Map(said.map((entry) => [entry.ref, entry.member.key]))
      const conversions = conversionsOf(
        said.flatMap((entry) =>
          entry.builtFrom ? [{ ref: entry.ref, name: entry.name, builtFrom: entry.builtFrom }] : [],
        ),
      ).map((conversion) => ({
        from: keyOf.get(conversion.from)!,
        to: keyOf.get(conversion.to)!,
        by: conversion.by,
      }))
      const axes = found
        ? {
            by: found.by,
            valuesOf: (entry: { ref: string }) =>
              found.variants.find(({ ref }) => ref === entry.ref)?.values ?? [],
          }
        : familyAxes(said)
      const by = axes.by.map((axis) =>
        axis.ref ? (dimensionNames.get(axis.ref) ?? axisWords(axis)) : axisWords(axis),
      )
      const descriptionOf = (entry: (typeof said)[number]) =>
        entry.member.definitionRefs.flatMap((ref) => definitions.get(ref) ?? [])[0]
          ?.descriptionCopy ?? null
      const chosen = chosenMeanings.get(row.key)
      const usual = pickedUsual.get(row.key)
      const meaning = familyMeaning({
        by,
        variants: said.map((entry) => ({
          key: entry.member.key,
          values: axes.valuesOf(entry),
          description: descriptionOf(entry),
        })),
        conversions,
        declared: declaredWords(said.map((entry) => entry.declared?.description)) ?? null,
        chosen: chosen ?? null,
      })
      const views = new Set(said.map((entry) => viewOf(entry.name)))
      const view = views.size === 1 ? [...views][0] : null
      const keys = new Set([row.key, ...members.map((member) => member.key)])
      const names = (item: ShelfItem) =>
        item.scope.metrics.some((id: string) => keys.has(metricKeyOf(id)))
      const shelf = shelfOf(items, names, today)
      const speaking = speakingDefinition(listed)
      const definition = speaking && { ...speaking, title: null, descriptionCopy: null }
      return {
        key: row.key,
        kind: 'metric',
        id: row.key.slice(row.key.indexOf(':') + 1),
        name: row.name,
        aliases: row.aliases,
        // Its view, in words: `booked_revenue` is "Booked revenue".
        group: view ? { key: `view:${view}`, name: viewWords(view) } : null,
        family: {
          by,
          // A family an owner published from names that look alike was found by its names.
          found: found?.found ?? 'names',
          conversions,
          derivations: derivationsOf(
            said.map((entry) => ({
              said: entry.said,
              values: axes.valuesOf(entry),
              description: descriptionOf(entry),
            })),
          ),
          variants: said.map((entry) => {
            const { member } = entry
            const own = member.definitionRefs.flatMap((ref) => definitions.get(ref) ?? [])[0]
            return {
              key: member.key,
              name: member.name,
              aliases: member.aliases,
              values: axes.valuesOf(entry),
              description: own?.descriptionCopy ?? null,
              ref: own?.ref ?? null,
              state: own ? definitionState(own) : null,
              items: shelfOf(items, scopeNames(member.key), today).items,
            }
          }),
          meaning: {
            ...meaning,
            chosen: chosen
              ? {
                  choice: chosen.choice,
                  words: chosen.words,
                  personId: chosen.personId,
                  at: chosen.at,
                }
              : null,
            revision: chosen?.revision ?? 0,
          },
          declared:
            found?.found === 'declared'
              ? (said.find((entry) => entry.declared)?.declared?.name ?? null)
              : null,
          // A usual variant that has left the family is no usual variant.
          usual: {
            member: members.some((member) => member.key === usual?.member)
              ? (usual?.member ?? null)
              : null,
            chosen: usual ? { personId: usual.personId, at: usual.at } : null,
            revision: usual?.revision ?? 0,
          },
        },
        domain: termDomain(row.areaId, row.sourceAreaId),
        definition,
        definitions: [],
        status: catalogueStatus(definition, shelf),
        shelf: {
          ...shelf,
          gaps: [...keys].reduce((n, key) => n + gapsNaming(key), 0),
          mentionedBy: [...keys].reduce((n, key) => n + (mentionedBy.get(key) ?? 0), 0),
        },
      }
    }

    function term(row: VocabularyRow): CatalogueTerm | null {
      const listed = listedOf(row)
      if (!listed) return null
      const definition = speakingDefinition(listed)
      const shelf = shelfOf(items, scopeNames(row.key), today)
      const kind = row.kind === 'metric' ? 'metric' : 'dimension'
      return {
        key: row.key,
        kind,
        id: row.key.slice(row.key.indexOf(':') + 1),
        name: row.name,
        aliases: row.aliases,
        group:
          row.parentKey && groupNames.has(row.parentKey)
            ? { key: row.parentKey, name: groupNames.get(row.parentKey)! }
            : null,
        family: null,
        // The live edition's map, the one serving and gap topics read.
        domain: termDomain(row.areaId, row.sourceAreaId),
        definition,
        definitions: listed,
        status: catalogueStatus(definition, shelf),
        shelf: {
          ...shelf,
          gaps: gapsNaming(row.key),
          mentionedBy: mentionedBy.get(row.key) ?? 0,
        },
      }
    }

    // A family's variants are listed in it, never as terms of their own.
    const terms = (kind: VocabularyRow['kind']) =>
      data.vocabulary
        .filter((row) =>
          kind === 'metric'
            ? (row.kind === 'metric' && !(row.parentKey && families.has(row.parentKey))) ||
              families.has(row.key)
            : row.kind === kind,
        )
        .sort(byName)
        .flatMap((row) => (families.has(row.key) ? family(row) : term(row)) ?? [])

    return { today, terms }
  }

  /**
   * The metric's definition, the metrics of its view and those built from it, what it is built
   * from, and the live terms that name any of them, in one statement.
   */
  async function readRelations(key: string) {
    type Row = RelationMember & { connectorId: string; missing: boolean }
    const [row] = await database.query<{
      own: Row | null
      peers: Row[]
      targets: { ref: string; name: string; missing: boolean; visible: boolean }[]
      terms: { key: string; name: string; refs: string[] }[]
    }>(
      `with vocabulary as materialized (
         select t.key, t.name, t.definition_refs as refs
           from serving_vocabulary((select seq from live_edition)) t where t.kind = 'metric'),
       own as (
         select d.ref, d.connector_id as "connectorId", d.name,
                d.missing_since_snapshot is not null as missing,
                case when d.built_from_refs is null then null
                     else json_build_object('refs', d.built_from_refs, 'columns', d.built_from_columns)
                end as "builtFrom"
           from definitions d
          where d.ref = (select v.refs[1] from vocabulary v where v.key = $2)
            and d.kind = 'metric' and ${visibleTo}),
       -- The live metrics of its view, which a conversion is found among (D2), and those built
       -- from it.
       peers as (
         select d.ref, d.connector_id as "connectorId", d.name, false as missing,
                jsonb_build_object('refs', d.built_from_refs, 'columns', d.built_from_columns) as "builtFrom"
           from definitions d join own o on d.connector_id = o."connectorId"
          where d.kind = 'metric' and d.built_from_refs is not null and d.ref <> o.ref
            and d.missing_since_snapshot is null and ${visibleTo}
            and regexp_replace(d.name, '[.][^.]*$', '') = regexp_replace(o.name, '[.][^.]*$', '')
         union
         select d.ref, d.connector_id, d.name, false,
                jsonb_build_object('refs', d.built_from_refs, 'columns', d.built_from_columns)
           from definitions d join own o on d.built_from_refs @> array[o.ref]
          where d.missing_since_snapshot is null and ${visibleTo}),
       targets as (
         select d.ref, d.name, d.missing_since_snapshot is not null as missing, ${visibleTo} as visible
           from definitions d join definitions o on o.ref = (select ref from own)
          where d.ref = any(o.built_from_refs))
       select
         (select row_to_json(o) from own o) as own,
         (select coalesce(json_agg(p), '[]') from peers p) as peers,
         (select coalesce(json_agg(t), '[]') from targets t) as targets,
         (select coalesce(json_agg(json_build_object('key', v.key, 'name', v.name, 'refs', v.refs)), '[]')
            from vocabulary v
           where v.refs && (array(select ref from peers) || array(select ref from targets where visible))) as terms`,
      [groups, key],
    )
    return row!
  }

  /**
   * The metric's definition and every metric below it, walked through what each is built from:
   * one a person may not see, or that left its source, is read but not walked through. With the
   * live terms that name any of them, in one statement.
   */
  async function readTree(key: string) {
    type Row = RelationMember & { known: boolean; missing: boolean; visible: boolean }
    const [row] = await database.query<{
      own: string | null
      metrics: Row[]
      terms: { key: string; name: string; refs: string[] }[]
    }>(
      `with recursive vocabulary as materialized (
         select t.key, t.name, t.definition_refs as refs
           from serving_vocabulary((select seq from live_edition)) t where t.kind = 'metric'),
       own as (
         select d.ref from definitions d
          where d.ref = (select v.refs[1] from vocabulary v where v.key = $2)
            and d.kind = 'metric' and ${visibleTo}),
       walk(ref) as (
         select ref from own
         union
         select input from walk w
           join definitions d on d.ref = w.ref
                and d.missing_since_snapshot is null and ${visibleTo}
           cross join unnest(d.built_from_refs) as input)
       select
         (select ref from own) as own,
         (select coalesce(json_agg(json_build_object(
                   'ref', w.ref, 'name', coalesce(d.name, w.ref), 'known', d.ref is not null,
                   'missing', coalesce(d.missing_since_snapshot is not null, false),
                   'visible', d.ref is null or ${visibleTo},
                   'builtFrom', case when d.built_from_refs is null then null
                                     else json_build_object('refs', d.built_from_refs, 'columns', '[]'::json)
                                end)), '[]')
            from walk w left join definitions d on d.ref = w.ref) as metrics,
         (select coalesce(json_agg(json_build_object('key', v.key, 'name', v.name, 'refs', v.refs)), '[]')
            from vocabulary v where v.refs && array(select ref from walk)) as terms`,
      [groups, key],
    )
    return row!
  }

  return {
    async builtFrom(key) {
      const { own, metrics, terms } = await readTree(key)
      const root = metrics.find((metric) => metric.ref === own)
      if (!root) return null
      const termOf = new Map(terms.flatMap((term) => term.refs.map((ref) => [ref, term] as const)))
      const stored = new Map(metrics.map((metric) => [metric.ref, metric]))
      const targetOf = (ref: string) => {
        const definition = stored.get(ref)
        if (!definition?.known) return undefined
        if (!definition.visible) return null
        const term = termOf.get(ref)
        return {
          name: term?.name ?? definition.name,
          key: term?.key ?? null,
          missing: definition.missing,
        }
      }
      return { metrics: treeOf(root, metrics, targetOf) }
    },
    async relations(key) {
      const { own, peers, targets, terms } = await readRelations(key)
      if (!own) return null
      const termOf = new Map(terms.flatMap((term) => term.refs.map((ref) => [ref, term] as const)))
      const stored = new Map<string, { name: string; missing: boolean; visible: boolean }>([
        ...peers.map((peer) => [peer.ref, { ...peer, visible: true }] as const),
        ...targets.map((target) => [target.ref, target] as const),
      ])
      // A definition the person may not see is left out; one the source never listed, named alone.
      const targetOf = (ref: string) => {
        const definition = stored.get(ref)
        if (!definition) return undefined
        if (!definition.visible) return null
        const term = termOf.get(ref)
        return {
          name: term?.name ?? definition.name,
          key: term?.key ?? null,
          missing: definition.missing,
        }
      }
      return { relations: relationsOf(own, peers, targetOf) }
    },
    async list() {
      const data = await read()
      const { today, terms } = build(data)
      const metrics = terms('metric')
      const nameOf = new Map(data.vocabulary.map((row) => [row.key, row.name]))
      return {
        terms: [...metrics, ...terms('dimension')],
        splits: data.splits.map((split) => ({
          ...split,
          metrics: split.metrics.flatMap((key) => {
            const name = nameOf.get(key)
            return name ? [{ key, name }] : []
          }),
        })),
        sources: data.sources.filter((source) => !source.removed).map(withoutRemoved),
        coverage: {
          metrics: metrics.length,
          withoutDomain: metrics.filter((metric) => metric.domain.areaId === null).length,
        },
        today,
      }
    },
  }
}
