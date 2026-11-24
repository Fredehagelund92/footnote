/**
 * Settings › Integrations on the http binding: the service's sources (`sources.list`), a source's
 * activity (`sources.activity`) and its settings (`sources.get`), in the words the integrations'
 * pages use. Pure, so it is unit tested (tests/web/api/http-integrations.test.ts).
 */
import { dayMonth, dayMonthYear } from '@/lib/dates'
import { secretsInUse } from '@domain/connector-config'
import type { ConnectorManifest } from '@domain/connector-manifest'
import type {
  SourceActivity,
  SourceCheck,
  SourceDocumentState,
  SourceReadEntry,
  SourceRow,
  SourceSettings,
} from '@contract/sources'
import {
  firstReadWords,
  type Activity,
  type ConnectChoice,
  type ConnectField,
  type ConnectForm,
  type ConnectRead,
  type ConnectTest,
  type DocState,
  type DriveDocument,
  type DriveFolder,
  type IntegrationsView,
  type Source,
  type SourcePage,
  type When,
} from '@/model/integrations'
import { connectorById, connectors } from '@/model/catalogue'

const twoDigits = (n: number) => String(n).padStart(2, '0')
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** A moment as the pages say it, in the reader's time zone: "Today", "Tomorrow", "21 Oct". */
export function whenOf(at: string, now: Date): When {
  const t = new Date(at)
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(t) - day(now)) / 86_400_000)
  const time = `${twoDigits(t.getHours())}:${twoDigits(t.getMinutes())}`
  const named =
    days === 0
      ? 'Today'
      : days === 1
        ? 'Tomorrow'
        : days === -1
          ? 'Yesterday'
          : t.getFullYear() === now.getFullYear()
            ? dayMonth(t)
            : dayMonthYear(t)
  const hours = Math.floor((now.getTime() - t.getTime()) / 3_600_000)
  const ago =
    hours < 1
      ? undefined
      : hours < 48
        ? `${plural(hours, 'hour')} ago`
        : `${plural(Math.floor(hours / 24), 'day')} ago`
  return { day: named, time, ...(ago ? { ago } : {}) }
}

/** An ISO 8601 duration of days, hours and minutes, in minutes. */
export function minutesOf(duration: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(duration)
  if (!m) return 0
  return Number(m[1] ?? 0) * 1_440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}

/** How long, in words: "6 hours", "2 days", "15 minutes". */
export function durationWords(duration: string): string {
  const minutes = minutesOf(duration)
  if (minutes % 1_440 === 0 && minutes >= 1_440) return plural(minutes / 1_440, 'day')
  if (minutes % 60 === 0 && minutes >= 60) return plural(minutes / 60, 'hour')
  return plural(minutes, 'minute')
}

/** How often, in words: "every hour", "every day", "every 15 minutes". */
export function everyWords(duration: string): string {
  const words = durationWords(duration)
  return `every ${words.replace(/^1 /, '')}`
}

/** Why a read failed, by the first warning that says so. */
const FAILURES: Record<string, string> = {
  unauthorized: 'the key was refused',
  secret_missing: 'it has no key',
  unreachable: "it couldn't be reached",
  not_found: "what it reads wasn't found",
  rate_limited: 'it was asked too often',
  timeout: 'it took too long',
  timed_out: 'it took too long',
  unreadable_file: 'it is too large, or not text',
  fetch_failed: 'the site that keeps it did not send it',
  git_missing: 'the server has no git program to read a repository with',
  private_address: 'its address is not one it may reach: use https, on a public host',
  redirect_refused: 'it redirects somewhere it may not follow',
  folder_missing: "the folder it reads isn't there",
  ref_not_found: "the branch or tag isn't in the repository",
  no_model_files: 'the folder holds no model files',
  compile_error: 'the model has a mistake the tool cannot read past',
  compile_timeout: 'the model took too long to read',
}

/** What to do when a test could not read, by the code of why. */
const FIXES: Record<string, string> = {
  unauthorized: 'Check that the token can read it, then replace it under Change settings.',
  secret_missing: 'Give it its key again under Change settings.',
  unreachable: 'Check the address, and that the host is up, then test again.',
  not_found: 'Check the address and the folder in its settings.',
  timed_out: 'Test again in a moment.',
  folder_missing:
    'Check the folder in its settings. A folder on the server is set by the person who hosts this app.',
  ref_not_found: 'Check the branch or tag in its settings.',
  no_model_files: 'Point it at the folder that holds the model files.',
  compile_error: 'Fix the model in the tool, then test again.',
  compile_timeout: 'Test again in a moment, or read fewer views.',
  private_address: 'Use an https address on a public host.',
}

/** Why a read failed, by the first of its warnings that says so. */
const failureWords = (warnings: readonly { code: string }[]) => {
  for (const warning of warnings) {
    const words = FAILURES[warning.code]
    if (words) return `${words} (${warning.code})`
  }
  return "it couldn't be read"
}

export function failureOf(read: SourceReadEntry): string {
  return failureWords(read.warnings)
}

/** Why a document was not offered. */
const SKIPPED: Record<string, string> = {
  document_names_people: 'it names people',
  names_people: 'it names people',
  document_holds_secret: 'it holds a secret',
  holds_secret: 'it holds a secret',
  document_no_scope: 'it applies nowhere',
  no_scope: 'it applies nowhere',
  document_empty: 'it has no words',
  empty: 'it has no words',
}
const skippedWords = (code: string) => SKIPPED[code] ?? "it couldn't be offered"

/** Why documents were skipped, each reason once: "names people, applies nowhere". */
const whySkipped = (skips: readonly string[]) =>
  [...new Set(skips)].map((why) => why.replace(/^it /, '')).join(', ')

/** The skips of a read, one reason per document skipped. */
const skipsOf = (read: SourceReadEntry) =>
  read.warnings.flatMap((w) =>
    w.code.startsWith('document_') && w.code !== 'document_too_long'
      ? Array.from({ length: w.count }, () => skippedWords(w.code))
      : [],
  )

/** How a source is, with its next read as the pages say a moment. */
function statusOf(state: SourceRow['state'], now: Date): Source['state'] {
  if (state.intent === 'paused') return state
  const { nextReadAt, ...active } = state
  return { ...active, next: whenOf(nextReadAt, now) }
}

/** A source as the integrations' rows show it; null for a tool the app has no cell for. */
export function sourceOf(row: SourceRow, now: Date): Source | null {
  const connector = connectorById(row.type)?.id
  if (!connector) return null
  const last = row.lastRead
  const failed = last?.status === 'failed'
  const documents = row.documents
  const created =
    last && !failed && last.documents && last.documents.suggested > 0
      ? {
          suggested: last.documents.suggested,
          replaced: last.documents.replaced,
          skipped: skipsOf(last),
        }
      : null
  return {
    id: row.id,
    connector,
    state: statusOf(row.state, now),
    every: everyWords(row.schedule),
    staleAfter: durationWords(row.staleAfter),
    last: last
      ? {
          at: whenOf(last.at, now),
          seconds:
            last.durationMs === null ? null : Math.max(1, Math.round(last.durationMs / 1000)),
          seen: last.definitions?.seen ?? last.documents?.seen ?? 0,
        }
      : null,
    lastGood: failed && row.lastGoodAt ? whenOf(row.lastGoodAt, now) : null,
    failures: row.failures,
    failure: failed ? failureOf(last) : null,
    definitions: row.definitions
      ? {
          metrics: row.definitions.metrics,
          dimensions: row.definitions.dimensions,
          views: row.definitions.groups,
          noDomain: row.definitions.groupsWithoutDomain,
          notSelected: row.definitions.notSelected,
          flagged: row.definitions.flagged,
        }
      : null,
    documents: documents
      ? {
          held: documents.held,
          waiting: documents.waiting,
          domains: documents.waitingDomains,
          madeToday: documents.madeToday,
          perDay: documents.perDay,
        }
      : null,
    created,
    // The Inbox lists a read's suggestions under the read that made them.
    inbox: documents?.waiting ? '/inbox' : null,
    added: row.addedAt ? { by: row.addedBy, when: dayOf(row.addedAt, now) } : null,
  }
}

/** A day as the pages say it: "Today", "Yesterday" or "1 Oct". */
const dayOf = (at: string, now: Date) => whenOf(at, now).day

/** Settings › Integrations: the tools the service reads, and which others it can connect. */
export function integrationsOf(
  rows: readonly SourceRow[],
  types: readonly { manifest: Pick<ConnectorManifest, 'id' | 'config'> }[],
  now: Date,
): IntegrationsView {
  const offered = new Set(
    types.flatMap(({ manifest }) => (formTakes(manifest) ? [manifest.id] : [])),
  )
  return {
    sources: rows.flatMap((row) => {
      const source = sourceOf(row, now)
      return source ? [source] : []
    }),
    // What the service offers and the form can take, in the catalogue's order.
    connectable: connectors.flatMap((c) => (offered.has(c.id) ? [c.id] : [])),
  }
}

/** One read, as a source's Activity lists it. */
export function activityOf(read: SourceReadEntry, tool: string, now: Date): Activity {
  const at = whenOf(read.at, now)
  const when = `${at.day}, ${at.time}`
  if (read.status === 'failed') {
    const refused = read.warnings.some((w) => w.code === 'unauthorized')
    return {
      when,
      tone: 'failed',
      what: refused ? 'Read refused' : 'Read failed',
      detail: refused
        ? `${tool} refused the key.`
        : `${failureOf(read).replace(/^./, (c) => c.toUpperCase())}.`,
    }
  }
  const what = read.first
    ? 'First read'
    : read.status === 'partial'
      ? 'Read in part'
      : 'Read complete'
  if (read.definitions) {
    const { seen, added, changed, gone } = read.definitions
    // The views chosen to read that it could not: none chosen, or one the model does not have.
    const unread = read.warnings.find((w) => w.code === 'group_not_found')?.count ?? 0
    const listed = read.warnings.some((w) => w.code === 'no_groups_chosen')
      ? ['no view chosen, so nothing is read']
      : unread
        ? [`${unread === 1 ? '1 chosen view is' : `${unread} chosen views are`} not in the model`]
        : []
    // Read, not added: nothing a read finds is published until an owner says so on the Names card.
    if (read.first)
      return {
        when,
        tone: listed.length ? 'changed' : 'ok',
        what,
        detail: [`${plural(added, 'definition')} read`, ...listed].join(', '),
      }
    const parts = [
      changed && `${plural(changed, 'definition')} changed`,
      added && `${added} new`,
      gone && `${gone} gone`,
      ...listed,
    ].filter(Boolean)
    return parts.length
      ? { when, tone: 'changed', what, detail: parts.join(', ') }
      : {
          when,
          tone: read.status === 'partial' ? 'changed' : 'ok',
          what,
          detail: `${plural(seen, 'definition')}, no changes`,
        }
  }
  const d = read.documents ?? {
    seen: 0,
    suggested: 0,
    replaced: 0,
    withdrawn: 0,
    waiting: 0,
    skipped: 0,
  }
  const skips = skipsOf(read)
  const parts = [
    d.suggested && plural(d.suggested, 'new suggestion'),
    d.replaced && `${d.replaced} replaced an open one`,
    d.withdrawn && `${d.withdrawn} withdrawn`,
    d.waiting && `${d.waiting} waiting for the next read`,
    d.skipped && `${d.skipped} skipped${skips.length ? `: ${whySkipped(skips)}` : ''}`,
  ].filter(Boolean)
  if (read.first)
    return {
      when,
      tone: 'ok',
      what,
      detail: [plural(d.seen, 'document'), d.suggested && plural(d.suggested, 'suggestion')]
        .filter(Boolean)
        .join(', '),
    }
  return parts.length
    ? { when, tone: 'changed', what, detail: parts.join(', ') }
    : {
        when,
        tone: read.status === 'partial' ? 'changed' : 'ok',
        what,
        detail: `${plural(d.seen, 'document')}, no changes`,
      }
}

/** What became of a document, in the pages' words. */
const docStates: Record<SourceDocumentState, DocState> = {
  suggested: 'waiting',
  published: 'published',
  returned: 'returned',
  declined: 'declined',
  withdrawn: 'withdrawn',
  held: 'held',
  skipped: 'skipped',
  gone: 'gone',
}

/** A document a read looked at, as Recent documents lists it. */
export function documentOf(d: SourceActivity['documents'][number], now: Date): DriveDocument {
  const state = docStates[d.state]
  const by = d.decidedBy?.split(' ')[0]
  const note =
    state === 'skipped'
      ? `Skipped: ${skippedWords(d.skipReason ?? '').replace(/^it /, '')}`
      : state === 'returned' && by
        ? `Returned by ${by}`
        : state === 'declined' && by
          ? `Declined by ${by}`
          : undefined
  return {
    title: d.title,
    folder: d.scope,
    ...(d.domain ? { domain: d.domain } : {}),
    state,
    ...(note ? { note } : {}),
    read: dayOf(d.readAt, now),
    ...(state === 'waiting' && d.proposalId ? { href: `/inbox?card=${d.proposalId}` } : {}),
  }
}

/** A scope a content source reads ("Data team / Definitions"), as its folder and path. */
export function folderOf(scope: SourceActivity['scopes'][number]): DriveFolder {
  const [folder = scope.title, ...rest] = scope.title.split(' / ')
  return { folder, path: rest.join(' / '), domain: scope.domain, documents: scope.documents }
}

/** A setting written as JSON, in words: how many entries its list has, never the list itself. */
function jsonWords(text: string): string {
  try {
    const value: unknown = JSON.parse(text)
    if (Array.isArray(value)) return `A list of ${plural(value.length, 'entry', 'entries')}`
  } catch {
    // Not JSON the connector reads: the source says so when it reads.
  }
  return 'Written in its settings'
}

/** How a source is connected, setting by setting, in its connector's words; never a secret. */
export function connectionOf(
  settings: SourceSettings | null,
  manifest: Pick<ConnectorManifest, 'config' | 'secrets'> | undefined,
): SourcePage['connection'] {
  if (!settings || !manifest)
    return [{ label: 'Settings', value: 'Set by the person who hosts this app' }]
  const fields = manifest.config.fields.flatMap((field) => {
    const value = settings.config[field.key]
    if (value === undefined || value === '' || typeof value === 'object') return []
    const chosen = field.options?.find((option) => option.value === value)?.label
    return [
      {
        label: field.label,
        value: chosen ?? (field.kind === 'json' ? jsonWords(String(value)) : String(value)),
        ...(field.kind === 'address' || field.kind === 'ref' || field.kind === 'path'
          ? { code: true }
          : {}),
      },
    ]
  })
  const secrets = secretsInUse(manifest, settings.config).map((secret) => ({
    label: secret.label,
    value: settings.secrets.find((s) => s.key === secret.key)?.set
      ? 'Set, only used for reading'
      : 'Not set',
  }))
  return [...fields, ...secrets]
}

/** One source's page: its row, what it reads, its documents, its reads, and how it is connected. */
export function sourcePageOf(
  row: SourceRow,
  activity: SourceActivity,
  settings: SourceSettings | null,
  manifest: Pick<ConnectorManifest, 'config' | 'secrets'> | undefined,
  now: Date,
): SourcePage | null {
  const source = sourceOf(row, now)
  if (!source) return null
  const changed = activity.reads.find((r) => !r.first && (r.definitions?.changed ?? 0) > 0)
  const reads = activity.reads.map((read) => activityOf(read, row.tool, now))
  const firstAt = firstReadWords(source.state)
  const connected =
    !reads.length && source.added
      ? [
          {
            when: source.added.when,
            tone: 'ok' as const,
            what: 'Connected',
            detail: `First read ${firstAt}. Reading publishes nothing.`,
          },
        ]
      : []
  return {
    source,
    views: activity.groups.map((g) => ({
      view: g.name,
      metrics: g.metrics,
      dimensions: g.dimensions,
      ...(g.domain ? { domain: g.domain } : {}),
    })),
    changedOn: changed ? dayOf(changed.at, now) : null,
    folders: activity.scopes.map(folderOf),
    documents: activity.documents.map((d) => documentOf(d, now)),
    activity: [...reads, ...connected],
    connection: connectionOf(settings, manifest),
  }
}

/* ---------- the connect flow and Change settings ---------- */

/** The kinds of setting the connect form draws: words, an address, a choice, a branch, JSON. */
const formKinds: readonly string[] = ['text', 'address', 'path', 'ref', 'json', 'radio', 'select']

/**
 * Whether the connect form can take a connector's settings: every one it needs is of a kind the
 * form draws. A setting of another kind (a map of domain names) is left out only when it may be
 * left empty; a connector that needs one is not connectable here.
 */
export const formTakes = (manifest: Pick<ConnectorManifest, 'config'>) =>
  manifest.config.fields.every((field) => !field.required || formKinds.includes(field.kind))

const scopeChoice = (scope: SourceSettings['scopes'][number]): ConnectChoice => ({
  id: scope.id,
  title: scope.title,
  domain: scope.domain,
})

/**
 * A tool's connect form from its connector's manifest: its settings, with what is set or their
 * defaults, and its secrets, each only as set or not (never their value). With a source's
 * settings, it is that source's Change settings; without, a new connection. A definitions source
 * the server's configuration selects has neither settings nor secrets here: its form only chooses
 * what it reads.
 */
export function connectFormOf(
  manifest: Pick<
    ConnectorManifest,
    'id' | 'kind' | 'config' | 'secrets' | 'schedule' | 'staleAfter' | 'limits'
  >,
  settings: SourceSettings | null,
  secretStore = true,
): ConnectForm | null {
  const connector = connectorById(manifest.id)?.id
  // The server's own source has nothing to fill in: only what it reads is chosen here.
  const server = settings?.origin === 'server'
  if (
    !connector ||
    (server && manifest.kind !== 'definitions') ||
    (!server && !formTakes(manifest))
  )
    return null
  const fields = manifest.config.fields.flatMap((field): ConnectField[] => {
    if (server || !formKinds.includes(field.kind)) return []
    const set = settings?.config[field.key]
    // A new connection starts from the manifest's default; a source's form from what it has, and
    // a default for what it needs and has none of, such as the settings of a route it is not on.
    const value =
      typeof set === 'string' || typeof set === 'number'
        ? String(set)
        : (!settings || field.required) && typeof field.default === 'string'
          ? field.default
          : ''
    return [
      {
        key: field.key,
        kind: field.kind as ConnectField['kind'],
        label: field.label,
        description: field.description,
        ...(field.placeholder ? { placeholder: field.placeholder } : {}),
        ...(field.maxLength ? { maxLength: field.maxLength } : {}),
        ...(field.options ? { options: field.options } : {}),
        ...(field.visibleIf ? { visibleIf: field.visibleIf } : {}),
        required: field.required ?? false,
        advanced: field.advanced ?? false,
        value,
      },
    ]
  })
  return {
    connector,
    source: settings ? { id: settings.id, revision: settings.revision } : null,
    server,
    fields,
    secrets: (server ? [] : manifest.secrets).map((secret) => ({
      key: secret.key,
      label: secret.label,
      description: secret.description,
      required: secret.required ?? false,
      ...(secret.visibleIf ? { visibleIf: secret.visibleIf } : {}),
      set: settings?.secrets.find((s) => s.key === secret.key)?.set ?? false,
    })),
    every: everyWords(settings?.schedule ?? manifest.schedule.default),
    staleAfter: durationWords(manifest.staleAfter),
    perDay: manifest.kind === 'content' ? (manifest.limits.draftsPerDay ?? null) : null,
    chosen: (settings?.scopes ?? []).map(scopeChoice),
    kept: (settings?.kept ?? []).map(scopeChoice),
    readsAll: settings?.allGroups ?? true,
    secretStore,
  }
}

/** A read's warnings the core words, as a test's result says them. */
const READ_WARNINGS: Record<string, { title: string; detail: string }> = {
  missing_domain: {
    title: 'No domain named',
    detail: 'Map it to a domain in the next steps, or name its domain in the tool.',
  },
  invalid_domain: {
    title: 'A domain we do not have',
    detail: 'The tool names a domain that is not one of yours. Map it in the next steps.',
  },
  taken: {
    title: 'Read by another source',
    detail: 'It stays with that source, and this one leaves it out.',
  },
  too_many_records: { title: 'Too much to read at once', detail: 'The rest is left out.' },
  unsupported_file: {
    title: 'A file was skipped',
    detail: 'It is not plain YAML, so nothing in it is read. Jinja and Python are never run.',
  },
  unreadable_file: {
    title: 'A file could not be read',
    detail: 'It is a link, too large or not text, so nothing in it is read.',
  },
  group_not_found: {
    title: 'A chosen view is not in the model',
    detail: 'Nothing is read for it. Leave it out, or add it to the model.',
  },
  no_groups_chosen: {
    title: 'No view chosen',
    detail: 'Nothing is read. Choose the views to read.',
  },
  invalid_family: {
    title: 'A family we cannot read',
    detail:
      'Its meta.footnote names a family without a by, or with a by we cannot keep. The metric is read on its own.',
  },
  family_one_member: {
    title: 'A family of one metric',
    detail: 'Only one metric names this family in meta.footnote, so it is read on its own.',
  },
  family_two_views: {
    title: 'A family in two views',
    detail: 'The metrics that name this family are in different views, so each is read on its own.',
  },
  family_two_kinds: {
    title: 'A family with a dimension in it',
    detail: 'Only metrics make a family. Its members are read on their own.',
  },
  family_axes_differ: {
    title: 'A family told apart in two ways',
    detail:
      'Its metrics name different keys under by, so each is read on its own. Give them the same keys.',
  },
  family_same_values: {
    title: 'A family with two of the same',
    detail:
      'Two of its metrics name the same values under by, so each is read on its own. Give each its own value.',
  },
  family_words_differ: {
    title: 'A family described two ways',
    detail:
      'Its metrics give different words under family_description, so the family is read without them. Give them the same words.',
  },
}

/** A read's warnings, each kind once with how many there are, in the words of who says them. */
/** The warnings about one file of the tool's, which name the file. */
const FILE_WARNINGS = new Set(['unsupported_file', 'unreadable_file'])
/** How many files a warning names before it only counts them. */
const FILES_SHOWN = 5

function readWarnings(
  warnings: SourceCheck['warnings'],
  own: ConnectorManifest['warnings'] = {},
): ConnectRead['warnings'] {
  const found = new Map<string, ConnectRead['warnings'][number]>()
  for (const { code, target } of warnings) {
    const name = code.slice(code.lastIndexOf('.') + 1)
    // A file left out is named: someone looks for it in the model.
    const file = FILE_WARNINGS.has(code) ? [target] : []
    const seen = found.get(code)
    if (seen) {
      seen.count += 1
      if (seen.files && seen.files.length < FILES_SHOWN) seen.files.push(...file)
    } else
      found.set(code, {
        title: name.replaceAll('_', ' '),
        ...(own[name] ?? READ_WARNINGS[code]),
        count: 1,
        ...(file.length ? { files: file } : {}),
      })
  }
  return [...found.values()]
}

/** Why a test could not read, by the first warning that says so: the connector's own words first. */
function testFailureOf(
  warnings: SourceCheck['warnings'],
  type: string | undefined,
  own: ConnectorManifest['warnings'] = {},
): string {
  for (const { code } of warnings) {
    const mine =
      type !== undefined && code.startsWith(`${type}.`)
        ? own[code.slice(type.length + 1)]
        : undefined
    if (mine) return `${mine.title}. ${mine.detail}`
    const words = FAILURES[code]
    if (words) return `It couldn't be read: ${words}.`
  }
  return "It couldn't be read."
}

/** What to do about a test that could not read, by the first warning that has a fix. */
const testFixOf = (warnings: SourceCheck['warnings']) =>
  warnings.flatMap(({ code }) => FIXES[code] ?? [])[0]

/** The words one split takes: "eur, usd, gbp and 47 more". */
const splitWords = ({ words, examples }: { words: number; examples: string[] }) =>
  words > examples.length
    ? `${examples.join(', ')} and ${(words - examples.length).toLocaleString('en-GB')} more`
    : examples.length > 1
      ? `${examples.slice(0, -1).join(', ')} and ${examples.at(-1)}`
      : (examples[0] ?? '')

/** Whether the families found hold at least half of the metrics that look like variants. */
function coversMost(
  families: SourceCheck['families'],
  variants: NonNullable<SourceCheck['variants']>,
) {
  return !!families && families.metrics * 2 >= variants.variants
}

/**
 * What a read that looks like a metric per currency or channel says, before its names are
 * published, when it finds no family of them: Test connection then leads with the families (D5).
 */
export function variantsWords(shape: NonNullable<SourceCheck['variants']>) {
  const n = (count: number) => count.toLocaleString('en-GB')
  const splits = shape.splits.map(splitWords).join(', and by ')
  return {
    title: 'Many metrics look like variants of a few',
    detail: `${n(shape.variants)} of ${n(shape.metrics)} metrics look like ${n(shape.bases)} metrics, each split by ${splits}. One metric each, with these as dimensions, works best.`,
  }
}

/** What Test connection found, in the flow's words: the check's steps, and what may be read. */
export function connectTestOf(check: SourceCheck, type?: string): ConnectTest {
  const connector = type === undefined ? undefined : connectorById(type)
  const scopes = (check.scopes ?? []).map((scope) => {
    const holds =
      scope.metrics === undefined && scope.dimensions === undefined
        ? ''
        : [
            scope.metrics ? plural(scope.metrics, 'metric') : '',
            scope.dimensions ? plural(scope.dimensions, 'dimension') : '',
          ]
            .filter(Boolean)
            .join(', ')
    return {
      id: scope.id,
      title: scope.title,
      detail: holds,
      ...(scope.metrics === undefined ? {} : { metrics: scope.metrics }),
      ...(scope.dimensions === undefined ? {} : { dimensions: scope.dimensions }),
      ...(scope.suggestedDomain ? { domain: scope.suggestedDomain } : {}),
    }
  })
  const steps = check.steps.map((step) => ({
    title: step.title,
    status: step.status,
    ...(step.detail ? { detail: step.detail } : {}),
    ...(step.fix ? { fix: step.fix } : {}),
  }))
  const said = steps.some((step) => step.status === 'failed')
  return {
    ok: check.ok,
    steps,
    scopes: check.ok ? scopes : [],
    ...(check.ok || said
      ? {}
      : {
          failure: testFailureOf(check.warnings, type, connector?.warnings),
          ...(testFixOf(check.warnings) ? { fix: testFixOf(check.warnings) } : {}),
        }),
    ...(check.ok && connector?.kind === 'definitions'
      ? {
          read: {
            metrics: check.metrics,
            dimensions: check.dimensions,
            warnings: readWarnings(check.warnings, connector.warnings),
            ...(check.families ? { families: check.families } : {}),
            ...(check.variants && !coversMost(check.families, check.variants)
              ? { variants: variantsWords(check.variants) }
              : {}),
          },
        }
      : {}),
    ...(check.ok && check.chosen ? { chosen: check.chosen } : {}),
  }
}

/** The form's settings as the service keeps them: each one written, trimmed; none left empty. */
export function configOf(config: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(config).flatMap(([key, value]) => (value.trim() ? [[key, value.trim()]] : [])),
  )
}

/**
 * Change settings' settings: the source's own, with each the form draws as the form says it; a
 * setting the form does not draw (a map of domain names) stays as it was.
 */
export function changedConfigOf(
  before: SourceSettings['config'],
  form: Readonly<Record<string, string>>,
): SourceSettings['config'] {
  const config = { ...before }
  for (const [key, value] of Object.entries(form))
    if (value.trim()) config[key] = value.trim()
    else delete config[key]
  return config
}

/** The secrets written in the form; one left empty is not sent, so the stored one stays. */
export const secretsOf = (secrets: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(Object.entries(secrets).filter(([, value]) => value !== ''))

/** What was chosen to read, as the service keeps it: each with its domain, or none. */
export const scopesOf = (chosen: readonly ConnectChoice[]) =>
  chosen.map((choice) => ({ id: choice.id, title: choice.title, domain: choice.domain }))
