/**
 * The names a read makes (FR-141): each member of a definition source that no live term names,
 * as the term it would be, sorted into what an owner publishes with one press and what they must
 * look at first. One word has one meaning across the workspace (FR-138), so a name that would give
 * a word a second meaning is flagged, never picked: it stays out of Publish all, with the name
 * `termCandidates` offers for it, until an owner publishes or changes it. A date or an id stays out
 * by itself, since an item's dates and its scope cover those, and so does a member an owner left
 * out; while the card is open, either can still be published one by one. Dates and ids alone never
 * raise the card.
 *
 * Pure: the service and the mock binding make the same names from the same members.
 */
import { agreedDomain } from './catalogue.ts'
import { axisWords, familiesOf, type Family } from './metric-families.ts'
import {
  keyPart,
  memberName,
  termCandidates,
  type CandidateMember,
  type KnownTerm,
  type TermCandidate,
} from './term-candidates.ts'
import {
  TERM_NAME_MAX,
  termName,
  termNamePattern,
  termWord,
  wordRefusal,
  type WordHolder,
} from './terms.ts'

/** Why a name needs an owner's eyes before it goes live. */
export const nameFlagCodes = [
  'taken',
  'same_name',
  'titles_differ',
  'bad_name',
  'variants',
] as const
export type NameFlagCode = (typeof nameFlagCodes)[number]
export type NameFlag = { code: NameFlagCode; message: string }

/** `ready` goes with Publish all, `flagged` waits for a look, `left_out` is only there to add. */
export const nameStates = ['ready', 'flagged', 'left_out'] as const
export type NameState = (typeof nameStates)[number]

export type SourceName = Omit<TermCandidate, 'kind'> & {
  /** A metric, a dimension, or a family of metrics (`metric_group`, FR-142). */
  kind: TermCandidate['kind'] | 'metric_group'
  state: NameState
  flags: NameFlag[]
  /** Whether an owner left it out, rather than it being a date or an id. */
  leftByOwner: boolean
  /** The family a variant goes live in, by key; absent for any other name. */
  parentKey?: string
  /**
   * A family's variants, each a name of its own that goes live with it, and what tells them
   * apart, in words ("Currency", "Channel"). The card shows the family, never its variants.
   */
  family?: { by: string[]; variants: SourceName[] }
}

/** What has each word now, by its compared form: terms, synonyms and live vocabulary. */
export type WordHolders = ReadonlyMap<string, readonly WordHolder[]>

const quoted = (names: readonly string[]) => names.map((name) => `“${name}”`).join(' and ')

/** The name a candidate's members give it, before `termCandidates` told it from another. */
function plainName(candidate: TermCandidate, members: ReadonlyMap<string, CandidateMember>) {
  const member = candidate.definitionRefs.flatMap((ref) => members.get(ref) ?? [])[0]
  return member ? memberName(member) : candidate.name
}

/**
 * Who gives a word another meaning: a term people wrote, or a live name of another metric or
 * dimension. What a source calls a live term is left out: nobody reads a word by it, so an owner
 * who renamed one of two "Revenue"s can give the word to the other.
 */
const othersOf = (key: string, word: string, holders: WordHolders) =>
  (holders.get(word) ?? []).filter(
    (holder) => holder.origin === 'term' || (holder.origin === 'vocabulary' && holder.ref !== key),
  )

/**
 * The names the members make, given the live terms, what holds each word and the members owners
 * left out. A dimension's other names that another meaning has already are dropped, as `termCandidates`
 * drops them between members (CON-201): an owner adds one by hand to the term it belongs to.
 * Metrics first, then dimensions, each by name.
 */
export function sourceNames(
  members: readonly CandidateMember[],
  known: readonly KnownTerm[],
  holders: WordHolders,
  leftOut: ReadonlySet<string>,
): SourceName[] {
  const byRef = new Map(members.map((member) => [member.ref, member]))
  const live = new Map(known.map((term) => [term.key, term]))
  const base = termCandidates(members, known)
  const adds = (candidate: TermCandidate) =>
    candidate.definitionRefs.filter((ref) => !candidate.linked.includes(ref))
  const leftByOwner = (candidate: TermCandidate) => adds(candidate).every((ref) => leftOut.has(ref))
  // The names that claim words: those on offer, and a live name gaining a view.
  const claiming = base.filter(
    (candidate) => candidate.suggested && (candidate.linked.length || !leftByOwner(candidate)),
  )
  const claimedBy = new Map<string, Set<TermCandidate>>()
  for (const candidate of claiming) {
    const words = [
      ...(candidate.linked.length ? [] : [plainName(candidate, byRef)]),
      candidate.name,
      ...candidate.aliases,
    ].map(termWord)
    for (const word of words) claimedBy.set(word, (claimedBy.get(word) ?? new Set()).add(candidate))
  }
  // An other name goes to one meaning only: one that a term people wrote, a live name or another
  // name on offer has too goes to neither (CON-201). A live term keeps the ones it has.
  const candidates = base.map((candidate) => {
    const kept = new Set((live.get(candidate.key)?.aliases ?? []).map(termWord))
    return {
      ...candidate,
      aliases: candidate.aliases.filter((alias) => {
        const word = termWord(alias)
        if (kept.has(word)) return true
        const claimants = claimedBy.get(word)
        return (
          !othersOf(candidate.key, word, holders).length &&
          !(claimants && [...claimants].some((other) => other.key !== candidate.key))
        )
      }),
    }
  })
  const offered = new Set(
    candidates.filter(
      (candidate) => candidate.suggested && !leftByOwner(candidate) && !candidate.linked.length,
    ),
  )
  // Which of the names on offer read as one word, across kinds: "Orders", a metric and a dimension.
  const sharing = new Map<string, TermCandidate[]>()
  for (const candidate of offered) {
    const words = new Set(
      [plainName(candidate, byRef), candidate.name, ...candidate.aliases].map(termWord),
    )
    for (const word of words) sharing.set(word, [...(sharing.get(word) ?? []), candidate])
  }
  const flagsOf = (candidate: TermCandidate): NameFlag[] => {
    if (candidate.linked.length) {
      if (!candidate.suggested) return []
      const views = [
        ...new Set(
          adds(candidate).flatMap((ref) => {
            const member = byRef.get(ref)
            return member?.title && termWord(memberName(member)) !== termWord(candidate.name)
              ? [memberName(member)]
              : []
          }),
        ),
      ]
      return views.length
        ? [
            {
              code: 'titles_differ',
              message: `Its new views call it ${quoted(views)}, not “${candidate.name}”. It keeps the name it has.`,
            },
          ]
        : []
    }
    if (!offered.has(candidate)) return []
    const plain = plainName(candidate, byRef)
    const flags: NameFlag[] = []
    const shape = nameShapeRefusal(candidate.name)
    if (shape) flags.push({ code: 'bad_name', message: shape })
    const held = wordRefusal(plain, othersOf(candidate.key, termWord(plain), holders), null)
    if (held) flags.push({ code: 'taken', message: held.message })
    const others = (sharing.get(termWord(plain)) ?? []).filter((other) => other !== candidate)
    if (others.length)
      flags.push({
        code: 'same_name',
        message: `${others.length === 1 ? 'Another definition is' : `${others.length} others are`} called “${plain}”: ${others
          .map((other) => byRef.get(other.definitionRefs[0]!)?.name ?? other.key)
          .join(', ')}.`,
      })
    const titles = [
      ...new Set(
        candidate.definitionRefs.flatMap((ref) => {
          const member = byRef.get(ref)
          return member?.title ? [memberName(member)] : []
        }),
      ),
    ]
    if (titles.length > 1)
      flags.push({
        code: 'titles_differ',
        message: `Its views call it ${quoted(titles)}. Choose the one people say.`,
      })
    return flags
  }
  const names = candidates.map((candidate): SourceName => {
    const flags = flagsOf(candidate)
    return {
      ...candidate,
      state:
        candidate.linked.length || offered.has(candidate)
          ? flags.length
            ? 'flagged'
            : 'ready'
          : 'left_out',
      flags,
      leftByOwner: leftByOwner(candidate) && candidate.suggested,
    }
  })
  return withFamilies(names, members, known, holders, leftOut)
}

/**
 * The names with each family of variants (FR-142) as one name that holds them: the family a
 * metric group, its variants metrics in it. A family the vocabulary has already gains the
 * variants a later read found. Its variants' own names go live with it and are never shown
 * apart, so a flag on one of them is a flag on the family.
 */
function withFamilies(
  names: readonly SourceName[],
  members: readonly CandidateMember[],
  known: readonly KnownTerm[],
  holders: WordHolders,
  leftOut: ReadonlySet<string>,
): SourceName[] {
  const families = familiesOf(
    members.flatMap((member) =>
      member.kind === 'metric'
        ? [{ ...member, said: memberName(member), variant: member.variant ?? null }]
        : [],
    ),
  )
  if (!families.length) return [...names]
  const byRef = new Map(
    names.flatMap((name) =>
      name.kind === 'metric' && !name.linked.length && name.definitionRefs.length === 1
        ? [[name.definitionRefs[0]!, name] as const]
        : [],
    ),
  )
  const live = known.filter((term) => !term.open)
  const liveGroups = live.filter((term) => term.kind === 'metric_group')
  const keys = new Set([...known.map((term) => term.key), ...names.map((name) => name.key)])
  const dimensionName = (ref: string) =>
    [...names, ...live].find(
      (term) => term.kind === 'dimension' && term.definitionRefs.includes(ref),
    )?.name
  const folded = new Set<SourceName>()
  const made: SourceName[] = []
  for (const family of families) {
    const variants = family.variants.flatMap(({ ref }) => byRef.get(ref) ?? [])
    const group = liveGroups.find((term) =>
      family.variants.some(({ ref }) => term.definitionRefs.includes(ref)),
    )
    if (!variants.length || (!group && variants.length < family.min)) continue
    const key = group?.key ?? freeKey(family, keys)
    keys.add(key)
    for (const variant of variants) folded.add(variant)
    made.push(
      familyName(family, key, group ?? null, variants, holders, names, leftOut, (axis) =>
        axis.ref ? (dimensionName(axis.ref) ?? axisWords(axis)) : axisWords(axis),
      ),
    )
  }
  return [...names.filter((name) => !folded.has(name)), ...made].sort(
    (a, b) =>
      Number(a.kind === 'dimension') - Number(b.kind === 'dimension') ||
      a.name.localeCompare(b.name, 'en'),
  )
}

/** A family's key: from its name, else with its view's in front, else numbered. */
function freeKey(family: Family, keys: ReadonlySet<string>): string {
  const part = family.key.slice('group:'.length)
  const view = keyPart(family.variants[0]!.ref.split(':').at(-1)!.split('.')[0] ?? '')
  const tries = [
    part,
    `${view}_${part}`,
    ...Array.from({ length: 98 }, (_, i) => `${part}_${i + 2}`),
  ]
  return `group:${tries.find((key) => !keys.has(`group:${key}`)) ?? `${part}_${keys.size}`}`
}

const variantProblems: Record<Exclude<NameFlagCode, 'variants'>, string> = {
  taken: 'names already in use',
  same_name: 'names other definitions share',
  titles_differ: 'titles that differ',
  bad_name: 'names that cannot be used',
}

/** What is wrong with a family's variants, counted and in kind, never naming one. */
function variantsFlagMessage(looking: readonly SourceName[]): string {
  const kinds = [
    ...new Set(looking.flatMap((variant) => variant.flags.map((flag) => flag.code))),
  ].flatMap((code) => (code === 'variants' ? [] : [variantProblems[code]]))
  return `${looking.length === 1 ? 'One of its variants has' : `${looking.length} of its variants have`} ${kinds.join(' and ')}. Leave the family out, or fix them in the tool.`
}

/** Why a family can't go live when a variant's name can't be published; never names the variant. */
export const variantNameRefusal = (family: string) =>
  `A variant of “${family}” has a name that can't be published as it stands, so the family can't go live. Leave it out, or fix its variants in the tool.`

/** The name a family of variants makes: itself, flagged as any name is, and its variants. */
function familyName(
  family: Family,
  key: string,
  group: KnownTerm | null,
  variants: readonly SourceName[],
  holders: WordHolders,
  names: readonly SourceName[],
  leftOut: ReadonlySet<string>,
  axisName: (axis: Family['by'][number]) => string,
): SourceName {
  const refs = variants.flatMap((variant) => variant.definitionRefs)
  const name = group?.name ?? family.name
  const flags: NameFlag[] = []
  if (!group) {
    const shape = nameShapeRefusal(name)
    if (shape) flags.push({ code: 'bad_name', message: shape })
    const held = wordRefusal(name, othersOf(key, termWord(name), holders), null)
    if (held) flags.push({ code: 'taken', message: held.message })
    const same = names.filter(
      (other) => other.state !== 'left_out' && termWord(other.name) === termWord(name),
    )
    if (same.length)
      flags.push({
        code: 'same_name',
        message: `${same.length === 1 ? 'Another definition is' : `${same.length} others are`} called “${name}”: ${same.map((other) => other.name).join(', ')}.`,
      })
  }
  const looking = variants.filter((variant) => variant.flags.length)
  if (looking.length) flags.push({ code: 'variants', message: variantsFlagMessage(looking) })
  const left = refs.every((ref) => leftOut.has(ref))
  return {
    source: family.source,
    key,
    kind: 'metric_group',
    name,
    aliases: group?.aliases ?? [],
    definitionRefs: [...new Set([...(group?.definitionRefs ?? []), ...refs])].sort(),
    linked: group ? [...group.definitionRefs] : [],
    areaId: group?.areaId ?? agreedDomain(variants.map((variant) => variant.areaId)),
    views: [...new Set(variants.flatMap((variant) => variant.views))],
    description: null,
    valueType: null,
    suggested: true,
    state: left ? 'left_out' : flags.length ? 'flagged' : 'ready',
    flags,
    leftByOwner: left,
    family: {
      by: family.by.map(axisName),
      variants: variants.map((variant) => ({ ...variant, parentKey: key })),
    },
  }
}

/**
 * The flagged names an owner can publish as suggested at one press: those that wait only because
 * another definition has the same name, as one dimension a project keeps in many semantic models
 * does, each with the name `termCandidates` told it apart by. A name whose word another meaning
 * holds, or that is no name, still needs a look, and so do two that would share a word.
 */
export function asSuggested<
  T extends Pick<SourceName, 'state' | 'flags' | 'linked' | 'name' | 'aliases'>,
>(names: readonly T[]): T[] {
  const sameNameOnly = names.filter(
    (name) =>
      name.state === 'flagged' &&
      !name.linked.length &&
      name.flags.some((flag) => flag.code === 'same_name') &&
      name.flags.every((flag) => flag.code === 'same_name' || flag.code === 'titles_differ'),
  )
  const wordsOf = (name: T) => new Set([name.name, ...name.aliases].map(termWord))
  const uses = new Map<string, number>()
  for (const name of sameNameOnly)
    for (const word of wordsOf(name)) uses.set(word, (uses.get(word) ?? 0) + 1)
  return sameNameOnly.filter((name) => [...wordsOf(name)].every((word) => uses.get(word) === 1))
}

/** What is wrong with the shape of a name, whatever else holds its word; null when it is fine. */
function nameShapeRefusal(name: string): string | null {
  const said = termName(name)
  if (!termWord(said)) return 'Give it a name.'
  if (said.length > TERM_NAME_MAX) return `A name can be ${TERM_NAME_MAX} characters at most.`
  if (!termNamePattern.test(said)) return 'A name holds no comma or line break.'
  return null
}

/** Why a name can't be published as it stands, in one sentence; null when it can. */
export function nameRefusal(
  key: string,
  name: string,
  holders: WordHolders,
  chosen: ReadonlyMap<string, readonly string[]>,
): string | null {
  const shape = nameShapeRefusal(name)
  if (shape) return shape
  const said = termName(name)
  const word = termWord(said)
  const held = wordRefusal(said, othersOf(key, word, holders), null)
  if (held) return held.message
  const mine = new Set((chosen.get(key) ?? [said]).map(termWord))
  for (const [other, otherWords] of chosen)
    if (other !== key) {
      const shared = otherWords.find((w) => mine.has(termWord(w)))
      if (shared !== undefined)
        return `You gave two definitions the word “${shared}”. One word has one meaning.`
    }
  return null
}

/** The compared forms of the names a list of terms goes by. */
export function wordsOf(terms: readonly Pick<TermCandidate, 'name' | 'aliases'>[]): string[] {
  return [...new Set(terms.flatMap((term) => [term.name, ...term.aliases]).map(termWord))]
}
