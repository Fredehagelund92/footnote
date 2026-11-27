import * as React from 'react'
import { useEditor } from '@tiptap/react'
import {
  ArchiveIcon,
  CalendarIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleDashedIcon,
  FilePenLineIcon,
  CircleAlertIcon,
  FlaskConicalIcon,
  RefreshCwIcon,
  PanelRightIcon,
  FolderIcon,
  GlobeIcon,
  LinkIcon,
  MapPinIcon,
  ShapesIcon,
  ShieldAlertIcon,
  SparklesIcon,
  TriangleAlertIcon,
  UserIcon,
} from '@/components/icons'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { RichTextEditor } from '@/components/editor'
import { ContextText } from '@/components/footnote/context-text'
import { hostOf } from '@/lib/host'
import { useSideChoice } from '@/lib/side-panel'
import { useSend } from '@/lib/send'
import { useLeaveGuard } from '@/lib/leave-guard'
import { useDraftSession } from '@/lib/draft-session'
import {
  AgentChangeSaid,
  AgentChangeStrip,
  agentMark,
  AgentVersion,
  AgentWroteLine,
  HelpWorkingStrip,
} from '@/components/footnote/agent-change'
import { helpChangeLine, sessionFieldLabel, type SessionField } from '@/model/draft-session'
import {
  moveHelpChat,
  noteHelpChange,
  setHelpDesk,
  stopHelp,
  undoHelp,
  useHelp,
  type HelpDesk,
} from '@/lib/writing-help'
import { useAutosave, type SaveState } from '@/lib/autosave'
import { problemsOf, sourceProblem, type EditorField } from '@/lib/editor-problems'
import { causeIn } from '@/lib/cause-words'
import '@/components/editor/style.css'
import { docExtensions } from '@/lib/doc-extensions'
import { noteEmoji } from '@/lib/emoji-note'
import { conflictPath } from '@/model/conflicts'
import {
  holdLine,
  readinessOf,
  standingLine,
  SUMMARY_LIMIT,
  type Readiness,
} from '@/model/editor-readiness'
import {
  missingDates,
  validOfWhen,
  whenOfPeriod,
  whenOfValid,
  whensOfText,
  whenSummary,
  type WhenMode,
  type WhenValue,
} from '@/lib/when'
import {
  Ghost,
  InlineText,
  PeopleField,
  PickerField,
  PropertyGroup,
  PropertyList,
  PropertyRow,
  SelectField,
  StaticField,
  WhenField,
  type Option,
} from '@/components/footnote/field-controls'
import { NoDomainYet } from '@/components/footnote/no-domain-yet'
import { DomainDot, TagChip } from '@/components/footnote/tag-chip'
import { ScopeField } from '@/components/footnote/scope-field'
import { termsOfNames } from '@/lib/scope'
import { kindIcons } from '@/components/footnote/kind-icons'
import { plainText } from '@/lib/mentions'
import { PersonAvatar } from '@/components/footnote/bits'
import { TextComparison } from '@/components/footnote/source-review'
import { DocFooter, Paper } from '@/components/footnote/doc'
import { ResizableAside } from '@/components/resizable-aside'
import { Page, SiteHeader } from '@/components/site-header'
import { LoadError, NoSuchItem } from '@/components/footnote/load-state'
import { readOf } from '@/lib/read'
import { Loading } from '@/App'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  kindHint,
  kindLabel,
  servedToAgents,
  type DomainId,
  type Fact,
  type Kind,
  type ScopeTerm,
  type Status,
  unpublished,
} from '@/model/items'
import { homeDomain, ownersOf, type Domain, type Domains } from '@/model/people'
import { ApiError, toApiError, type Clash } from '@/api/errors'
import { planFacts, publishParts } from '@/lib/bulk'
import { useUndo } from '@/lib/undo'
import { today } from '@/lib/today'
import { dateLabel, type Validity } from '@/model/validity'
import { closeDock, openDock, useDock } from '@/lib/dock'
import { useReadAhead } from '@/lib/read-ahead'
import { HeaderMore, SaveStatus } from '@/components/footnote/editor-header'
import { Panel, PanelGroup } from '@/components/footnote/panel'
import { ChoiceMenu, ViewToggle } from '@/components/footnote/switches'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { setDraft } from '@/lib/draft'
import { href, navigate, useRoute } from '@/lib/router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Vocabulary } from '@/api'
import type { Relation } from '@/api/client'
import { relationWords } from '@domain/clash-relations'
import { instructionWords } from '@domain/instruction-words'
import {
  draftFromTextQuery,
  draftNowQuery,
  itemPageQuery,
  useInbox,
  useVocabulary,
  useWorkspace,
  useWrite,
} from '@/api/queries'
import { useGlossary, type Definition } from '@/lib/definitions'
import { useDomainList, useDomains, useFact, useFacts, useMe, usePeople } from '@/lib/workspace'
import { useWide } from '@/hooks/use-wide'
import { Kbd } from '@/components/ui/kbd'
import { usePrimaryKey } from '@/hooks/use-primary-key'
import { useIsMobile } from '@/hooks/use-mobile'
import { DocumentEditorShell } from '@/components/footnote/document-shell'
import { WriteWithButton, WriteWithMenuItem } from '@/components/footnote/write-with-agent'
import { finishPrompt, writePrompt } from '@/lib/agents'

// Writing help's dock opens only beside this page, so it comes with this page's code (App.tsx).
export { WritingHelpDock } from '@/pages/writing-help'

// The context editor as a document, the way editorcn's Simple Document Editor template shows one: a
// muted canvas, editorcn's floating toolbar, the title as a large heading, the text as the document,
// and a word count in the footer. The item's fields are a property strip under the title; what
// agents get, the overlaps and the Ready line sit in a side panel. Publish and Save are in the
// header, as in a docs editor. One page for new context, an edit and a suggestion.

type Form = {
  title: string
  body: string
  kind: Kind
  domain: DomainId
  owners: string[]
  status: Status
  /** What it applies to, each term by its vocabulary key (FR-107). */
  where: ScopeTerm[]
  when: WhenMode
  from: string
  until: string
  source: string
  quote: string
  dontConclude: string
}

const BLANK: Form = {
  title: '',
  body: '',
  kind: 'event',
  domain: 'sales',
  owners: [],
  status: 'Live',
  where: [],
  when: 'always',
  from: '',
  until: '',
  source: '',
  quote: '',
  dontConclude: '',
}

/** What the foot says after "Not ready", where it has room for more than those words. */
const notReadyWhy = (r: Readiness) =>
  r.state === 'missing'
    ? `: add ${r.missing.join(', ')}`
    : r.state === 'too-long'
      ? ': shorten the first paragraph'
      : ': say how it relates'

/** An item's scope by key; an item read only as names (a list row, a gap's draft) by its names. */
const scopeOf = (f: Fact, vocabulary: Vocabulary) => f.scope ?? termsOfNames(f.where, vocabulary)

/** The words of "Applies to" in a sentence: "Orders in any market". */
const scopeWords = (terms: ScopeTerm[]) =>
  terms.map((t) => (t.kind === 'dimension' ? `any "${t.name}"` : t.name)).join(' in ')

/**
 * What a new item is about, for the prompt that writes it with an agent: where and when it
 * applies, as the panel says it, and nothing when the form names neither.
 */
const topicOf = (form: Form) =>
  [
    form.where.length ? scopeWords(form.where) : '',
    form.when === 'always' ? '' : whenText(form).replace(/^From/, 'from'),
  ]
    .filter(Boolean)
    .join(', ')

function fromFact(f: Fact, domains: Domains, vocabulary: Vocabulary): Form {
  // From the stored dates, so the editor shows the real ones.
  const w = whenOfValid(f.valid)
  return {
    // A draft with no title yet asks for one: its stand-in is a list's, never words to keep.
    title: f.untitled ? '' : f.title,
    body: [f.summary, f.body].filter(Boolean).join('\n\n'),
    kind: f.kind,
    domain: f.domain,
    owners: ownersOf(f, domains),
    // A draft, or a suggestion waiting for review, is published as Live.
    status: unpublished(f) ? 'Live' : f.status,
    where: scopeOf(f, vocabulary),
    when: w.mode,
    from: w.from,
    until: w.until,
    source: f.source,
    quote: f.quote,
    dontConclude: f.dontConclude,
  }
}

const whenOf = (f: Form): WhenValue => ({ mode: f.when, from: f.from, until: f.until })

/** The stored dates the form says. */
const validOf = (f: Form): Validity => validOfWhen(whenOf(f))

/** The When people read, from the same function as everywhere else once the dates are there. */
const whenText = (f: Form) => whenSummary(whenOf(f))

function toFact(f: Form, id: string, me: string, domains: Domains, original?: Fact): Fact {
  const [summary, ...rest] = f.body.split('\n\n')
  return {
    valid: validOf(f),
    id,
    title: f.title || 'Untitled context item',
    summary: summary ?? '',
    body: rest.join('\n\n') || undefined,
    domain: f.domain,
    // Owners of its own only when they differ from its domain's.
    owners: f.owners.join() === domains[f.domain]?.owners.join() ? undefined : f.owners,
    kind: f.kind,
    where: f.where.map((t) => t.name),
    scope: f.where,
    // Until its dates are picked, an edited item keeps saying what it said.
    when: original && missingDates(whenOf(f)) ? original.when : whenText(f),
    status: f.status,
    checkedBy: me,
    checkedOn: '22 Oct 2026',
    source: f.source,
    quote: f.quote,
    // Left empty, the item says nothing more: the service keeps its default, which agents never get.
    dontConclude: f.dontConclude.trim(),
  }
}

function initialForm(
  fact: Fact | undefined,
  query: URLSearchParams,
  home: DomainId,
  {
    domains,
    vocabulary,
    gapDraft,
    fromText,
    publishes,
    definitionOf,
  }: {
    domains: Domains
    vocabulary: Vocabulary
    gapDraft?: Fact
    fromText?: Fact
    /** A definition by its name, as Definitions reads it: its domain is where an item about it starts. */
    definitionOf: (name: string) => Pick<Definition, 'domain'> | undefined
    /** Whether the writer publishes in a domain: its owner, or an administrator. */
    publishes: (domain: DomainId) => boolean
  },
): Form {
  if (fact) return fromFact(fact, domains, vocabulary)
  if (fromText) return fromFact(fromText, domains, vocabulary)
  // New context starts in the writer's own domain, so an owner publishes rather than suggests.
  const blank = { ...BLANK, domain: home, owners: domains[home]?.owners ?? [] }
  // A Not found card opens its draft, never a blank page, with the draft's own dates.
  if (gapDraft)
    return {
      ...fromFact(gapDraft, domains, vocabulary),
      domain: gapDraft.domain,
      owners: domains[gapDraft.domain]?.owners ?? [],
      when: 'between',
      from: '2026-10-14',
      until: '2026-10-16',
    }
  const metric = query.get('metric')
  const market = query.get('market')
  const about = query.get('about')?.split('|') ?? []
  // Written from a definition or about a question, it starts in the domain of what it is about
  // when the writer publishes there, or owns no domain of their own to start in; else in the first
  // domain they own.
  const own =
    query.get('domain') ??
    [metric, ...about].flatMap((name) => {
      const d = name ? definitionOf(name) : undefined
      return d?.domain ? [d.domain] : []
    })[0]
  const ownDomain = own && Object.hasOwn(domains, own) ? domains[own] : undefined
  const start =
    own && ownDomain && (publishes(own) || !publishes(home))
      ? { domain: own, owners: ownDomain.owners }
      : {}
  // The kind the question makes likely: a rule about a metric, an event about a date; and the days
  // it was read on, which the writer may change.
  const kind = query.get('kind')
  const period = query.get('period')
  const dates = period ? whenOfPeriod(period) : null
  if (metric || market || about.length)
    return {
      ...blank,
      ...start,
      ...(kind && Object.hasOwn(kindLabel, kind) ? { kind: kind as Kind } : {}),
      ...(dates ? { when: dates.mode, from: dates.from, until: dates.until } : {}),
      where: termsOfNames(
        [metric, market, ...about].filter((w): w is string => !!w),
        vocabulary,
      ),
    }
  return blank
}

const countWords = (text: string) =>
  text
    .replace(/[#*_`>[\]()-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length

/* ---------- the property list ---------- */

const STATUS_OPTIONS: Option<Status>[] = [
  { value: 'Live', label: 'Live', hint: 'Agents get it.' },
  {
    value: 'Due for a check',
    label: 'Due for a check',
    hint: 'Agents get it, told it may be out of date.',
  },
  { value: 'Archived', label: 'Archived', hint: 'Agents stop getting it.' },
]
const KIND_OPTIONS = (Object.keys(kindLabel) as Kind[]).map((k) => {
  const Icon = kindIcons[k]
  return {
    value: k,
    label: kindLabel[k],
    hint: kindHint[k],
    icon: <Icon aria-hidden className="size-4 text-muted-foreground" />,
  }
})
// From the workspace as it stands, so a domain added or renamed in Settings is here with its own words.
const domainOptions = (domains: Domain[]) =>
  domains.map((d) => ({
    value: d.id,
    label: d.name,
    hint: d.covers,
    icon: <DomainDot id={d.id} />,
  }))

// Unrelated first: most overlaps keep it. Each answer says what it does when this is published.
const RELATIONS: { value: Relation; label: string; hint: string }[] = [
  { value: 'unrelated', label: 'Unrelated', hint: relationWords.unrelated.hint },
  { value: 'disagree', label: 'Disagrees', hint: relationWords.disagrees.hint },
  { value: 'replaces', label: 'Replaces it', hint: relationWords.replaces.hint },
]
const relationHint = (r: Relation | undefined) => RELATIONS.find((x) => x.value === r)?.hint

/**
 * One overlap as a row: its title, which opens it, and how this relates to it as a menu at the
 * end. Once the answer is more than Unrelated, what it does sits under the title, in amber when
 * publishing archives the live item.
 */
function RelationRow({
  itemId,
  title,
  value,
  onChange,
  titleProps,
  className,
}: {
  itemId: string
  title: string
  value: Relation | undefined
  onChange: (v: Relation) => void
  titleProps: React.ComponentProps<'button'>
  className?: string
}) {
  return (
    // On the first line's baseline, so the answer sits beside the title at any button height.
    <li data-relation={itemId} className={cn('flex items-baseline gap-3', className)}>
      <div className="min-w-0 flex-1 pb-1">
        <button
          type="button"
          className="line-clamp-2 text-left text-sm underline-offset-4 hover:underline"
          {...titleProps}
        >
          {title}
        </button>
        {value && value !== 'unrelated' && (
          <p
            className={cn(
              'mt-0.5 text-xs text-muted-foreground',
              value === 'replaces' && 'text-caution',
            )}
          >
            {relationHint(value)}
          </p>
        )}
      </div>
      <ChoiceMenu
        label={`How this relates to ${title}`}
        options={RELATIONS}
        value={value}
        onChange={onChange}
        quiet="unrelated"
        className="-mr-2"
      />
    </li>
  )
}

/* ---------- the page ---------- */

export function FactEditor(asked: { mode: 'new' | 'edit' | 'suggest'; factId?: string }) {
  const { query } = useRoute()
  // ?draft=norway opens the editor as Draft from text fills it, so that state has a link.
  const fromText = useQuery({
    ...draftFromTextQuery(''),
    enabled: query.get('draft') === 'norway',
  })
  // A new item that kept itself as a draft (?saved=) opens as that draft after a reload. Read once:
  // the address names it while the page is open too, and the page is the same page.
  const [saved] = React.useState(() => (asked.mode === 'new' && query.get('saved')) || undefined)
  const props = saved ? { mode: 'edit' as const, factId: saved } : asked
  // An edit or a suggestion starts from the item's own read, which has its text, source and quote;
  // the list's row is all there is when that read fails.
  const page = useQuery({ ...itemPageQuery(props.factId ?? ''), enabled: !!props.factId })
  const listed = useFact(props.factId)
  const read = readOf(page)
  if (fromText.isFetching || (props.factId && read.state === 'loading'))
    return <Loading shape="editor" />
  if (props.factId) {
    // An item that is not there opens no editor: there is nothing to edit, and Publish would make it.
    if (read.state === 'missing')
      return (
        <Page title="Context">
          <NoSuchItem />
        </Page>
      )
    if (read.state === 'failed' && !listed)
      return (
        <Page title="Context">
          <LoadError what="this context item" onRetry={read.retry} />
        </Page>
      )
  }
  const original = read.state === 'ready' ? read.data.item : listed
  return <Editor {...props} fromText={fromText.data} original={original} />
}

function Editor({
  mode,
  original,
  fromText,
}: {
  mode: 'new' | 'edit' | 'suggest'
  factId?: string
  original?: Fact
  fromText?: Fact
}) {
  const ahead = useReadAhead()
  const facts = useFacts()
  const me = useMe()
  const domains = useDomains()
  const domainList = useDomainList()
  const people = usePeople()
  const vocabulary = useVocabulary()
  const glossary = useGlossary()
  const { cards } = useInbox()
  const write = useWrite()
  const undo = useUndo()
  const queryClient = useQueryClient()
  const { query } = useRoute()
  // Opened from a conflict (Edit this one): the other item stays in view while this one is narrowed.
  const beside = facts.find((f) => f.id === query.get('beside') && f.id !== original?.id)
  // What the page opened with, so an edit or a suggestion that changes nothing can't be sent.
  const [initial] = React.useState<Form>(() =>
    initialForm(original, query, homeDomain(me, domainList)?.id ?? '', {
      domains,
      vocabulary,
      gapDraft: cards.find((c) => c.id === query.get('gap'))?.gap?.draft,
      fromText: mode === 'new' ? fromText : undefined,
      publishes: (domain) => me.admin || me.owns.includes(domain),
      definitionOf: (name) => {
        const d = glossary.find(name)
        return d && glossary.meaningOf(d)
      },
    }),
  )
  const [form, setForm] = React.useState<Form>(initial)
  // The version the words started from: a read of the item since then does not move it, so a Save
  // from this page never takes away what someone else published meanwhile.
  const [base, setBase] = React.useState(original?.version)
  // What agents get now, read after the service refused a Save because someone published since.
  const [newer, setNewer] = React.useState<Fact | null>(null)
  const [sourceOpen, setSourceOpen] = React.useState(false)
  const [mainRef, wide] = useWide<HTMLDivElement>()
  usePrimaryKey()
  const titleRef = React.useRef<HTMLTextAreaElement>(null)
  const [overlap, setOverlap] = React.useState<Record<string, Relation>>({})
  const [pasted, setPasted] = React.useState('')
  // A new item with nothing to start from opens on one box: what the person has, pasted or said,
  // fills the fields by rule (Draft from text), and the fields are then what they check. Written
  // about a question, a definition or a Not found card, it opens on the form that already says so.
  const [starting, setStarting] = React.useState(
    () =>
      mode === 'new' &&
      !fromText &&
      !query.get('gap') &&
      !['metric', 'market', 'about'].some((k) => query.has(k)),
  )
  // A touch screen gets no automatic focus: the keyboard would cover the page before anyone asked for it.
  const [touch] = React.useState(() => window.matchMedia('(pointer: coarse)').matches)
  // Write it yourself puts the cursor in the title, once the form is there.
  const byHand = React.useRef(false)
  const startRef = React.useRef<HTMLTextAreaElement>(null)
  React.useEffect(() => {
    if (starting || !byHand.current) return
    byHand.current = false
    titleRef.current?.focus()
  }, [starting])
  // Why the pasted text filled nothing in, such as a page Footnote can't open; the text stays, so
  // pasting the page's own words is the next step.
  const [fillProblem, setFillProblem] = React.useState('')
  const [filling, setFilling] = React.useState(false)
  const [previewAll, setPreviewAll] = React.useState(false)
  const { state: sendState, error: sendError, send, online, reset } = useSend()
  // Live items the service named when it refused to publish until this says how it relates to
  // each: asked right under the title, and sent with the next publish.
  const [clashes, setClashes] = React.useState<Clash[]>([])
  // Read by the text editor's own handler too, which keeps the first render's closure.
  const failed = React.useRef(false)
  React.useEffect(() => {
    failed.current = sendState === 'failed'
  })
  // A refusal was about the words as they were: once they change, Publish tries them afresh.
  React.useEffect(() => {
    if (failed.current) reset()
  }, [form, reset])
  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setForm((f) => (Object.is(f[k], v) ? f : { ...f, [k]: v }))
  // A new item asks when it starts (an Event, when it happened) until the person has picked: the
  // service keeps a start for every item, so a silent default would be a date they never chose. So
  // does a draft that kept itself before a date was picked: its Always was never chosen either.
  const datesOpen = mode === 'new' || original?.status === 'Draft'
  const [whenChosen, setWhenChosen] = React.useState(() => !datesOpen || initial.when !== 'always')

  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    extensions: docExtensions(
      'Two or three plain sentences. The first one is what agents read first.',
    ),
    content: form.body,
    contentType: 'markdown',
    editorProps: { attributes: { 'aria-label': 'What agents should know' } },
    onUpdate: ({ editor }) => set('body', editor.getMarkdown()),
  })

  // The person's own draft saves itself as they write, and keeps up with their agent's changes to
  // it (Route 1): what it changed comes into each field they are not writing in.
  const ids = React.useId()
  const fieldId = (name: string) => `${ids}-${name}`
  const rowOf: Record<Exclude<SessionField, 'title' | 'text'>, string> = {
    kind: 'kind',
    domain: 'domain',
    where: 'where',
    when: 'when',
    source: 'source',
    dontConclude: 'dont',
  }
  // A new item that kept itself as a draft: the page goes on as that draft, as one opened again.
  const [kept, setKept] = React.useState<Fact | null>(null)
  // The person's own draft the page holds, which saves itself: the one it opened, or the one kept.
  const own = original?.session && original.by === me.name ? original : (kept ?? undefined)
  const session = useDraftSession({
    draft: own,
    form,
    setForm,
    formOf: (f) => fromFact(f, domains, vocabulary),
    // The form's own title, an empty one as empty: the draft stays untitled, as start has it.
    factOf: (f) => ({
      ...toFact(f, original?.id ?? kept?.id ?? 'draft', me.name, domains, original),
      title: f.title,
    }),
    typing: (field) => {
      const active = document.activeElement
      if (field === 'title') return active === titleRef.current
      if (field === 'text') return !!editor?.isFocused
      const row = document.getElementById(fieldId(rowOf[field]))?.parentElement
      return !!active && !!row?.contains(active)
    },
    setText: (body) =>
      editor?.commands.setContent(body, { contentType: 'markdown', emitUpdate: false }),
    onError: (error) =>
      toast("Couldn't save your draft", { description: toApiError(error).message }),
    // What writing help changed is its turn's change, kept beside the chat for its Undo.
    onHelped: (change) => own && noteHelpChange(own.id, change),
  })

  const trying = useDock()?.kind === 'try'
  const owner = me.owns.includes(form.domain) || me.admin
  const isSuggest = mode === 'suggest' || !owner
  // A new item, a draft nobody has published, or a suggestion waiting for review: it has no status
  // until it is published.
  const notLive = mode === 'new' || (!!original && unpublished(original))
  const ownerName = form.owners[0] ?? domains[form.domain]?.owners[0] ?? ''
  const standing = standingLine({
    mode,
    draft: original?.status === 'Draft',
    waiting: original?.status === 'Waiting',
    suggests: isSuggest,
    writer: original?.by && original.by !== me.name ? original.by : undefined,
    owner: ownerName,
    domain: domains[form.domain]?.name ?? '',
  })
  const KindIcon = kindIcons[form.kind]
  // The draft this page saved itself into (a new item once it has words): its id from then on.
  const [savedId, setSavedId] = React.useState<string | null>(null)
  const savedRef = React.useRef<string | null>(null)
  const draft = {
    ...toFact(form, original?.id ?? savedId ?? 'draft', me.name, domains, original),
    ...(base ? { version: base } : {}),
  }
  React.useEffect(() => setDraft(draft))

  const whereNames = form.where.map((t) => t.name)
  const inside = (a: string[], b: string[]) => a.every((w) => b.includes(w))
  // The same place, or one inside the other: a value narrows an item, and still overlaps the
  // broader one ("Orders in Norway" and "Orders in Norway for one campaign").
  const overlaps = facts.filter(
    (f) =>
      f.id !== original?.id &&
      f.title !== form.title &&
      servedToAgents(f) &&
      whereNames.length >= 2 &&
      f.where.length >= 2 &&
      (inside(whereNames, f.where) || inside(f.where, whereNames)),
  )
  // Folded unless there is something to say (an overlap), until the person chooses.
  // The panel's open or closed, as the person last left it this session; until then, open only with an overlap.
  const [sideChoice, setSideChoice] = useSideChoice()
  const sideOpen = sideChoice ?? overlaps.length > 0
  // What the service needs before it publishes or sends: a domain that exists, where it applies
  // (a mention in the text is not that), and a source with a sentence copied from it. An edit that
  // leaves its source alone keeps the sentence it has.
  const quoteNeeded =
    mode === 'new' || form.source !== initial.source || form.quote !== initial.quote
  // A date somebody gave is not asked for again: the person's pick, or one their agent or writing
  // help wrote into the draft while it is open.
  const asksWhen = datesOpen && form.kind === 'event' && !whenChosen && form.when === 'always'
  const missing = [
    !domains[form.domain] && 'a domain',
    !form.title && 'a title',
    !form.body.trim() && 'what agents should know',
    !form.where.length && 'where it applies',
    asksWhen && 'when it happened',
    !form.source && 'a source',
    form.source && quoteNeeded && !form.quote.trim() && 'a sentence copied from the source',
  ].filter(Boolean) as string[]
  const unanswered = clashes.find((c) => !overlap[c.itemId])
  // A source is a link: said at the field as soon as it is not, not when the service refuses it.
  const linkProblem = sourceProblem(form.source)
  // Counted as agents read it: a mention is its words.
  const text = plainText(form.body)
  const words = countWords(`${form.title} ${text}`)
  // Words that read like orders to an AI agent (NFR-024), such as a pasted page can carry: said
  // while drafting, as the owner's review says them, and kept as words.
  const orders = React.useMemo(
    () => instructionWords([form.title, text, form.quote].join('\n')),
    [form.title, text, form.quote],
  )
  // The dates the title and the text name, offered in When in one press.
  const whenOffers = React.useMemo(
    () => whensOfText(`${form.title}\n${text}`, today()),
    [form.title, text],
  )
  // A cause the text gives, which agents pass on as the writer's words.
  const cause = causeIn(`${form.title}\n${text}`)
  // Long enough to clamp: about six lines of the preview's width.
  const long = text.split('\n').filter(Boolean).length + Math.floor(text.length / 45) > 6

  const fill = async () => {
    if (!pasted.trim()) {
      setFillProblem('Write or paste something first.')
      startRef.current?.focus()
      return
    }
    setFillProblem('')
    setFilling(true)
    let drafted
    try {
      drafted = await queryClient.fetchQuery(draftFromTextQuery(pasted))
    } catch (e) {
      setFillProblem(toApiError(e).message)
      return
    } finally {
      setFilling(false)
    }
    const filled = fromFact(drafted, domains, vocabulary)
    setForm(filled)
    // Dates read from the words are an answer to When; the field shows them rather than asking.
    if (filled.when !== 'always') setWhenChosen(true)
    editor?.commands.setContent(filled.body, { contentType: 'markdown' })
    setStarting(false)
    toast('Filled from your text', { description: 'Check each part before you publish.' })
  }

  // Words that differ from what the page opened with.
  const edited = JSON.stringify(form) !== JSON.stringify(initial)
  // A draft nobody has published goes as it is: publishing its words is the change.
  const asIs = mode !== 'new' && original?.status === 'Draft' && !edited ? original : undefined
  const unchanged = mode !== 'new' && !edited && !asIs
  // A new item keeps itself as a draft once there are words and a domain to keep them in (FR-230):
  // a reload, a closed tab or a crash loses nothing. From then on it is that draft, which saves
  // itself as any of the writer's drafts do. A change to a published item, or to someone else's
  // draft, is kept only by its Save.
  const hasWords = !!(form.title.trim() || form.body.trim())
  const keepsItself =
    !session.on &&
    !beside &&
    !starting &&
    mode === 'new' &&
    !savedId &&
    !!domains[form.domain] &&
    hasWords
  const gapId = query.get('gap') ?? undefined
  // The page's one draft is made once: the autosave and writing help's first turn share the
  // creation in flight, so a message sent while the page keeps itself finds one draft, not two.
  const creating = React.useRef<Promise<string> | null>(null)
  const draftMade = (make: () => Promise<{ id: string }>) => {
    if (savedRef.current) return Promise.resolve(savedRef.current)
    creating.current ??= make()
      .then(({ id }) => {
        savedRef.current = id
        setSavedId(id)
        // The address names the draft, so a reload opens it again; the page stays as it is, with
        // the cursor where it was.
        navigate('/context/new', { ...Object.fromEntries(query), saved: id }, { replace: true })
        return id
      })
      .finally(() => {
        creating.current = null
      })
    return creating.current
  }
  const autosave = useAutosave<Fact>({
    save: async (fact) => {
      const id = await draftMade(() => write('saveDraft', { fact, isNew: true, gap: gapId }))
      const stored = await queryClient.fetchQuery(draftNowQuery(id))
      if (stored?.session) setKept(stored)
    },
    onError: (error) =>
      toast("Couldn't save it as a draft", { description: toApiError(error).message }),
  })
  // Each change of what it holds is kept, a moment after the typing stops; its id is the save's.
  const draftKey = JSON.stringify({ ...draft, id: 'draft' })
  const { change } = autosave
  React.useEffect(() => {
    if (keepsItself && edited) change(JSON.parse(draftKey) as Fact)
  }, [draftKey, keepsItself, edited, change])
  // What the header says: a page that keeps itself says whether it is kept; any other holds words
  // that are not saved until its Save.
  const saveState: SaveState =
    sendState === 'failed'
      ? 'failed'
      : sendState === 'sending'
        ? 'saving'
        : keepsItself || savedId
          ? autosave.status
          : !edited
            ? 'clean'
            : online
              ? 'dirty'
              : 'offline'
  // Words in the first box are the person's too, until they are filled in. A draft that saves
  // itself holds back only what it could not save: the rest is sent on the way out.
  const guard = useLeaveGuard(
    session.on
      ? session.status === 'failed' || session.status === 'offline'
      : keepsItself || savedId
        ? !['saved', 'clean'].includes(autosave.status)
        : edited || (starting && !!pasted.trim()),
  )
  // The first paragraph is the summary agents read first; the service keeps it to SUMMARY_LIMIT characters.
  const summaryLength = plainText(form.body.split('\n\n')[0] ?? '').length
  const tooLong = summaryLength > SUMMARY_LIMIT
  // With no definitions connected there is nothing to say where it applies with yet.
  const noWords = !form.where.length && !vocabulary.metrics.length && !vocabulary.dimensions.length
  // A dimension this install has, as the Applies to box's example: a plain one before a copy
  // told apart by its semantic model ("Region (stores)").
  const exampleDimension = (
    vocabulary.dimensions.find((dimension) => !dimension.name.includes('(')) ??
    vocabulary.dimensions[0]
  )?.name
  // One answer for the button, the footer and the side panel.
  const readiness = readinessOf({
    missing,
    badLink: Boolean(linkProblem),
    tooLong,
    unchanged,
    unanswered: unanswered?.title,
  })
  const blocked =
    holdLine(readiness) +
    (readiness.state === 'missing' && noWords
      ? ' Where it applies is named from your definitions: connect them in Settings, Integrations, then publish their names in the Inbox.'
      : '')
  // A blocked click goes to the first thing missing instead of answering with a toast.
  const focusField = (name: string) =>
    document.getElementById(fieldId(name))?.nextElementSibling?.querySelector('button')?.focus()
  const goToMissing = () => {
    if (!domains[form.domain]) focusField('domain')
    else if (!form.title) titleRef.current?.focus()
    else if (!form.body.trim()) editor?.commands.focus('end')
    else if (!form.where.length) focusField('where')
    else if (asksWhen) focusField('when')
    else if (!form.source || (quoteNeeded && !form.quote.trim()) || linkProblem) setSourceOpen(true)
    else if (unanswered)
      document
        .getElementById(`${ids}-clashes`)
        ?.querySelector<HTMLElement>(`[data-relation="${unanswered.itemId}"] [aria-haspopup=menu]`)
        ?.focus()
  }

  // Sending, then done; or failed with Retry, the text untouched. Offline, nothing is sent.
  // A draft is published by its button, whoever wrote it: it is not Live yet, so nothing is saved.
  const verb = isSuggest ? 'Send' : notLive ? 'Publish' : 'Save'
  /**
   * A draft as it is, through the Context list's Publish of one row: at once where the person owns
   * its domain or is an admin, as its writer's; their own for another domain goes to its owners.
   */
  const publishAsIs = async (f: Fact) => {
    const who = { name: me.name, admin: me.admin }
    const plan = planFacts('publish', [f], who, domains)
    if (!plan.act.length) throw new ApiError('forbidden', plan.skipped[0]!.reason)
    const parts = publishParts(plan, who, domains, dateLabel(today()))
    const result = await write('applyBulk', {
      action: 'publish',
      patches: parts.patches,
      remove: [],
      ...(parts.suggest.length ? { suggest: parts.suggest } : {}),
      entry: {
        id: `log-page-${f.id}`,
        on: today(),
        who: me.name,
        what: 'published',
        summary: 'Published from its page.',
        items: [{ id: f.id, title: f.title, domain: f.domain }],
      },
    })
    if (!result.done.includes(f.id))
      throw new ApiError(
        result.skipped?.length ? 'invalid' : 'failed',
        result.skipped?.[0]?.reason ?? "It couldn't be published. Try again.",
      )
    guard.release()
    const sent = parts.suggest.length > 0
    undo.offer(sent ? `Sent to the owners of ${parts.to}` : 'Published', result.undo, {
      description: sent
        ? 'Agents get it once an owner publishes it.'
        : 'Agents get it from the next question.',
    })
    navigate('/context')
  }

  const commit = async () => {
    // A draft that saves itself is stored as it reads before it goes.
    if (session.on) await session.flush()
    if (asIs) return publishAsIs(asIs)
    // A draft this page keeps is sent or published as itself, once what it holds is stored: a
    // save still on its way would otherwise leave a draft beside what is published.
    if (keepsItself || (savedRef.current && !session.on))
      await autosave.flush().catch(() => undefined)
    const kept = original?.id ?? savedRef.current ?? undefined
    const fact = { ...draft, id: kept ?? draft.id }
    if (isSuggest) {
      // It waits visibly: a line on the item, and a row under All in your Inbox.
      const { id } = await write('sendSuggestion', {
        fact,
        gap: query.get('gap') ?? undefined,
        sent: {
          factId: kept,
          title: form.title,
          by: me.name,
          to: ownerName,
          domain: form.domain,
          at: 'just now',
        },
      })
      guard.release()
      toast(`Sent to ${ownerName}, owner of ${domains[form.domain]?.name}`, {
        description: 'Agents get it once the owner publishes it.',
      })
      // A draft, or a suggestion sent again, has no item page yet: it waits in the Inbox.
      const item = original && original.status !== 'Draft' ? original : undefined
      navigate(item ? `/context/${item.id}` : '/inbox', item ? undefined : { tab: 'all', card: id })
      return
    }
    const { id } = await write('saveItem', {
      fact,
      isNew: !kept,
      // Each overlap as the owner answered it; one left alone is unrelated, as it reads.
      relations: {
        ...Object.fromEntries(overlaps.map((f) => [f.id, overlap[f.id] ?? 'unrelated'])),
        ...Object.fromEntries(
          clashes.flatMap((c) => {
            const r = overlap[c.itemId]
            return r ? [[c.itemId, r] as const] : []
          }),
        ),
      },
      gap: query.get('gap') ?? undefined,
    })
    guard.release()
    if (query.get('setup')) {
      toast('Published', {
        description: 'Your first context item. Ask the same question again to see it answered.',
      })
      navigate('/inbox')
      return
    }
    // Edited from a conflict: it stays flagged until its owner settles it, with a reason.
    if (original && beside) {
      toast('Saved', { description: 'Agents get it from the next question.' })
      navigate(conflictPath(`${original.id}.${beside.id}`), { settle: 'not_conflict' })
      return
    }
    toast(verb === 'Save' ? 'Saved' : 'Published', {
      description: 'Agents get it from the next question.',
    })
    // Written about a question: its page asks it again.
    const asked = query.get('q')
    navigate(`/context/${id}`, asked ? { q: asked } : undefined)
  }
  // A refusal that names live items to relate to lists them, unanswered, under the title.
  const publish = () =>
    commit().catch(async (e: unknown) => {
      const error = toApiError(e)
      const named = error.clashes.filter((c) => !clashes.some((k) => k.itemId === c.itemId))
      if (named.length) setClashes((k) => [...k, ...named])
      // Someone published since this page opened: their words are shown beside these.
      if (error.stale && original) {
        const page = await queryClient
          .fetchQuery({ ...itemPageQuery(original.id), staleTime: 0 })
          .catch(() => null)
        if (page) setNewer(page.item)
      }
      throw e
    })
  // Starts from what agents get now and keeps every word written here; Save then publishes them.
  const reload = () => {
    if (!newer) return
    setBase(newer.version)
    reset()
  }
  // Retry only where sending again can help: no answer, or the service failing on its side. A
  // refusal says why instead, and the change it asks for makes Publish work again.
  // The service's own words for a refusal, as a sentence.
  const refused =
    sendState === 'failed' &&
    sendError &&
    !(sendError.kind === 'unanswered' || sendError.kind === 'failed')
  // What the service found wrong, each at its field; the sentence above them only points there.
  const problems = problemsOf(refused && sendError ? sendError.findings : [])
  const marked = Object.keys(problems.at).length + problems.elsewhere.length > 0
  const refusal =
    refused && sendError
      ? marked
        ? 'Fix what is marked below.'
        : sendError.message.replace(/[^.!?]$/, '$&.')
      : ''
  // What is wrong at a field: the link's shape as it is written, or the service's reason for it.
  const problemAt = (field: EditorField) =>
    (field === 'source' ? linkProblem : '') || problems.at[field] || ''
  // A new refusal brings the first thing marked into view, wherever the page was scrolled, and
  // never scrolls so far that the title is cut.
  const refusalRef = React.useRef<HTMLElement>(null)
  React.useEffect(() => {
    if (!refusal) return
    const field = refusalRef.current?.parentElement?.querySelector('[data-problem]')
    if (field) field.scrollIntoView({ block: 'nearest' })
    else refusalRef.current?.scrollIntoView({ block: 'start' })
  }, [refusal])
  const retryable = !sendError || sendError.kind === 'unanswered' || sendError.kind === 'failed'
  const submit = () => {
    if (blocked) return goToMissing()
    send(publish)
  }
  const held =
    blocked || (!online ? `You're offline. ${verb} once you're back; your text stays here.` : '')

  // Save as draft (FR-139): a new item, or a change to a published item, kept where only they can
  // see it, to finish later. Their own draft saves itself. A suggestion that waits for review, or
  // one an owner returned, is sent instead.
  const savesDraft =
    !beside && !query.get('setup') && (mode === 'new' || (!!original && !unpublished(original)))
  const [savingDraft, setSavingDraft] = React.useState(false)
  const draftHeld = !online
    ? "You're offline. Save it once you're back; your text stays here."
    : !domains[form.domain]
      ? 'Choose a domain first.'
      : !form.title && !form.body.trim()
        ? 'Write something first.'
        : mode !== 'new' && !edited
          ? 'No changes yet.'
          : ''
  const saveDraft = async () => {
    if (draftHeld) {
      toast("Couldn't save it as a draft", { description: draftHeld })
      return
    }
    setSavingDraft(true)
    try {
      // A page that keeps itself has saved it already: what is still on its way goes, then the
      // person is taken to the draft.
      if (session.on) await session.flush()
      else if (keepsItself || savedRef.current) await autosave.flush()
      const { id } = savedRef.current
        ? { id: savedRef.current }
        : await write('saveDraft', {
            fact: draft,
            isNew: !original,
            gap: query.get('gap') ?? undefined,
          })
      guard.release()
      toast('Saved as a draft', {
        description: "Only you can see it. Agents don't get it until it is published.",
      })
      navigate(`/context/${id}`)
    } catch (error) {
      toast("Couldn't save it as a draft", { description: toApiError(error).message })
    } finally {
      setSavingDraft(false)
    }
  }
  const mobile = useIsMobile()

  // Writing help, in the dock beside the draft (Route 3): there when an admin turned it on, for
  // the person's own draft, and for words that can be kept as one, a new item or a change to a
  // published one, which the first thing they say to it does. A phone has no dock beside a page.
  const helping = useDock()?.kind === 'write'
  const helpThere = useWorkspace().writingHelp && !mobile && (session.on || savesDraft)
  const help = useHelp()
  const helpChange = help.latest
  const [helpChangeHidden, setHelpChangeHidden] = React.useState<string | null>(null)
  // What the dock reaches the draft through, as the page is now.
  const desk = React.useRef<Omit<HelpDesk, 'draftId'>>(null)
  React.useLayoutEffect(() => {
    desk.current = {
      ready: async () => {
        if (session.on) {
          await session.flush()
          return own!.id
        }
        // What the form left empty stays empty, for writing help or the person to fill in.
        const start = (isNew: boolean) =>
          write('startWritingHelp', {
            fact: { ...draft, title: form.title },
            isNew,
            gap: gapId,
          })
        if (original) {
          // A change to a published item is kept as the person's draft of it, as Save as draft
          // keeps it, and the page moves to that draft.
          const { id } = await start(false)
          guard.release()
          moveHelpChat(id)
          // Read before the page moves there, so the draft opens at once.
          await queryClient.fetchQuery({ ...itemPageQuery(id), staleTime: 0 }).catch(() => null)
          navigate(`/context/${id}/edit`, { dock: 'write' }, { replace: true })
          return null
        }
        // A new item is the draft it keeps itself as (FR-230): the one already on its way, or one
        // started now for a page with no words yet. The page goes on as that draft, where it is.
        if (keepsItself || savedRef.current) await autosave.flush()
        const id = await draftMade(() => start(true))
        const stored = await queryClient.fetchQuery({ ...draftNowQuery(id), staleTime: 0 })
        if (!stored?.session) throw new ApiError('not-found', 'This draft was sent or deleted.')
        moveHelpChat(id)
        setKept((now) => now ?? stored)
        return null
      },
      ask: (input, live) => write('writingHelp', { ...input, live }),
      refresh: session.refresh,
      revert: session.revert,
    }
  })
  const helpDraft = session.on ? own!.id : null
  React.useEffect(() => {
    if (!helpThere) return
    setHelpDesk({
      draftId: helpDraft,
      ready: () => desk.current!.ready(),
      ask: (input, live) => desk.current!.ask(input, live),
      refresh: () => desk.current!.refresh(),
      revert: (change) => desk.current!.revert(change),
    })
    return () => setHelpDesk(null)
  }, [helpThere, helpDraft])

  const heading =
    form.title || (mode === 'new' ? 'New context' : mode === 'edit' ? 'Edit' : 'Suggest a change')

  // Leaving with words that are not saved asks first; the safe answer has the focus.
  const keepRef = React.useRef<HTMLButtonElement>(null)
  const leaveDialog = (
    <Dialog open={guard.asking} onOpenChange={(open) => !open && guard.stay()}>
      <DialogContent className="sm:max-w-md" initialFocus={keepRef}>
        <DialogHeader>
          <DialogTitle>Leave without saving?</DialogTitle>
          <DialogDescription>
            What you wrote here is not saved yet. If you leave now, it is lost.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="destructive" onClick={guard.leave}>
            Leave and lose it
          </Button>
          <Button ref={keepRef} onClick={guard.stay}>
            Keep editing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  // The panel: the overlaps first, one row each with its answer, so the decisions are in view
  // above the preview of what agents get. Both are groups that fold.
  const side = (
    <>
      {/* Until it says where it applies, nothing can overlap it, so there is nothing to say. */}
      {(overlaps.length > 0 || form.where.length > 0) && (
        <PanelGroup
          title="Overlaps"
          count={overlaps.length}
          description={
            overlaps.length
              ? 'Context on the same metric and market. Say how this one relates to each.'
              : `Nothing else applies to ${scopeWords(form.where)}.`
          }
        >
          {/* The group's own bottom line closes the list; the menus line up under its chevron. */}
          {overlaps.length > 0 && (
            <ul className="-mx-4 -mb-4 divide-y border-t">
              {overlaps.map((f) => (
                <RelationRow
                  key={f.id}
                  itemId={f.id}
                  title={f.title}
                  value={overlap[f.id] ?? 'unrelated'}
                  onChange={(v) => setOverlap((o) => ({ ...o, [f.id]: v }))}
                  titleProps={{ ...ahead(f.id), onClick: () => openDock('context', f.id) }}
                  className="px-4 py-1.5 md:pr-6"
                />
              ))}
            </ul>
          )}
        </PanelGroup>
      )}
      <PanelGroup
        title="Preview"
        description={
          form.where.length
            ? `Agents asking about ${scopeWords(form.where)}${form.when === 'always' ? '' : `, ${whenText(form).replace(/^From/, 'from')}`} get this, live as you type.`
            : 'Add where it applies to see who gets it.'
        }
      >
        <div className="rounded-frame border bg-muted/30 p-3 text-sm">
          <p className="leading-snug font-medium">{draft.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {domains[form.domain]?.name}, {kindLabel[form.kind].toLowerCase()},{' '}
            {draft.when.charAt(0).toLowerCase() + draft.when.slice(1)}
          </p>
          <p className="text-xs text-muted-foreground">
            {isSuggest
              ? 'Not checked yet: waiting for the owner'
              : `Checked by the owner of ${domains[form.domain]?.name}`}
          </p>
          {/* The text as the document reads it: paragraphs, real bullets, a quote. Clamped when long,
              never boxed, so the panel keeps one scroll bar at most. */}
          <div
            className={cn(
              'mt-2.5 flex flex-col gap-2 leading-relaxed text-foreground',
              long && !previewAll && 'max-h-44 overflow-hidden fade-out-bottom',
            )}
          >
            {form.body.trim() ? (
              <ContextText text={form.body} dense />
            ) : (
              <p className="text-muted-foreground">…</p>
            )}
          </div>
          {long && (
            <Button
              variant="link"
              className="h-auto px-0 text-xs"
              aria-expanded={previewAll}
              onClick={() => setPreviewAll((v) => !v)}
            >
              {previewAll ? 'Show less' : 'Show all'}
            </Button>
          )}
          <p className="mt-2.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <LinkIcon aria-hidden className="size-3 shrink-0" />
            <span className="truncate">
              {form.source.replace(/^https?:\/\//, '') || 'No source yet'}
            </span>
          </p>
          {draft.dontConclude && (
            <p className="mt-1 text-xs text-muted-foreground">
              {/* As a sentence, before the next one: the service's own line is "cause not proven". */}
              <span className="text-foreground">Don't conclude:</span>{' '}
              {draft.dontConclude.charAt(0).toUpperCase() +
                draft.dontConclude.slice(1).replace(/[^.!?]$/, '$&.')}
            </p>
          )}
        </div>
      </PanelGroup>
    </>
  )
  // Who wrote a field nobody has read yet, and the agent's words waiting at one being written in.
  const markOf = (field: SessionField) => {
    const agent = session.agentIn(field)
    return agent ? agentMark(agent) : undefined
  }
  const wordsOf: Record<SessionField, (f: Form) => React.ReactNode> = {
    title: (f) => f.title,
    text: (f) => <ContextText text={f.body} dense />,
    kind: (f) => kindLabel[f.kind],
    domain: (f) => domains[f.domain]?.name ?? f.domain,
    where: (f) => scopeWords(f.where) || 'Nowhere yet',
    when: (f) => whenText(f),
    source: (f) => f.source || 'No source',
    dontConclude: (f) => f.dontConclude || 'Empty',
  }
  const versionOf = (field: SessionField, className: string) => {
    const theirs = session.waitingIn(field)
    return (
      theirs && (
        <AgentVersion
          agent={theirs.agent}
          field={sessionFieldLabel[field]}
          onTake={() => session.take(field)}
          onLeave={() => session.leave(field)}
          className={className}
        >
          {wordsOf[field](theirs.form)}
        </AgentVersion>
      )
    )
  }
  const back = original
    ? { href: href(`/context/${original.id}`), label: 'Back to the context item' }
    : { href: href('/context'), label: 'Back to Context' }

  // The first box: one question and one place to answer it. Fill it in reads the words by rule, and
  // the form opens filled; Write it yourself opens it as it is.
  if (starting)
    return (
      <DocumentEditorShell
        editor={editor}
        toolbar={false}
        header={
          <>
            <SiteHeader title={heading} icon={<FilePenLineIcon />} back={back} bare />
            {leaveDialog}
          </>
        }
        footer={null}
      >
        <Paper>
          <section aria-labelledby={`${ids}-start`} className="flex max-w-reading flex-col">
            <h2
              id={`${ids}-start`}
              className="text-2xl leading-tight font-bold tracking-tight sm:text-3xl"
            >
              What happened?
            </h2>
            <p id={`${ids}-start-how`} className="mt-2 mb-5 text-sm text-muted-foreground">
              Paste a message, a link, or just say what happened. The fields fill in from it, and
              you check each one.
            </p>
            <Field>
              <Textarea
                ref={startRef}
                value={pasted}
                onChange={(e) => {
                  setPasted(e.target.value)
                  setFillProblem('')
                }}
                autoFocus={!touch}
                aria-labelledby={`${ids}-start`}
                aria-describedby={`${ids}-start-how${fillProblem ? ` ${ids}-start-problem` : ''}`}
                aria-invalid={fillProblem ? true : undefined}
                className="min-h-36 md:text-base"
                placeholder="From 1 March 2026, returns are counted on the day of the refund, not of the order. https://wiki.example/returns-change"
              />
              <FieldError id={`${ids}-start-problem`}>{fillProblem}</FieldError>
            </Field>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      data-primary
                      loading={filling}
                      loadingLabel="Reading…"
                      onClick={() => void fill()}
                    />
                  }
                >
                  Fill it in
                </TooltipTrigger>
                <TooltipContent>
                  Fill it in <Kbd className="ml-1">⌘</Kbd>
                  <Kbd>Enter</Kbd>
                </TooltipContent>
              </Tooltip>
              <Button
                variant="ghost"
                disabled={filling}
                onClick={() => {
                  byHand.current = true
                  setStarting(false)
                }}
              >
                {edited ? 'Back to the form' : 'Write it yourself'}
              </Button>
              <WriteWithButton prompt={writePrompt()} variant="ghost" />
            </div>
          </section>
        </Paper>
      </DocumentEditorShell>
    )

  return (
    <DocumentEditorShell
      editor={editor}
      toolbar={true}
      paneRef={mainRef}
      header={
        <>
          <SiteHeader title={heading} icon={<FilePenLineIcon />} back={back} bare>
            {/* A new page that holds nothing yet has nothing to say. */}
            {session.on ? (
              <SaveStatus status={session.status} retry={session.retry} />
            ) : (
              (mode !== 'new' || edited) && (
                <SaveStatus
                  status={saveState}
                  retry={autosave.status === 'failed' ? autosave.retry : undefined}
                />
              )
            )}
            {/* Writing help and Try it swap in the one dock: write it, then see what agents would say. */}
            {helpThere && (
              <ViewToggle
                pressed={helping}
                onPressedChange={(p) => (p ? openDock('write') : closeDock())}
                icon={<SparklesIcon />}
                on="Writing help"
                off="Close writing help"
              />
            )}
            {/* Write or try it: the same draft, seen two ways, so a quiet toggle rather than tabs. */}
            <ViewToggle
              pressed={trying}
              onPressedChange={(p) => (p ? openDock('try', 'editor') : closeDock())}
              icon={<FlaskConicalIcon />}
              on="Try it"
              off="Back to writing"
            />
            {savesDraft && !mobile && (
              <Button
                variant="outline"
                aria-disabled={!!draftHeld}
                aria-description={draftHeld || undefined}
                title={draftHeld || undefined}
                loading={savingDraft}
                loadingLabel="Saving…"
                onClick={() => void saveDraft()}
              >
                Save as draft
              </Button>
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    data-primary
                    aria-disabled={!!held}
                    loading={sendState === 'sending'}
                    loadingLabel={
                      verb === 'Send' ? 'Sending…' : verb === 'Save' ? 'Saving…' : 'Publishing…'
                    }
                    aria-describedby={held ? 'publish-blocked' : undefined}

                    onClick={submit}
                  />
                }
              >
                {isSuggest ? (
                  // One run of words: the button's gap would stand between two parts of it.
                  <span>
                    Send
                    <span className="hidden sm:inline">
                      {' '}
                      to the owner of {domains[form.domain]?.name}
                    </span>
                  </span>
                ) : (
                  verb
                )}
              </TooltipTrigger>
              <TooltipContent>
                {held || (
                  <>
                    {isSuggest ? 'Send' : original ? 'Save' : 'Publish'}{' '}
                    <Kbd className="ml-1">⌘</Kbd>
                    <Kbd>Enter</Kbd>
                  </>
                )}
              </TooltipContent>
            </Tooltip>
            <span id="publish-blocked" className="sr-only">
              {held}
            </span>
            <HeaderMore>
              {savesDraft && mobile && (
                <DropdownMenuItem onClick={() => void saveDraft()}>
                  <FilePenLineIcon />
                  Save as draft
                </DropdownMenuItem>
              )}
              {mode === 'new' && (
                <DropdownMenuItem onClick={() => setStarting(true)}>
                  <SparklesIcon />
                  Draft from text
                </DropdownMenuItem>
              )}
              {/* A new item starts a draft about what it applies to; a saved draft goes on by its id. */}
              {mode === 'new' ? (
                <WriteWithMenuItem prompt={writePrompt(topicOf(form))} />
              ) : (
                original?.status === 'Draft' && (
                  <WriteWithMenuItem prompt={finishPrompt(original.id)} />
                )
              )}
              <DropdownMenuItem onClick={() => setSideChoice(!sideOpen)}>
                <PanelRightIcon />
                {sideOpen ? 'Hide what agents get' : 'Show what agents get'}
              </DropdownMenuItem>
            </HeaderMore>
          </SiteHeader>
          {leaveDialog}
        </>
      }
      aside={
        <>
          {/* The side pane opens by itself only when this overlaps another item: then what agents get, and how the two relate, matter. Otherwise the header's toggle opens it. */}
          {sideOpen && wide && (
            <ResizableAside
              side="right"
              storageKey="doc-side"
              defaultWidth={320}
              min={280}
              max={520}
              label="What agents get"
              className="border-l bg-background"
            >
              <Panel
                title="What agents get"
                onClose={() => setSideChoice(false)}
                closeLabel="Hide what agents get"
              >
                {side}
              </Panel>
            </ResizableAside>
          )}
        </>
      }
      footer={
        <DocFooter
          status={
            sendState === 'failed' && !retryable ? (
              <span className="flex items-center gap-2 text-destructive">
                <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden />
                Not {verb === 'Send' ? 'sent' : verb === 'Save' ? 'saved' : 'published'}
              </span>
            ) : sendState === 'failed' ? (
              <span role="alert" className="flex items-center gap-2 text-destructive">
                <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden />
                <span>
                  Couldn't {verb.toLowerCase()}
                  <span className="max-sm:hidden">. Your text is kept</span>.
                </span>
                <Button variant="outline" className="text-foreground" onClick={() => send(publish)}>
                  <RefreshCwIcon data-icon="inline-start" />
                  Retry
                </Button>
              </span>
            ) : readiness.state === 'ready' ? (
              <>
                <CircleCheckIcon className="size-3.5" aria-hidden />
                Ready
              </>
            ) : readiness.state === 'bad-link' ? (
              <>
                <CircleDashedIcon className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate" title="Not ready: fix the link in Source">
                  Not ready<span className="hidden sm:inline">: fix the link in Source</span>
                </span>
              </>
            ) : readiness.state === 'unchanged' ? (
              <>
                <CircleDashedIcon className="size-3.5" aria-hidden />
                No changes yet
              </>
            ) : (
              <>
                <CircleDashedIcon className="size-3.5 shrink-0" aria-hidden />
                {/* One line in the bar: where the words are cut, they are whole on hover. */}
                <span className="truncate" title={`Not ready${notReadyWhy(readiness)}`}>
                  Not ready
                  <span className="hidden sm:inline">{notReadyWhy(readiness)}</span>
                </span>
              </>
            )
          }
        >
          <span
            className={cn(
              'whitespace-nowrap tabular-nums',
              tooLong && 'font-medium text-destructive',
            )}
            title="The first paragraph is what agents read first"
          >
            Summary {summaryLength} of {SUMMARY_LIMIT}
          </span>
          <span className="whitespace-nowrap">
            {words.toLocaleString('en-GB')} {words === 1 ? 'word' : 'words'}
          </span>
          <span className="whitespace-nowrap max-sm:hidden">
            {(form.title.length + text.length).toLocaleString('en-GB')} characters
          </span>
        </DocFooter>
      }
    >
      <Paper>
        {beside && original && (
          <aside
            aria-label="The item it disagrees with"
            className="mb-5 flex flex-col gap-1.5 rounded-frame border px-3 py-2 text-sm"
          >
            <p className="text-xs text-muted-foreground">
              Disagrees with “{beside.title}”, {domains[beside.domain]?.name ?? beside.domain}
              {beside.checkedOn && `, checked ${beside.checkedOn}`}
            </p>
            <p>{beside.summary}</p>
            <p className="text-xs text-muted-foreground">
              Narrow this one to where it applies, so the two no longer say different things about
              the same thing.
            </p>
          </aside>
        )}
        {standing && (
          <p
            role="note"
            aria-label="Where this stands"
            className="mb-5 rounded-frame bg-muted px-3 py-2 text-sm text-muted-foreground"
          >
            {standing}
          </p>
        )}
        {session.on && <AgentChangeSaid change={session.change} />}
        {session.change && (
          <AgentChangeStrip
            change={session.change}
            onUndo={session.undo}
            onClose={session.dismiss}
          />
        )}
        {/* Writing help: that it is writing, with Stop; then what its last turn changed, with Undo. */}
        {session.on && <AgentChangeSaid change={help.busy ? null : (helpChange?.change ?? null)} />}
        {help.busy && session.on ? (
          <HelpWorkingStrip onStop={stopHelp} />
        ) : (
          helpChange &&
          helpChangeHidden !== helpChange.change.at && (
            <AgentChangeStrip
              change={helpChange.change}
              words={helpChangeLine}
              onUndo={undoHelp}
              onClose={() => setHelpChangeHidden(helpChange.change.at)}
            />
          )
        )}
        <textarea
          ref={titleRef}
          aria-label="Title"
          rows={1}
          className="mb-4 field-sizing-content w-full resize-none overflow-hidden rounded-md bg-transparent text-2xl leading-tight font-bold tracking-tight outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:mb-5 sm:text-3xl"
          placeholder="What should agents know?"
          value={form.title}
          onChange={(e) => set('title', e.target.value.replace(/\n/g, ' '))}
          onPaste={(e) => noteEmoji(e.clipboardData.getData('text/plain'))}
        />
        {problemAt('title') && (
          <p data-problem className="-mt-3 mb-4 text-sm text-destructive">
            {problemAt('title')}
          </p>
        )}
        {versionOf('title', 'mb-4')}
        <AgentWroteLine
          agent={session.agentIn('title') ?? session.agentIn('text') ?? ''}
          parts={[
            ...(session.agentIn('title') ? ['the title'] : []),
            ...(session.agentIn('text') ? ['the text'] : []),
          ]}
        />
        {orders.length > 0 && (
          <p
            aria-label="Words that read like orders"
            className="mb-5 flex items-start gap-2 rounded-frame bg-muted px-3 py-2 text-sm"
          >
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-caution" aria-hidden />
            <span>
              Some words read like orders to an AI agent: {orders.map((w) => `“${w}”`).join(', ')}.
              Agents get them as words to read, never as orders. Check that they belong before you
              publish.
            </span>
          </p>
        )}
        {/* What stopped a publish, in the service's words, and the live items it named to relate
            to, answered here, under the title, at any width. Words someone published since this
            page opened show here too, until this is saved. */}
        {(refusal || clashes.length > 0 || newer) && (
          <section
            ref={refusalRef}
            id={`${ids}-clashes`}
            aria-label="Before it can be published"
            className="mb-5 flex flex-col gap-3 rounded-frame bg-muted px-3 py-2 text-sm"
          >
            {refusal ? (
              <p role="alert" className="flex items-start gap-2">
                <CircleAlertIcon
                  className="mt-0.5 size-3.5 shrink-0 text-destructive"
                  aria-hidden
                />
                <span>
                  Couldn't {verb.toLowerCase()}. {refusal}
                  {problems.elsewhere.map((reason) => (
                    <span key={reason} className="block text-muted-foreground">
                      {reason}
                    </span>
                  ))}
                </span>
              </p>
            ) : clashes.length > 0 ? (
              <p className="text-muted-foreground">
                Agents get these for the same questions. Say how this relates to each.
              </p>
            ) : null}
            {newer && (
              <div aria-label="Published since you opened it" className="flex flex-col gap-2">
                <p className="text-muted-foreground">
                  {base === newer.version
                    ? 'Agents get this now. Your words are kept below: add what you want of theirs, then save.'
                    : 'Agents get this now:'}
                </p>
                {/* See both: the two edits that met, as the review compares a change. */}
                <div className="@container bg-background">
                  <TextComparison
                    before={[newer.summary, newer.body].filter(Boolean).join('\n\n')}
                    after={form.body}
                    labels={{ before: 'Agents get now', after: 'Your words' }}
                  />
                </div>
                {base !== newer.version && (
                  <Button variant="outline" className="self-start" onClick={reload}>
                    <RefreshCwIcon data-icon="inline-start" />
                    Reload, keep my words
                  </Button>
                )}
              </div>
            )}
            {clashes.length > 0 && (
              <ul className="-mx-3 divide-y divide-foreground/10">
                {clashes.map((c) => (
                  <RelationRow
                    key={c.itemId}
                    itemId={c.itemId}
                    title={c.title}
                    value={overlap[c.itemId]}
                    onChange={(v) => {
                      setOverlap((o) => ({ ...o, [c.itemId]: v }))
                      reset()
                    }}
                    titleProps={{
                      ...ahead(c.itemId),
                      onClick: () => openDock('context', c.itemId),
                    }}
                    className="px-3 py-1"
                  />
                ))}
              </ul>
            )}
          </section>
        )}
        {/* The properties as a calm list under the title: what it is, when and where it applies,
            where it comes from. Each value shows as the thing it is; a click edits it. */}
        <PropertyList label="Properties">
          <PropertyGroup>
            <PropertyRow
              id={fieldId('domain')}
              mark={markOf('domain')}
              label="Domain"
              icon={<FolderIcon />}
              required={!domains[form.domain]}
              problem={problemAt('domain')}
            >
              <SelectField
                labelId={fieldId('domain')}
                label="Domain"
                value={form.domain}
                options={domainOptions(domainList)}
                onChange={(d) => {
                  set('domain', d)
                  set('owners', domains[d]?.owners ?? [])
                }}
                display={
                  domains[form.domain] ? (
                    <>
                      <DomainDot id={form.domain} />
                      <span className="font-medium">{domains[form.domain]?.name}</span>
                    </>
                  ) : (
                    <Ghost>Choose a domain</Ghost>
                  )
                }
                empty={<NoDomainYet />}
              />
              {versionOf('domain', 'mt-1 mb-2 max-w-xl')}
            </PropertyRow>
            <PropertyRow
              id={fieldId('kind')}
              label="Kind"
              icon={<ShapesIcon />}
              mark={markOf('kind')}
            >
              <SelectField
                labelId={fieldId('kind')}
                label="Kind"
                value={form.kind}
                options={KIND_OPTIONS}
                onChange={(k) => set('kind', k)}
                display={<TagChip icon={<KindIcon aria-hidden />}>{kindLabel[form.kind]}</TagChip>}
              />
              {versionOf('kind', 'mt-1 mb-2 max-w-xl')}
            </PropertyRow>
            <PropertyRow id={fieldId('status')} label="Status" icon={<CircleDotIcon />}>
              {notLive ? (
                // Agents get nothing of it until it is published: it is not Live yet (U9).
                <StaticField>Not published yet</StaticField>
              ) : (
                <SelectField
                  labelId={fieldId('status')}
                  label="Status"
                  value={form.status}
                  options={STATUS_OPTIONS}
                  onChange={(v) => set('status', v)}
                  disabled={isSuggest}
                  display={
                    // Live is the default and says nothing; a status that needs attention is a chip.
                    form.status === 'Live' ? (
                      <span>Live</span>
                    ) : form.status === 'Due for a check' ? (
                      <TagChip tone="warn" icon={<TriangleAlertIcon aria-hidden />}>
                        Due for a check
                      </TagChip>
                    ) : (
                      <TagChip icon={<ArchiveIcon aria-hidden />}>Archived</TagChip>
                    )
                  }
                />
              )}
            </PropertyRow>
            <PropertyRow id={fieldId('owner')} label="Owner" icon={<UserIcon />}>
              <PeopleField
                labelId={fieldId('owner')}
                label="Owner"
                values={form.owners}
                people={people}
                me={me.name}
                onChange={(v) => set('owners', v)}
                note={
                  isSuggest
                    ? 'The owner decides on your suggestion.'
                    : "An owner publishes and checks this domain's context."
                }
              />
            </PropertyRow>
          </PropertyGroup>
          <PropertyGroup>
            <PropertyRow
              id={fieldId('where')}
              mark={markOf('where')}
              label="Applies to"
              icon={<MapPinIcon />}
              required={!form.where.length}
              problem={problemAt('where')}
            >
              <ScopeField
                labelId={fieldId('where')}
                label="Applies to"
                value={form.where}
                onChange={(w) => set('where', w)}
                nothingPublished={noWords}
                placeholder={
                  exampleDimension
                    ? `Add a metric, or a dimension such as ${exampleDimension}`
                    : 'Add a metric or a dimension'
                }
              />
              {versionOf('where', 'mt-1 mb-2 max-w-xl')}
            </PropertyRow>
            <PropertyRow
              id={fieldId('when')}
              mark={markOf('when')}
              label="When"
              icon={<CalendarIcon />}
              required={asksWhen}
              problem={problemAt('when')}
            >
              <WhenField
                labelId={fieldId('when')}
                value={whenOf(form)}
                asking={asksWhen ? 'When did it happen? Pick a date' : undefined}
                offers={whenOffers}
                onChange={(w) => {
                  setWhenChosen(true)
                  setForm((f) => ({ ...f, when: w.mode, from: w.from, until: w.until }))
                }}
              />
              {versionOf('when', 'mt-1 mb-2 max-w-xl')}
            </PropertyRow>
          </PropertyGroup>
          <PropertyGroup>
            <PropertyRow
              id={fieldId('source')}
              mark={markOf('source')}
              label="Source"
              icon={<LinkIcon />}
              required={!form.source}
              problem={problemAt('source')}
            >
              <PickerField
                labelId={fieldId('source')}
                label="Source"
                open={sourceOpen}
                onOpenChange={setSourceOpen}
                className="w-96 p-3"
                value={
                  form.source ? (
                    <TagChip icon={<GlobeIcon aria-hidden />} title={form.source}>
                      {hostOf(form.source)}
                    </TagChip>
                  ) : (
                    <Ghost>Add a source</Ghost>
                  )
                }
              >
                <div className="grid gap-3 pb-1">
                  <Field>
                    <FieldLabel htmlFor="fact-source">Link</FieldLabel>
                    <Input
                      id="fact-source"
                      type="url"
                      aria-invalid={!!problemAt('source')}
                      value={form.source}
                      onChange={(e) => set('source', e.target.value)}
                      placeholder="https://"
                    />
                    {problemAt('source') && (
                      <p className="text-xs text-destructive">{problemAt('source')}</p>
                    )}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="fact-quote">A sentence copied from it</FieldLabel>
                    <Textarea
                      id="fact-quote"
                      value={form.quote}
                      onChange={(e) => set('quote', e.target.value)}
                      className="min-h-16"
                    />
                  </Field>
                </div>
              </PickerField>
              {versionOf('source', 'mt-1 mb-2 max-w-xl')}
            </PropertyRow>
            <PropertyRow
              id={fieldId('dont')}
              mark={markOf('dontConclude')}
              label="Don't conclude"
              icon={<ShieldAlertIcon />}
              problem={problemAt('dont')}
            >
              <InlineText
                labelId={fieldId('dont')}
                value={form.dontConclude}
                onChange={(v) => set('dontConclude', v)}
                placeholder="What agents must not read into it, such as a cause nobody has shown"
              />
              {cause && !form.dontConclude.trim() && (
                <p className="pt-0.5 pb-1 text-xs text-muted-foreground">
                  Your text gives a cause (“{cause}”), and agents pass it on as yours. If nobody has
                  shown it, say so here.
                </p>
              )}
              {versionOf('dontConclude', 'mt-1 mb-2 max-w-xl')}
            </PropertyRow>
            {/* A draft, or a suggestion sent back, was never checked: it has no such row. */}
            {original?.checkedBy && (
              <PropertyRow id={fieldId('checked')} label="Checked" icon={<CircleCheckIcon />}>
                <StaticField>
                  <PersonAvatar name={original.checkedBy} size={20} />
                  <span>
                    {original.checkedBy}, {original.checkedOn}
                  </span>
                </StaticField>
              </PropertyRow>
            )}
          </PropertyGroup>
        </PropertyList>
        <RichTextEditor.Content className="text-base [&_.ProseMirror]:min-h-48! [&_.ProseMirror]:max-w-reading [&_.ProseMirror]:p-0!" />
        {versionOf('text', 'mt-3 max-w-reading')}
        {problemAt('text') && (
          <p data-problem className="mt-2 text-sm text-destructive">
            {problemAt('text')}
          </p>
        )}
      </Paper>
      {sideOpen && !wide && (
        <section aria-labelledby="doc-side-under" className="border-t bg-background">
          {/* Under the document the panel keeps its title, so its groups sit under a heading of their own. */}
          <h2 id="doc-side-under" className="px-4 pt-4 pb-1 text-sm font-medium">
            What agents get
          </h2>
          {side}
        </section>
      )}
    </DocumentEditorShell>
  )
}
