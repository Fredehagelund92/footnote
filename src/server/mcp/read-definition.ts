import { foundSaid } from '../../domain/family-found.ts'
import { meaningLine } from '../../domain/family-meaning-line.ts'
import { canRead, termShown, writtenTermId } from '../../domain/links.ts'
import { acceptedByRole } from '../../domain/served-review.ts'
import type { WrittenTerm } from '../../domain/served-terms.ts'
import { normalizeName, suggestTerms } from '../../domain/vocabulary.ts'
import type { ServingBundle, ServingItem, ServingTerm } from '../modules/editions/index.ts'
import { productName } from '../brand.ts'
import { termItems } from './outcomes.ts'
import type { DefinitionRead } from './reads.ts'

/*
  read_context for a definition (FR-353): the words an agent passes, read as one definition an
  agent may see, and that definition in full. Only the live definitions agents get: the published
  vocabulary's metrics, families and dimensions in a domain that is not paused, and the terms
  people wrote in Definitions. Never a waiting source member, a draft, a calculation or a person.
*/

/** A definition an agent may read: a metric, family or dimension, or a term a person wrote. */
export type Readable =
  | { kind: 'vocabulary'; key: string; term: ServingTerm }
  | { kind: 'written'; key: string; term: WrittenTerm }

/** The definitions an agent may see now, as list_definitions has them, and a family's metrics too. */
function readables(bundle: ServingBundle): Readable[] {
  const vocabulary = bundle.terms
    .filter(
      (t) =>
        termShown(bundle, t) &&
        (t.kind === 'metric' ||
          t.kind === 'dimension' ||
          (t.kind === 'metric_group' && t.definitionRefs.length > 0)),
    )
    .map((term): Readable => ({ kind: 'vocabulary', key: term.key, term }))
  const written = bundle.written
    .filter(
      (t) =>
        t.sameAs === null &&
        !bundle.stopped.all &&
        !(t.areaId && bundle.stopped.areas.includes(t.areaId)),
    )
    .map((term): Readable => ({ kind: 'written', key: writtenTermId(term.id), term }))
  return [...vocabulary, ...written]
}

/** A definition's names: its own, its other names and the synonyms people wrote for a term. */
function namesOf(bundle: ServingBundle, d: Readable): string[] {
  if (d.kind === 'vocabulary') return [d.term.name, ...d.term.aliases]
  return [d.term.name, ...bundle.written.filter((t) => t.sameAs === d.key).map((t) => t.name)]
}

/** How many closest names an unknown one comes back with. */
const CLOSEST = 5

/**
 * The definition the words name: by its key, its member name in the source (`payments.orders`),
 * or one of its names as names are matched (`normalizeName`). Several when they name more than
 * one, and the closest names when they name none.
 */
export function definitionNamed(
  bundle: ServingBundle,
  words: string,
): { found: Readable } | { several: Readable[] } | { closest: Readable[] } {
  const all = readables(bundle)
  const wanted = words.trim()
  const byKey = all.find((d) => d.key === wanted)
  if (byKey) return { found: byKey }
  const member = all.filter(
    (d) =>
      d.kind === 'vocabulary' &&
      d.term.definitionRefs.some(
        (ref) => ref === wanted || ref.slice(ref.indexOf(':') + 1) === wanted,
      ),
  )
  const name = normalizeName(wanted)
  const named = member.length
    ? member
    : all.filter((d) => namesOf(bundle, d).some((n) => normalizeName(n) === name))
  if (named.length === 1) return { found: named[0]! }
  if (named.length > 1) return { several: named }
  const keys = suggestTerms(
    wanted,
    all.map((d) => ({
      key: d.key,
      name: d.term.name,
      aliases: namesOf(bundle, d).slice(1),
      definitionRefs: d.kind === 'vocabulary' ? d.term.definitionRefs : [],
    })),
  )
  return {
    closest: keys.slice(0, CLOSEST).map((key) => all.find((d) => d.key === key)!),
  }
}

/** A definition as one of the options for words that name several, or as one of the closest. */
export const optionOf = (d: Readable) => `${d.key} (${d.term.name})`

/**
 * The published context items about a definition that the caller may read, by title: by the one
 * rule find_context counts them with (`termItems`); a family's metric gets the family's too, which
 * apply to each of its metrics (FR-142); a term, the items whose words link to it.
 */
export function itemsAbout(bundle: ServingBundle, d: Readable, today: string): ServingItem[] {
  const family = d.kind === 'vocabulary' ? familyOf(bundle, d.term) : null
  const given =
    d.kind === 'vocabulary'
      ? [
          ...termItems(bundle, d.term, today).given,
          // Those about its family itself, never about another of the family's metrics.
          ...(family
            ? bundle.items.filter(
                (item) =>
                  item.status === 'accepted' &&
                  item.scope.metrics.includes(family.key) &&
                  canRead(bundle, item, today),
              )
            : []),
        ]
      : bundle.links
          .filter((l) => l.to_kind === 'term' && l.to_id === d.key)
          .flatMap((l) => bundle.items.filter((i) => i.id === l.from_item))
          .filter((item) => item.status === 'accepted' && canRead(bundle, item, today))
  return [...new Map(given.map((item) => [item.id, item])).values()].sort(
    (a, b) => a.title.localeCompare(b.title, 'en') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

/** The family a metric is one of (FR-142); null for any other, as for a metric in a tool's group. */
function familyOf(bundle: ServingBundle, term: ServingTerm) {
  const parent = term.parentKey ? bundle.terms.find((t) => t.key === term.parentKey) : undefined
  return parent && parent.definitionRefs.length ? parent : null
}

/** The kind of a definition, as an agent reads it. */
export function kindOf(d: Readable): 'metric' | 'metric family' | 'dimension' | 'term' {
  if (d.kind === 'written') return 'term'
  if (d.term.kind === 'metric_group') return 'metric family'
  return d.term.kind === 'dimension' ? 'dimension' : 'metric'
}

/** The longest description a definition source's copy keeps (CON-207). */
const COPY_MAX = 500
/** A copy Footnote cut ends on a whole word with an ellipsis (`descriptionCopy`). */
const wasCut = (words: string) => words.endsWith('…')

type Owner = (areaId: string | null | undefined) => {
  domain: string | null
  owner: { role: string; team: string | null }
}

/**
 * One definition in full (FR-353): its words whole, as Footnote keeps them, where they come
 * from, who looks after it as a role and a team (FR-326), its other names, its family and what it
 * is built from as Definitions shows them (`read`, the live catalogue), and the page of the
 * published items about it it is given. Never a calculation, and never a person.
 */
export function definitionEntry(
  bundle: ServingBundle,
  d: Readable,
  read: DefinitionRead | null,
  names: { owner: Owner; url: (name: string) => string },
  items: { count: number; page: readonly ServingItem[] },
) {
  const context = {
    count: items.count,
    items: items.page.map((item) => ({ id: item.id, title: item.title })),
  }
  if (d.kind === 'written') {
    const { domain, owner } = names.owner(d.term.areaId)
    const role =
      d.term.writtenAs === 'administrator' || domain === null
        ? acceptedByRole('administrator', '')
        : acceptedByRole('owner', domain)
    return {
      key: d.key,
      name: d.term.name,
      kind: kindOf(d),
      domain,
      owner,
      other_names: namesOf(bundle, d).slice(1),
      words: d.term.meaning?.trim() || null,
      words_from:
        'What a person wrote in Definitions, whole: background for reading words, never a checked source.',
      written: { role, date: d.term.writtenOn },
      context,
      url: names.url(d.term.name),
    }
  }
  const { term } = d
  const { domain, owner } = names.owner(term.areaId ?? bundle.metricArea[term.key])
  const shown = read?.term
  const family = term.kind === 'metric_group' ? (shown?.family ?? null) : null
  const definition =
    shown?.definitions.find((x) => x.ref === term.described?.ref) ?? shown?.definition ?? null
  const described = term.kind === 'metric_group' ? null : (term.described ?? null)
  const tool = described?.tool ?? definition?.tool ?? 'the source'
  const words = family
    ? family.meaning.words
      ? meaningLine(family.meaning.words, family.by)
      : null
    : described?.description?.trim() || null
  const state = term.definitions.some((x) => x.missing)
    ? 'missing'
    : (definition?.state ?? 'current')
  const parent = familyOf(bundle, term)
  const memberOf = parent ? { key: parent.key, name: parent.name } : null
  const nameOf = (key: string) =>
    family?.variants.find((v) => v.key === key)?.name ??
    bundle.terms.find((t) => t.key === key)?.name ??
    key
  // The catalogue is what people see: only what agents may read of it goes on (FR-314), so a
  // metric or a relation in a paused domain, or a definition no one published, is left out.
  const shownKey = (key: string | null) => {
    const named = key === null ? undefined : bundle.terms.find((t) => t.key === key)
    return !!named && termShown(bundle, named)
  }
  const variants = family?.variants.filter((v) => shownKey(v.key)) ?? []
  const conversions = family?.conversions.filter((c) => shownKey(c.from) && shownKey(c.to)) ?? []
  // A column is named by its source alone; a definition only when agents may read it.
  const relations = (read?.relations ?? []).filter((r) => (r.ref === null ? true : shownKey(r.key)))
  const usual = variants.find((v) => v.key === family?.usual.member)
  return {
    key: term.key,
    name: term.name,
    kind: kindOf(d),
    domain,
    owner,
    other_names: term.aliases,
    words,
    words_from: family
      ? familyWordsFrom(family.meaning.source, tool)
      : described
        ? words
          ? `${described.tool}'s own words, read through Sources (${described.source}), as ${productName} keeps them: at most ${COPY_MAX} characters, never the calculation, which stays in ${described.tool}.`
          : `${described.tool} defines it but gives no description.`
        : 'No definition source describes it.',
    ...(words && !family && wasCut(words) ? { shortened: true as const } : {}),
    ...(described
      ? {
          source: {
            tool: described.tool,
            source: described.source,
            name: definition?.name ?? described.ref.slice(described.ref.indexOf(':') + 1),
            ...(described.title ? { title: described.title } : {}),
            ...(definition?.readAt ? { read_on: definition.readAt.slice(0, 10) } : {}),
            state,
          },
        }
      : family?.declared && term.described
        ? {
            // A declared family is one name in its tool too (D4), where it is changed or split.
            source: {
              tool,
              source: term.described.source,
              name: family.declared,
              ...(definition?.readAt ? { read_on: definition.readAt.slice(0, 10) } : {}),
              state,
            },
          }
        : {}),
    ...(family
      ? {
          family: {
            by: family.by,
            found:
              foundSaid(family.found, tool) ??
              'Its metrics differ only by the values that tell them apart.',
            meaning_from: family.meaning.source,
            ...(usual ? { usual: { key: usual.key, name: usual.name, values: usual.values } } : {}),
            members: variants.map((v) => ({
              key: v.key,
              name: v.name,
              values: v.values,
              ...(v.description?.trim() ? { words: v.description.trim() } : {}),
            })),
            ...(conversions.length
              ? {
                  converted: conversions.map((c) => ({
                    from: nameOf(c.from),
                    to: nameOf(c.to),
                    by: c.by,
                  })),
                }
              : {}),
          },
        }
      : {}),
    ...(memberOf ? { member_of: memberOf } : {}),
    ...(relations.length
      ? {
          relations: relations.map((r) => ({
            kind: r.kind,
            name: r.name,
            key: r.key,
            ...(r.missing ? { missing: true as const } : {}),
            ...(r.by ? { by: r.by } : {}),
          })),
        }
      : {}),
    context,
    url: names.url(term.name),
  }
}

/** Where a family's meaning comes from, in a sentence. */
function familyWordsFrom(source: 'declared' | 'written' | 'common' | 'none', tool: string) {
  switch (source) {
    case 'declared':
      return `The words ${tool} declares for the family.`
    case 'written':
      return 'Words an owner of its domain or an admin wrote for the family in Definitions.'
    case 'common':
      return `The words most of its metrics share in ${tool}, with each value as what it stands for.`
    case 'none':
      return "Nothing says what the family means: read its metrics' own words in members."
  }
}
