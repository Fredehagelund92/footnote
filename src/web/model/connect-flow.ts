import { NONE, type Selection } from '@/lib/selection'
import type { DomainId } from './items'
import type { ConnectForm, ConnectScope, ConnectTest, ConnectValues } from './integrations'

// The connect flow's state, in one place above its five steps: the settings, the test of them,
// what is chosen to read, and the save. The step is in the address; this is what every step shares,
// so stepping Back, the browser's own Back, or a new test after a changed setting loses nothing
// chosen. A pure reducer; the view runs the test and sends the save, and tells it how they went.
//
//   settings ──Test──▶ testing ──ok──▶ settings, tested: the choices start, or are kept from before
//   testing ──failed──▶ settings (say why)      a changed setting asks for a new test, choices kept
//   idle ──Save, only if canSave──▶ saving ──ok──▶ saved
//   saving ──failed──▶ idle (the words shown)   saving ──someone saved first──▶ conflict
//   conflict ──Load the latest version──▶ idle, on the latest revision, the choices kept
//
// A test or a save answer that comes after a newer one began is not this flow's to show.

/** A test of the settings: which one it is, what it tested, and how it went. */
export type Testing = {
  /** Which test this is: an answer to an older one is dropped. */
  run: number
  /** The settings it tested, so a change to them asks for a new test. */
  of: string
  running: boolean
  result: ConnectTest | null
  error: string | null
}

export const untested: Testing = { run: 0, of: '', running: false, result: null, error: null }

/** A key file uploaded: its name, and the account it signs in as, when known. */
export type KeyFile = { name: string; account: string | null }

/** What is chosen to read, kept from the first test that could read until the flow ends. */
export type Choices = {
  /** A definitions tool reads every view, or only those picked: an allow list. */
  readsAll: boolean
  /** The rows ticked, as the list's selection keeps them. */
  picked: Selection
  /** Each row's domain; none leaves a view shared. */
  map: Record<string, DomainId | null>
  /** Why it is added or changed, kept in the history log. */
  why: string
}

export type Save =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  /** Someone else saved the source after the flow read it: nothing is saved over it unseen. */
  | { kind: 'conflict'; failure: string }

export type FlowState = {
  values: ConnectValues
  files: Record<string, KeyFile>
  test: Testing
  /** Null until a test could read. */
  choices: Choices | null
  /** The source's revision a change is saved over; null to connect a tool anew. */
  revision: number | null
  save: Save
}

export type FlowEvent =
  | { type: 'field'; key: string; value: string }
  | { type: 'secret'; key: string; value: string }
  | { type: 'file'; key: string; text: string; file: KeyFile }
  | { type: 'test'; of: string }
  /** `start` is what a first test that could read begins with. */
  | { type: 'tested'; run: number; result: ConnectTest; start: Choices }
  | { type: 'testFailed'; run: number; error: string }
  | { type: 'readsAll'; on: boolean }
  | { type: 'pick'; update: Selection | ((picked: Selection) => Selection) }
  | { type: 'domain'; id: string; domain: DomainId | null }
  | { type: 'why'; text: string }
  | { type: 'save' }
  | { type: 'saved' }
  | { type: 'failed' }
  | { type: 'refused'; failure: string }
  /** The latest version was read after a conflict. */
  | { type: 'reloaded'; revision: number }

/** The flow as it opens on a form. */
export function opening(form: ConnectForm): FlowState {
  return {
    values: {
      config: Object.fromEntries(form.fields.map((f) => [f.key, f.value])),
      secrets: Object.fromEntries(form.secrets.map((s) => [s.key, ''])),
    },
    files: Object.fromEntries(form.secrets.flatMap((s) => (s.file ? [[s.key, s.file]] : []))),
    test: untested,
    choices: null,
    revision: form.source?.revision ?? null,
    save: { kind: 'idle' },
  }
}

/** The views or folders a test found, after those a definitions tool reads that the model lost. */
export function rowsOf(form: ConnectForm, scopes: ConnectScope[], definitions: boolean) {
  // A view it reads that the model no longer has stays in the list, ticked, so it is seen.
  const found = new Set(scopes.map((s) => s.id))
  const gone =
    !definitions || form.readsAll
      ? []
      : form.chosen
          .filter((choice) => !found.has(choice.id))
          .map((choice): ConnectScope => ({
            id: choice.id,
            title: choice.title,
            detail: 'Not in the model',
          }))
  return [...gone, ...scopes]
}

/** What a first test that could read begins with: what the tool reads now, or what it found. */
export function startChoices(
  form: ConnectForm,
  scopes: ConnectScope[],
  { definitions, why, domains }: { definitions: boolean; why: string; domains: Set<DomainId> },
): Choices {
  const before = new Map(form.chosen.map((choice) => [choice.id, choice.domain]))
  const rows = rowsOf(form, scopes, definitions)
  const ids = rows.map((s) => s.id)
  // A tool connected starts from what it reads; a new one from everything found, but what is left
  // out at first.
  const initial = form.source
    ? !form.readsAll || (!definitions && before.size)
      ? ids.filter((i) => before.has(i))
      : ids
    : scopes.filter((s) => !s.leftOut).map((s) => s.id)
  return {
    readsAll: definitions && form.readsAll,
    picked: { ...NONE, ids: initial, base: initial },
    // A domain the tool suggests goes in only when it is one of the workspace's.
    map: Object.fromEntries(
      rows.map((s) => {
        const domain = before.has(s.id) ? (before.get(s.id) ?? null) : (s.domain ?? null)
        return [s.id, domain && domains.has(domain) ? domain : null]
      }),
    ),
    why,
  }
}

/**
 * The choices after another test: kept as they were, with what it newly found mapped as found and,
 * while every view is read, ticked.
 */
function kept(choices: Choices, start: Choices): Choices {
  const found = Object.keys(start.map).filter((id) => !(id in choices.map))
  const ids = choices.readsAll
    ? [...choices.picked.ids, ...found.filter((id) => !choices.picked.ids.includes(id))]
    : choices.picked.ids
  return {
    ...choices,
    picked: ids === choices.picked.ids ? choices.picked : { ...choices.picked, ids, base: ids },
    map: { ...start.map, ...choices.map },
  }
}

const choose = (s: FlowState, change: (c: Choices) => Choices): FlowState =>
  s.choices && s.save.kind === 'idle' ? { ...s, choices: change(s.choices) } : s

/** The next state; the same object when the event does not apply, so a caller can tell. */
export function flow(s: FlowState, e: FlowEvent): FlowState {
  switch (e.type) {
    case 'field':
      return { ...s, values: { ...s.values, config: { ...s.values.config, [e.key]: e.value } } }
    case 'secret':
      return { ...s, values: { ...s.values, secrets: { ...s.values.secrets, [e.key]: e.value } } }
    case 'file':
      return {
        ...s,
        values: { ...s.values, secrets: { ...s.values.secrets, [e.key]: e.text } },
        files: { ...s.files, [e.key]: e.file },
      }
    case 'test':
      return { ...s, test: { ...untested, run: s.test.run + 1, of: e.of, running: true } }
    case 'tested':
      if (e.run !== s.test.run) return s
      return {
        ...s,
        test: { ...s.test, running: false, result: e.result },
        choices: !e.result.ok ? s.choices : s.choices ? kept(s.choices, e.start) : e.start,
      }
    case 'testFailed':
      return e.run === s.test.run
        ? { ...s, test: { ...s.test, running: false, error: e.error } }
        : s
    case 'readsAll':
      return choose(s, (c) => ({ ...c, readsAll: e.on }))
    case 'pick':
      return choose(s, (c) => ({
        ...c,
        picked: typeof e.update === 'function' ? e.update(c.picked) : e.update,
      }))
    case 'domain':
      return choose(s, (c) => ({ ...c, map: { ...c.map, [e.id]: e.domain } }))
    case 'why':
      return choose(s, (c) => ({ ...c, why: e.text }))
    case 'save':
      return s.save.kind === 'idle' && s.choices ? { ...s, save: { kind: 'saving' } } : s
    case 'saved':
      return s.save.kind === 'saving' ? { ...s, save: { kind: 'saved' } } : s
    case 'failed':
      return s.save.kind === 'saving' ? { ...s, save: { kind: 'idle' } } : s
    case 'refused':
      return s.save.kind === 'saving' ? { ...s, save: { kind: 'conflict', failure: e.failure } } : s
    case 'reloaded':
      return s.save.kind === 'conflict' ? { ...s, revision: e.revision, save: { kind: 'idle' } } : s
  }
}

/**
 * Whether Save may be pressed, from the whole state: settings tested as they are, something chosen,
 * every folder of a content tool mapped, a reason given, and nothing on its way or refused.
 */
export function canSave(
  s: FlowState,
  {
    tested,
    chosen,
    mapped,
    definitions,
  }: {
    tested: boolean
    chosen: number
    mapped: number
    definitions: boolean
  },
) {
  return (
    tested &&
    s.save.kind === 'idle' &&
    !!s.choices?.why.trim() &&
    chosen > 0 &&
    (definitions || mapped === chosen)
  )
}
