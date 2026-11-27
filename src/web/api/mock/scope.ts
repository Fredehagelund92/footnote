import { searchScope, type ScopeUsage } from '@domain/scope-search'
import type { Term } from '@domain/vocabulary'
import type { ScopeSearch, ScopeSearchInput } from '../client'
import type { Definition, DefinitionValue } from '@/lib/definitions'
import type { Fact, ScopeTerm } from '@/model/items'
import { markets, metrics } from './data/world'

/*
  The "Applies to" picker's search over the demo world, by the service's own rule
  (src/domain/scope-search.ts): the metrics, and the dimensions with their values as the demo
  install seeds them (db/seed/fixtures/reference-data.ts), the 2,400 invented campaigns included,
  so the picker meets a dimension too large to list in the mock as it does on the service.
*/

/** A name as a key's id: "First-time buyers" is `first_time_buyers`. */
const idOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

/** The other names the demo gives a market. */
const marketAliases: Record<string, string[]> = {
  Norway: ['Norge'],
  Spain: ['Espana'],
  Poland: ['Polska'],
  Germany: ['Deutschland'],
  'United Kingdom': ['Great Britain', 'UK'],
  'United States': ['USA', 'United States of America'],
}

const campaignEvents = [
  'Spring Sale',
  'Summer Trail',
  'Autumn Gear Up',
  'Winter Warmth',
  'Black Friday',
  'Festival Season',
  'Late Night Sale',
  'New Season',
  'Clearance',
  'Welcome Back',
]
const campaignFormats = ['Search', 'Social', 'Video', 'Display', 'Email']
const campaignYears = [2023, 2024, 2025, 2026]
const campaigns = markets.flatMap((market) =>
  campaignEvents.flatMap((event) =>
    campaignYears.flatMap((year) =>
      campaignFormats.map((format) => `${market} ${event} ${year} ${format}`),
    ),
  ),
)

const dimensions: { name: string; values: string[]; aliases?: Record<string, string[]> }[] = [
  { name: 'Market', values: markets, aliases: marketAliases },
  { name: 'Product', values: ['Footwear', 'Clothing', 'Camping', 'Climbing'] },
  { name: 'Channel', values: ['Marketplace', 'Paid search', 'Email', 'Organic'] },
  { name: 'Platform', values: ['Web', 'iOS', 'Android'] },
  { name: 'Campaign', values: campaigns },
]

const term = (
  key: string,
  kind: Term['kind'],
  name: string,
  parentKey: string | null = null,
  aliases: string[] = [],
): Term => ({ key, kind, name, aliases, parentKey, areaId: null, definitionRefs: [] })

/** The demo's vocabulary as the service's terms. */
const terms: Term[] = [
  ...metrics.map((m) => term(`metric:${idOf(m.name)}`, 'metric', m.name)),
  ...dimensions.flatMap((d) => {
    const key = `dim:${idOf(d.name)}`
    return [
      term(key, 'dimension', d.name),
      ...d.values.map((v) =>
        term(`val:${idOf(d.name)}/${idOf(v)}`, 'dimension_value', v, key, d.aliases?.[v] ?? []),
      ),
    ]
  }),
]
const byKey = new Map(terms.map((t) => [t.key, t]))
/** How the data writes a value people added this visit, by key. */
const spelled = new Map<string, string[]>()
/** How many times values were published this visit: a list of them read before is out of date. */
let published = 0
export const valuesPublished = () => published

/** A dimension of the demo by its name, as its term. */
export const dimensionTermOf = (name: string) =>
  terms.find((t) => t.kind === 'dimension' && t.name.toLowerCase() === name.toLowerCase())

/** A dimension's values, as Definitions lists them: by name, with their other names. */
export function valuesOf(dimensionKey: string): DefinitionValue[] {
  return terms
    .filter((t) => t.kind === 'dimension_value' && t.parentKey === dimensionKey)
    .map((t) => ({ name: t.name, aliases: t.aliases, writtenAs: spelled.get(t.key) ?? [] }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
}

/**
 * Publishes values of a dimension in the demo, as an owner or an admin does: the picker and
 * Definitions read them at once, until the page reloads.
 */
export function publishValues(
  dimensionKey: string,
  values: readonly (Pick<DefinitionValue, 'name'> & Partial<DefinitionValue> & { key: string })[],
) {
  for (const value of values) {
    if (byKey.has(value.key)) continue
    const added = term(value.key, 'dimension_value', value.name, dimensionKey, value.aliases ?? [])
    terms.push(added)
    byKey.set(value.key, added)
    if (value.writtenAs?.length) spelled.set(value.key, value.writtenAs)
  }
  published++
}

/** The values a dimension has, live, by the words each is written with. */
export const heldValuesOf = (dimensionKey: string) =>
  terms
    .filter((t) => t.kind === 'dimension_value' && t.parentKey === dimensionKey)
    .map((t) => ({ key: t.key, name: t.name, words: [t.name, ...t.aliases], waiting: false }))

/** A term as "Applies to" holds it. */
function scopeTermOf(t: Term): ScopeTerm {
  if (t.kind === 'metric') return { key: t.key, kind: 'metric', name: t.name }
  if (t.kind === 'dimension') return { key: t.key, kind: 'dimension', name: t.name }
  return {
    key: t.key,
    kind: 'value',
    name: t.name,
    dimension: byKey.get(t.parentKey ?? '')?.name ?? '',
  }
}

/**
 * The scope of a demo item, whose fixtures name it in words: a metric, a dimension or a market by
 * its name. A word the vocabulary does not hold is left out.
 */
export function scopeOfWhere(where: readonly string[]): ScopeTerm[] {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  return where.flatMap((name) => {
    const found =
      terms.find((t) => t.kind !== 'dimension_value' && same(t.name, name)) ??
      terms.find((t) => t.parentKey === 'dim:market' && same(t.name, name))
    return found ? [scopeTermOf(found)] : []
  })
}

/** An item with its scope by key. */
export const withScope = (fact: Fact): Fact =>
  fact.scope ? fact : { ...fact, scope: scopeOfWhere(fact.where) }

const valued = new WeakMap<Fact, Fact>()
/** An item with its dimension values, each with its dimension, as the library index names them. */
export function withValues(fact: Fact): Fact {
  if (fact.values) return fact
  let done = valued.get(fact)
  if (!done) {
    const values = withScope(fact).scope!.flatMap((t) =>
      t.kind === 'value' ? [{ dimension: t.dimension ?? '', name: t.name }] : [],
    )
    valued.set(fact, (done = { ...fact, values }))
  }
  return done
}

/** The families of metrics as the service's terms: one group naming its variants, which are metrics in it. */
const familyTermsOf = (families: readonly Definition[]): Term[] =>
  families.flatMap((d) => {
    const key = `group:${idOf(d.name)}`
    return [
      { ...term(key, 'metric_group', d.name), definitionRefs: ['variants'] },
      ...(d.family?.variants ?? []).map((v) =>
        term(`metric:${idOf(v.name)}`, 'metric', v.name, key),
      ),
    ]
  })

/** The demo's search: the person's recent terms are those they published or suggested this visit. */
export function createScopeSearch() {
  let recent: string[] = []
  return {
    /** Remembers the terms of a scope the person just published or suggested, newest first. */
    used(scope: readonly ScopeTerm[] | undefined) {
      const keys = (scope ?? []).map((t) => t.key)
      recent = [...keys, ...recent.filter((k) => !keys.includes(k))].slice(0, 20)
    },
    search(
      input: ScopeSearchInput,
      facts: readonly Fact[],
      families: readonly Definition[] = [],
    ): ScopeSearch {
      const uses: Record<string, number> = {}
      for (const fact of facts) {
        if (fact.status === 'Draft' || fact.status === 'Archived') continue
        const keys = new Set(
          withScope(fact).scope!.flatMap((t) =>
            t.kind === 'value' ? [t.key, `dim:${t.key.slice(4, t.key.indexOf('/'))}`] : [t.key],
          ),
        )
        for (const key of keys) uses[key] = (uses[key] ?? 0) + 1
      }
      const usage: ScopeUsage = { recent, uses }
      return searchScope([...terms, ...familyTermsOf(families)], usage, {
        query: input.q,
        ...(input.dimension === undefined ? {} : { dimension: input.dimension }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      })
    },
  }
}
