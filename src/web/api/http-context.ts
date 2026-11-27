/**
 * The http binding's reading of Context: a context item's page and a draft into the item the
 * screens draw, the service's history into versions, its log of changes to many items into the
 * History log, and the editor's item back into the draft the service publishes. The text's
 * mentions are written both ways: the app's own token, [@ id="context:itm_..." label="..."], and
 * the service's markup, @[words](item:itm_...). Related is the service's related context as
 * links. Pure, so the rules are tested without a service.
 */
import type {
  ItemChange,
  ItemPage as ServiceItemPage,
  ItemVersionEntry,
  RelatedContext,
} from '@contract/context'
import type { ProposalRecord } from '@contract/proposals'
import type { TermVersion } from '@contract/terms'
import type { Draft } from '@domain/draft'
import type { MarkedField } from '@domain/provenance'
import type { Scope, Vocabulary as ServiceVocabulary } from '@domain/item'
import { defaultNotToConclude, ownCaveat } from '@domain/proposal-rules'
import { parseMentions, serializeMentions, type MentionPart } from '@domain/mentions'
import { anyDate, shiftDate } from '@domain/validity'
import { metricKeyOf } from '@domain/vocabulary'
import type { Link, LinkEnd, Rel } from '@/lib/links'
import { mentionParts, mentionToken, parseMentionId } from '@/lib/mentions'
import type { DraftSession, FieldBy, SessionField } from '@/model/draft-session'
import type { Version, VersionKind } from '@/model/history'
import type { Fact, LogEntry, ScopeTerm } from '@/model/items'
import { dateLabel, whenLabel } from '@/model/validity'
import type { ItemPage } from './client'
import { dueWords, ownersOf, statusOf, validityOf, type Names } from './http-map'

/* ---------- the words a scope and a mention name ---------- */

/** The live vocabulary both ways: a metric, a dimension or a value by its key and by its name. */
export type Words = {
  /**
   * A scope's key for a name people read: `metric:orders`, `dim:market`, `val:market/norway`. With
   * a dimension's name, only a value of that dimension.
   */
  keyOf: (
    name: string,
    dimension?: string,
  ) => { kind: 'metric' | 'dim' | 'val'; key: string } | undefined
  /** The name people read for a key, or the key's own id when the vocabulary has no name. */
  nameOf: (key: string) => string
  /** The metrics a family that was split back into them reaches agents through, by key. */
  formerOf?: (key: string) => string[] | undefined
  /** A term written in Definitions by its id, as the app names it (by its word), if it is there. */
  termName: (id: string) => string | undefined
  /** A term's id by its word, any case. */
  termId: (name: string) => string | undefined
}

/** A term written in Definitions, as Words reads it: its id and its word. */
export type WrittenWord = { id: string; name: string }

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export function wordsOf(
  vocabulary: ServiceVocabulary,
  terms: readonly WrittenWord[] = [],
  splits: readonly { key: string; metrics: readonly { key: string }[] }[] = [],
): Words {
  const names = new Map<string, string>()
  for (const m of vocabulary.metrics) names.set(`metric:${m.id}`, m.name)
  for (const f of vocabulary.families) names.set(f.key, f.name)
  for (const d of vocabulary.dimensions) {
    names.set(`dim:${d.id}`, d.name)
    for (const v of d.values) names.set(`val:${d.id}/${v.id}`, v.name)
  }
  return {
    keyOf(name, within) {
      if (within !== undefined) {
        const d = vocabulary.dimensions.find((x) => same(x.name, within))
        const value = d?.values.find((v) => same(v.name, name))
        return d && value ? { kind: 'val', key: `val:${d.id}/${value.id}` } : undefined
      }
      // A family by its name: an item about it applies to every variant (FR-142).
      const family = vocabulary.families.find((f) => same(f.name, name))
      if (family) return { kind: 'metric', key: family.key }
      const metric = vocabulary.metrics.find((m) => same(m.name, name))
      if (metric) return { kind: 'metric', key: `metric:${metric.id}` }
      const dimension = vocabulary.dimensions.find((d) => same(d.name, name))
      if (dimension) return { kind: 'dim', key: `dim:${dimension.id}` }
      for (const d of vocabulary.dimensions) {
        const value = d.values.find((v) => same(v.name, name))
        if (value) return { kind: 'val', key: `val:${d.id}/${value.id}` }
      }
      return undefined
    },
    formerOf: (key) => splits.find((s) => s.key === key)?.metrics.map((m) => m.key),
    nameOf: (key) => names.get(key) ?? key.split(/[:/]/).at(-1)!,
    termName: (id) => terms.find((t) => t.id === id)?.name,
    termId: (name) => terms.find((t) => same(t.name, name))?.id,
  }
}

/* ---------- mentions ---------- */

/**
 * A service's target as the app's mention id, by the kind and the key the app names it with (a
 * metric by its name, an item by its id): `item:itm_x` is `context:itm_x`, `metric:orders` is
 * `metric:Orders`, a value by its key, so values of two dimensions never mix
 * (`val:market/norway` is `value:market/norway`), and a term written in Definitions `term:<id>` is
 * `term:<its word>`. Empty for a target the app has no mention of, such as a term no longer there.
 */
export function mentionIdOf(target: string, words: Words): string {
  const kind = target.slice(0, target.indexOf(':'))
  const key = target.slice(target.indexOf(':') + 1)
  if (kind === 'item') return `context:${key}`
  if (kind === 'metric') return `metric:${words.nameOf(target)}`
  if (kind === 'dim') return `dimension:${words.nameOf(target)}`
  if (kind === 'val') return `value:${key}`
  if (kind === 'area') return `domain:${key}`
  if (kind === 'term') {
    const name = words.termName(key)
    return name ? `term:${name}` : ''
  }
  return ''
}

/** The service's markup as the app's text: each mention as the app's token. */
export function textFromService(markup: string, words: Words): string {
  return parseMentions(markup)
    .parts.map((part) => {
      if (part.kind === 'text') return part.text
      const id = mentionIdOf(part.target, words)
      return id ? mentionToken({ id, label: part.label }) : part.label
    })
    .join('')
}

/**
 * A mention as the service can keep it, or null: a person, or a word no longer there, is kept as
 * its words. A value is kept by its key; a market named by its word is found among the markets
 * only.
 */
function targetOf(id: string, words: Words): string | null {
  const { kind, key } = parseMentionId(id)
  if (kind === 'context') return /^itm_[a-z0-9]{8,16}$/.test(key) ? `item:${key}` : null
  if (kind === 'domain') return `area:${key}`
  if (kind === 'value') return /^[a-z0-9_]+\/[a-z0-9_]+$/.test(key) ? `val:${key}` : null
  if (kind === 'term') {
    const id = words.termId(key)
    return id ? `term:${id}` : null
  }
  if (kind === 'metric' || kind === 'dimension' || kind === 'market') {
    const found = words.keyOf(key)
    if (!found) return null
    if (kind === 'metric' && found.kind !== 'metric') return null
    if (kind === 'market' && !found.key.startsWith('val:market/')) return null
    return found.key
  }
  return null
}

/**
 * The app's text as the service keeps it: the words agents read, and the markup with each mention
 * the service can follow, written only when there is one.
 */
export function textToService(text: string, words: Words): { plain: string; markup?: string } {
  const parts: MentionPart[] = mentionParts(text).map((part) => {
    if (typeof part === 'string') return { kind: 'text', text: part }
    const target = targetOf(part.id, words)
    return target
      ? { kind: 'mention', target, label: part.label }
      : { kind: 'text', text: part.label }
  })
  const plain = parts.map((p) => (p.kind === 'text' ? p.text : p.label)).join('')
  return parts.some((p) => p.kind === 'mention')
    ? { plain, markup: serializeMentions(parts) }
    : { plain }
}

/* ---------- what an item applies to ---------- */

const NO_SCOPE: Scope = { metrics: [], dimensions: [], dimensionValues: [] }

/**
 * A scope as "Applies to" holds it: each term by its key, with the name people read. A value the
 * writer added (`added`, a draft's `newValues`) is named as they wrote it.
 */
export function scopeTermsOf(
  scope: Scope,
  words: Words,
  added: readonly { key: string; name: string }[] = [],
): ScopeTerm[] {
  const addedName = new Map(added.map((value) => [value.key, value.name]))
  return [
    ...scope.metrics
      .flatMap((key) => words.formerOf?.(key) ?? [key])
      .map((key) => ({ key, kind: 'metric' as const, name: words.nameOf(key) })),
    ...scope.dimensions.map((key) => ({
      key,
      kind: 'dimension' as const,
      name: words.nameOf(key),
    })),
    ...scope.dimensionValues.map(({ dimension, value }) => {
      const name = addedName.get(value)
      return {
        key: value,
        kind: 'value' as const,
        name: name ?? words.nameOf(value),
        dimension: words.nameOf(dimension),
        ...(name !== undefined ? { added: true as const } : {}),
      }
    }),
  ]
}

/**
 * A published item's scope by key. An item keeps its terms by their ids (`orders`, `market` and
 * `norway`); a draft and "Applies to" name them by key (`metric:orders`, `val:market/norway`).
 */
export const keyedScope = (scope: Scope): Scope => ({
  metrics: scope.metrics.map(metricKeyOf),
  dimensions: scope.dimensions.map((id) => `dim:${id}`),
  dimensionValues: scope.dimensionValues.map(({ dimension, value }) => ({
    dimension: `dim:${dimension}`,
    value: `val:${dimension}/${value}`,
  })),
})

/**
 * "Applies to" as the service keeps a scope: each term by its key, never by its name, so two
 * values with the same name in two dimensions stay apart. A term the editor only knows by name
 * (an item whose scope was not read) is found by it.
 */
export function scopeOfTerms(terms: readonly ScopeTerm[], words: Words): Scope {
  const keys = terms.flatMap((t) => t.key || (words.keyOf(t.name, t.dimension)?.key ?? []))
  return {
    metrics: keys.filter((k) => k.startsWith('metric:') || k.startsWith('group:')),
    dimensions: keys.filter((k) => k.startsWith('dim:')),
    dimensionValues: keys
      .filter((k) => k.startsWith('val:'))
      .map((k) => ({ dimension: `dim:${k.slice(4, k.indexOf('/'))}`, value: k })),
  }
}

/* ---------- related ---------- */

/** How a neighbour relates, in Related's words; scope and domain membership are not links there. */
const relOf: Partial<Record<string, Rel>> = {
  replaces: 'replaces',
  replaced_by: 'replaced_by',
  conflicts_with: 'disagrees',
  mentions: 'mentions',
  mentioned_by: 'mentioned_by',
}

/** A neighbour's node as the app names it: an item by its id, a definition by its name. */
const targetOfNode = (node: RelatedContext['nodes'][number]): string =>
  node.type === 'item' ? `item:${node.id}` : node.type === 'area' ? `area:${node.id}` : node.id

/**
 * The service's related context as Related draws it: the links in the text both ways and the
 * owners' relations, in the service's order (the one agents follow). What an item applies to is
 * its scope, shown on the item, so it is no link here. Anything but a neighbour in service is
 * retired: shown, never followed.
 */
export function linksOfRelated(related: RelatedContext, words: Words): Link[] {
  return related.nodes.flatMap((node) => {
    const rel = relOf[node.relation]
    const id = mentionIdOf(targetOfNode(node), words)
    if (!rel || !id) return []
    const { kind } = parseMentionId(id)
    // A domain is its own.
    const domain = node.type === 'area' ? node.id : node.areaId
    const to: LinkEnd = {
      id,
      kind,
      label: node.label,
      retired: node.status !== 'current',
      ...(domain ? { domain } : {}),
    }
    return [{ rel, to }]
  })
}

/* ---------- the service's day ---------- */

/**
 * The day a time falls on in the service's calendar. The service may keep a day of its own (a
 * demo pins it): a time it stamped is that many days from the clock's day.
 */
export const serviceDay = (at: string, shift: number) => shiftDate(at.slice(0, 10), shift)

/** How many days the service's today is from the clock's day, as an index read it. */
export function dayShiftOf(index: { today: string; loadedAt: string }): number {
  return Math.round(
    (Date.parse(index.today) - Date.parse(index.loadedAt.slice(0, 10))) / 86_400_000,
  )
}

/* ---------- a context item ---------- */

/** The text of an item or a draft as the app writes it: the markup when there is one. */
const text = (plain: string | undefined, markup: string | undefined, words: Words) =>
  markup !== undefined ? textFromService(markup, words) : (plain ?? '')

/** A published item as its page reads it: its text, where it comes from and what not to conclude. */
export function factOfPage(page: ServiceItemPage, names: Names, words: Words): Fact {
  const item = page.item
  const kind = item.kind
  const valid = validityOf(item)
  const evidence = item.evidence[0]
  const body = text(item.body, item.bodyMarkup, words)
  const owners = ownersOf(
    { owners: page.owners, ownerId: item.ownerId, areaId: item.areaId },
    names,
  )
  return {
    id: item.id,
    version: item.version,
    title: item.title,
    summary: text(item.summary, item.summaryMarkup, words),
    ...(body ? { body } : {}),
    domain: item.areaId,
    kind,
    where: page.chips,
    scope: scopeTermsOf(keyedScope(item.scope), words),
    valid,
    when: whenLabel(valid),
    status: statusOf({ status: item.status, trust: page.trust }),
    ...dueWords({ check: page.check, reviewDate: item.reviewDate }),
    checkedBy: page.lastChecked ? names.person(page.lastChecked.personId) : '',
    checkedOn: page.lastChecked ? dateLabel(page.lastChecked.on) : '',
    source: evidence?.url ?? '',
    quote: evidence?.quote ?? '',
    // The writer's own words: the default is what agents are never told.
    dontConclude: ownCaveat(item.notToConclude) ?? '',
    ...(owners ? { owners } : {}),
    // The item it is in a conflict with, either way round (FR-220): its page and peek say so.
    ...(page.conflicts[0] ? { disagreesWith: page.conflicts[0] } : {}),
  }
}

/** A draft that was never published, as the Context list and its page read it. */
export function factOfDraft(
  proposal: Pick<ProposalRecord, 'id' | 'title' | 'areaId' | 'draft' | 'proposerId'> &
    Partial<Pick<ProposalRecord, 'newValues'>>,
  names: Names,
  words: Words,
): Fact {
  const draft = proposal.draft
  const scope = scopeTermsOf(draft.scope ?? NO_SCOPE, words, proposal.newValues)
  const valid = draft.validity
    ? validityOf({ validity: draft.validity, reviewQuestion: 'still_correct' })
    : {}
  const evidence = draft.evidence?.[0]
  const body = text(draft.body, draft.bodyMarkup, words)
  return {
    id: proposal.id,
    title: draft.title || proposal.title || 'Untitled draft',
    ...(draft.title || proposal.title ? {} : { untitled: true }),
    summary: text(draft.summary, draft.summaryMarkup, words),
    ...(body ? { body } : {}),
    domain: draft.areaId ?? proposal.areaId ?? '',
    kind: draft.kind ?? 'note',
    where: scope.map((t) => t.name),
    scope,
    valid,
    when: whenLabel(valid),
    status: 'Draft',
    by: proposal.proposerId === null ? '' : names.person(proposal.proposerId),
    checkedBy: '',
    checkedOn: '',
    source: evidence?.url ?? '',
    quote: evidence?.quote ?? '',
    dontConclude: ownCaveat(draft.notToConclude) ?? '',
  }
}

/** The service's fields of a draft by the editor's: the text is the summary and the detail. */
const sessionParts: Record<SessionField, readonly MarkedField[]> = {
  title: ['title'],
  text: ['summary', 'body'],
  kind: ['kind'],
  domain: ['areaId'],
  where: ['scope'],
  when: ['validity'],
  source: ['evidence'],
  dontConclude: ['notToConclude'],
}

/**
 * The person's own draft as the editor keeps up with it: its revision, and for each field who
 * changed it last, by the latest stamp of the service's fields it is made of, with that field's mark.
 */
export function sessionOf(
  proposal: Pick<ProposalRecord, 'revision' | 'fieldStamps' | 'provenance'>,
): DraftSession {
  const fields: DraftSession['fields'] = {}
  for (const [field, of] of Object.entries(sessionParts) as [SessionField, MarkedField[]][]) {
    const last = of
      .flatMap((part) => {
        const stamp = proposal.fieldStamps[part]
        return stamp ? [{ part, stamp }] : []
      })
      .sort((a, b) => b.stamp.revision - a.stamp.revision)[0]
    if (!last) continue
    const mark = proposal.provenance?.fields[last.part]
    const by: FieldBy = {
      by: last.stamp.by,
      revision: last.stamp.revision,
      at: last.stamp.at,
      ...(last.stamp.agent ? { agent: last.stamp.agent } : {}),
      ...(mark ? { mark } : {}),
    }
    fields[field] = by
  }
  return { revision: proposal.revision, fields }
}

/**
 * A suggestion waiting for review, as the Context list and its page show it to the people who may
 * open it (its sender, the owners of its domain, admins): its words, who sent it and when.
 */
export function factOfWaiting(
  proposal: Pick<
    ProposalRecord,
    'id' | 'title' | 'areaId' | 'draft' | 'proposerId' | 'submittedAt'
  >,
  names: Names,
  words: Words,
  shift: number,
): Fact {
  return {
    ...factOfDraft(proposal, names, words),
    status: 'Waiting',
    ...(proposal.submittedAt ? { sentAt: serviceDay(proposal.submittedAt, shift) } : {}),
  }
}

/* ---------- history ---------- */

/** A field as the app's difference names it. */
const FIELD: Record<string, string> = { Text: 'What agents should know' }

/** One sentence: what a version changed. */
function summaryOf(entry: ItemVersionEntry): string {
  switch (entry.kind) {
    case 'published':
      return 'Published.'
    case 'checked':
      return 'Checked against the source: still true.'
    case 'moved':
      return `Moved from ${entry.before} to ${entry.after}.`
    case 'retyped':
      return `Changed from ${entry.before} to ${entry.after}.`
    case 'dates':
      return 'Changed when it applies.'
    case 'link':
      return 'Changed the source.'
    case 'wording':
      return entry.field === 'Title'
        ? 'Changed the title.'
        : entry.field === 'Text'
          ? 'Reworded what agents should know.'
          : "Changed what agents shouldn't conclude."
    case 'archived':
      return entry.after || 'Archived: agents stop getting it.'
    case 'owners':
      return entry.after || 'Changed the owners.'
    case 'conflict':
      // A settled conflict says what was decided and why; a version that set or removed the flag says which.
      if (entry.field !== 'Disagrees with') return entry.after
      return entry.after.split('\n').filter(Boolean).length >
        entry.before.split('\n').filter(Boolean).length
        ? 'Marked as disagreeing with another item.'
        : 'Removed the Conflict mark.'
  }
}

/**
 * An item's history as the app lists it, newest first, each numbered in turn: the archives and
 * owner changes between the versions are rows of their own. A row's number is its place, so
 * `versionAt` finds the service's version a row restores.
 */
export function historyOf(
  entries: readonly ItemVersionEntry[],
  names: Names,
  shift: number,
): Version[] {
  return entries.map((entry, index) => ({
    v: entries.length - index,
    who: entry.personId ? names.person(entry.personId) : 'Someone',
    on: shiftDate(entry.on, shift),
    kind: entry.kind satisfies VersionKind,
    summary: summaryOf(entry),
    field: FIELD[entry.field] ?? entry.field,
    before: entry.before,
    after: entry.after,
    ...(entry.version !== null ? { comparable: true as const } : {}),
    ...(entry.agent
      ? { sentBy: `${entry.agent.name} for ${names.person(entry.agent.personId)}` }
      : {}),
    ...(entry.policy
      ? {
          policy: {
            undo: entry.policy.undoable ? `decision:${entry.policy.decisionId}` : null,
            undone: entry.policy.undone,
          },
        }
      : {}),
  }))
}

/** The service's version a history row is, by the row's number; null for one that is no version. */
export function versionAt(entries: readonly ItemVersionEntry[], v: number): number | null {
  return entries[entries.length - v]?.version ?? null
}

/** A term's versions as the app lists them, newest first: what each write made of it. */
export function termHistoryOf(
  versions: readonly TermVersion[],
  person: (id: string) => string,
  shift: number,
): Version[] {
  const sorted = [...versions].sort((a, b) => b.revision - a.revision)
  return sorted.map((version, index) => {
    const before = sorted[index + 1]
    const words = (v: TermVersion | undefined) =>
      v ? (v.sameAs ? `Another name for ${v.sameAs}` : (v.meaning ?? '')) : ''
    const kind: VersionKind =
      version.change === 'created' || version.change === 'restored'
        ? 'published'
        : version.change === 'moved'
          ? 'moved'
          : version.change === 'deleted'
            ? 'archived'
            : 'wording'
    const summary = {
      created: 'Written.',
      edited: before && before.name !== version.name ? `Renamed from ${before.name}.` : 'Reworded.',
      moved: 'Moved to another domain.',
      deleted: 'Deleted.',
      restored: 'Brought back.',
    }[version.change]
    return {
      v: version.revision,
      who: person(version.personId),
      on: serviceDay(version.at, shift),
      kind,
      summary,
      field: 'Meaning',
      before: words(before),
      after: words(version),
    }
  })
}

/* ---------- changes to many items ---------- */

/** The service's log of changes to many items as the History log reads it: those still in force. */
export function logOf(changes: readonly ItemChange[], names: Names, shift: number): LogEntry[] {
  return changes
    .filter((c) => !c.undone)
    .map((c) => ({
      id: c.id,
      on: serviceDay(c.at, shift),
      who: names.person(c.personId),
      what: c.action,
      summary: c.summary,
      items: c.items.map((i) => ({ id: i.id, title: i.title, domain: i.areaId })),
    }))
}

/* ---------- the editor's item, as a draft ---------- */

/** The last day an item applies as the service keeps it: the first day it no longer applies. */
const endOf = (until: string | undefined) => (until ? shiftDate(until, 1) : null)

/**
 * What the editor wrote as the draft the service publishes. A change names only the fields it
 * changes from `before`, the item as its page read it; the service keeps the rest. The domain's
 * owners answer for it unless the item has its own.
 */
export function draftOf(fact: Fact, words: Words, today: string, before?: Fact): Draft {
  const changed = <K extends keyof Fact>(key: K) =>
    !before || JSON.stringify(fact[key] ?? null) !== JSON.stringify(before[key] ?? null)
  const draft: Draft = {}
  if (changed('domain')) draft.areaId = fact.domain
  if (changed('kind')) draft.kind = fact.kind
  if (changed('title')) draft.title = fact.title
  if (changed('summary')) {
    const summary = textToService(fact.summary, words)
    draft.summary = summary.plain
    if (summary.markup) draft.summaryMarkup = summary.markup
  }
  if (changed('body')) {
    const body = textToService(fact.body ?? '', words)
    draft.body = body.plain
    if (body.markup) draft.bodyMarkup = body.markup
  }
  // By key when the editor read the scope; an item read only as names is written by them.
  const keys = (f?: Fact) => JSON.stringify(f?.scope?.map((t) => t.key || t.name) ?? null)
  if (fact.scope ? keys(fact) !== keys(before) : changed('where'))
    draft.scope = scopeOfTerms(
      fact.scope ?? fact.where.map((name) => ({ key: '', kind: 'value', name })),
      words,
    )
  if (changed('valid'))
    draft.validity = { start: fact.valid.from ?? anyDate.start, end: endOf(fact.valid.until) }
  if (changed('source') || changed('quote'))
    draft.evidence = fact.source ? [{ url: fact.source, quote: fact.quote, date: today }] : []
  if (changed('dontConclude')) draft.notToConclude = fact.dontConclude || defaultNotToConclude
  return draft
}

/**
 * The values the writer added in "Applies to" that no vocabulary has yet, by the key its scope
 * names each with: they go with the suggestion, beside its draft (values without figures).
 */
export const newValuesOf = (fact: Fact) =>
  (fact.scope ?? []).flatMap((t) => (t.added && t.key ? [{ key: t.key, name: t.name }] : []))

/** The words a draft read from text has, as the editor's item: every field it could read. */
export function factOfReadDraft(draft: Draft, names: Names, words: Words): Fact {
  return factOfDraft({ id: 'draft', title: '', areaId: null, draft, proposerId: '' }, names, words)
}

/** What the item page answers: the item and its versions. */
export function itemPageOf(
  page: ServiceItemPage,
  names: Names,
  words: Words,
  shift: number,
): ItemPage {
  const item = factOfPage(page, names, words)
  const pair = page.pairs.find((p) => p.otherId === item.disagreesWith)
  return {
    item,
    history: historyOf(page.history, names, shift),
    ...(pair ? { conflict: { key: pair.key, canSettle: pair.canSettle, asked: pair.asked } } : {}),
  }
}
