import type { DraftWriter } from '@domain/draft-stamps'
import type { FieldMark } from '@domain/provenance'
import type { ScopeTerm } from './items'

/*
  A draft the person writes with their agent (Route 1): the person in the editor, the agent through
  write_draft. The editor saves as the person types and reads the draft again while it is open. What
  the agent changed comes into each field the person is not writing in; in a field they are writing
  in, the agent's words wait beside theirs to be taken, and never replace what they typed. Who
  changed what is the service's stamp on each field, so the editor never guesses it from the words.
  Writing help, the editor's dock (Route 3), is a writer of the same kind: what it changed comes in
  the same way, under its own name.
*/

/**
 * Writing help's name, as a label and at the start of a sentence, where a writer is named as an
 * agent is by the name the person gave it; mid-sentence it is "writing help" (`inSentence`).
 */
export const HELP_NAME = 'Writing help'

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

/**
 * Who last changed a field: the person, their agent by its name, or writing help, at which
 * revision and when.
 */
export type FieldBy = {
  by: 'person' | DraftWriter
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
  said: string
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
  source: ['source', 'quote', 'said'],
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

/** The writer of a stamp by name: the agent's as the person named it, or writing help's. */
export const writerName = (stamp: Pick<FieldBy, 'by' | 'agent'>) =>
  stamp.by === 'writing_help' ? HELP_NAME : (stamp.agent ?? 'Your agent')

/** A writer's name inside a sentence: an agent's is a name, writing help's a plain noun. */
export const inSentence = (writer: string) => (writer === HELP_NAME ? 'writing help' : writer)

/** What a writer changed, put into the fields the person was not writing in: Undo puts back `before`. */
export type AgentChange = {
  /** The agent's name, as the person named it when they connected it, or writing help's. */
  agent: string
  fields: SessionField[]
  /** For a turn of writing help: the fields the person changed while it worked, kept as theirs. */
  kept?: SessionField[]
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
  /** Writing help's change that went into the form, the same way. */
  helped: AgentChange | null
  /** Fields the person is writing in that a writer changed too: its words wait there. */
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
  const changed: Record<DraftWriter, { fields: SessionField[]; at: string; name: string }> = {
    agent: { fields: [], at: '', name: '' },
    writing_help: { fields: [], at: '', name: HELP_NAME },
  }
  const waiting: SessionField[] = []
  const settled: SessionField[] = []
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
    const edited = !sameField(mine.form, mine.saved, field)
    if (typing(field) || edited) {
      // A field the person only stands in stays as last saved: nothing of theirs to save over it.
      if (edited) saved = takeField(saved, theirs.form, field)
      if (stamp.by !== 'person') waiting.push(field)
      continue
    }
    saved = takeField(saved, theirs.form, field)
    form = takeField(form, theirs.form, field)
    if (stamp.by === 'person') continue
    const writer = changed[stamp.by]
    writer.fields.push(field)
    if (stamp.at > writer.at) writer.at = stamp.at
    writer.name ||= stamp.agent ?? ''
  }
  const changeBy = (writer: DraftWriter): AgentChange | null =>
    changed[writer].fields.length
      ? {
          agent: changed[writer].name || 'Your agent',
          fields: changed[writer].fields,
          at: changed[writer].at,
          before: mine.form,
          after: form,
        }
      : null
  return {
    form,
    saved,
    revision,
    change: changeBy('agent'),
    helped: changeBy('writing_help'),
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

/** Whether a field of a form holds nothing yet. */
const emptyIn = (form: SessionForm, field: SessionField) =>
  field === 'when'
    ? form.when === 'always'
    : field === 'where'
      ? !form.where.length
      : field === 'text'
        ? !form.body.trim()
        : field === 'source'
          ? !form.source
          : field === 'dontConclude'
            ? !form.dontConclude
            : field === 'title'
              ? !form.title
              : false

/**
 * What a turn of writing help did, as the strip says it: a first fill of several empty fields by
 * their count ("Writing help filled in 6 fields from your message. Check each one."), any other
 * change by its fields and how long ago, and the fields that kept the person's words.
 */
export function helpChangeLine(change: AgentChange, now: Date) {
  const filled =
    change.fields.length > 2 &&
    change.fields.filter((field) => emptyIn(change.before, field)).length > 2
  const did = filled
    ? `${change.agent} filled in ${change.fields.length} fields from your message. Check each one.`
    : `${changeLine(change, now)}.`
  const kept = change.kept ?? []
  if (!kept.length) return did
  const yours = fieldList(kept)
  return `${did} ${yours} ${kept.length > 1 ? 'were' : 'was'} kept as you wrote ${kept.length > 1 ? 'them' : 'it'}.`
}
