import type { RecordsKind } from './records-answer.ts'

/*
  The context's own records as Ask's loop reads them: each item the Context list shows the person,
  with what the workspace keeps about it, never what it says.
*/

export type { RecordsKind } from './records-answer.ts'

/** A context item as the records keep it. */
export type RecordsItem = {
  id: string
  kind: RecordsKind
  areaId: string
  title: string
  /** As the Context list says it: live, needs a recheck, or archived. */
  status: 'live' | 'due' | 'archived'
  reviewDate: string | null
  checkFlag: 'needs_check' | 'source_missing' | null
  /** When it was first published: agents first got it. Null when not known. */
  publishedAt: string | null
  /** When its current version was published. */
  changedAt: string | null
  /** When its current version was last confirmed: its acceptance, or a later check. */
  checkedAt: string | null
  /** When it was archived; null while it is not. */
  archivedAt: string | null
  /** Its own owners, by id, when not its domain's. */
  owners: readonly string[]
  /** The metrics and values it names, by key: what a question can narrow it by. */
  metrics?: readonly string[]
  values?: readonly string[]
}
