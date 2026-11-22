import type { FamilyMeaningVersion } from '@contract/catalogue'
import { REPOSITORY_URL } from '@domain/brand'
import { familyMeaning } from '@domain/family-meaning'
import { FAMILY_WORDS_MAX, type FamilyMeaningChoice } from '@domain/family-meaning-line'
import { termWord } from '@domain/terms'
import { DEMO_DEFINITIONS, demoTool } from './data/integrations'
import { dimensions, metrics } from './data/world'
import { term, TERMS } from './data/terms'
import { familyDefinitions, variantDefinitions } from './data/variants'
import { dbtFolderDefinitions } from './data/dbt-folder'
import { ApiError } from '@/api/errors'
import { today } from '@/lib/today'
import type { DomainId } from '@/model/items'
import { dateLabel } from '@/model/validity'
import {
  checkSynonym,
  checkWord,
  goesWith,
  meaningOf,
  type Definition,
  type SynonymCheck,
} from '@/lib/definitions'

// The mock's definitions, the data glossary: metrics and dimensions synced from the demo world's
// definitions tool, never changed here, and the terms and synonyms written here. Kept until the page reloads.

/** The demo model's files, one per view (db/seed/cube): a view without one links nowhere. */
const modelFiles = new Set([
  'basket',
  'customers',
  'marketing',
  'operations',
  'orders',
  'revenue',
  'segments',
])

/** A synced definition's id and model file, as the demo model's Cube read names them. */
function fromModel(group: string, name: string): Pick<Definition, 'ref' | 'fileUrl'> {
  // The demo's Payments group is the model's orders view (db/seed/cube/orders.yml).
  const view = group === 'Payments' ? 'orders' : group.toLowerCase()
  const member = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return {
    ref: `cube:${view}.${member}`,
    ...(modelFiles.has(view)
      ? { fileUrl: `${REPOSITORY_URL}/blob/main/db/seed/cube/${view}.yml` }
      : {}),
  }
}

const seed: Definition[] = [
  ...metrics.map<Definition>((m) => ({
    name: m.name,
    type: 'metric',
    definition: m.definition,
    synced: true,
    tool: demoTool(DEMO_DEFINITIONS),
    connector: DEMO_DEFINITIONS,
    ...fromModel(m.group, m.name),
    sourceNames: m.otherNames ?? [],
    domain: m.domain,
    group: m.group,
    changed: m.note === 'changed' ? '7 Oct' : undefined,
    updated: m.note === 'changed' ? '7 Oct 2026' : '22 Oct 2026',
  })),
  ...dimensions.map<Definition>((d) => ({
    name: d.name,
    type: 'dimension',
    definition: d.definition,
    synced: true,
    tool: demoTool(DEMO_DEFINITIONS),
    connector: DEMO_DEFINITIONS,
    ...fromModel('Segments', d.name),
    sourceNames: [],
    group: 'Segments',
    values: d.values,
    updated: '22 Oct 2026',
  })),
  ...TERMS,
]

const same = (a: string, b: string) => termWord(a) === termWord(b)
/** The definitions tool whose read finds the demo's families. */
const FAMILIES_DEFINITIONS = 'dbt-metricflow'

/** An owner's choice of what a family means, as the service keeps it, variants by name. */
type Chosen = FamilyMeaningVersion

/** A family with its meaning worked out as the catalogue does (M1), variants by name. */
function withMeaning(d: Definition, chosen: Chosen | undefined): Definition {
  const family = d.family
  if (!family) return d
  const meaning = familyMeaning({
    by: family.by,
    variants: family.variants.map((v) => ({
      key: v.name,
      values: v.values,
      description: v.description ?? null,
    })),
    conversions: family.conversions ?? [],
    declared: null,
    chosen: chosen ?? null,
  })
  return {
    ...d,
    family: {
      ...family,
      meaning: {
        source: meaning.source,
        words: meaning.words,
        ...(meaning.common ? { common: meaning.common } : {}),
        ...(meaning.base ? { base: meaning.base } : {}),
        ...(meaning.automatic ? { automatic: meaning.automatic } : {}),
        differing: meaning.differing,
        ...(chosen
          ? {
              chosen: {
                choice: chosen.choice,
                ...(chosen.words ? { words: chosen.words } : {}),
                by: chosen.personId,
                on: dateLabel(chosen.at.slice(0, 10)),
              },
            }
          : {}),
        revision: chosen?.revision ?? 0,
      },
    },
  }
}

export { seed as definitionSeed }

export function createDefinitions() {
  let all = seed
  /** Every choice of what a family means, by the family's name, newest last. */
  const meanings = new Map<string, Chosen[]>()

  return {
    list: () => all,

    /** Adds a metric per currency and channel, 5,000 of them, for Definitions at that size. */
    loadVariants() {
      if (!all.some((d) => d.name === 'Revenue (EUR) web'))
        all = [...all, ...variantDefinitions(demoTool(DEMO_DEFINITIONS))]
    },

    /** Adds what a dbt folder on the server holds, beside the demo's Cube model. */
    loadDbtFolder() {
      if (!all.some((d) => d.connector === 'dbt-metricflow'))
        all = [...all, ...dbtFolderDefinitions()]
    },

    /**
     * Adds the same 5,000 metrics as the 20 families a read of a dbt project finds in them (FR-142),
     * beside the demo's own: an install with two definitions tools, as the Names card says.
     */
    loadFamilies() {
      if (!all.some((d) => d.family))
        all = [
          ...all,
          ...familyDefinitions(demoTool(FAMILIES_DEFINITIONS)).map((d) =>
            withMeaning({ ...d, connector: FAMILIES_DEFINITIONS }, meanings.get(d.name)?.at(-1)),
          ),
        ]
    },

    /**
     * Chooses what a family means, as the service does: words written for the family, or worked
     * out from its variants again, against the meaning the person read.
     */
    setFamilyMeaning(
      input: {
        name: string
        choice: FamilyMeaningChoice
        words?: string
        revision: number
      },
      by: string,
    ) {
      const d = all.find((x) => x.family && same(x.name, input.name))
      if (!d?.family)
        throw new ApiError('not-found', `“${input.name}” isn't a family in Definitions any more.`)
      const words = input.choice === 'written' ? input.words?.trim() : undefined
      if (input.choice === 'written' && (!words || [...words].length > FAMILY_WORDS_MAX))
        throw new ApiError(
          'invalid',
          `Write the family's meaning in 1 to ${FAMILY_WORDS_MAX} characters.`,
        )
      const kept = meanings.get(d.name) ?? []
      if ((kept.at(-1)?.revision ?? 0) !== input.revision)
        throw new ApiError(
          'conflict',
          'Someone changed what this family means after you opened it. Look at it again, then try again.',
        )
      const chosen: Chosen = {
        revision: input.revision + 1,
        choice: input.choice,
        words: words ?? null,
        personId: by,
        at: `${today()}T09:00:00.000Z`,
      }
      meanings.set(d.name, [...kept, chosen])
      all = all.map((x) => (x === d ? withMeaning(x, chosen) : x))
    },

    /**
     * Picks the variant Ask reads when a question names none of the family's values, or none, as
     * the service does: against the pick the person read.
     */
    setFamilyUsual(input: { name: string; member: string | null; revision: number }, by: string) {
      const d = all.find((x) => x.family && same(x.name, input.name))
      if (!d?.family)
        throw new ApiError('not-found', `“${input.name}” isn't a family in Definitions any more.`)
      const member = input.member
        ? d.family.variants.find((v) => same(v.name, input.member!))
        : undefined
      if (input.member && !member)
        throw new ApiError('not-found', 'That variant is no longer in this family.')
      if ((d.family.usual?.revision ?? 0) !== input.revision)
        throw new ApiError(
          'conflict',
          "Someone changed this family's usual variant after you opened it. Look at it again, then try again.",
        )
      const usual = {
        ...(member ? { member: member.name } : {}),
        by,
        on: dateLabel(today()),
        revision: input.revision + 1,
      }
      all = all.map((x) => (x === d ? { ...x, family: { ...d.family!, usual } } : x))
    },

    /** Every choice of what a family means, newest first. */
    familyMeaningHistory: (name: string) =>
      [
        ...(meanings.get(all.find((x) => x.family && same(x.name, name))?.name ?? '') ?? []),
      ].reverse(),

    /** Saves a term; a renamed one replaces the old entry where it stood. Synced items are never saved here. */
    saveTerm(previous: string | undefined, next: Definition) {
      if (next.synced) return
      const index = previous ? all.findIndex((d) => d.name === previous) : -1
      // As the service: a word claims a meaning again only when it or what it means changes.
      const was = all[index]
      if (!was || !same(was.name, next.name) || was.sameAs !== next.sameAs) {
        const target = all.find((d) => next.sameAs && same(d.name, next.sameAs))
        const check = checkWord(all, next.name, target, previous)
        if (!check.ok) throw new ApiError('conflict', check.reason, { status: 409, refusal: true })
      }
      all = index === -1 ? [...all, next] : all.map((d, i) => (i === index ? next : d))
    },

    /**
     * Adds a synonym to a definition. An existing term with that word is pointed at it (no second
     * entry for the same word); otherwise a new term is written. It never edits the target.
     */
    addSynonym(
      targetName: string,
      word: string,
      by: string,
    ): { ok: true; created: boolean } | Exclude<SynonymCheck, { ok: true }> {
      const target = all.find((d) => same(d.name, targetName))
      if (!target) return { ok: false, why: 'empty', reason: 'Type a word.' }
      const check = checkSynonym(all, target, word)
      if (!check.ok) return check
      const point = target.sameAs ? meaningOf(all, target) : target
      all = [
        ...all,
        term(word.trim().replace(/\s+/g, ' '), {
          sameAs: point.name,
          domain: point.domain,
          by,
          updated: '23 Oct 2026',
        }),
      ]
      return { ok: true, created: true }
    },

    /** Removes a synonym: the term only existed to point here, so it goes. Gives back Undo. */
    removeTerm(name: string) {
      const was = all.find((d) => d.type === 'term' && same(d.name, name))
      all = all.filter((d) => d !== was)
      return () => {
        if (was && !all.some((d) => same(d.name, was.name))) all = [...all, was]
      }
    },

    /** Deletes terms, and the synonyms that only existed to point at them. Gives back Undo. */
    deleteTerms(names: string[]) {
      const before = all
      const gone = new Set(
        [...names, ...goesWith(all, names).map((d) => d.name)].map((n) => n.toLowerCase()),
      )
      all = all.filter((d) => d.synced || !gone.has(d.name.toLowerCase()))
      return () => {
        all = before
      }
    },

    /** Moves terms to another domain. Gives back Undo. */
    moveTerms(names: string[], domain: DomainId) {
      const before = all
      all = all.map((d) => (!d.synced && names.some((n) => same(d.name, n)) ? { ...d, domain } : d))
      return () => {
        all = before
      }
    },
  }
}

export type MockDefinitions = ReturnType<typeof createDefinitions>
