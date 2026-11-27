import { DEMO_TODAY, today } from '@/lib/today'
import { dayMonth, dayMonthYear, monthYearLong } from '@/lib/dates'
import type { LogEntry } from '@/model/items'
import type { FieldSide } from '@/model/review'
// A context item's or a definition's versions as the app reads them (src/web/api): a number,
// who, when and what changed. Pure types and the words a version list says them with.

export type VersionKind =
  | 'wording'
  | 'link'
  | 'formatting'
  | 'dates'
  | 'published'
  | 'returned'
  | 'checked'
  | 'synced'
  | 'archived'
  | 'moved'
  | 'retyped'
  | 'owners'
  | 'conflict'
  | 'family'
  | 'split'
  | 'joined'

export type Version = {
  v: number
  who: string
  /** ISO date. */
  on: string
  kind: VersionKind
  /** One sentence: what this version changed. */
  summary: string
  /** The field it changed, and its words before and after, for the read-only diff. */
  field: string
  before: string
  after: string
  /** The agent that sent the suggestion this version published, and for whom (FR-420). */
  sentBy?: string
  /**
   * Published under an owner's policy, without a review round (FR-421): `who` is the owner who set
   * it. `undo` takes the publish back, while the signed-in person may; null when they may not.
   */
  policy?: { undo: string | null; undone: boolean }
  /**
   * A version agents got, with words and fields of its own, which History compares with any other
   * such version. A return, an archive or a change of owners has none.
   */
  comparable?: true
}

/**
 * Two versions of an item as History compares them, the way the review compares a suggestion:
 * every field of each and the stored text of each, mentions as the app's tokens.
 */
export type VersionPair = {
  fields: { before: FieldSide; after: FieldSide }
  source: { before: string; after: string }
}

/** The version History compares one with first: the comparable one just before it, else after. */
export function compareWith(versions: readonly Version[], v: Version): Version | undefined {
  const others = versions.filter((x) => x.comparable && x.v !== v.v)
  return others.find((x) => x.v < v.v) ?? others.at(-1)
}

/** Whether a version changed the words, so it can be restored (a check or a return changed nothing). */
export const restorable = (v: Version) =>
  !['checked', 'returned', 'synced', 'archived', 'moved', 'retyped', 'owners', 'conflict'].includes(
    v.kind,
  )

/** A short plain verb for each kind, as a row says it: "Jon Abara edited wording". */
export const VERB: Record<VersionKind, string> = {
  wording: 'edited wording',
  link: 'changed the link',
  formatting: 'changed formatting',
  dates: 'changed the dates',
  published: 'published a suggestion',
  returned: 'returned a suggestion',
  checked: 'checked it: still true',
  synced: 'read a change from its tool',
  archived: 'archived it',
  moved: 'moved it',
  retyped: 'changed its kind',
  owners: 'changed its owners',
  conflict: 'changed a conflict',
  family: 'published it as a family',
  split: 'split it into its metrics',
  joined: 'made it one family',
}

/** The demo world's today, as the mock dates its data; the app reads the service's (`today()`). */
export const TODAY = DEMO_TODAY

/** "today", "yesterday", "4 days ago", "12 Oct", "3 Oct 2025". */
export function relativeDate(iso: string) {
  const days = Math.round((Date.parse(today()) - Date.parse(iso)) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return iso.slice(0, 4) === today().slice(0, 4) ? dayMonth(iso) : dayMonthYear(iso)
}

/** "October 2026": a version list's group header. */
export const monthOf = (iso: string) => monthYearLong(iso)

/** A change to many items, as the History log says it: "Archived “A”, “B” and 3 more". */
export function logLine(e: Pick<LogEntry, 'what' | 'summary' | 'items'>) {
  const names = e.items.map((i) => `“${i.title}”`)
  const titles =
    names.length > 2
      ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
      : names.join(' and ')
  const verb = {
    archived: 'Archived',
    deleted: 'Deleted',
    moved: 'Moved',
    kind: 'Changed the kind of',
    owners: 'Changed the owners of',
    checked: 'Checked',
    settled: 'Settled the conflict between',
    published: 'Published',
  }[e.what]
  const detail =
    e.what === 'moved'
      ? e.summary.replace(/^Moved /, '').replace(/\.$/, '')
      : e.what === 'kind' || e.what === 'owners'
        ? e.summary.replace(/\.$/, '')
        : ''
  return `${verb} ${titles}${detail ? `: ${detail.charAt(0).toLowerCase()}${detail.slice(1)}` : ''}`
}
