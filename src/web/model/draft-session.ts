import type { FieldMark } from '@domain/provenance'
import type { ScopeTerm } from './items'

/*
  A draft the person writes with their agent (Route 1): the person in the editor, the agent through
  write_draft. The editor saves as the person types and reads the draft again while it is open. What
  the agent changed comes into each field the person is not writing in; in a field they are writing
  in, the agent's words wait beside theirs to be taken, and never replace what they typed. Who
  changed what is the service's stamp on each field, so the editor never guesses it from the words.
*/

/** The fields of a draft as the editor names them, each one of the service's or two (the text). */
export const sessionFields = [
  'title',
  'text',
  'kind',
  'domain',
  'where',
  'when',
  'source',
  'dontConclude',
] as const
export type SessionField = (typeof sessionFields)[number]

/** Each field in the words the editor shows it with, for "Claude changed Title and When". */
export const sessionFieldLabel: Record<SessionField, string> = {
  title: 'Title',
  text: 'Text',
  kind: 'Kind',
  domain: 'Domain',
  where: 'Applies to',
  when: 'When',
  source: 'Source',
  dontConclude: "Don't conclude",
}

/** Who last changed a field: the person, or their agent by its name, at which revision and when. */
export type FieldBy = {
  by: 'person' | 'agent'
  agent?: string
  revision: number
  /** ISO time. */
  at: string
  /** How the value was found, for a field an agent wrote (FR-121). */
  mark?: FieldMark
}

/** The person's own draft as the editor keeps up with it: its revision, and who changed what. */
export type DraftSession = {
  revision: number
  fields: Partial<Record<SessionField, FieldBy>>
}

/** What the editor holds of a draft: the parts of its form each field is made of. */
export type SessionForm = {
  title: string
  body: string
  kind: string
  domain: string
  owners: string[]
  where: ScopeTerm[]
  when: string
  from: string
  until: string
  source: string
  quote: string
  causes: boolean
  dontConclude: string
}

/** The parts of the form a field is: a domain brings its owners along, the dates their mode. */
const parts: Record<SessionField, (keyof SessionForm)[]> = {
  title: ['title'],
  text: ['body'],
  kind: ['kind'],
  domain: ['domain', 'owners'],
  where: ['where'],
  when: ['when', 'from', 'until'],
  source: ['source', 'quote', 'causes'],
  dontConclude: ['dontConclude'],
}
/** The parts that say what a field holds: who owns a domain follows from the domain. */
const said: Record<SessionField, (keyof SessionForm)[]> = { ...parts, domain: ['domain'] }

/** Whether two forms hold the same in a field. */
export const sameField = (a: SessionForm, b: SessionForm, field: SessionField) =>
  said[field].every((part) => JSON.stringify(a[part]) === JSON.stringify(b[part]))

/** `into` with the field as `from` holds it. */
export const takeField = <F extends SessionForm>(into: F, from: SessionForm, field: SessionField) =>
  Object.assign({ ...into }, ...parts[field].map((part) => ({ [part]: from[part] }))) as F

/** The fields where the form differs from what was saved: what the person changed and is not stored. */
export const unsavedFields = (form: SessionForm, saved: SessionForm) =>
  sessionFields.filter((field) => !sameField(form, saved, field))

/** What the agent changed, put into the fields the person was not writing in: Undo puts back `before`. */
export type AgentChange = {
  /** The agent's name, as the person named it when they connected it. */
  agent: string
  fields: SessionField[]
  /** ISO time of its last change. */
  at: string
  /** The form before the change, and after it, for Undo: a field changed since stays as it is. */
  before: SessionForm
  after: SessionForm
}

export type Merged<F extends SessionForm> = {
  form: F
  /** What the service holds now, field by field, as the editor writes it. */
  saved: F
  revision: number
  /** The agent's change that went into the form, if it changed a field the person was not in. */
  change: AgentChange | null
  /** Fields the person is writing in that the agent changed too: its words wait there. */
  waiting: SessionField[]
  /** Fields changed since the editor's revision that did not go to waiting: any older wait is over. */
  settled: SessionField[]
}

/**
 * The draft as the service has it now, merged into the one the person is writing. Each field changed
 * since the editor's revision comes in, unless the person is writing in it (`typing`: the cursor is
 * there) or changed it and it is not saved yet: then the form keeps their words and an agent's wait
 * beside them. A change the person made elsewhere (another window) comes in the same way, quietly.
 * Null when the service has nothing newer.
 */
export function mergeDraft<F extends SessionForm>(
  mine: { form: F; saved: F; revision: number },
  theirs: { form: F; session: DraftSession },
  typing: (field: SessionField) => boolean,
): Merged<F> | null {
  const { revision, fields } = theirs.session
  if (revision <= mine.revision) return null
  let form = mine.form
  let saved = mine.saved
  const changed: SessionField[] = []
  const waiting: SessionField[] = []
  const settled: SessionField[] = []
  let at = ''
  let agent = ''
  for (const field of sessionFields) {
    const stamp = fields[field]
    if (!stamp || stamp.revision <= mine.revision) continue
    if (
      !(typing(field) || !sameField(mine.form, mine.saved, field)) ||
      sameField(form, theirs.form, field)
    )
      settled.push(field)
    if (sameField(form, theirs.form, field)) {
      saved = takeField(saved, theirs.form, field)
      continue
    }
    const byAgent = stamp.by === 'agent'
    const edited = !sameField(mine.form, mine.saved, field)
    if (typing(field) || edited) {
      // A field the person only stands in stays as last saved: nothing of theirs to save over it.
      if (edited) saved = takeField(saved, theirs.form, field)
      if (byAgent) waiting.push(field)
      continue
    }
    saved = takeField(saved, theirs.form, field)
    form = takeField(form, theirs.form, field)
    if (!byAgent) continue
    changed.push(field)
    if (stamp.at > at) at = stamp.at
    agent ||= stamp.agent ?? ''
  }
  return {
    form,
    saved,
    revision,
    change: changed.length
      ? { agent: agent || 'Your agent', fields: changed, at, before: mine.form, after: form }
      : null,
    waiting,
    settled,
  }
}

/** A second change while the first is still offered: one Undo takes back both. */
export function joinChanges(older: AgentChange | null, newer: AgentChange): AgentChange {
  if (!older) return newer
  let before = newer.before
  for (const field of older.fields) before = takeField(before, older.before, field)
  return {
    agent: newer.agent,
    fields: sessionFields.filter((f) => older.fields.includes(f) || newer.fields.includes(f)),
    at: newer.at > older.at ? newer.at : older.at,
    before,
    after: newer.after,
  }
}

/**
 * The form with the agent's change taken back: each of its fields as it was before, unless the
 * person has changed it since, which stays theirs.
 */
export function undoChange<F extends SessionForm>(form: F, change: AgentChange): F {
  let undone = form
  for (const field of change.fields)
    if (sameField(form, change.after, field)) undone = takeField(undone, change.before, field)
  return undone
}

/** "Title", "Title and When", "Title, Text and When". */
export function fieldList(fields: readonly SessionField[]) {
  const words = fields.map((f) => sessionFieldLabel[f])
  return words.length < 2
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
}

/** How long ago, as the strip says it: "just now", "20 seconds ago", "3 minutes ago", "at 14:05". */
export function agoWords(at: Date, now: Date) {
  const seconds = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 1000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${Math.floor(seconds / 10) * 10} seconds ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return minutes === 1 ? 'a minute ago' : `${minutes} minutes ago`
  return `at ${at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

/** "Claude changed Title and When, 20 seconds ago". */
export const changeLine = (change: AgentChange, now: Date) =>
  `${change.agent} changed ${fieldList(change.fields)}, ${agoWords(new Date(change.at), now)}`
