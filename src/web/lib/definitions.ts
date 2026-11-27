import * as React from 'react'
import type { FamilyFound } from '@domain/family-found'
import type { FamilyMeaningChoice, FamilyMeaningSource } from '@domain/family-meaning-line'
import { lookAlikes, termWord, wordRefusal, type WordHolder } from '@domain/terms'
import { useDefinitions as useDefinitionList } from '@/api/queries'
import { servedToAgents, type DomainId, type Fact } from '@/model/items'

// Definitions: the data glossary. Metrics and dimensions are synced from a definitions tool (its
// connector says which) and are never changed here: their name, meaning, other names and domain
// are the tool's.
// Two plain concepts are written here. A term is a word with its own meaning ("Peak season"). A
// synonym is another name for an existing definition ("GMV" for Gross sales): stored as a term
// that points at it, so adding one from the definition's tag box or from the term editor's
// "Another name for" writes the same entry, once. The definitions come from the app's API; the
// rules here read the list they are given.

export type DefinitionType = 'metric' | 'dimension' | 'term'

/** A variant of a family: a metric its family's own page lists, and nothing else (FR-142). */
export type Variant = {
  name: string
  /** What tells it apart, in the order of its family's `by`: `["EUR", "web"]`. */
  values: string[]
  /** Its tool's own words for it; absent when the tool gives none. */
  description?: string
  /** Its id in its tool, as its source reads it: `cube:orders.revenue_eur_web`. */
  ref?: string
}

/**
 * The variant Ask reads when a question names none of the values a family's variants are told
 * apart by (F3), as an owner of its domain or an admin picked it: by name, who and on which day.
 */
export type FamilyUsual = {
  /** The usual variant; absent when none is picked, and Ask asks which one is meant. */
  member?: string
  by?: string
  on?: string
  /** How many times owners picked: a change sends it back. */
  revision: number
}

/**
 * What a family means (FR-142, M1): the words its tool writes for it, else words an owner wrote,
 * else the words most of its variants share. Variants by name.
 */
export type FamilyMeaning = {
  source: FamilyMeaningSource
  /** The meaning; the common words write each value as what it stands for: "in {Currency}". */
  words: string | null
  /** The words most variants share, values aside, and how many share them. */
  common?: { words: string; agree: number }
  /** The variant the others are converted from, when the common words are its alone. */
  base?: string
  /** The words the rule gives, an owner's choice aside: the common words. */
  automatic?: string
  /** The variants whose own words say something else than the meaning. */
  differing: string[]
  /** What an owner chose last, by whom and on which day. */
  chosen?: {
    choice: FamilyMeaningChoice
    words?: string
    by: string
    on: string
  } | null
  /** How many times owners chose: a change sends it back. */
  revision: number
}

/**
 * A family of metrics (FR-142): one entry for its variants, which only its own page lists. `by`
 * is what tells them apart, in words: ["Currency", "Channel"].
 */
export type Family = {
  by: string[]
  variants: Variant[]
  /** What the source says of how a variant is worked out from another, as plain lines. */
  derivations?: string[]
  /** How it was found (D1, D6): declared in its tool, from the calculation, from a rate, or from its names. */
  found?: FamilyFound
  /**
   * The variants worked out from another with one column more, as the tool's structure says (D2):
   * each by its name, and the column.
   */
  conversions?: { from: string; to: string; by: string }[]
  /** What it means, and where that comes from. */
  meaning?: FamilyMeaning
  /** The variant Ask reads when a question names none of its values. */
  usual?: FamilyUsual
  /**
   * The family's name as its tool declares it (`meta.footnote.family: active_buyers`), for one
   * found so: it is changed or split there, never here (D4).
   */
  declared?: string
}

/**
 * Metrics kept apart, while they stand so (FR-142): a family split back into its metrics, or the
 * metrics of a family Footnote suggested that an owner kept separate when publishing them.
 * Definitions lists them, with the way to make them one family.
 */
export type KeptApart = {
  /** A family split after it was published, or metrics kept separate when they were. */
  how: 'split' | 'apart'
  /** The family's name: when it was split, or as it was suggested. */
  name: string
  /** The domain it was in: its owners and admins may make them one family. */
  domain?: DomainId
  /** The metrics, each a metric of its own now, by name. */
  metrics: string[]
  /** Live context items still about a split family, which reach agents through its metrics. */
  items: number
  by: string
  on: string
}

/** A value of a dimension: its name, other names people say, and how the data writes it. */
export type DefinitionValue = { name: string; aliases: string[]; writtenAs: string[] }

export type Definition = {
  name: string
  type: DefinitionType
  /** Its meaning. Empty for a synonym, whose meaning is its target's. */
  definition: string
  /** A synonym: the definition it is another name for. */
  sameAs?: string
  /** Synced from its tool: read-only here. */
  synced: boolean
  /** The tool a synced definition comes from, as people say it: "Cube". */
  tool?: string
  /** The manifest id of the connector that reads a synced definition, such as `dbt-metricflow`. */
  connector?: string
  /** The source a synced definition is read from: its id in Integrations. */
  source?: string
  /** A synced definition's id in its tool, as its source reads it: `dbt:orders.revenue`. */
  ref?: string
  /**
   * The model file that defines a synced definition, in its source's web view. Absent when the
   * source names no file or has no folder address: then nothing links to the source.
   */
  fileUrl?: string
  /** Other names that came with the synced item from its tool; read-only. */
  sourceNames: string[]
  domain?: DomainId
  /** Its tool's group, for metrics and dimensions. */
  group?: string
  /** A dimension's values, by name: the ones people and owners published. */
  values?: DefinitionValue[]
  /** A metric that is a family of variants, one entry for them all (FR-142). */
  family?: Family
  /** Its tool changed it at the last sync. */
  changed?: string
  /** Who wrote a term. */
  by?: string
  updated: string
}

/**
 * What a metric is built from, or what is built from it, as its source's structure says (FR-143):
 * a definition by its name, or a column of its view. Never a calculation.
 */
export type DefinitionRelation = {
  kind: 'converted_from' | 'converted_to' | 'built_from' | 'used_by'
  /** A definition's name in Definitions, or else in its tool; a column's name in its tool. */
  name: string
  /** A column of its view, not a definition. */
  column: boolean
  /** Definitions lists it, so its name opens its page. */
  linked: boolean
  /** The definition is no longer in its tool. */
  missing: boolean
  /** A conversion's column: the one the converted metric reads beyond the other; else null. */
  by: string | null
}

/**
 * A metric in what another is built from, as its source's structure says (FR-143): its name in
 * Definitions, or else in its tool, and the metrics it is built from, by ref. Never a calculation.
 */
export type BuiltFromMetric = {
  /** Its id in its tool: one metric under two others is the same ref. */
  ref: string
  name: string
  /** Definitions lists it, so its name opens it. */
  linked: boolean
  /** No longer in its tool. */
  missing: boolean
  /** What it is built from, by ref, in its tool's order. */
  from: string[]
}

export const typeLabel: Record<DefinitionType, string> = {
  metric: 'Metric',
  dimension: 'Dimension',
  term: 'Term',
}
/** A type as people read it; a term that points at something else is a synonym. */
export const kindName = (
  d: Pick<Definition, 'type' | 'sameAs'> & Pick<Partial<Definition>, 'family'>,
) => (d.family ? 'Family of metrics' : d.sameAs ? 'Synonym' : typeLabel[d.type])

/**
 * The tool synced definitions come from, as people say it; undefined when none is synced, so a
 * screen says it in neutral words. One definitions integration is on at a time (CON-120), so they
 * all come from one.
 */
export function toolOf(defs: readonly Pick<Definition, 'synced' | 'tool'>[]): string | undefined {
  return defs.find((d) => d.synced && d.tool)?.tool
}

/** The connector the synced definitions are read by; undefined when none is synced. */
export function connectorOf(defs: readonly Pick<Definition, 'synced' | 'connector'>[]) {
  return defs.find((d) => d.synced && d.connector)?.connector
}

// Words are compared as the service compares them: case, spaces and accents aside. Each name's
// word is worked out once: a list of thousands compares the same names many times over.
const words = new Map<string, string>()
const wordOf = (name: string) => {
  let word = words.get(name)
  if (word === undefined) {
    if (words.size > 50_000) words.clear()
    words.set(name, (word = termWord(name)))
  }
  return word
}
const same = (a: string, b: string) => wordOf(a) === wordOf(b)
/** A definition by its name, or the family a variant's name is in: a variant has no entry. */
export const findDefinition = (all: Definition[], name: string | undefined) =>
  name
    ? (all.find((d) => d.name === name) ??
      all.find((d) => same(d.name, name)) ??
      all.find((d) => d.family?.variants.some((v) => same(v.name, name))))
    : undefined

const counted = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`
const kindWords = {
  metric: ['metric', 'metrics'],
  dimension: ['dimension', 'dimensions'],
  term: ['term', 'terms'],
} as const

/**
 * How many of each kind a list holds, in words: "20 metrics (5,000 variants), 3 dimensions". A
 * family counts as one metric and says its variants apart (FR-142). Empty for none.
 */
export function definitionCounts(rows: readonly Definition[]): string {
  return (['metric', 'dimension', 'term'] as const)
    .flatMap((type) => {
      const of = rows.filter((d) => d.type === type)
      const variants = of.reduce((n, d) => n + (d.family?.variants.length ?? 0), 0)
      return of.length
        ? [
            `${counted(of.length, kindWords[type][0], kindWords[type][1])}${variants ? ` (${counted(variants, 'variant', 'variants')})` : ''}`,
          ]
        : []
    })
    .join(', ')
}

/** What a family is, in a sentence or two, for its page and its quick view. */
export function familyMeaning(family: Family): string {
  const n = family.variants.length.toLocaleString('en-GB')
  return `Its ${n} variants differ only ${familyBy(family)}. Context written about it applies to all ${n}.`
}

/**
 * What a variant's name says after its family's: "(USD)" of "Revenue (USD)" in Revenue. A
 * variant named otherwise is said in full.
 */
export function variantPart(family: string, variant: string): string {
  const rest = variant.toLowerCase().startsWith(family.toLowerCase())
    ? variant.slice(family.length).trim()
    : ''
  return rest || `· ${variant}`
}

/** "by Currency and Channel": what tells a family's variants apart. */
export function familyBy(family: Family): string {
  const by = family.by
  return `by ${by.length < 2 ? (by[0] ?? '') : `${by.slice(0, -1).join(', ')} and ${by.at(-1)}`}`
}

/**
 * How variants are converted from others, in one line each, by the values that differ: "USD is
 * converted from EUR by the column exchange_rate_usd". The same conversion across a channel is
 * said once; past two, how many more.
 */
export function conversionLines(family: Family): {
  lines: { to: string; from: string; by: string }[]
  more: number
} {
  const valuesOf = (name: string) => family.variants.find((v) => v.name === name)?.values ?? []
  const said = new Map<string, { to: string; from: string; by: string }>()
  for (const c of family.conversions ?? []) {
    const [from, to] = [valuesOf(c.from), valuesOf(c.to)]
    const differ = to.flatMap((value, i) => (value !== from[i] ? [i] : []))
    const line = {
      to: differ.map((i) => to[i]).join(' · ') || c.to,
      from: differ.map((i) => from[i]).join(' · ') || c.from,
      by: c.by,
    }
    said.set(`${line.to}\u0000${line.from}\u0000${line.by}`, line)
  }
  const lines = [...said.values()]
  return { lines: lines.slice(0, 2), more: Math.max(0, lines.length - 2) }
}

/**
 * A family's mark said in words, as its quick view's first line says it: "Family of 250 metrics,
 * by Currency and Channel", with how one variant is converted from another after it.
 */
export function familyLines(family: Family): string[] {
  const n = (x: number) => x.toLocaleString('en-GB')
  const { lines, more } = conversionLines(family)
  return [
    `Family of ${n(family.variants.length)} metrics, ${familyBy(family)}`,
    ...lines.map((line) => `${line.to} is converted from ${line.from}`),
    ...(more > 0 ? [`${n(more)} more conversions`] : []),
  ]
}

/** The terms that mean the same as this definition: its "Also called in Footnote". */
export const synonymsOf = (all: Definition[], name: string) =>
  all.filter((d) => d.sameAs && same(d.sameAs, name))

/** What a word finally means: a synonym's target, followed to the end. */
export function meaningOf(all: Definition[], d: Definition): Definition {
  const seen = new Set<string>()
  let at = d
  while (at.sameAs && !seen.has(at.name)) {
    seen.add(at.name)
    const next = findDefinition(all, at.sameAs)
    if (!next) break
    at = next
  }
  return at
}

/** Every word that means this definition: its name, its tool's other names, and Footnote's synonyms. */
export const namesOf = (all: Definition[], d: Definition) => [
  d.name,
  ...d.sourceNames,
  ...synonymsOf(all, d.name).map((s) => s.name),
  // Context about a family's variant is context about the family (FR-142).
  ...(d.family?.variants.map((v) => v.name) ?? []),
]

/** `short` is the one line a quick view shows; `other` is what the word already means. */
export type Conflict = {
  kind: 'two-things' | 'chain' | 'missing'
  message: string
  short: string
  other?: string
  /** Whether agents ask which meaning: one of the meanings is a synced item. Else they get nothing. */
  asks: boolean
}

/**
 * Why a term can mislead an agent: its word already means something else (another definition's
 * name, a name Cube gives another item, or another term that reads as the same word), or it is a
 * synonym of a synonym. `self` is the term a draft was opened from: its old word is no conflict.
 */
export function conflictOf(all: Definition[], d: Definition, self?: string): Conflict | undefined {
  if (d.type !== 'term') return undefined
  const target = d.sameAs ? findDefinition(all, d.sameAs) : undefined
  if (d.sameAs && !target)
    return {
      kind: 'missing',
      message: `${d.sameAs} isn't in Definitions any more. Point ${d.name} at something else.`,
      short: `${d.sameAs} isn't in Definitions any more.`,
      asks: false,
    }
  // A term never conflicts with itself (a draft of it is a different object with the same name).
  const other = all
    .filter(
      (x) =>
        !(x.type === 'term' && (x.name === d.name || x.name === self)) &&
        (same(x.name, d.name) || x.sourceNames.some((n) => same(n, d.name))),
    )
    .map((x) => meaningOf(all, x))
    .find((x) => x !== target)
  if (other)
    return {
      kind: 'two-things',
      message: `“${d.name}” already means ${other.name}${other.synced ? ` in ${other.tool}` : ' here'}${target ? `, and this term says it means ${target.name}` : ''}. An agent can't tell which one a person means. Rename this term or point it at ${other.name}.`,
      short: `“${d.name}” already means ${other.name}.`,
      other: other.name,
      asks: !!other.synced || !!target?.synced,
    }
  if (target?.sameAs) {
    const to = meaningOf(all, target)
    return {
      kind: 'chain',
      message: `${target.name} is itself a synonym of ${to.name}. Point ${d.name} at ${to.name} directly.`,
      short: `${target.name} is itself a synonym of ${to.name}.`,
      asks: false,
    }
  }
  return undefined
}

/**
 * The live context about a definition: for a metric or a term, the items that use any of its
 * names (a metric through where it applies, a term in its text). Dimensions are about every item.
 */
export function contextAbout(all: Definition[], d: Definition, facts: Fact[]) {
  const target = meaningOf(all, d)
  if (target.type === 'dimension') return []
  const names = namesOf(all, target).map((n) => n.toLowerCase())
  const word = (n: string) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i')
  return facts.filter(
    (f) =>
      servedToAgents(f) &&
      (target.type === 'metric'
        ? f.where.some((w) => names.includes(w.toLowerCase()))
        : names.some((n) => word(n).test(`${f.title} ${f.summary} ${f.body ?? ''}`))),
  )
}

/** The word in a question that is a Footnote synonym, and the synced item it means: "turnover" is Net revenue. */
export function synonymIn(
  all: Definition[],
  question: string,
): { asked: string; is: Definition } | undefined {
  const lower = question.toLowerCase()
  const hit = all
    .filter((d) => d.sameAs && !conflictOf(all, d))
    .sort((a, b) => b.name.length - a.name.length)
    .find((d) => new RegExp(`\\b${d.name.toLowerCase()}\\b`).test(lower))
  if (!hit) return undefined
  const is = meaningOf(all, hit)
  return is.synced ? { asked: hit.name, is } : undefined
}

/** The synonym rows the list folds into their definition: those whose definition is still there. */
export const foldsInto = (all: Definition[], d: Definition) =>
  d.sameAs ? findDefinition(all, d.sameAs) : undefined

/** Every synonym that ends at this definition, a synonym of a synonym included: the list's "Also called". */
export const alsoCalled = (all: Definition[], d: Definition) =>
  all.filter((x) => x.sameAs && !same(x.name, d.name) && same(meaningOf(all, x).name, d.name))

/**
 * Words typed or pasted into the synonym box: split on commas and new lines, trimmed, each word
 * once whatever its case, the person's own casing kept. "GMV, turnover, sales value" is three.
 */
export function parseTags(input: string): string[] {
  const out: string[] = []
  for (const raw of input.split(/[,\n]/)) {
    const w = raw.trim().replace(/\s+/g, ' ')
    if (w && !out.some((x) => same(x, w))) out.push(w)
  }
  return out
}

/** Why a word can't become a synonym of this definition, and who already has it. */
export type SynonymCheck =
  | { ok: true }
  | {
      ok: false
      why: 'empty' | 'here' | 'source' | 'taken' | 'term'
      reason: string
      holder?: string
      by?: string
    }

/** Everything that has a word, as the service finds it: `self` is the term being edited. */
function holdersOf(
  all: Definition[],
  word: string,
  point: Definition | undefined,
  self: string | undefined,
): WordHolder[] {
  return all.flatMap((d): WordHolder[] => {
    if (d.synced)
      return same(d.name, word) || d.sourceNames.some((n) => same(n, word))
        ? [{ origin: 'source', ref: d.name, name: d.name, tool: d.tool ?? null }]
        : []
    if (d.type !== 'term' || d.name === self || !same(d.name, word)) return []
    const means = d.sameAs ? meaningOf(all, d) : d === point ? d : undefined
    return [
      {
        origin: 'term',
        id: d.name,
        name: d.name,
        sameAs: means ? { ref: means.name, name: means.name } : null,
        by: d.by ?? 'someone',
      },
    ]
  })
}

/**
 * Checks a word as the service will, with the same sentence (`wordRefusal`): never a second entry
 * for a word, never a word that means something else. `target` is what it would be another name
 * for, and `self` the term being edited, when there is one.
 */
export function checkWord(
  all: Definition[],
  word: string,
  target?: Definition,
  self?: string,
): SynonymCheck {
  const name = word.trim()
  if (!name) return { ok: false, why: 'empty', reason: 'Type a word.' }
  const point = target && meaningOf(all, target)
  const refusal = wordRefusal(
    name,
    holdersOf(all, name, point, self),
    point ? { ref: point.name, name: point.name } : null,
  )
  if (!refusal) return { ok: true }
  return {
    ok: false,
    why: refusal.code,
    reason: refusal.message,
    holder: refusal.holder,
    ...(refusal.by ? { by: refusal.by } : {}),
  }
}

/** Checks a word before it becomes a synonym. */
export const checkSynonym = (all: Definition[], target: Definition, word: string) =>
  checkWord(all, word, target)

/** A name in use that a new word looks like, and what that name means. */
export type LookAlike = { name: string; means: string }

/**
 * The name in use a word most looks like, unless it means what the word would mean: a warning for
 * the editor, never a stop. `self` is the term being edited, and `means` what the word would mean.
 */
export function lookAlikeOf(
  all: Definition[],
  word: string,
  self?: string,
  means?: string,
): LookAlike | undefined {
  const names = new Map(
    all
      .filter((d) => d.name !== self)
      .flatMap((d) => {
        const meaning = meaningOf(all, d).name
        return [d.name, ...d.sourceNames].map((n) => [n, meaning] as const)
      }),
  )
  const name = lookAlikes(word, [...names.keys()]).find((n) => names.get(n) !== means)
  return name ? { name, means: names.get(name)! } : undefined
}

/** The other names that go with a term when it is deleted: the synonyms that point at it. */
export const goesWith = (all: Definition[], names: string[]) =>
  all.filter(
    (d) => d.sameAs && names.some((n) => same(d.sameAs!, n)) && !names.some((n) => same(d.name, n)),
  )

/**
 * What a list draws of each definition, worked out once for the whole list: its other names
 * ("Also called") and the live context about it. The glossary's own rules each look at every
 * definition, which costs nothing on a screen of one but grew with the square of the list on
 * Definitions: 5,000 rows took seconds a key. These give the same answers from an index.
 */
export function listIndex(all: Definition[], facts: Fact[]) {
  // Synonyms by what they point at, and by what they finally mean, each by its word.
  const pointing = new Map<string, Definition[]>()
  const ending = new Map<string, Definition[]>()
  const add = (map: Map<string, Definition[]>, word: string, d: Definition) =>
    map.set(word, [...(map.get(word) ?? []), d])
  for (const d of all) {
    if (!d.sameAs) continue
    add(pointing, wordOf(d.sameAs), d)
    add(ending, wordOf(meaningOf(all, d).name), d)
  }
  // The served items by each name they apply to, as a metric's context is found.
  const where = new Map<string, Fact[]>()
  for (const f of facts)
    if (servedToAgents(f))
      for (const w of new Set(f.where.map((n) => n.toLowerCase())))
        where.set(w, [...(where.get(w) ?? []), f])
  const about = new Map<string, Fact[]>()
  const conflicts = new Map<string, Conflict | undefined>()
  return {
    /** As `alsoCalled`: every synonym that ends at this definition. */
    alsoCalled: (d: Definition) =>
      (ending.get(wordOf(d.name)) ?? []).filter((x) => !same(x.name, d.name)),
    /** As `conflictOf`, with no term being edited: once for each definition of the list. */
    conflictOf(d: Definition): Conflict | undefined {
      if (d.type !== 'term') return undefined
      if (!conflicts.has(d.name)) conflicts.set(d.name, conflictOf(all, d))
      return conflicts.get(d.name)
    },
    /** As `contextAbout`: the live context about a metric or a term. */
    contextAbout(d: Definition): Fact[] {
      const known = about.get(d.name)
      if (known) return known
      const target = meaningOf(all, d)
      let found: Fact[]
      if (target.type === 'dimension') found = []
      else if (target.type === 'term') found = contextAbout(all, d, facts)
      else {
        const names = [
          target.name,
          ...target.sourceNames,
          ...(pointing.get(wordOf(target.name)) ?? []).map((s) => s.name),
          ...(target.family?.variants.map((v) => v.name) ?? []),
        ].map((n) => n.toLowerCase())
        const ids = new Set(names.flatMap((n) => where.get(n) ?? []))
        // In the order of the items, as the glossary's own rule gives them.
        found = ids.size ? facts.filter((f) => ids.has(f)) : []
      }
      about.set(d.name, found)
      return found
    },
  }
}

export type ListIndex = ReturnType<typeof listIndex>

/** The glossary's rules over one list of definitions, for a screen to call without passing it. */
export function glossary(all: Definition[]) {
  return {
    all,
    find: (name: string | undefined) => findDefinition(all, name),
    synonymsOf: (name: string) => synonymsOf(all, name),
    meaningOf: (d: Definition) => meaningOf(all, d),
    namesOf: (d: Definition) => namesOf(all, d),
    sameWord: same,
    conflictOf: (d: Definition, self?: string) => conflictOf(all, d, self),
    contextAbout: (d: Definition, facts: Fact[]) => contextAbout(all, d, facts),
    synonymIn: (question: string) => synonymIn(all, question),
    foldsInto: (d: Definition) => foldsInto(all, d),
    alsoCalled: (d: Definition) => alsoCalled(all, d),
    checkSynonym: (target: Definition, word: string) => checkSynonym(all, target, word),
    checkWord: (word: string, target?: Definition, self?: string) =>
      checkWord(all, word, target, self),
    lookAlikeOf: (word: string, self?: string, means?: string) =>
      lookAlikeOf(all, word, self, means),
    goesWith: (names: string[]) => goesWith(all, names),
  }
}

export type Glossary = ReturnType<typeof glossary>

/** The definitions as they stand, from the shared read. */
export const useDefinitions = (): Definition[] => useDefinitionList()

/** The glossary's rules over the definitions as they stand. */
export function useGlossary(): Glossary {
  const all = useDefinitions()
  return React.useMemo(() => glossary(all), [all])
}
