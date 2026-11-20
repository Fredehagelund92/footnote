import type {
  Catalogue,
  IndexedItem,
  CatalogueDefinition,
  CatalogueSource,
  CatalogueTerm,
} from '../../../contract/index.ts'
import {
  catalogueStatus,
  definitionState,
  scopeNames,
  shelfOf,
  speakingDefinition,
  termDomain,
  type ShelfItem,
} from '../../../domain/catalogue.ts'
import type { VariantValue } from '../../../domain/definition-helpers.ts'
import { axisWords, derivationsOf, familyAxes } from '../../../domain/metric-families.ts'
import { metricKeyOf } from '../../../domain/vocabulary.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { connectorType } from '../connectors/index.ts'
import { libraryIndexItems } from '../library/index.ts'

const withoutRemoved = <T extends { removed: boolean }>({ removed: _removed, ...source }: T) =>
  source

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

type DefinitionRow = Omit<CatalogueDefinition, 'state'> & {
  visible: boolean
  missing: boolean
  changedSinceFirstRead: boolean
  itemsWithOlderMark: number
  /** What tells a variant of a family apart, as its source read it (FR-142); null otherwise. */
  variantBy: VariantValue[] | null
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
      sources: (Omit<CatalogueSource, 'tool' | 'connector'> & { type: string; removed: boolean })[]
      mentions: { key: string; items: number }[]
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
                d.renamed_to as "renamedTo", d.variant_by as "variantBy",
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
       sources as (
         select c.id, c.name, c.type, ${iso('ok.fetched_at')} as "readAt", ok.source_version as "sourceVersion",
                coalesce(latest.status = 'failed', false) as failing,
                c.removed_at is not null as removed
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
         (select coalesce(json_agg(s order by s.id collate "C"), '[]') from sources s) as sources,
         (select coalesce(json_agg(m), '[]') from mentions m) as mentions,
         (select coalesce(json_agg(t.metric_keys || t.value_keys || t.dimension_keys), '[]')
            from gaps g join topics t on t.id = g.topic_id
           where g.status = 'open') as gaps,
         ${libraryIndexItems} as items`,
      [groups],
    )
    const { vocabulary, definitions, mentions, items } = row!
    // The words on screen name the tool the source reads (CON-101: core names no vendor).
    const sources: (CatalogueSource & { removed: boolean })[] = row!.sources.map(
      ({ type, removed, ...source }) => ({
        ...source,
        removed,
        tool: connectorType(type, source.name).tool,
        connector: type,
      }),
    )
    const gaps = row!.gaps.map((keys) => ({ keys }))
    return { vocabulary, definitions, sources, mentions, gaps, items }
  }

  function build(data: Awaited<ReturnType<typeof read>>) {
    const today = clock.today()
    const definitions = new Map(data.definitions.map((row) => [row.ref, row]))
    const groupNames = new Map(
      data.vocabulary.filter((t) => t.kind === 'metric_group').map((t) => [t.key, t.name]),
    )
    const mentionedBy = new Map(data.mentions.map((row) => [row.key, row.items]))
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
      }))
    }

    /** A family's one entry: its variants, what tells them apart, and the items about any of them. */
    function family(row: VocabularyRow): CatalogueTerm | null {
      const members = (variantsOf.get(row.key) ?? []).sort(byName)
      const listed = listedOf(row)
      if (!listed || !members.length) return null
      const said = members.map((member) => ({
        member,
        said: member.name,
        variant: (() => {
          const by = member.definitionRefs.flatMap((ref) => definitions.get(ref)?.variantBy ?? [])
          return by.length ? { shape: '', by } : null
        })(),
      }))
      const axes = familyAxes(said)
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
        group: null,
        family: {
          by: axes.by.map((axis) =>
            axis.ref ? (dimensionNames.get(axis.ref) ?? axisWords(axis)) : axisWords(axis),
          ),
          derivations: derivationsOf(
            said.map((entry) => ({
              said: entry.said,
              values: axes.valuesOf(entry),
              description:
                entry.member.definitionRefs.flatMap((ref) => definitions.get(ref) ?? [])[0]
                  ?.descriptionCopy ?? null,
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
              state: own ? definitionState(own) : null,
              items: shelfOf(items, scopeNames(member.key), today).items,
            }
          }),
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

  return {
    async list() {
      const data = await read()
      const { today, terms } = build(data)
      const metrics = terms('metric')
      return {
        terms: [...metrics, ...terms('dimension')],
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
