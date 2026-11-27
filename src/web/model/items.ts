import type { TermDomainSource } from '@domain/catalogue'
import type { CheckFlag, ItemKind, ItemStatus } from '@domain/item'
import { kinds } from '@domain/words'
import type { DraftSession } from './draft-session'
import { whenLabel, type Validity } from './validity'

// A context item as the app's screens read it, from the app's API (src/web/api). Pure types, the
// words for its kinds, and the rules that follow from its fields; the items themselves come from
// a binding.

/** A domain's id: `sales`, `customer_value`. Domains are created and deleted, so any string. */
export type DomainId = string

/** The four kinds the app writes. */
export type Kind = ItemKind

/**
 * A draft was never published: agents never got it, so it can be deleted. Waiting (for review) was
 * sent: an owner of its domain decides, and agents don't get it yet. A published item is archived
 * instead.
 */
export type Status = 'Draft' | 'Waiting' | 'Live' | 'Due for a check' | 'Archived'

/**
 * The four kinds of context, in plain words most people know, native English or not. The one
 * place their names and hints live; the stored values (event, issue, note, guide) stay as they are.
 */
export const kindLabel: Record<Kind, string> = {
  event: kinds.event.label,
  issue: kinds.issue.label,
  note: kinds.note.label,
  guide: kinds.guide.label,
}

export const kindHint: Record<Kind, string> = {
  event: kinds.event.hint,
  issue: kinds.issue.hint,
  note: kinds.note.hint,
  guide: kinds.guide.hint,
}

/**
 * One term an item applies to (FR-107, FR-126): a metric, a dimension with any value, or one value
 * of a dimension, by the vocabulary's key (`metric:orders`, `dim:market`, `val:market/norway`).
 * A value names its dimension, so two values with the same name never mix.
 */
export type ScopeTerm = {
  key: string
  kind: 'metric' | 'dimension' | 'value'
  name: string
  /** A value's dimension, by name. */
  dimension?: string
  /**
   * A value the writer added here ("Add Norway to Market") that no vocabulary has yet: it goes to
   * the owner with the item, and is published with it (values without figures).
   */
  added?: true
}

export type Fact = {
  id: string
  /** The published version it was read at: a change to it starts from that version. */
  version?: number
  title: string
  summary: string
  body?: string
  domain: DomainId
  kind: Kind
  /** What it applies to, as people read it: the names of its metrics, dimensions and values. */
  where: string[]
  /**
   * What it applies to, by vocabulary key, when the binding read it: the editor's "Applies to".
   * `where` is the same scope as names.
   */
  scope?: ScopeTerm[]
  /**
   * The dimension values it applies to, each with its dimension, by name ("Market", "Norway"):
   * what By time groups and filters a dimension by. `where` names them without their dimension.
   */
  values?: { dimension: string; name: string }[]
  /** When it applies, as stored (dates, not words). */
  valid: Validity
  /** Derived from `valid` by whenLabel: the When people read. Never typed by hand. */
  when: string
  status: Status
  checkedBy: string
  checkedOn: string
  source: string
  quote: string
  dontConclude: string
  outOfDate?: string
  disagreesWith?: string
  /** The older context item this one replaced: it stays, archived, and links say so. */
  replaces?: string
  /** Published from a suggestion a sync created: the document it came from. */
  origin?: { tool: string; connector: string; folder: string; doc: string; read: string }
  /** Who answers for it, when not its domain's owners: set in the editor or in bulk. */
  owners?: string[]
  /** Who started a draft, or sent a suggestion that waits for review. */
  by?: string
  /** When a suggestion waiting for review was sent (ISO): how long it has waited. */
  sentAt?: string
  /**
   * A suggestion an owner returned to its writer with a note: they edit it and send it again. It
   * is no draft of theirs alone, so it is sent, never saved as a draft.
   */
  returned?: boolean
  /**
   * The person's own draft, read on its own: its revision and who changed each field, the person
   * or their agent. The editor saves it as they type and keeps up with their agent's changes.
   */
  session?: DraftSession
}

/** A status in the server's words: accepted or retired, with the flags that wait for a look. A draft, or a suggestion waiting for review, is no item yet. */
export const toServerStatus = (
  status: Status,
): { status: ItemStatus; flags: CheckFlag[] } | null =>
  status === 'Draft' || status === 'Waiting'
    ? null
    : {
        status: status === 'Archived' ? 'retired' : 'accepted',
        flags: status === 'Due for a check' ? ['needs_check'] : [],
      }

/** Not published yet: a draft, or a suggestion waiting for review. Agents never got it. */
export const unpublished = (f: Pick<Fact, 'status'>) =>
  f.status === 'Draft' || f.status === 'Waiting'

/** What agents get: a published item that isn't archived. */
export const servedToAgents = (f: Pick<Fact, 'status'>) =>
  f.status === 'Live' || f.status === 'Due for a check'

/** A context item as stored: its labels are derived when it loads. */
export type StoredFact = Omit<Fact, 'when'>

/** Adds the labels people read to a stored item. */
export const withWhen = (f: StoredFact): Fact => ({ ...f, when: whenLabel(f.valid) })

/** A metric as the definitions source names it. */
export type Metric = {
  name: string
  group: string
  domain?: DomainId
  facts: number
  note?: 'changed' | 'none'
  definition: string
  /** Other names analysts use, adopted from Cube or added by an owner. */
  otherNames?: string[]
}

/** A metric's domain in the server's words: the vocabulary's area, or none. */
export const toServerTermDomain = (
  m: Pick<Metric, 'domain'>,
): { areaId: DomainId | null; source: TermDomainSource } =>
  m.domain ? { areaId: m.domain, source: 'vocabulary' } : { areaId: null, source: 'none' }

/** What a change to many items did, as their History and Settings say it. */
export type LogEntry = {
  id: string
  /** ISO date. */
  on: string
  who: string
  what: 'archived' | 'deleted' | 'moved' | 'kind' | 'owners' | 'checked' | 'settled' | 'published'
  /** One sentence: "Moved to Marketing." */
  summary: string
  items: { id: string; title: string; domain?: DomainId }[]
}

/** A suggestion someone sent from the editor: it waits for the owner, visibly, until they decide. */
export type Sent = {
  id: string
  factId?: string
  title: string
  by: string
  to: string
  domain: DomainId
  at: string
}
