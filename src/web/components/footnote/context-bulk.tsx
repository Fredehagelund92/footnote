import * as React from 'react'
import {
  ArchiveIcon,
  CircleCheckIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  FolderInputIcon,
  SendIcon,
  ShapesIcon,
  Trash2Icon,
  UserPlusIcon,
  UsersIcon,
} from '@/components/icons'
import { toast } from '@/lib/toast'
import { BulkBar, BulkButton, type BulkNote } from '@/components/footnote/bulk-bar'
import { DeleteDialog } from '@/components/footnote/delete-dialog'
import { PublishDialog } from '@/components/footnote/publish-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { dateLabel } from '@/model/validity'
import { today } from '@/lib/today'
import { leaveAllThen } from '@/lib/presence'
import { APP_URL } from '@/lib/brand'
import { kindLabel, type DomainId, type Fact, type Kind } from '@/model/items'
import { ownersOf } from '@/model/people'
import type { RowSelection } from '@/hooks/use-selection'
import { useDeleteConfirmation } from '@/hooks/use-delete-confirmation'
import {
  canChange,
  CONFIRM_ABOVE,
  count,
  doneLine,
  download,
  heldRows,
  movableTo,
  planFacts,
  publishedLine,
  publishesNow,
  publishParts,
  skippedLine,
  toCsv,
  toMarkdown,
  type FactAction,
  type Me,
} from '@/lib/bulk'
import { nextLine, nothingToPublish, publishedWhen } from '@/lib/publish-lines'
import { api } from '@/api'
import { useLibrary, useRefreshAfter } from '@/api/queries'
import { useUndo } from '@/lib/undo'
import { useOnline } from '@/lib/send'
import { useDomains, useMe, usePeople } from '@/lib/workspace'
import type { LogEntry } from '@/model/items'

// What a person can do to many context items at once, from the bar: Publish (drafts only, as from
// the editor: at once where they own the domain, else sent to its owners; asked first for more than a
// handful), Archive (the safe default, with Undo), Delete (drafts only, after a confirmation, with
// Undo for a short while), and under More:
// change the domain, the kind or the owners, mark as checked, and export. Each change acts on the
// rows it may change and says what it left alone; the rows left alone stay ticked, with the reasons.
// Every change is written to the items' History, and a deletion to Settings, Advanced.

const KINDS = Object.keys(kindLabel) as Kind[]
const OFFLINE = "Off while you're offline. Nothing is lost."
let entries = 0

export function ContextBulk({
  sel,
  facts,
  matching,
}: {
  sel: RowSelection
  facts: Fact[]
  /** Every row the search and filters match, folded groups too. */
  matching: string[]
}) {
  const { viewed } = useLibrary()
  const me = useMe()
  const domains = useDomains()
  const people = usePeople()
  const online = useOnline()
  const undo = useUndo()
  const refreshAfter = useRefreshAfter()
  const [note, setNote] = React.useState<BulkNote>()
  const picked = facts.filter((f) => sel.isSelected(f.id))
  const who: Me = { name: me.name, admin: me.admin }

  // A new selection starts without the last change's line.
  const key = sel.ids.join('|')
  const noted = React.useRef(key)
  React.useEffect(() => {
    if (noted.current !== key) setNote(undefined)
  }, [key])

  /** One change to the picked rows: it acts on what it may, keeps the rest ticked, and can be undone. */
  const change = (...args: Parameters<typeof applyChange>) => void applyChange(...args)
  async function applyChange(
    action: FactAction,
    verb: string,
    what: LogEntry['what'],
    summary: string,
    patch: (f: Fact) => Partial<Fact>,
    opts: Parameters<typeof planFacts>[4] = {},
    rows: Fact[] = picked,
  ) {
    const plan = planFacts(action, rows, who, domains, { ...opts, viewed })
    if (!plan.act.length) {
      setNote({ text: skippedLine(plan.skipped), skipped: plan.skipped })
      return
    }
    // Publish: as from a draft's own page; a draft for another domain's owners is sent to them.
    const parts = action === 'publish' ? publishParts(plan, who, domains, dateLabel(today())) : null
    const suggest = plan.act.filter((f) => parts?.suggest.includes(f.id))
    const input = {
      action,
      ...(opts.domain ? { domain: opts.domain } : {}),
      ...(opts.kind ? { kind: opts.kind } : {}),
      ...(opts.person ? { person: opts.person.name } : {}),
      patches:
        action === 'delete'
          ? {}
          : (parts?.patches ?? Object.fromEntries(plan.act.map((f) => [f.id, patch(f)]))),
      remove: action === 'delete' ? plan.act.map((f) => f.id) : [],
      ...(parts?.suggest.length ? { suggest: parts.suggest } : {}),
      entry: {
        id: `log-${++entries}`,
        on: today(),
        who: me.name,
        what,
        summary,
        items: plan.act.map((f) => ({ id: f.id, title: f.title, domain: f.domain })),
      },
    }
    // The change is made at once; the list shows it once the rows that leave it (archived or
    // deleted) have gone.
    const result = await api.applyBulk(input)
    const ok = plan.act.filter((f) => result.done.includes(f.id))
    const failed = plan.act.filter((f) => result.failed.includes(f.id))
    // What the service's own checks refused: left alone, with why, as the rows planned out.
    const skipped = [...plan.skipped, ...(result.skipped ?? [])]
    const sent = ok.filter((f) => suggest.includes(f))
    const refresh = () => refreshAfter('applyBulk', input, result)
    if (action === 'delete' || action === 'archive' || sent.length)
      void leaveAllThen(
        (action === 'publish' ? sent : ok).map((f) => f.id),
        refresh,
      )
    else void refresh()
    // What is done leaves the selection; what failed or was left alone stays, with its line, and
    // so do the drafts past one Publish's batch, for the next press.
    const later = plan.next.map((f) => f.id)
    const stay = [...failed.map((f) => f.id), ...skipped.map((s) => s.id), ...later]
    if (stay.length) sel.select(stay)
    else sel.clear()
    const line =
      action === 'publish'
        ? publishedLine(
            ok.length - sent.length,
            sent.length,
            failed.length,
            [...new Set(sent.map((f) => domains[f.domain]?.name))].join(' and '),
          )
        : doneLine(verb, ok.length, failed.length)
    if (!ok.length && !failed.length) {
      setNote({ text: skippedLine(skipped), skipped })
      noted.current = stay.join('|')
      return
    }
    if (failed.length)
      setNote({
        text: [line, skippedLine(skipped)].filter(Boolean).join('. '),
        skipped,
        action: {
          label: 'Retry',
          onClick: () => change(action, verb, what, summary, patch, opts, failed),
        },
      })
    else if (later.length)
      setNote({
        text: nextLine(later.length),
        action: {
          label: `Publish next ${later.length.toLocaleString('en-GB')}`,
          onClick: () => publishNext.current(),
        },
      })
    // What a Publish left has nothing to publish: the bar says why on its own (nothingToPublish).
    else if (action === 'publish') setNote(undefined)
    else setNote(skipped.length ? { text: skippedLine(skipped), skipped } : undefined)
    noted.current = stay.join('|')
    undo.offer(line, result.undo, {
      description: (held) =>
        action === 'delete'
          ? `You can undo it for ${held}; then they are gone for good.`
          : action === 'archive'
            ? 'Agents stop getting them from the next question.'
            : action === 'publish'
              ? publishedWhen(ok.length - sent.length, sent.length)
              : undefined,
      undone: { title: `Undone: ${count(ok.length, 'item')} as before` },
    })
  }

  const archive = (rows = picked) =>
    change(
      'archive',
      'archived',
      'archived',
      'Archived: agents stop getting it.',
      () => ({ status: 'Archived' }),
      {},
      rows,
    )

  const publish = (rows = picked) =>
    change(
      'publish',
      'published',
      'published',
      'Published from the Context list.',
      () => ({}),
      {},
      rows,
    )

  // What each button would do now, so one that can't act says why before it is pressed.
  const archivePlan = planFacts('archive', picked, who, domains)
  const deletePlan = planFacts('delete', picked, who, domains)
  const publishedPlan = planFacts(
    'archive',
    picked.filter((f) => f.status !== 'Draft'),
    who,
    domains,
  )
  const cannot = picked.length > 0 && picked.every((f) => !canChange(f, who, domains))
  const ownedBy = [...new Set(picked.map((f) => domains[f.domain]?.name))].join(' and ')
  const noRights = cannot ? `Only owners of ${ownedBy} and admins can change these.` : undefined
  const off = online ? noRights : OFFLINE
  const archiveReason = off ?? (archivePlan.act.length ? undefined : archivePlan.skipped[0]?.reason)
  // Delete opens its confirmation whenever there is a draft to delete or a published item to archive instead.
  const deleteReason =
    off ??
    (deletePlan.act.length || publishedPlan.act.length ? undefined : deletePlan.skipped[0]?.reason)
  // Publish is the writer's too, so it is off only offline or for what is not a draft, and then
  // the line above the bar says why at once. Past a batch it takes the first ones in the list's
  // order and keeps the rest ticked, saying so.
  const publishPlan = planFacts('publish', picked, who, domains)
  const publishNow = publishPlan.act.filter((f) => publishesNow(f, who, domains)).length
  const publishSend = publishPlan.act.length - publishNow
  const nothing =
    picked.length && !publishPlan.act.length ? nothingToPublish(publishPlan.skipped) : undefined
  const publishReason = !online ? OFFLINE : nothing && publishPlan.skipped[0]?.reason
  // The button says which it does: publish, send to the owners, or some of each.
  const publishLabel = !publishSend
    ? 'Publish'
    : !publishNow
      ? 'Suggest'
      : `Publish ${publishNow}, suggest ${publishSend}`
  const sendTo = [
    ...new Set(
      publishPlan.act
        .filter((f) => !publishesNow(f, who, domains))
        .map((f) => domains[f.domain]?.name),
    ),
  ].join(' and ')
  const publishSays = !publishSend
    ? undefined
    : publishNow
      ? `Publishes ${count(publishNow, 'draft')}; sends ${count(publishSend, 'draft')} to the owners of ${sendTo}.`
      : `Sends ${count(publishSend, 'draft')} to the owners of ${sendTo}.`
  // More than a handful is asked once, holding the rows ticked then.
  const [publishing, setPublishing] = React.useState<string[] | null>(null)
  const askPublish = () => {
    if (publishPlan.act.length > CONFIRM_ABOVE) setPublishing([...sel.ids])
    else publish()
  }
  // The line's "Publish next 4" is pressed later, with the rows ticked then.
  const publishNext = React.useRef(askPublish)
  React.useEffect(() => {
    publishNext.current = askPublish
  })
  const heldRowsToPublish = facts.filter((f) => publishing?.includes(f.id))
  const heldPublish = planFacts('publish', heldRowsToPublish, who, domains)
  const heldSend = heldPublish.act.filter((f) => !publishesNow(f, who, domains))
  // It shuts, and stays shut, when its drafts have gone or the connection has, as Delete's does.
  const publishStale = !!publishing && (!heldPublish.act.length || !online)
  if (publishStale) setPublishing(null)

  const { confirming, ask, close } = useDeleteConfirmation(sel, deleteReason, (text) =>
    setNote({ text }),
  )
  // What the confirmation holds: the items it was opened with, not the ticks as they are now.
  const heldPicked = heldRows(facts, confirming, (f) => f.id)
  const held = planFacts('delete', heldPicked, who, domains)
  const heldPublished = planFacts(
    'archive',
    heldPicked.filter((f) => f.status !== 'Draft'),
    who,
    domains,
  )
  const remove = () =>
    change(
      'delete',
      'deleted',
      'deleted',
      'Deleted: a draft nobody published.',
      () => ({}),
      {},
      heldPicked,
    )
  // It shuts, and stays shut, when the items are gone from under it or the connection is: it never
  // says "Delete 0 drafts?" and never opens by itself when the connection returns.
  const stale = !!confirming && (!(held.act.length || heldPublished.act.length) || !online)
  React.useEffect(() => {
    if (stale) close()
  })

  const owners = people.filter((p) => p.admin || p.owns.length)
  const domainChoices = movableTo(who, domains)

  return (
    <>
      <BulkBar
        label="Selected context"
        count={sel.count}
        onClear={sel.clear}
        matching={
          sel.allShown
            ? { count: matching.length, onSelect: () => sel.select(matching) }
            : undefined
        }
        note={
          !online
            ? { text: "You're offline. Changes are off until you're back; nothing is lost." }
            : (note ??
              (nothing ? { text: nothing, info: true, skipped: publishPlan.skipped } : undefined))
        }
      >
        <BulkButton reason={publishReason} aria-description={publishSays} onClick={askPublish}>
          <SendIcon />
          <span className="max-sm:sr-only">{publishLabel}</span>
        </BulkButton>
        <BulkButton reason={archiveReason} onClick={() => archive()}>
          <ArchiveIcon />
          <span className="max-sm:sr-only">Archive</span>
        </BulkButton>
        <BulkButton reason={deleteReason} onClick={ask}>
          <Trash2Icon />
          <span className="max-sm:sr-only">Delete</span>
        </BulkButton>
        <DropdownMenu>
          <DropdownMenuTrigger render={<BulkButton />}>
            <EllipsisIcon />
            <span className="max-sm:sr-only">More</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-60">
            {off && <p className="px-2 py-1.5 text-xs text-muted-foreground">{off}</p>}
            <DropdownMenuGroup>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={!!off}>
                  <FolderInputIcon />
                  Change domain
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-52">
                  {domainChoices.map((d: DomainId) => (
                    <DropdownMenuItem
                      key={d}
                      onClick={() =>
                        change(
                          'domain',
                          'moved',
                          'moved',
                          `Moved to ${domains[d]?.name}.`,
                          () => ({ domain: d }),
                          { domain: d },
                        )
                      }
                    >
                      {domains[d]?.name}
                    </DropdownMenuItem>
                  ))}
                  {!who.admin && (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">
                      Only domains you own are listed.
                    </p>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={!!off}>
                  <ShapesIcon />
                  Change kind
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-44">
                  {KINDS.map((k) => (
                    <DropdownMenuItem
                      key={k}
                      onClick={() =>
                        change(
                          'kind',
                          'changed',
                          'kind',
                          `Kind changed to ${kindLabel[k]}.`,
                          () => ({ kind: k }),
                          { kind: k },
                        )
                      }
                    >
                      {kindLabel[k]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={!!off}>
                  <UserPlusIcon />
                  Add owner
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  {owners.map((p) => (
                    <DropdownMenuItem
                      key={p.name}
                      onClick={() =>
                        change(
                          'owner-add',
                          'changed',
                          'owners',
                          `${p.name} added as an owner.`,
                          (f) => ({ owners: [...ownersOf(f, domains), p.name] }),
                          { person: p },
                        )
                      }
                    >
                      {p.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={!!off}>
                  <UsersIcon />
                  Change owner
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  {owners.map((p) => (
                    <DropdownMenuItem
                      key={p.name}
                      onClick={() =>
                        change(
                          'owner-set',
                          'changed',
                          'owners',
                          `Owner changed to ${p.name}.`,
                          () => ({ owners: [p.name] }),
                          { person: p },
                        )
                      }
                    >
                      {p.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem
                disabled={!!off}
                onClick={() =>
                  change(
                    'check',
                    'checked',
                    'checked',
                    'Checked: still true.',
                    (f) => ({
                      status: f.status === 'Due for a check' ? 'Live' : f.status,
                      outOfDate: undefined,
                      checkedBy: me.name,
                      checkedOn: dateLabel(today()),
                    }),
                    {},
                  )
                }
              >
                <CircleCheckIcon />
                <span className="flex flex-col">
                  Mark as checked
                  <span className="text-xs text-muted-foreground">Only the ones you opened</span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                navigator.clipboard
                  ?.writeText(picked.map((f) => `${APP_URL}/context/${f.id}`).join('\n'))
                  .catch(() => undefined)
                toast(`Copied ${count(picked.length, 'link')}`)
              }}
            >
              <CopyIcon />
              Copy links
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <DownloadIcon />
                Export
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52">
                <DropdownMenuItem
                  onClick={() => {
                    download('context.md', toMarkdown(picked, domains), 'text/markdown')
                    toast(`Exported ${count(picked.length, 'item')} as Markdown`)
                  }}
                >
                  As Markdown
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    download('context.csv', toCsv(picked, domains), 'text/csv')
                    toast(`Exported ${count(picked.length, 'item')} as a spreadsheet`)
                  }}
                >
                  As a spreadsheet (CSV)
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </BulkBar>
      <PublishDialog
        open={!!publishing && !publishStale}
        onOpenChange={(open) => !open && setPublishing(null)}
        drafts={heldPublish.act}
        send={heldSend}
        next={heldPublish.next.length}
        skipped={heldPublish.skipped}
        onPublish={() => publish(heldRowsToPublish)}
      />
      <DeleteDialog
        open={!!confirming && !stale}
        onOpenChange={(open) => !open && close()}
        noun="draft"
        titles={held.act.map((f) => f.title)}
        consequence="Nobody published them, so agents never got them. They are removed for good; you can undo it for a few seconds."
        skipped={held.skipped}
        archive={
          heldPublished.act.length
            ? { count: heldPublished.act.length, onArchive: () => archive(heldPublished.act) }
            : undefined
        }
        onDelete={remove}
      />
    </>
  )
}
