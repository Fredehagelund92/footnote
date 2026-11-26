/*
  Where the names a read made go when none of their members has a domain (F08 of the cold first
  use scout): the names card offers one domain for them, and publishing them puts them there and
  maps their views to it, so a new install's first domain is made with its names. Pure, so the
  service and the mock binding offer the same one.
*/

/** A new domain's id from its name, as the domains' ids are made: "Customer value" is customer_value. */
export function freeAreaId(name: string, taken: ReadonlySet<string>): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const base = (/^[a-z][a-z0-9_]/.test(slug) ? slug : `area_${slug || 'domain'}`)
    .slice(0, 36)
    .replace(/_+$/, '')
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`
  return id
}

/** A tool's word as a domain's name: `customer_success` is "Customer success". */
export function domainNameOf(word: string): string {
  const words = word.replace(/[_\s.-]+/g, ' ').trim()
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : ''
}

/** What a new install's names go under when nothing names a domain or a view. */
const FALLBACK = 'Company'

/** A name with no domain, as the card offers a domain for it. */
export type Unplaced = {
  /** The domain its tool names for most of its members that is not a domain yet, or null. */
  named: string | null
  /** The views its members are in. */
  views: readonly string[]
}

/**
 * The domain the card offers: one that exists (`id`), or a new one made with this name when the
 * names are published (`id` null). `names` is how many wait with no domain.
 */
export type NamesPlace = { id: string | null; name: string; names: number }

/** The value said most often, the first in order of its words on a tie; null for none. */
function most(values: readonly string[]): string | null {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))[0]?.[0] ?? null
}

/**
 * The domain the names with none go under: the one their tool names for most of them, made as a
 * new domain, when it is not taken; else the one domain the reader owns; else a new one named for
 * the view most of them are in. A name a domain has already is used as that domain. Null when no
 * name waits without one.
 */
export function namesPlace(input: {
  unplaced: readonly Unplaced[]
  /** The domains names may go under (never the sandbox), with whether the reader owns each. */
  domains: readonly { id: string; name: string; owned: boolean }[]
  /** Every id a domain has or had: history keeps a deleted one's. */
  taken: ReadonlySet<string>
}): NamesPlace | null {
  const { unplaced, domains, taken } = input
  if (!unplaced.length) return null
  const names = unplaced.length
  const existing = (name: string) =>
    domains.find((domain) => domain.name.toLowerCase() === name.toLowerCase())
  const offer = (name: string): NamesPlace => {
    const same = existing(name)
    return same ? { id: same.id, name: same.name, names } : { id: null, name, names }
  }
  const named = most(unplaced.flatMap((name) => (name.named ? [name.named] : [])))
  if (named && !taken.has(named)) return offer(domainNameOf(named))
  const owned = domains.filter((domain) => domain.owned)
  if (owned.length === 1) return { id: owned[0]!.id, name: owned[0]!.name, names }
  const view = most(unplaced.flatMap((name) => name.views))
  return offer((view && domainNameOf(view)) || FALLBACK)
}
