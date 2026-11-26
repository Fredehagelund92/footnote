import type { AnswerState } from './ask'
import type { Validity } from './validity'
import type { SavedResult } from './saved-questions'

// A suggestion's review as the app reads it (src/web/api): the change split into blocks by kind,
// what agents say before and after, and what to watch for. Pure types and the rules that follow
// from a review's fields; in Footnote the blocks come from diffing the parsed document (words,
// formatting, links and order told apart deterministically, no model).

/** A run of text in a change: unchanged, added, removed, or the same words formatted differently. */
export type Seg = { t: 'same' | 'add' | 'del' | 'fmt'; text: string; note?: string }

/**
 * Text with marks, so the data stays readable: [-removed-], {+added+}, {*formatted|what changed*}.
 */
export function marks(s: string): Seg[] {
  const out: Seg[] = []
  const re = /\[-([\s\S]+?)-\]|\{\+([\s\S]+?)\+\}|\{\*([\s\S]+?)\*\}/g
  let last = 0
  for (const m of s.matchAll(re)) {
    if (m.index > last) out.push({ t: 'same', text: s.slice(last, m.index) })
    if (m[1] !== undefined) out.push({ t: 'del', text: m[1] })
    else if (m[2] !== undefined) out.push({ t: 'add', text: m[2] })
    else {
      const [text = '', note] = m[3]!.split('|')
      out.push({ t: 'fmt', text, note })
    }
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ t: 'same', text: s.slice(last) })
  return out
}

/** "1 link", "2 links", "3 dates", "2 wording": a count of changes of one kind. */
export function countWord(kind: ChangeKind, n: number) {
  const w = kind.toLowerCase()
  if (n === 1) return w.replace(/s$/, '')
  return kind === 'Link' || kind === 'Order' ? `${w}s` : w
}

/**
 * What a suggestion does, as the rest of a sentence about whoever sent it: "changed 2 sentences and
 * 2 links, and moved 1 paragraph". Nothing for a review with no counted change.
 */
export function changeWords(counts: readonly { kind: ChangeKind; n: number }[]) {
  const of = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const phrase = (c: { kind: ChangeKind; n: number }): [verb: string, what: string] => {
    switch (c.kind) {
      case 'Wording':
        return ['changed', of(c.n, 'sentence', 'sentences')]
      case 'Formatting':
        return ['changed', of(c.n, 'formatted passage', 'formatted passages')]
      case 'Link':
        return ['changed', of(c.n, 'link', 'links')]
      case 'Dates':
        return ['changed', of(c.n, 'date', 'dates')]
      case 'Order':
        return ['moved', of(c.n, 'paragraph', 'paragraphs')]
      case 'Added':
        return ['added', of(c.n, 'passage', 'passages')]
      case 'Removed':
        return ['removed', of(c.n, 'passage', 'passages')]
    }
  }
  const byVerb = new Map<string, string[]>()
  for (const c of counts) {
    const [verb, what] = phrase(c)
    byVerb.set(verb, [...(byVerb.get(verb) ?? []), what])
  }
  const list = (xs: string[]) =>
    xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`
  return list([...byVerb].map(([verb, what]) => `${verb} ${list(what)}`))
}

/** How often agents asked: "Agents asked about this 12 times this week." */
export function askedWords(times: number | null) {
  return `Agents asked about this ${times === 1 ? 'once' : `${times ?? 'fewer than 5'} times`} this week.`
}

/**
 * A Not found row's line: what agents found this week, and whether someone told the owners from
 * Ask (Tell the owner), who are the only ones the row reaches.
 */
export function gapRowWords(gap: { times: number | null; told?: number; acrossMonths?: string }) {
  const told = gap.told ?? 0
  const people =
    told === 1
      ? 'Someone in Ask found nothing and told you.'
      : `People in Ask found nothing and told you, ${told} times this week.`
  const toldToo = told
    ? ` ${told === 1 ? 'Someone in Ask told you too.' : `People in Ask told you too, ${told} times.`}`
    : ''
  // A count under the minimum is hidden, never none: what agents asked raised the card.
  const agents =
    gap.times === 0
      ? told
        ? people
        : 'Agents found nothing, and did not ask this week.'
      : `${askedWords(gap.times)} They found nothing.${toldToo}`
  return `${agents}${gap.acrossMonths ? ' Counted across two months.' : ''}`
}

/** The quiet label each kind of change carries. */
export type ChangeKind = 'Wording' | 'Formatting' | 'Link' | 'Order' | 'Added' | 'Removed' | 'Dates'

export type Block =
  | { kind: 'Wording' | 'Added' | 'Removed'; field: string; text: string }
  | {
      kind: 'Formatting'
      field: string
      label: string
      text: string
      list?: { ordered: boolean; was: 'bullets' | 'numbers'; items: string[] }
    }
  | { kind: 'Link'; field: string; text: string; before: string; after: string }
  /** An @ link added or removed in the text: what an agent can follow from the item changes. */
  | {
      kind: 'Link'
      field: string
      text: string
      mention: { id: string; label: string; change: 'added' | 'removed' }
    }
  | { kind: 'Order'; field: string; label: string; steps: { text: string; from?: number }[] }
  | {
      kind: 'Dates'
      field: string
      before: string
      after: string
      /**
       * The days of the month it starts, ended and now ends, for the small timeline; left out
       * when the change spans more than one month.
       */
      span?: { from: number; was: number; now: number; month: string }
    }

export type Answer = { state: AnswerState; text: string }

/**
 * One side of a suggestion's fields, as the Fields table compares them: the version agents get
 * now, or the suggested one, in the words people read (the kind's name, the domain and the owner
 * by name, what it applies to by name). Dates are stored dates; `validity.until` is its last day.
 */
export type FieldSide = {
  title: string
  kind: string
  domain: string
  owner: string
  scope: string[]
  validity: Validity
  reviewDate?: string
  sources: { url: string; quote?: string }[]
  dontConclude: string
}

export type Review = {
  /** The Inbox card this review is for. */
  id: string
  title: string
  from: string
  /** Set when an agent sent it, with the person's OK: the agent's name (FR-420). */
  agent?: string
  via: string
  on: string
  note?: string
  mode: 'edit' | 'new' | 'retire'
  /**
   * Written against an earlier version of its item (src/domain/suggestion-standing.ts): a change
   * is returned and a suggestion to archive closed, not sent out as it is.
   */
  stale?: true
  /**
   * Sent from a question link without a source: the owner adds one, or confirms the link its
   * sender gave without a sentence from it, in the editor before publishing.
   */
  sourceless?: 'add' | 'confirm'
  /** Drafted for a Not found card: how many questions it answers, and what it was drafted from. Nobody wrote it. */
  drafted?: { questions: number; scope: string; from: string }
  /** A suggestion a sync created from a document: where it came from, and the quote Footnote kept. */
  synced?: {
    tool: string
    /** The connector's id, which its logo is drawn by. */
    connector: string
    folder: string
    doc: string
    read: string
    quote: string
  }
  /** One sentence: what changes, said before any mark is shown. */
  summary: string
  /** Counts by kind, for the summary line. */
  counts: { kind: ChangeKind; n: number }[]
  /** The values that moved, pulled out: Number 312 to 340. */
  moved: { label: string; before?: string; after: string }[]
  blocks: Block[]
  unchanged: string[]
  formattingOnly?: boolean
  /** A long rewrite: side by side, with where the changes sit. */
  rewrite?: { field: string; before: string; after: string; changes: number }
  /** An agent's suggestion: each claim against the sentence the agent copied from the source. */
  claims?: {
    sentence: string
    rows: { claim: string; source: string; same: 'same' | 'different' | 'check' }[]
    /** How many claims are to check, as the service counts them: past the rows it lists too. */
    toCheck?: number
  }
  /**
   * Words of the suggestion that read like orders to an AI agent, by the field they are in
   * (NFR-024): the review warns of them. Absent when there are none.
   */
  instructionLike?: { field: string; words: string[] }[]
  /**
   * Values its writer added in "Applies to", each with its dimension: publishing it publishes them
   * too (values without figures). Absent when there are none.
   */
  newValues?: { name: string; dimension: string }[]
  /**
   * The clash with live context: the suggestion's words once, and each live item it overlaps, which the
   * owner answers on its own. Publish sends each answer for its own item.
   */
  clash?: {
    mine: string
    items: { factId: string; title: string; theirs: string; relation?: Relation }[]
  }
  retire?: {
    factId: string
    reason: string
    used: number
    checkFirst: string
    /** The proposer took it back in the comments: the review shows that, and Archive steps back. */
    withdrawn?: { by: string; when: string; quote: string }
  }
  tryIt: { question: string; before: Answer; after: Answer; reach: number }
  /**
   * Every field of both versions, for the Fields table: before is null for a new item, after is
   * null for an archive.
   */
  fields: { before: FieldSide | null; after: FieldSide | null }
  /**
   * The two versions the review compares: the one agents get now (null for a new item) and the
   * suggested one (null for an archive). A thread on a line or a field names them.
   */
  versions: { before: string | null; after: string | null }
  /** The stored markdown of each version, mentions as the app's tokens, for the Text diff. */
  source: { before: string; after: string }
  /** The Ready line as the service says it: the service decides the publish rules. */
  ready: Readiness
  /** How long the change must be on screen to count as read, as the service says it. */
  readMs?: number
  /**
   * The saved questions that answer from its item, checked against the draft, as the service
   * says it (FR-526): it holds over the check worked out here (lib/saved-check.ts).
   */
  saved?: { id: string; result: SavedResult; why: string; before: string; now: string }[]
}

/** How a suggestion that overlaps a live item relates to it, as the owner chose. */
export type Relation = 'replaces' | 'disagree' | 'unrelated'

/** The claims an agent or a draft makes that the copied sentence doesn't plainly say. */
export const claimsToCheck = (r: Pick<Review, 'claims'>) =>
  r.claims?.toCheck ?? r.claims?.rows.filter((x) => x.same !== 'same').length ?? 0

/** The overlap with live context as a sentence: "About the same thing as 2 published items". */
export const clashWords = (n: number) =>
  `About the same thing as ${n === 1 ? '1 published item' : `${n} published items`}`

/** What needs care, in a few words, for the quick view and the Inbox row: "2 details to compare with the source". */
export function careLine(r: Review) {
  const n = claimsToCheck(r)
  if (n) return `${n} ${n === 1 ? 'detail' : 'details'} to compare with the source`
  if (r.clash) return clashWords(r.clash.items.length)
  if (r.retire?.withdrawn) return `Withdrawn by ${r.retire.withdrawn.by}`
  return undefined
}

/** `bulk` says whether it may go out with "Publish the ones you've read": not while something still needs a look. */
export type Readiness = { ok: boolean; title: string; text: string; bulk: boolean }

/**
 * The Ready line: what can honestly be said before publishing, as the service says it
 * (src/domain/readiness.ts decides it; the web has no second copy of the rules). The one thing
 * decided here is an answer the owner has just given to a clash: once every live item it overlaps
 * has one (`relation`, from clashOutcome), Publish sends them, and a suggestion with nothing else
 * to check reads as Ready with what publishing will do. A draft or a claim still comes first.
 */
export function readiness(r: Review, relation?: { hint: string } | null): Readiness {
  if (!r.clash || !relation || r.drafted || claimsToCheck(r)) return r.ready
  return { ok: true, title: 'Ready', text: relation.hint, bulk: false }
}

/** The values a suggestion adds, in words: "New value: Norway (Market). Publishing it publishes the value too." */
export function newValuesWords(values: readonly { name: string; dimension: string }[]) {
  const named = values.map((v) => `${v.name} (${v.dimension})`).join(', ')
  return values.length === 1
    ? `New value: ${named}. Publishing it publishes the value too.`
    : `New values: ${named}. Publishing it publishes them too.`
}
