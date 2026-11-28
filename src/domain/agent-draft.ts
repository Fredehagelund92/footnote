import { question, type AgentQuestion } from './agent-questions.ts'
import type { Draft } from './draft.ts'
import { SUMMARY_MAX_LENGTH, type ItemKind } from './item.ts'
import {
  provenanceFlags,
  withoutInvisible,
  type FieldMark,
  type MarkedField,
  type ProvenanceFlag,
} from './provenance.ts'
import { termsInText } from './scope.ts'
import { datesInText } from './text-dates.ts'
import { shiftDate } from './validity.ts'
import { normalizeName, resolveTerm, suggestTerms, type Term } from './vocabulary.ts'

/*
  The deterministic part of an agent's draft (FR-121): no language model, only rules a person can
  read. The calling agent writes the words and may pass hints; this works out what can be worked
  out exactly, marks where every value came from, and lists the questions only the person can
  answer. It never invents a vocabulary key, an evidence link, a risk above the default, an
  audience, an owner or a link to another item.
*/

/**
 * The new drafts one person's agents may save in 24 hours, and keep waiting unsent, as installed
 * (`limits.agent_drafts`, which an admin changes): 50, the most one Publish takes.
 */
export const agentDraftsDefault = { perDay: 50, open: 50 } as const

/** What an agent passes for a draft, in the MCP tool's words (`write_draft`). */
export type AgentDraftInput = {
  text: string
  title?: string
  summary?: string
  kind?: ItemKind
  scope?: {
    metrics?: string[]
    dimension_filters?: { dimension: string; values: string[] }[]
  }
  window?: { from: string; to?: string }
  /** A link and a sentence copied from it, or, for a source with no link, who or what says so. */
  evidence?: AgentSource[]
  not_to_conclude?: string
  area?: string
}

/** One source an agent passes (FR-116). */
export type AgentSource = { url: string; quote: string } | { said_by: string }

/** A source as a draft keeps it: one with no link is its line, written today. */
const sourceOf = (entry: AgentSource, today: string) =>
  'said_by' in entry
    ? { url: null, quote: asWords(entry.said_by), date: today }
    : { url: entry.url.trim(), quote: asWords(entry.quote), date: today }

/** Why the draft's source is filled in, as its first source is. */
const sourceReason = (entries: readonly AgentSource[]) =>
  entries.every((entry) => 'said_by' in entry)
    ? 'Who or what says so, as the agent passed it. There is no link to check.'
    : 'The link and sentence the agent passed. Check that the sentence is there.'

export type DerivationContext = {
  terms: readonly Term[]
  /** The domain of a metric: the vocabulary's area, otherwise the source's domain (Cube). */
  areaOf: (metricKey: string) => string | null
  /** The active areas a draft may go to. */
  areas: readonly { id: string; name: string }[]
  /** The capture day: relative dates and missing years are read against it. */
  today: string
}

export type { AgentQuestion }

export type Derivation = {
  /** The draft before the service's defaults (owner, references, review date and so on). */
  draft: Draft
  marks: Partial<Record<MarkedField, FieldMark>>
  /** Why a value is what it is, in plain words, for the agent and the person. */
  reasons: Partial<Record<MarkedField, string>>
  /** At most four, the most important first. */
  questions: AgentQuestion[]
  /** Names the vocabulary does not know, with the nearest terms. */
  unresolved: { name: string; suggestions: string[] }[]
  /** Set when no single domain follows: the draft cannot be saved without one. */
  areaCandidates: string[] | null
  flags: ProvenanceFlag[]
}

/**
 * The kind a text's shape suggests, with the rule that chose it. The line between an event and
 * an issue is a judgement (requirements 4.4): the person confirms it.
 */
export function kindByRule(text: string): { kind: ItemKind; reason: string } {
  const first = text.split(/\n|(?<=[.!?])\s/)[0] ?? text
  const lower = first.toLowerCase()
  if (/\?\.?$/.test(first.trim()))
    return { kind: 'guide', reason: 'It reads as a question and what a good answer to it holds.' }
  if (/^(?:how to|how do|checklist|comparing|what to rule out|steps? to|before you)\b/.test(lower))
    return { kind: 'guide', reason: 'It reads as a way to investigate.' }
  const dated = /\b(?:on|from) (?:\d{1,2} [a-z]+|[a-z]+ \d{1,2}|\d{4}-\d{2}-\d{2})/.test(lower)
  // A data problem shows in the first sentence, or anywhere in words only a data problem uses.
  const all = text.toLowerCase()
  if (
    /\b(?:is|are|has been|have been|was|were) (?:down|delayed|missing|broken|late|stale|incomplete|unreliable|not tracked)\b/.test(
      lower,
    ) ||
    /\b(?:delays?|gaps? in|still|ongoing|until further notice|since)\b/.test(lower) ||
    (/\boutage\b/.test(lower) && !dated) ||
    /\b(?:counted (?:\w+ ){0,4}twice|double[- ]counted|not tracked|sen(?:d|ds|t) no|(?:is|are) missing until|arrive (?:\w+ ){0,3}late|dropped|drops some)\b/.test(
      all,
    )
  )
    return { kind: 'issue', reason: 'It reads as a data problem that lasts for a while.' }
  if (
    dated &&
    /\b(?:closed|opened|applied|switched|started|stopped|paused|took effect|launched|affected|introduced|ended|began|went live|moved)\b/.test(
      lower,
    )
  )
    return { kind: 'event', reason: 'It reads as something that happened on a day.' }
  return { kind: 'note', reason: 'No other kind fits its shape, so it is a lasting remark.' }
}

/** A mention-like sequence in an agent's words stays words: an agent never adds a mention. */
const asWords = (text: string) => withoutInvisible(text).replaceAll('@[', '@ [').trim()

/**
 * Why an agent's text cannot become a summary of whole sentences: no summary was given and the
 * first sentence alone is longer than a summary may be. The tool refuses it, so the agent writes
 * a summary, instead of saving words cut off part way. Null when the text splits cleanly.
 */
export function summaryCut(input: Pick<AgentDraftInput, 'text' | 'summary'>): string | null {
  if (input.summary !== undefined) return null
  if (!split(asWords(input.text)).cut) return null
  return `The first sentence of text is longer than a summary may be (${SUMMARY_MAX_LENGTH} characters), so it would be cut part way. Give summary: what happened, where and when, in at most ${SUMMARY_MAX_LENGTH} characters; text keeps the detail as the body.`
}

/**
 * The summary and the body from one text: whole sentences up to the summary's limit. `cut` when
 * not even the first sentence fits, so the summary is its first words.
 */
function split(text: string): { summary: string; body?: string; cut?: true } {
  if ([...text].length <= SUMMARY_MAX_LENGTH) return { summary: text }
  let summary = ''
  let end = 0
  for (const match of text.matchAll(/\S[\s\S]*?(?:(?<=[.!?])(?=\s)|$)/g)) {
    const next = summary ? `${summary} ${match[0]}` : match[0]
    if ([...next].length > SUMMARY_MAX_LENGTH) break
    summary = next
    end = match.index + match[0].length
  }
  if (!summary) {
    const words = [...text].slice(0, SUMMARY_MAX_LENGTH - 3).join('')
    summary = `${words.slice(0, Math.max(words.lastIndexOf(' '), 1)).trimEnd()}...`
    return { summary, body: text, cut: true }
  }
  const body = text.slice(end).trim()
  return body ? { summary, body } : { summary }
}

/** Works out a draft from an agent's input. Pure: the same input gives the same draft. */
export function deriveAgentDraft(input: AgentDraftInput, context: DerivationContext): Derivation {
  const marks: Derivation['marks'] = {}
  const reasons: Derivation['reasons'] = {}
  const questions: AgentQuestion[] = []
  const unresolved: Derivation['unresolved'] = []
  const draft: Draft = {}
  const text = asWords(input.text)

  // The words: the agent's, so the person checks them.
  const words = input.summary ? { summary: asWords(input.summary) } : split(text)
  const body = input.summary && text !== words.summary ? text : words.body
  draft.summary = words.summary
  marks.summary = 'prefilled'
  reasons.summary = 'Written by the agent. Check the wording, and that it does not claim a cause.'
  if (body) {
    draft.body = body
    marks.body = 'prefilled'
    reasons.body = 'Written by the agent from what the person said.'
  }
  if (input.title) draft.title = asWords(input.title)
  marks.title = 'prefilled'
  reasons.title = input.title
    ? 'Written by the agent.'
    : 'The first words of the summary. Shorten it if it reads badly.'

  // The kind: the agent's hint or the rule, for the person to confirm.
  const rule = kindByRule(input.title ? `${asWords(input.title)}\n${text}` : text)
  draft.kind = input.kind ?? rule.kind
  marks.kind = 'prefilled'
  reasons.kind = input.kind ? 'Suggested by the agent.' : rule.reason
  if (input.kind && input.kind !== rule.kind)
    questions.push(
      question('kind', `Is this ${article(input.kind)} or ${article(rule.kind)}? ${rule.reason}`, [
        input.kind,
        rule.kind,
      ]),
    )

  // Where it applies: names resolved against the vocabulary, never keys from memory.
  const metrics = new Set<string>()
  const values = new Map<string, Set<string>>()
  const anyValue = new Set<string>()
  const resolve = (name: string, kinds: Term['kind'][], parent?: string) =>
    resolveName(name, context.terms, kinds, parent, unresolved)
  for (const name of input.scope?.metrics ?? []) {
    const key = resolve(name, ['metric', 'metric_group'])
    if (key) metrics.add(key)
  }
  for (const filter of input.scope?.dimension_filters ?? []) {
    const dimension = resolve(filter.dimension, ['dimension'])
    if (!dimension) continue
    if (!filter.values.length) anyValue.add(dimension)
    for (const name of filter.values) {
      const value = resolve(name, ['dimension_value'], dimension)
      if (value) values.set(dimension, (values.get(dimension) ?? new Set()).add(value))
    }
  }
  // Names in the words count too; a dimension named without a value is never read as "any value".
  const named = termsInText(`${input.title ?? ''}\n${text}`, context.terms)
  for (const key of named.metrics) metrics.add(key)
  for (const [dimension, keys] of Object.entries(named.filters))
    for (const key of keys) values.set(dimension, (values.get(dimension) ?? new Set()).add(key))
  for (const dimension of anyValue) values.delete(dimension)
  draft.scope = {
    metrics: [...metrics].sort(),
    dimensions: [...anyValue].sort(),
    dimensionValues: [...values]
      .flatMap(([dimension, keys]) => [...keys].map((value) => ({ dimension, value })))
      .sort((a, b) => (a.value < b.value ? -1 : 1)),
  }
  marks.scope = 'prefilled'
  reasons.scope = 'Matched to the vocabulary from the names the agent passed and the words.'
  const ambiguous = named.ambiguous.map((issue) => issue.input)
  if (
    !draft.scope.metrics.length &&
    !draft.scope.dimensions.length &&
    !draft.scope.dimensionValues.length
  )
    questions.push(
      question(
        'scope',
        unresolved.length
          ? `Which metric or value is it about? Not in the vocabulary: ${unresolved.map((u) => u.name).join(', ')}.`
          : 'Which metric or value is it about?',
      ),
    )
  else if (ambiguous.length)
    questions.push(
      question(
        'scope',
        `Which term is meant by ${ambiguous.map((name) => `"${name}"`).join(', ')}?`,
        [...new Set(named.ambiguous.flatMap((issue) => issue.options))].slice(0, 10),
      ),
    )

  // The domain: the one area of every scoped metric. The agent's area counts only when the names
  // give no single domain, so it never moves an item off its metrics'.
  let areaCandidates: string[] | null = null
  const ofMetrics = areaOfMetrics(draft.scope.metrics, context)
  const chosen = input.area ? areaByName(input.area, context.areas) : undefined
  if (ofMetrics.id) {
    draft.areaId = ofMetrics.id
    marks.areaId = 'derived'
    reasons.areaId = 'Every metric it names belongs to this domain.'
  } else if (chosen) {
    draft.areaId = chosen.id
    marks.areaId = 'prefilled'
    reasons.areaId = 'Chosen by the person, as the agent says.'
  } else areaCandidates = ofMetrics.candidates
  if (areaCandidates)
    questions.unshift(
      question('area', 'Which domain is it about? Its owner reviews it.', areaCandidates),
    )

  // When it applies: the agent's dates, otherwise the dates the words name.
  if (input.window) {
    draft.validity = {
      start: input.window.from,
      end: input.window.to ? shiftDate(input.window.to, 1) : null,
    }
    marks.validity = 'prefilled'
    reasons.validity = input.window.to
      ? 'The dates the agent passed; the last day is included.'
      : 'The first day the agent passed, with no end.'
  } else {
    const dates = datesInText(`${input.title ?? ''}\n${text}`, context.today)
    if (dates) {
      draft.validity = { start: dates.start, end: dates.end ?? null }
      marks.validity = 'prefilled'
      reasons.validity = `${dates.end ? 'The range' : 'The first date'} the words name${dates.assumedYear ? `; the year is assumed from ${context.today}` : ''}.`
    } else questions.push(question('start', 'From which day does it apply?', [context.today]))
  }
  if (draft.kind === 'issue' && draft.validity && draft.validity.end === null)
    questions.push(
      question('end', 'Is it still going on, or what was the last day?', ['still going on']),
    )

  // Where it comes from: only links and sentences the agent read or the person gave.
  if (input.evidence?.length) {
    draft.evidence = input.evidence.map((entry) => sourceOf(entry, context.today))
    marks.evidence = 'prefilled'
    reasons.evidence = sourceReason(input.evidence)
  } else
    questions.push(
      question(
        'evidence',
        'Where does this come from? A link and one sentence from it, or who or what says so.',
      ),
    )

  // What not to conclude: the default unless the agent wrote one.
  if (input.not_to_conclude) {
    draft.notToConclude = asWords(input.not_to_conclude)
    marks.notToConclude = 'prefilled'
    reasons.notToConclude = 'Written by the agent.'
  } else {
    marks.notToConclude = 'default'
    reasons.notToConclude = 'The default: cause not proven.'
  }

  // The rest is the service's to fill (FR-105), or people's to decide.
  Object.assign(marks, {
    references: 'derived',
    changeMarks: 'derived',
    ownerId: 'derived',
    reviewDate: 'derived',
    claimLevel: 'default',
    riskLevel: 'default',
    audience: 'default',
    replaces: 'not_inferred',
    conflicts: 'not_inferred',
  } satisfies Derivation['marks'])
  Object.assign(reasons, {
    references: 'The definitions of the metrics and dimensions in its scope.',
    ownerId: "The domain's owner.",
    reviewDate: 'The default review date for its kind.',
    claimLevel:
      'The default: a context item, with no stated effect. Only an owner states an effect.',
    riskLevel: 'The default for its kind. Only an owner raises it.',
    audience: 'Everyone.',
    replaces: 'Left for people: only the items that overlap are listed.',
    conflicts: 'Left for people: only the items that overlap are listed.',
  } satisfies Derivation['reasons'])
  const flags = provenanceFlags(draft)
  return {
    draft,
    marks,
    reasons,
    questions: questions.slice(0, 4),
    unresolved,
    areaCandidates,
    flags,
  }
}

/**
 * What an agent passes to change fields of a draft (`write_draft` with a draft): only the fields to
 * change. `text` is the draft's text, the body; the summary changes only by `summary`.
 */
export type AgentPatchInput = Partial<Omit<AgentDraftInput, 'window'>> & {
  window?: { from: string; to?: string; uncertain?: boolean }
}

/** A change to some fields of a draft, worked out as a new draft's fields are. */
export type Patch = Pick<Derivation, 'draft' | 'marks' | 'reasons' | 'unresolved'> & {
  /** A domain named that is no active one. */
  unknownArea?: string
  /** A scope whose names matched nothing: it would leave the draft applying to nothing. */
  unmatchedScope?: true
}

/**
 * Works out the fields an agent changes in a draft, by the rules a new draft's fields follow: its
 * words cleaned, names matched to the vocabulary and never taken as keys, its dates read with the
 * last day included, and every value marked as the agent's. Only the fields given are in it. Pure.
 */
export function deriveAgentPatch(input: AgentPatchInput, context: DerivationContext): Patch {
  const draft: Draft = {}
  const marks: Patch['marks'] = {}
  const reasons: Patch['reasons'] = {}
  const unresolved: Patch['unresolved'] = []
  const set = <F extends MarkedField>(field: F, value: Draft[F & keyof Draft], reason: string) => {
    Object.assign(draft, { [field]: value })
    marks[field] = 'prefilled'
    reasons[field] = reason
  }
  if (input.title !== undefined) set('title', asWords(input.title), 'Written by the agent.')
  if (input.summary !== undefined)
    set(
      'summary',
      asWords(input.summary),
      'Written by the agent. Check the wording, and that it does not claim a cause.',
    )
  if (input.text !== undefined)
    set('body', asWords(input.text), 'Written by the agent from what the person said.')
  if (input.kind !== undefined) set('kind', input.kind, 'Suggested by the agent.')
  if (input.scope !== undefined) {
    const metrics = new Set<string>()
    const values = new Map<string, Set<string>>()
    const any = new Set<string>()
    for (const name of input.scope.metrics ?? []) {
      const key = resolveName(
        name,
        context.terms,
        ['metric', 'metric_group'],
        undefined,
        unresolved,
      )
      if (key) metrics.add(key)
    }
    for (const filter of input.scope.dimension_filters ?? []) {
      const dimension = resolveName(
        filter.dimension,
        context.terms,
        ['dimension'],
        undefined,
        unresolved,
      )
      if (!dimension) continue
      if (!filter.values.length) any.add(dimension)
      for (const name of filter.values) {
        const value = resolveName(name, context.terms, ['dimension_value'], dimension, unresolved)
        if (value) values.set(dimension, (values.get(dimension) ?? new Set()).add(value))
      }
    }
    set(
      'scope',
      {
        metrics: [...metrics].sort(),
        dimensions: [...any].sort(),
        dimensionValues: [...values]
          .flatMap(([dimension, keys]) => [...keys].map((value) => ({ dimension, value })))
          .sort((a, b) => (a.value < b.value ? -1 : 1)),
      },
      'Matched to the vocabulary from the names the agent passed.',
    )
  }
  let unknownArea: string | undefined
  if (input.area !== undefined) {
    const area = areaByName(input.area, context.areas)
    if (area) set('areaId', area.id, 'Chosen by the person, as the agent says.')
    else unknownArea = input.area
  }
  if (input.window !== undefined)
    set(
      'validity',
      { start: input.window.from, end: input.window.to ? shiftDate(input.window.to, 1) : null },
      input.window.to
        ? 'The dates the agent passed; the last day is included.'
        : 'The first day the agent passed, with no end.',
    )
  if (input.evidence !== undefined)
    set(
      'evidence',
      input.evidence.map((entry) => sourceOf(entry, context.today)),
      sourceReason(input.evidence),
    )
  if (input.not_to_conclude !== undefined)
    set('notToConclude', asWords(input.not_to_conclude), 'Written by the agent.')
  const scope = draft.scope
  const unmatchedScope =
    input.scope !== undefined &&
    unresolved.length > 0 &&
    !scope?.metrics.length &&
    !scope?.dimensions.length &&
    !scope?.dimensionValues.length
  return {
    draft,
    marks,
    reasons,
    unresolved,
    ...(unknownArea ? { unknownArea } : {}),
    ...(unmatchedScope ? { unmatchedScope: true as const } : {}),
  }
}

/**
 * A name matched to the vocabulary, as `write_draft` matches it: a key, a name or another name
 * of exactly one term. A name it cannot match goes on `unresolved` with the nearest terms.
 */
function resolveName(
  name: string,
  terms: readonly Term[],
  kinds: Term['kind'][],
  parent: string | undefined,
  unresolved: Derivation['unresolved'],
): string | null {
  const result = resolveTerm(name, terms, kinds, parent)
  if (result.status === 'resolved') return result.key
  unresolved.push({
    name,
    suggestions: suggestTerms(
      name,
      terms.filter(
        (term) => kinds.includes(term.kind) && (parent === undefined || term.parentKey === parent),
      ),
    ).slice(0, 5),
  })
  return null
}

/** A domain by its id or its name. */
const areaByName = (value: string, areas: DerivationContext['areas']) =>
  areas.find((area) => area.id === value || normalizeName(area.name) === normalizeName(value))

/** The one active domain every metric belongs to, or the domains to choose from. */
function areaOfMetrics(
  metrics: readonly string[],
  context: Pick<DerivationContext, 'areaOf' | 'areas'>,
): { id: string | null; candidates: string[] } {
  const areas = metrics.map((key) => context.areaOf(key))
  const distinct = [...new Set(areas.filter((area): area is string => area !== null))]
  const active = distinct.filter((area) => context.areas.some((a) => a.id === area))
  if (areas.length && !areas.includes(null) && active.length === 1 && distinct.length === 1)
    return { id: active[0]!, candidates: [] }
  return { id: null, candidates: active.length ? active : context.areas.map((area) => area.id) }
}

/** A draft whose domain, owner and scope may name things instead of giving their keys. */
export type NamedDraft = Omit<Draft, 'areaId' | 'ownerId' | 'scope'> & {
  areaId?: string
  ownerId?: string
  scope?: {
    metrics: string[]
    dimensions?: string[]
    dimensionValues: { dimension: string; value: string }[]
  }
}

const article = (kind: ItemKind) => `${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind}`
