import * as React from 'react'
import { cn } from '@/lib/utils'
import { PlusIcon } from '@/components/icons'
import { toast } from '@/lib/toast'
import { PersonAvatar } from '@/components/footnote/bits'
import { Page } from '@/components/site-header'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button, buttonVariants } from '@/components/ui/button'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FoldTrigger } from '@/components/footnote/fold'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { isHost, NEVER_READ_HOSTS_MAX, normalizeHost } from '@domain/never-read-hosts'
import { GuideLink, PublicGuideLink } from '@/components/footnote/guide-link'
import { servedToAgents } from '@/model/items'
import { useQuery } from '@tanstack/react-query'
import type { Advanced as AdvancedPage, AnswerTestRuns, Exported } from '@/api/client'
import { toApiError } from '@/api/errors'
import { advancedPageQuery, useSession, useWrite } from '@/api/queries'
import { Loadable, RowsSkeleton } from '@/components/footnote/load-state'
import { useAdminsSaid, useFacts, useMe, usePeople } from '@/lib/workspace'
import { listOf } from '@/model/people'
import { answerTestWords } from '@/model/settings'
import { useDomainList, useDomains } from '@/lib/workspace'
import { useDefinitions } from '@/lib/definitions'
import { DomainDot } from '@/components/footnote/tag-chip'
import { IntegrationsRoute } from '@/pages/integrations'
import {
  Frame,
  FramePage,
  FrameRows,
  FrameFit,
  FrameSection,
  FrameTable,
  type FrameColumn,
} from '@/components/footnote/frame'
import { SLUG } from '@/lib/brand'
import { People } from '@/pages/people'
import { Agents } from '@/pages/settings-agents'
import { landingOf, mayOpenSettings } from '@/lib/settings-access'
import { useRoute } from '@/lib/router'

// Settings: six sections under the settings navigation (General, Domains and owners, People,
// Agents and access, Integrations, Advanced). Someone who isn't an admin has their agents, and an owner
// also the domains and the people list. No tabs anywhere.

/* ---------- Domains and owners ---------- */

/**
 * The domains as a grid of square hairline cells: each the domain's dot and name, two lines of what it
 * covers, its owners' faces and a quiet health line ("12 items - 2 due") with a freshness dot. One cell
 * adds a domain. Arrow keys move between cells; search shows once there are more than eight.
 */
function Domains() {
  const me = useMe()
  const admins = useAdminsSaid()
  const domains = useDomains()
  const domainIds = useDomainList().map((d) => d.id)
  const facts = useFacts()
  const defs = useDefinitions()
  const [q, setQ] = React.useState('')
  const grid = React.useRef<HTMLDivElement>(null)
  // Sorted by name; the sandbox, which never reaches agents, comes last.
  const ids = [...domainIds]
    .sort((a, b) =>
      domains[a]?.sandbox
        ? 1
        : domains[b]?.sandbox
          ? -1
          : domains[a]!.name.localeCompare(domains[b]!.name),
    )
    .filter((id) =>
      `${domains[id]?.name} ${domains[id]?.covers}`.toLowerCase().includes(q.trim().toLowerCase()),
    )
  const onKeyDown = (e: React.KeyboardEvent) => {
    const keys = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 0, ArrowUp: 0 } as Record<
      string,
      number
    >
    if (!(e.key in keys) || !grid.current) return
    const cells = [...grid.current.querySelectorAll<HTMLElement>('[data-cell]')]
    const i = cells.indexOf(document.activeElement as HTMLElement)
    if (i < 0) return
    const cols = getComputedStyle(grid.current).gridTemplateColumns.split(' ').length
    const step = e.key === 'ArrowDown' ? cols : e.key === 'ArrowUp' ? -cols : keys[e.key]
    const next = cells[i + (step ?? 0)]
    if (!next) return
    e.preventDefault()
    next.focus()
  }
  return (
    <Frame>
      <FrameSection
        title="Domains and owners"
        description="A domain is a part of the business with its own owners. Owners publish its context and check it when it is due."
        action={
          domainIds.length > 8 && (
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search domains"
              aria-label="Search domains"
              className="w-56 max-w-full"
            />
          )
        }
      >
        <div
          ref={grid}
          onKeyDown={onKeyDown}
          role="list"
          aria-label="Domains"
          className="grid grid-cols-1 gap-px border-t bg-border @2xl/main:grid-cols-2 @5xl/main:grid-cols-3"
        >
          {ids.map((id) => {
            const items = facts.filter((f) => f.domain === id && servedToAgents(f))
            const due = items.filter((f) => f.status === 'Due for a check').length
            const terms = defs.filter((d) => d.domain === id).length
            return (
              <a
                key={id}
                role="listitem"
                data-cell
                href={`/settings/domains/${id}`}
                className="group/cell flex min-h-36 flex-col gap-2 bg-background p-4 outline-none hover:bg-muted/40 focus-visible:z-raised focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset md:p-5 @2xl/main:min-h-44"
              >
                <span className="flex items-center gap-2">
                  <DomainDot id={id} />
                  <span className="truncate font-medium">{domains[id]?.name}</span>
                  {domains[id]?.sandbox && (
                    <span className="text-xs text-muted-foreground">Never reaches agents</span>
                  )}
                </span>
                <span className="line-clamp-2 text-sm text-muted-foreground">
                  {domains[id]?.covers || 'Nothing written yet.'}
                </span>
                <span className="mt-auto flex items-end justify-between gap-3 pt-2">
                  <span
                    className="flex -space-x-1.5 *:ring-2 *:ring-background"
                    aria-label={`Owners: ${domains[id]?.owners.join(', ')}`}
                  >
                    {domains[id]?.owners.slice(0, 4).map((o) => (
                      <PersonAvatar key={o} name={o} />
                    ))}
                    {domains[id]!.owners.length > 4 && (
                      <span className="grid size-7 place-items-center rounded-full bg-muted text-xs font-medium">
                        +{domains[id]!.owners.length - 4}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                    <span
                      aria-hidden
                      className={cn(
                        'size-1.5 rounded-full',
                        !items.length
                          ? 'border border-muted-foreground'
                          : due
                            ? 'bg-caution'
                            : 'bg-good',
                      )}
                    />
                    {items.length} {items.length === 1 ? 'item' : 'items'}
                    {due > 0 && ` - ${due} due`}
                    {terms > 0 && ` - ${terms} ${terms === 1 ? 'term' : 'terms'}`}
                  </span>
                </span>
              </a>
            )
          })}
          {/* Only an admin adds a domain: anyone else reads who does, in the same place. */}
          {me.admin ? (
            <a
              role="listitem"
              data-cell
              href="/settings/domains/new"
              className="flex min-h-24 flex-col items-center justify-center gap-2 bg-background p-4 text-sm text-muted-foreground outline-none hover:bg-muted/40 hover:text-foreground focus-visible:z-raised focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset @2xl/main:min-h-44"
            >
              <PlusIcon aria-hidden className="size-5" />
              Add a domain
            </a>
          ) : (
            <p
              role="listitem"
              className="flex min-h-24 items-center justify-center bg-background p-4 text-center text-sm text-balance text-muted-foreground @2xl/main:min-h-44"
            >
              An admin adds a domain{admins}.
            </p>
          )}
        </div>
        {q && !ids.length && (
          <p className="border-t p-4 text-sm text-muted-foreground">
            No domain matches “{q.trim()}”.
          </p>
        )}
      </FrameSection>
    </Frame>
  )
}

/* ---------- About our business ---------- */

// The editor loads on its own (Tiptap stays out of the first load); until it does, the page's skeleton.
// A domain is a document too, so its page loads with the editor.
const DomainPage = React.lazy(() =>
  import('@/pages/domain-page').then((m) => ({ default: m.DomainPage })),
)
const AboutPage = React.lazy(() =>
  import('@/pages/about-editor').then((m) => ({ default: m.AboutPage })),
)

/** General's side help, in the aside (or under the frame on narrower screens). */
function AboutHelp() {
  return (
    <>
      <ul>
        <li>
          What the company does, in one or two sentences: what you sell, to whom, where and through
          which channels.
        </li>
        <li>
          Not the words people use: write each as a term in Definitions, with an owner. Ask and
          agents get a term with each question that uses its word.
        </li>
        <li>
          Leave out numbers, dates, deals, legal conclusions, secrets and personal data. What
          happened goes in context items, and the rest stays out.
        </li>
        <li>
          Once there are domains or definitions, Write a first version for me drafts it from them.
          Nothing is saved until you keep it.
        </li>
        <li>
          Ask reads it with every question, and an agent when it connects. An agent connected now
          gets a change when it next connects.
        </li>
      </ul>
      <GuideLink slug="write-context" className="mt-4" />
    </>
  )
}

/* ---------- Advanced ---------- */

const link = 'underline underline-offset-4'
const cols = (...labels: string[]): FrameColumn[] =>
  labels.map((label, i) => ({
    label,
    className: i === 0 ? 'w-56' : i === 1 ? 'whitespace-nowrap' : undefined,
    cell: i === 0 ? 'font-medium' : 'text-muted-foreground',
  }))

/** A file the binding made, saved the way a download is. */
function save(file: Exported) {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name })
  document.body.append(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** A link inside a table cell, or the words alone when there is nowhere to go. */
const cellLink = (text: string, href?: string) =>
  href ? (
    <a key={href} href={href} className={link}>
      {text}
    </a>
  ) : (
    text
  )

function Advanced() {
  const load = useQuery(advancedPageQuery())
  return (
    <Frame>
      <FrameSection
        title="Advanced"
        description="For the day someone needs them. Nothing here is needed day to day."
      />
      <Loadable what="Advanced" skeleton={<RowsSkeleton rows={8} />} query={load}>
        {load.data && <AdvancedSections page={load.data} />}
      </Loadable>
    </Frame>
  )
}

/**
 * Every tuning setting in one table, a header row for each group, so the columns line up. Where
 * the frame is too narrow for the five columns, a setting is a block: its key, its value, what it
 * does, and then whether it was changed.
 */
function SettingsTable({ groups }: { groups: AdvancedPage['settings'] }) {
  const cell = 'px-4 py-2 align-middle first:md:pl-5 last:md:pr-5'
  const columns = ['Setting', 'Value', 'Default or changed', 'Set by', 'What it does']
  const id = React.useId()
  const stacked = (
    <div aria-label="Tuning settings" role="group" className="@container text-sm">
      {groups.map((g, i) => (
        <div
          key={g.group}
          role="group"
          aria-labelledby={`${id}-${i}`}
          className="border-t first:border-t-0"
        >
          <h4
            id={`${id}-${i}`}
            className="flex h-9 items-center bg-band px-4 text-xs font-medium md:px-5"
          >
            {g.group}
          </h4>
          <ul>
            {g.rows.map((r) => (
              <li
                key={r.key}
                className="grid gap-x-6 gap-y-1 border-t px-4 py-3 md:px-5 @xl:grid-cols-2"
              >
                <div>
                  <p className="font-mono text-xs wrap-anywhere">{r.key}</p>
                  <p className="mt-1 wrap-anywhere">
                    {r.value}
                    {r.note && (
                      <span className="block text-xs text-muted-foreground">{r.note}</span>
                    )}
                  </p>
                </div>
                <div className="text-muted-foreground">
                  <p>{r.what}</p>
                  <p className="mt-1 text-xs">
                    {r.changed
                      ? `Changed by ${r.changed.who ?? 'an update or a script'}, ${r.changed.when}`
                      : 'Default, from the install'}
                    {r.changed?.why && <span className="block">{r.changed.why}</span>}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
  return (
    <FrameFit stacked={stacked}>
      <table className="w-full text-sm" aria-label="Tuning settings">
        <thead>
          <tr className="bg-band text-xs text-muted-foreground">
            {columns.map((c) => (
              <th
                key={c}
                className="h-9 px-4 text-left font-medium whitespace-nowrap first:md:pl-5 last:md:pr-5"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.group}>
            <tr className="border-t bg-band">
              <th
                scope="rowgroup"
                colSpan={columns.length}
                className="h-9 px-4 text-left text-xs font-medium md:px-5"
              >
                {g.group}
              </th>
            </tr>
            {g.rows.map((r) => (
              <tr key={r.key} className="border-t">
                <th
                  scope="row"
                  className={cn(cell, 'w-56 text-left font-mono text-xs font-normal')}
                >
                  {r.key}
                </th>
                <td className={cn(cell, 'min-w-40 wrap-anywhere')}>
                  {r.value}
                  {r.note && <span className="block text-xs text-muted-foreground">{r.note}</span>}
                </td>
                <td className={cn(cell, 'whitespace-nowrap')}>
                  {r.changed ? 'Changed' : 'Default'}
                </td>
                <td className={cn(cell, 'min-w-48')}>
                  {r.changed ? (
                    <>
                      {r.changed.who ?? 'An update or a script'}, {r.changed.when}
                      {r.changed.why && (
                        <span className="block text-xs text-muted-foreground">{r.changed.why}</span>
                      )}
                    </>
                  ) : (
                    'Install'
                  )}
                </td>
                {/* Where this would be squeezed to a word a line, the settings stack instead. */}
                <td className={cn(cell, 'min-w-64 text-muted-foreground')}>{r.what}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </FrameFit>
  )
}

/** An API address in a sentence. */
const CODE = 'rounded-sm bg-muted px-1 py-0.5 font-mono text-xs text-foreground'

function AdvancedSections({ page }: { page: AdvancedPage }) {
  const domains = useDomains()
  const write = useWrite()
  const failed = (what: string) => (e: unknown) =>
    toast(`Couldn't ${what}`, { description: toApiError(e).message })
  const checkChain = () =>
    void write('checkHistory', undefined).then(
      ({ whole, entries }) =>
        toast(whole ? 'The log is whole' : 'The log is broken', {
          description:
            entries === null
              ? whole
                ? 'Every entry verified.'
                : 'An entry was changed after the fact.'
              : `${entries.toLocaleString('en-GB')} entries verified.`,
        }),
      failed('verify the log'),
    )
  const exported = (what: 'exportHistory' | 'exportContext') =>
    void write(what, undefined).then((file) => {
      save(file)
      toast('Exported', { description: file.name })
    }, failed('export'))
  const count = page.settings.reduce((sum, g) => sum + g.rows.length, 0)
  return (
    <>
      <FrameSection
        title="Tuning settings"
        level={3}
        description={`All ${count} settings and their values now. Answer tests, links people paste, shared chats and writing help can be changed here; the rest change through the API.`}
        collapsible
      >
        <div className="space-y-2 border-t px-4 py-3 text-sm text-muted-foreground md:px-5">
          <p className="max-w-reading">
            Each setting is kept in the database, and only an Admin can change one. The change
            applies at once, and the History log keeps who made it and why. About our business can
            also be changed in General, and the Not found level in Observability, Alerts.
          </p>
          <Collapsible>
            <FoldTrigger variant="inline" label="For engineers" className="-ml-1 px-1 text-xs" />
            <CollapsibleContent>
              <p className="mt-2 max-w-reading">
                An Admin changes a setting through the API:{' '}
                <code className={CODE}>PUT /api/v1/settings/{'{key}'}</code> with the version they
                read, the new value and a reason.
              </p>
            </CollapsibleContent>
          </Collapsible>
          <p className="max-w-reading">
            Default means the value the app was installed with. Changed names who changed it last:
            an Admin, or, with no person, an update of the app or a script run on the database.
            Whether a real model is called at all, and its key, are set by the person who hosts this
            app, where it runs, not here.{' '}
            <PublicGuideLink slug="model-providers">How to connect a model</PublicGuideLink>
          </p>
        </div>
        <SettingsTable groups={page.settings} />
      </FrameSection>
      <FrameSection
        title="History log"
        level={3}
        description="Who changed what, and when. A later edit to this log would show (a hash chain)."
        collapsible
        defaultOpen={page.history.length > 4}
        action={
          <>
            <Button variant="outline" onClick={checkChain}>
              Verify the log
            </Button>
            <Button variant="outline" onClick={() => exported('exportHistory')}>
              Export
            </Button>
          </>
        }
      >
        <FrameTable
          label="History log"
          columns={[
            { label: 'When', className: 'w-36 whitespace-nowrap', cell: 'text-muted-foreground' },
            { label: 'Who', className: 'w-56', cell: 'font-medium' },
            { label: 'What', className: 'min-w-64' },
          ]}
          rows={page.history.map((h) => [h.when, h.who, cellLink(h.what, h.href)])}
        />
      </FrameSection>
      <FrameSection
        title="Jobs"
        level={3}
        description="What runs on its own."
        collapsible
        defaultOpen={false}
      >
        {page.jobs ? (
          <FrameTable
            label="Jobs"
            columns={cols('Job', 'Last run', 'Result')}
            rows={page.jobs.map((j) => [
              <span key={j.key} className="block">
                {cellLink(j.job, j.href)}
                <code className="block font-mono text-xs text-muted-foreground">{j.key}</code>
              </span>,
              j.last,
              j.result,
            ])}
          />
        ) : (
          <p className="border-t px-4 py-3 text-sm text-muted-foreground md:px-5">
            The jobs aren&apos;t answering right now. Try again in a minute.
          </p>
        )}
      </FrameSection>
      <FrameSection
        title="Versions of what agents get"
        level={3}
        description="Agents read the latest version. Each publish makes a new one. Engineers call one an edition."
        collapsible
        defaultOpen={false}
      >
        <FrameTable
          label="Editions"
          columns={cols('Edition', 'Sealed', 'Change').map((c, i) =>
            i === 0
              ? { ...c, cell: 'font-mono text-xs' }
              : i === 2
                ? { ...c, className: 'min-w-56' }
                : c,
          )}
          rows={page.editions.map((e) => [e.label, e.sealed, e.change])}
        />
      </FrameSection>
      {page.links && <LinkReading links={page.links} />}
      {page.sharing && <ChatSharing sharing={page.sharing} />}
      {page.writingHelp && <WritingHelp help={page.writingHelp} />}
      <FrameSection
        title="Answer tests"
        level={3}
        description="Answer tests are saved questions, answered by a real AI model and then judged. The free run of saved questions already happens after every change, in Observability, Quality."
        collapsible
        defaultOpen={false}
      >
        <FrameRows
          rows={[
            ...(page.answerTests
              ? [
                  {
                    label: 'Run on their own',
                    hint: answerTestWords(page.answerTests).hint,
                    value: <AutomaticRuns tests={page.answerTests} />,
                  },
                ]
              : []),
            {
              label: 'Needs a model key',
              hint: "Answer tests only run with a real model, so a passed test always means something. The person who hosts this app turns real models on and adds the model provider's key where it runs.",
              value: <span className="text-xs text-muted-foreground">Not set here</span>,
            },
            {
              label: 'With and without context',
              hint: 'Runs the saved questions twice, with context and without, and a model judges whether context helps. It is run once from the command line first; this comes after, with a key.',
              value: (
                <Button
                  variant="outline"
                  aria-disabled
                  aria-description="Run it once from the command line first. A model key turns this on later."
                  title="Run it once from the command line first. A model key turns this on later."
                >
                  Run with and without
                </Button>
              ),
            },
          ]}
        />
      </FrameSection>
      <FrameSection
        title="Import and export"
        level={3}
        description={
          <>
            Context as a file (JSON), for a backup or a move. To bring context in, the command
            line&apos;s <code className={CODE}>{SLUG} import</code> checks a file, and sends its
            items as suggestions with <code className={CODE}>--apply</code>.
          </>
        }
        action={
          <Button variant="outline" onClick={() => exported('exportContext')}>
            Export context
          </Button>
        }
      />
      <FrameSection
        title="Deleted"
        level={3}
        description="Your drafts and the terms that were deleted, by whom and when. Deleting is for good; published context is archived instead, so it keeps its history."
        collapsible
        defaultOpen={page.deleted.length > 1}
      >
        {page.deleted.length ? (
          <FrameRows
            rows={page.deleted.map((d) => ({
              id: d.key,
              label: d.title,
              hint: d.hint,
              value: (
                <span className="text-xs text-muted-foreground">
                  {d.domain ? domains[d.domain]?.name : ''}
                </span>
              ),
            }))}
          />
        ) : (
          <p className="border-t px-4 py-3 text-sm text-muted-foreground md:px-5">
            Nothing deleted yet.
          </p>
        )}
      </FrameSection>
      <LeftDrafts left={page.left} />
    </>
  )
}

/**
 * The drafts of people who left (FR-139): a draft is its writer's alone, so nobody reads it once
 * they are gone. An admin deletes them by count, unread, after a confirmation; the History log
 * says how many, and whose.
 */
function LeftDrafts({ left }: { left: AdvancedPage['left'] }) {
  const write = useWrite()
  const [asking, setAsking] = React.useState<AdvancedPage['left'][number] | null>(null)
  const drafts = (n: number) => (n === 1 ? '1 draft' : `${n.toLocaleString('en-GB')} drafts`)
  if (!left.length) return null
  const clear = (person: AdvancedPage['left'][number]) =>
    void write('clearLeftDrafts', { id: person.id }).then(
      ({ deleted }) => toast(`Deleted ${drafts(deleted)}`, { description: person.name }),
      (e: unknown) =>
        toast(`Couldn't delete the drafts of ${person.name}`, {
          description: toApiError(e).message,
        }),
    )
  return (
    <FrameSection
      title="Drafts of people who left"
      level={3}
      description="Only their writer could read a draft, so nobody can now. Delete them when nobody needs them."
    >
      <FrameRows
        rows={left.map((person) => ({
          id: person.id,
          label: person.name,
          hint: `Left ${drafts(person.drafts)} nobody sent or published.`,
          value: (
            <Button variant="outline" onClick={() => setAsking(person)}>
              Delete {drafts(person.drafts)}
            </Button>
          ),
        }))}
      />
      <Dialog open={!!asking} onOpenChange={(open) => !open && setAsking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {asking ? drafts(asking.drafts) : ''} of {asking?.name}?
            </DialogTitle>
            <DialogDescription>
              Nobody reads them first, and they are gone for good. What {asking?.name} published or
              sent stays.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (asking) clear(asking)
                setAsking(null)
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FrameSection>
  )
}

/**
 * Sharing an Ask chat as a link (FR-721): on as installed. Off, no chat is shared and no link
 * opens, those already made too, until it is on again.
 */
function ChatSharing({ sharing }: { sharing: NonNullable<AdvancedPage['sharing']> }) {
  const write = useWrite()
  const setOn = (on: boolean) =>
    void write('setChatSharing', { on, version: sharing.version }).then(
      () => toast(on ? 'People can share chats' : 'Sharing chats is off'),
      (e: unknown) =>
        toast(on ? "Couldn't turn it on" : "Couldn't turn it off", {
          description: toApiError(e).message,
        }),
    )
  return (
    <FrameSection
      title="Shared chats"
      level={3}
      description={
        sharing.on
          ? 'On. People can share an Ask chat as a link, which lasts 90 days.'
          : 'Off. No chat is shared, and no link opens.'
      }
      collapsible
      defaultOpen={false}
    >
      <FrameRows
        rows={[
          {
            id: 'share-chats',
            label: <label htmlFor="share-chats">Share chats as links</label>,
            hint: 'A link keeps a copy of the chat under its sender’s name, never a figure. Only people signed in open it, each source only if they may read it.',
            value: <Switch id="share-chats" checked={sharing.on} onCheckedChange={setOn} />,
          },
        ]}
      />
    </FrameSection>
  )
}

/**
 * Writing help, the editor's dock: off as installed, since turning it on sends the words of a
 * draft to the AI model set for Ask. The row says what is sent before an admin turns it on. It has
 * an address of its own (/settings/advanced/writing-help), where the editor's first box leads an
 * admin: there it is open, with the keyboard on its switch.
 */
function WritingHelp({ help }: { help: NonNullable<AdvancedPage['writingHelp']> }) {
  const write = useWrite()
  const { answeredBy } = useSession()
  const asked = useRoute().parts[2] === 'writing-help'
  // The switch itself: its id is on the hidden checkbox behind it, which takes no focus.
  const toggle = React.useRef<HTMLElement>(null)
  React.useEffect(() => {
    if (asked) toggle.current?.focus()
  }, [asked])
  const setOn = (on: boolean) =>
    void write('setWritingHelp', { on, version: help.version }).then(
      () => toast(on ? 'Writing help is on' : 'Writing help is off'),
      (e: unknown) =>
        toast(on ? "Couldn't turn it on" : "Couldn't turn it off", {
          description: toApiError(e).message,
        }),
    )
  return (
    <FrameSection
      title="Writing help"
      level={3}
      description={
        help.on
          ? 'On. People can write a draft with writing help, beside the editor.'
          : 'Off. Nothing of a draft leaves this workspace.'
      }
      collapsible
      defaultOpen={asked}
    >
      <FrameRows
        rows={[
          {
            id: 'writing-help',
            label: <label htmlFor="writing-help">Let people write with writing help</label>,
            hint:
              answeredBy === 'reader'
                ? 'On a computer or tablet. When it is on, a draft’s words, and what its writer pastes or links, go to the AI model set for Ask. No AI model is connected now, so writing help stays away until one is.'
                : 'On a computer or tablet. When it is on, a draft’s words, and what its writer pastes or links, go to the AI model set for Ask. Writing help changes only that person’s own draft, and never sends it.',
            value: (
              <Switch ref={toggle} id="writing-help" checked={help.on} onCheckedChange={setOn} />
            ),
          },
        ]}
      />
    </FrameSection>
  )
}

/**
 * Reading the links people paste (FR-144): on as installed. Draft from text opens the public
 * page a link points to, under the reader's rules; off, people paste the page's text. The sites an
 * admin lists are never read, such as internal systems on public addresses, which the address
 * rules cannot tell from the public web.
 */
function LinkReading({ links }: { links: NonNullable<AdvancedPage['links']> }) {
  const write = useWrite()
  const [editing, setEditing] = React.useState(false)
  const [text, setText] = React.useState('')
  const [problem, setProblem] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const sites = (n: number) => (n === 1 ? '1 site' : `${n.toLocaleString('en-GB')} sites`)
  const setOn = (on: boolean) =>
    void write('setLinkReading', { on, version: links.version }).then(
      () => toast(on ? 'Links people paste are read' : 'Links people paste are not read'),
      (e: unknown) =>
        toast(on ? "Couldn't turn it on" : "Couldn't turn it off", {
          description: toApiError(e).message,
        }),
    )
  const edit = () => {
    setText(links.hosts.join('\n'))
    setProblem('')
    setEditing(true)
  }
  const save = () => {
    // One site a line or separated by commas; a whole address keeps only its site.
    const hosts = [
      ...new Set(
        text
          .split(/[\n,]+/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const url = URL.parse(line)
            return normalizeHost(url && /^https?:$/.test(url.protocol) ? url.hostname : line)
          }),
      ),
    ]
    const bad = hosts.find((host) => !isHost(host))
    if (bad)
      return setProblem(
        `“${bad}” isn’t a site’s name. Write one a line, such as intranet.example.com.`,
      )
    if (hosts.length > NEVER_READ_HOSTS_MAX)
      return setProblem(`List at most ${NEVER_READ_HOSTS_MAX.toLocaleString('en-GB')} sites.`)
    setSaving(true)
    void write('setNeverReadHosts', { hosts, version: links.hostsVersion })
      .then(
        () => {
          setEditing(false)
          toast(hosts.length ? `${sites(hosts.length)} never read` : 'No site listed')
        },
        (e: unknown) => setProblem(toApiError(e).message),
      )
      .finally(() => setSaving(false))
  }
  return (
    <FrameSection
      title="Links people paste"
      level={3}
      description={
        links.on
          ? 'On. Draft from text opens the public page a link points to and fills in from it.'
          : "Off. People paste the page's text instead."
      }
      collapsible
      defaultOpen={false}
    >
      <FrameRows
        rows={[
          {
            id: 'read-links',
            label: <label htmlFor="read-links">Read links people paste</label>,
            hint: 'Public pages only, read once and never kept: the draft keeps the link and one sentence. A sign-in page or a link that carries a key is never opened.',
            value: <Switch id="read-links" checked={links.on} onCheckedChange={setOn} />,
          },
          {
            id: 'never-read',
            label: 'Sites never read',
            hint: links.hosts.length
              ? `${
                  links.hosts.length > 3
                    ? `${links.hosts.slice(0, 3).join(', ')} and ${(links.hosts.length - 3).toLocaleString('en-GB')} more`
                    : listOf(links.hosts, 'and')
                }. Each covers its subdomains.`
              : 'Links are read from inside your network, so list your internal sites that have public addresses. Each covers its subdomains.',
            value: (
              <Button variant="outline" onClick={edit}>
                {links.hosts.length ? 'Change' : 'Add sites'}
              </Button>
            ),
          },
        ]}
      />
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sites never read</DialogTitle>
            <DialogDescription>
              A link to one of these sites, or to a site under one, is never opened. List a
              site&apos;s address too, and no other name for it is read either. People paste the
              page&apos;s text instead.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="never-read-hosts">One site a line</FieldLabel>
            <Textarea
              id="never-read-hosts"
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setProblem('')
              }}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? 'never-read-problem' : undefined}
              className="min-h-28 font-mono text-xs"
              placeholder={'intranet.example.com\nwiki.example.com'}
            />
            <FieldError id="never-read-problem">{problem}</FieldError>
          </Field>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button onClick={save} loading={saving} loadingLabel="Saving…">
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FrameSection>
  )
}

/**
 * Answer tests that run on their own (decision 6): off as installed. Turning them on shows what a
 * run of every domain is estimated to cost first, and asks; turning them off asks nothing.
 */
function AutomaticRuns({ tests }: { tests: AnswerTestRuns }) {
  const write = useWrite()
  const [asking, setAsking] = React.useState(false)
  const words = answerTestWords(tests)
  const set = (on: boolean) =>
    void write('setAutomaticRuns', { on, version: tests.version }).then(
      () => {
        setAsking(false)
        toast(on ? 'Answer tests run on their own' : 'Answer tests run only when started')
      },
      (e: unknown) =>
        toast(`Couldn't turn them ${on ? 'on' : 'off'}`, { description: toApiError(e).message }),
    )
  return (
    <>
      <span className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">{words.state}</span>
        {tests.on ? (
          <Button variant="outline" onClick={() => set(false)}>
            Turn off
          </Button>
        ) : (
          <Button variant="outline" onClick={() => setAsking(true)}>
            Turn on
          </Button>
        )}
      </span>
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Run answer tests on their own?</DialogTitle>
            <DialogDescription render={<div className="space-y-2" />}>
              {words.estimate.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button onClick={() => set(true)}>Turn on</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

const TITLES: Record<string, string> = {
  people: 'People',
  general: 'General',
  domains: 'Domains and owners',
  agents: 'Agents and access',
  integrations: 'Integrations',
  advanced: 'Advanced',
}

/** Settings > Integrations > Cube: where you are inside Settings, each step a link back. */
export function SettingsCrumbs({ trail }: { trail: { label: string; href?: string }[] }) {
  return (
    <Breadcrumb>
      <BreadcrumbList className="flex-nowrap text-sm">
        {trail.map((t, i) => (
          <React.Fragment key={t.label}>
            {/* In a narrow header the page's own name stands alone. */}
            {i > 0 && <BreadcrumbSeparator data-narrow="gone" />}
            <BreadcrumbItem
              data-narrow={i < trail.length - 1 ? 'gone' : undefined}
              className="min-w-0"
            >
              {/* The page it ends in is the page's heading. */}
              {i === trail.length - 1 ? (
                <h1 className="min-w-0 truncate">
                  <BreadcrumbPage className="font-medium">{t.label}</BreadcrumbPage>
                </h1>
              ) : t.href ? (
                <BreadcrumbLink href={t.href}>{t.label}</BreadcrumbLink>
              ) : (
                <span>{t.label}</span>
              )}
            </BreadcrumbItem>
          </React.Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

/** One Settings section, with its title and what it is for, under the settings navigation. No tabs. */
export function SettingsPage({
  section,
  sub,
  step,
}: {
  section?: string
  sub?: string
  step?: string
}) {
  const me = useMe()
  const admins = usePeople()
    .filter((p) => p.admin && p.name !== me.name)
    .map((p) => p.name)
  const current =
    section && TITLES[section] ? section : me.admin ? 'general' : landingOf(me.owns.length > 0)
  // Someone who isn't an admin uses their agents here, and an owner also the domains and the
  // people list: any other section says who to ask, and leads to their own.
  const owner = me.owns.length > 0
  if (!mayOpenSettings(`/settings/${current}/${sub ?? ''}`, me))
    return (
      <Page title="Settings">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Settings are for admins</EmptyTitle>
            <EmptyDescription>
              {admins.length
                ? `Ask ${listOf(admins, 'or')} if something here needs changing.`
                : 'Ask an admin if something here needs changing.'}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <a
              href={`/settings/${landingOf(owner)}`}
              className={cn(buttonVariants({ variant: 'outline' }))}
            >
              {owner ? 'Open Domains and owners' : 'Open Agents and access'}
            </a>
          </EmptyContent>
        </Empty>
      </Page>
    )
  if (current === 'integrations') return <IntegrationsRoute id={sub} step={step} />
  if (current === 'domains' && sub)
    return (
      <React.Suspense fallback={<Page title="Domain">{null}</Page>}>
        <DomainPage
          key={sub}
          id={sub}
          crumbs={(name) => (
            <SettingsCrumbs
              trail={[
                { label: 'Settings', href: '/settings' },
                { label: 'Domains and owners', href: '/settings/domains' },
                { label: name },
              ]}
            />
          )}
        />
      </React.Suspense>
    )
  const title = (
    <SettingsCrumbs
      trail={[{ label: 'Settings', href: '/settings' }, { label: TITLES[current]! }]}
    />
  )
  if (current === 'general')
    return (
      <React.Suspense fallback={<Page title={title}>{null}</Page>}>
        <AboutPage title={title} helpText={<AboutHelp />} />
      </React.Suspense>
    )
  return (
    <Page title={title}>
      <FramePage>
        {current === 'domains' && <Domains />}
        {current === 'people' && <People />}
        {current === 'agents' && <Agents />}
        {current === 'advanced' && <Advanced />}
      </FramePage>
    </Page>
  )
}
