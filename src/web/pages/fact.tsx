import * as React from 'react'
import { cn } from '@/lib/utils'
import { DisagreesSection } from '@/components/footnote/disagrees'
import { mentionId } from '@/lib/mentions'
import { CircleCheckIcon, ClockIcon, EllipsisIcon, MessageSquareIcon } from '@/components/icons'
import { toast } from '@/lib/toast'
import { Canvas, Paper, SideSection } from '@/components/footnote/doc'
import { ItemDocument } from '@/components/footnote/item-document'
import { ResizableAside } from '@/components/resizable-aside'
import { Panel, PanelRail } from '@/components/footnote/panel'
import { useSideChoice } from '@/lib/side-panel'
import { Page } from '@/components/site-header'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Related } from '@/components/footnote/related'
import { useRelated } from '@/hooks/use-related'
import { openDock } from '@/lib/dock'
import { useSidebar } from '@/components/ui/sidebar'
import { listHref } from '@/lib/list'
import { href, navigate, useRoute } from '@/lib/router'
import { useQuery } from '@tanstack/react-query'
import {
  itemPageQuery,
  useInbox,
  useLibrary,
  useSession,
  useWorkspace,
  useWrite,
} from '@/api/queries'
import { useUndo } from '@/lib/undo'
import { useCommentActions } from '@/lib/comments'
import { useDomains, useFacts, useMe } from '@/lib/workspace'
import { questionAbout } from '@/model/ask'
import { questionDates } from '@/model/validity'
import type { Fact, LogEntry } from '@/model/items'
import { useWide } from '@/hooks/use-wide'
import { VersionHistory } from '@/components/footnote/version-history'
import { today } from '@/lib/today'
import { DeleteDialog } from '@/components/footnote/delete-dialog'
import { useWaitingDecision } from '@/components/footnote/waiting-decision'
import { usePublishDrafts } from '@/lib/publish-drafts'
import { toApiError } from '@/api/errors'
import { waitingLine } from '@/model/waiting'
import {
  Loadable,
  LoadError,
  NoSuchItem,
  PageSkeleton,
  SideSkeleton,
} from '@/components/footnote/load-state'

/** What the decisions hook reads while the item is not loaded yet: it is never acted on. */
const NO_FACT = { id: '', title: '', by: '' } as Fact

// The comments load on their own: their composer is Tiptap, which stays out of the first load.
const CommentBox = React.lazy(() =>
  import('@/components/templates/comment-box').then((m) => ({ default: m.CommentBox })),
)

export function FactPage({ id }: { id: string }) {
  const { isMobile } = useSidebar()
  const facts = useFacts()
  const page = useQuery(itemPageQuery(id))
  // The page's own read shows the item; the library knows it exists while that read loads.
  const fact = page.data?.item ?? facts.find((f) => f.id === id)
  const history = page.data?.history ?? []
  const { published: publishedNow } = useLibrary()
  const { sent } = useInbox()
  const domains = useDomains()
  const me = useMe()
  const write = useWrite()
  const { query } = useRoute()
  const { install } = useSession()
  const { setup } = useWorkspace()
  const undo = useUndo()
  const commentActions = useCommentActions()
  const [deleting, setDeleting] = React.useState(false)
  const decision = useWaitingDecision(fact ?? NO_FACT)
  const publishDrafts = usePublishDrafts()
  const [sending, setSending] = React.useState(false)
  const [bodyRef, wide] = useWide<HTMLDivElement>()
  // The panel folds to a rail and stays the way the person left it this session.
  const [panelChoice, setPanelOpen] = useSideChoice('page-side')
  const panelOpen = panelChoice ?? true
  const related = useRelated(mentionId('context', id))
  // Opening the item is reading the comments that mention you here.
  React.useEffect(() => {
    void commentActions.seenMention(`context:${id}`)
    // Once per item opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, me.name])
  // Opened here counts as read: only items someone opened can be confirmed again together.
  const found = !!fact
  React.useEffect(() => {
    if (found) void write('markViewed', { id })
    // Once per item opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found, id])
  // A read that failed, such as one refused as too many at once, is no proof the item is gone.
  if (!fact)
    return (
      <Page title="Context">
        {page.isError ? (
          <LoadError what="this context item" onRetry={() => void page.refetch()} />
        ) : (
          <NoSuchItem />
        )}
      </Page>
    )
  const owner = me.owns.includes(fact.domain) || me.admin
  const entryFor = (what: LogEntry['what'], summary: string): LogEntry => ({
    id: `log-${what}-${fact.id}`,
    on: today(),
    who: me.name,
    what,
    summary,
    items: [{ id: fact.id, title: fact.title, domain: fact.domain }],
  })
  const archive = async () => {
    const entry = entryFor('archived', 'Archived: agents stop getting it.')
    const archived = await write('applyBulk', {
      action: 'archive',
      patches: { [fact.id]: { status: 'Archived' } },
      remove: [],
      entry,
    })
    undo.offer('Archived', archived.undo, {
      description: 'Agents stop getting it from the next question.',
    })
  }
  // A draft nobody published is deleted for good, after a confirmation, with Undo for a few seconds.
  const deleteDraft = async () => {
    const entry = entryFor('deleted', 'Deleted: a draft nobody published.')
    const deleted = await write('applyBulk', {
      action: 'delete',
      patches: {},
      remove: [fact.id],
      entry,
    })
    navigate('/context')
    undo.offer('Deleted 1 draft', deleted.undo, {
      description: (held) => `You can undo it for ${held}; then it is gone for good.`,
    })
  }
  // The writer's own draft goes as it is: published where they own its domain, else sent to its
  // owners, as the Context list's Publish of one row.
  const sendDraft = async () => {
    setSending(true)
    try {
      const done = await publishDrafts([fact], 'Published from its page.')
      if (!done.published.length && !done.sent.length) {
        toast(owner ? "Couldn't publish it" : "Couldn't send it", {
          description: done.skipped[0]?.reason ?? 'Try again.',
        })
        return
      }
      navigate('/context')
      undo.offer(done.sent.length ? `Sent to the owners of ${done.to}` : 'Published', done.undo, {
        description: done.sent.length
          ? 'Agents get it once an owner publishes it.'
          : 'Agents get it from the next question.',
      })
    } catch (error) {
      toast(owner ? "Couldn't publish it" : "Couldn't send it", {
        description: toApiError(error).message,
      })
    } finally {
      setSending(false)
    }
  }
  const pending = sent.find((x) => x.factId === fact.id && x.by === me.name)
  const published = publishedNow[fact.id]
  // Ask again (FR-816): the question it was written about, or one about what it applies to, typed
  // in Ask; while setup is unfinished it is the setup's question asked again.
  const setupAsks = install === 'new' && !setup.done.fact
  const again =
    query.get('q') ??
    (fact.where.length
      ? questionAbout(
          { metric: fact.where[0], markets: fact.where.slice(1) },
          questionDates(fact.valid, today()),
        )
      : null)
  // The item it is in a conflict with, whichever of the two holds the flag.
  const other = facts.find(
    (f) =>
      f.id !== fact.id &&
      (f.id === fact.disagreesWith || f.disagreesWith === fact.id) &&
      (f.status === 'Live' || f.status === 'Needs a recheck'),
  )

  // What needs a decision: in the side when there is room, and in the document itself on a phone,
  // above the comments rather than below them.
  const attention = (fact.outOfDate || other) && (
    <>
      {fact.outOfDate && (
        <SideSection title="Needs a recheck" description={fact.outOfDate}>
          {owner && (
            <Button
              variant="outline"
              onClick={() =>
                void write('editItem', {
                  id: fact.id,
                  patch: {
                    status: 'Live',
                    outOfDate: undefined,
                    checkedBy: me.name,
                    checkedOn: '22 Oct 2026',
                  },
                }).then(() => toast('Checked: still true'))
              }
            >
              Still true
            </Button>
          )}
        </SideSection>
      )}
      {other && <DisagreesSection self={fact} other={other} pair={page.data?.conflict} />}
    </>
  )
  const side = (
    <Loadable what="this context item" skeleton={<SideSkeleton />} quiet query={page}>
      {wide && attention}
      {/* What an agent can follow from here, both ways: the links in the text and the owners' relations. */}
      {related.links.length > 0 && (
        <SideSection title="Related" className={cn(!history.length && 'border-b-0')}>
          <Related id={mentionId('context', fact.id)} />
        </SideSection>
      )}
      {history.length > 0 && (
        <SideSection title="History" className="border-b-0">
          <VersionHistory
            versions={history}
            itemId={fact.id}
            canRestore={owner}
            onRestore={(version) => write('restoreAsDraft', { id: fact.id, v: version.v })}
            onUndo={(token) => write('undo', { token })}
          />
        </SideSection>
      )}
    </Loadable>
  )
  // A draft nobody linked to has nothing beside it: no panel, once the read says so.
  const sideEmpty = !!page.data && !related.links.length && !history.length

  // Waiting for review: an owner of its domain or an admin decides it here, its sender withdraws it.
  const waiting = fact.status === 'Waiting'
  const sentByMe = waiting && fact.by === me.name
  const decides = waiting && owner && !sentByMe
  // A draft's writer edits it, and sends or publishes it from the editor: it has no change to suggest.
  const writesDraft = fact.status === 'Draft' && fact.by === me.name
  const editHref = `/context/${fact.id}${owner ? '/edit' : '/suggest'}`
  const canCheck = owner && fact.status === 'Needs a recheck'
  const canEdit = !waiting && !(isMobile && (owner || writesDraft || !pending))
  const canArchive = owner && fact.status !== 'Archived' && fact.status !== 'Draft' && !waiting
  const canDelete = (owner || writesDraft) && fact.status !== 'Archived' && !waiting
  const waitingItems = decides ? (
    <DropdownMenuGroup>
      <DropdownMenuItem onClick={() => navigate(`/context/${fact.id}/edit`)}>Edit</DropdownMenuItem>
      <DropdownMenuItem onClick={() => decision.ask('return')}>
        Send back with a note
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => decision.ask('close')}>Don't publish</DropdownMenuItem>
    </DropdownMenuGroup>
  ) : undefined
  const moreItems = waiting ? (
    isMobile ? (
      waitingItems
    ) : undefined
  ) : canCheck || canEdit || canArchive || canDelete ? (
    <>
      {(canCheck || canEdit || canArchive) && (
        <DropdownMenuGroup>
          {canCheck && (
            <DropdownMenuItem
              onClick={() =>
                void write('editItem', {
                  id: fact.id,
                  patch: {
                    status: 'Live',
                    outOfDate: undefined,
                    checkedBy: me.name,
                    checkedOn: '22 Oct 2026',
                  },
                }).then(() => toast('Checked: still true'))
              }
            >
              Still true
            </DropdownMenuItem>
          )}
          {canEdit && (
            <DropdownMenuItem onClick={() => navigate(editHref)}>
              {owner || writesDraft ? 'Edit' : 'Suggest a change'}
            </DropdownMenuItem>
          )}
          {canArchive && (
            <DropdownMenuItem onClick={() => void archive()}>Archive</DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      )}
      {canDelete && (
        <>
          {(canCheck || canEdit || canArchive) && <DropdownMenuSeparator />}
          <DropdownMenuItem onClick={() => setDeleting(true)}>Delete</DropdownMenuItem>
        </>
      )}
    </>
  ) : undefined

  return (
    <Page
      bodyRef={bodyRef}
      deep={{ href: listHref('/context'), label: 'Back to Context' }}
      ask={() => openDock('ask')}
      more={moreItems}
      className="flex overflow-hidden"
      title={
        <Breadcrumb className="min-w-0">
          <BreadcrumbList className="flex-nowrap">
            {/* Gone on a phone, where the way back stands in its place, and in a narrow header. */}
            <BreadcrumbItem data-narrow="gone" className="max-md:hidden">
              <BreadcrumbLink href={listHref('/context')}>Context</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator data-narrow="gone" className="max-md:hidden" />
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage className="truncate">{fact.title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
      actions={
        waiting ? (
          <>
            {!isMobile && decides && (
              <>
                {/* In a narrow header (a tablet) they fold into More, as on a phone, so the title
                    keeps its words (data-narrow, styles/index.css). */}
                <div data-narrow="wide" className="flex items-center gap-2 sm:gap-3">
                  <Button variant="ghost" onClick={() => decision.ask('close')}>
                    Don't publish
                  </Button>
                  <Button variant="outline" onClick={() => decision.ask('return')}>
                    Send back with a note
                  </Button>
                  <Button
                    variant="outline"
                    nativeButton={false}
                    render={<a href={href(`/context/${fact.id}/edit`)} />}
                  >
                    Edit
                  </Button>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="outline" size="icon" aria-label="More" data-narrow="more" />
                    }
                  >
                    <EllipsisIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    {waitingItems}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
            {decides && (
              <Button
                loading={decision.busy === 'publish'}
                loadingLabel="Publishing…"
                onClick={decision.publish}
              >
                Publish
              </Button>
            )}
            {sentByMe && (
              <Button
                variant="outline"
                loading={decision.busy === 'withdraw'}
                loadingLabel="Withdrawing…"
                onClick={decision.withdraw}
              >
                Withdraw
              </Button>
            )}
          </>
        ) : (
          <>
            {!isMobile && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Ask about this context item"
                  onClick={() => openDock('ask')}
                >
                  <MessageSquareIcon />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="outline" size="icon" aria-label="More" />}
                  >
                    <EllipsisIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    {moreItems}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
            {/* Where the page has a decision of its own (Compare and decide), that is its one solid blue button. */}
            {writesDraft && (
              <Button
                loading={sending}
                loadingLabel={owner ? 'Publishing…' : 'Sending…'}
                onClick={() => void sendDraft()}
              >
                {owner ? (
                  'Publish'
                ) : (
                  // One run of words: the button's gap would stand between two parts of it.
                  <span>
                    Send
                    <span className="hidden sm:inline">
                      {' '}
                      to the owner of {domains[fact.domain]?.name}
                    </span>
                  </span>
                )}
              </Button>
            )}
            {owner || writesDraft ? (
              <Button
                variant={other || writesDraft ? 'outline' : 'default'}
                nativeButton={false}
                render={<a href={href(editHref)} />}
              >
                Edit
              </Button>
            ) : (
              !pending && (
                <Button
                  variant={other ? 'outline' : 'default'}
                  nativeButton={false}
                  render={<a href={href(`/context/${fact.id}/suggest`)} />}
                >
                  Suggest a change
                </Button>
              )
            )}
          </>
        )
      }
    >
      <Canvas className="min-h-0 min-w-0 flex-1 overflow-y-auto sm:pt-2 sm:pb-2">
        <Paper>
          <Loadable
            what="this context item"
            skeleton={<PageSkeleton />}
            errorClassName="p-0"
            refreshClassName="mb-5 rounded-frame border"
            query={page}
          >
            {/* Who sent it, how long it has waited, and who decides. */}
            {waiting && (
              <div
                role="note"
                aria-label="Waiting for review"
                className="mb-5 flex items-center gap-3 rounded-frame border border-dashed px-3 py-2 text-sm"
              >
                <ClockIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  {waitingLine(fact, domains[fact.domain]?.owners ?? [], me.name, today())}
                </span>
              </div>
            )}
            {/* What happened to it, said on the item itself rather than in a toast that leaves. */}
            {pending && (
              <div
                role="status"
                className="mb-5 flex animate-in flex-wrap items-center gap-x-3 gap-y-2 rounded-frame border border-dashed px-3 py-2 text-sm duration-(--dur-2) fade-in-0"
              >
                <ClockIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  Your suggestion is waiting for {pending.to}, owner of{' '}
                  {domains[pending.domain]?.name}. Sent {pending.at}.
                </span>
                <Button
                  variant="ghost"

                  onClick={() =>
                    void write('withdrawSuggestion', { id: pending.id }).then(() =>
                      toast('Withdrawn', { description: 'The owner no longer sees it.' }),
                    )
                  }
                >
                  Withdraw
                </Button>
              </div>
            )}
            {published && !pending && (
              <div className="mb-5 flex animate-in flex-wrap items-center gap-2 duration-(--dur-2) fade-in-0">
                <p
                  role="status"
                  className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground"
                >
                  <CircleCheckIcon className="size-4 shrink-0 text-primary" aria-hidden />
                  Published {published} by you. Agents get it from the next question.
                </p>
                {again && (
                  <Button
                    variant="outline"
                    nativeButton={false}
                    render={
                      <a
                        href={href('/ask', {
                          q: again,
                          ...(setupAsks ? { setup: '1' } : {}),
                        })}
                      />
                    }
                  >
                    Ask again
                  </Button>
                )}
              </div>
            )}
            {/* The document is the page: the item as people read it, the same view a review previews. */}
            <ItemDocument fact={fact} />
            {!wide && attention && (
              <div className="mt-6 overflow-hidden rounded-frame border border-caution/45 bg-caution/8 dark:border-caution/45 dark:bg-caution/8 [&>section]:border-b-0 [&>section+section]:border-t">
                {attention}
              </div>
            )}
            <React.Suspense fallback={null}>
              <CommentBox
                key={fact.id}
                subject={`context:${fact.id}`}
                me={me.name}
                owners={domains[fact.domain]?.owners ?? []}
                className="mt-8 border-t pt-6 sm:mt-10"
              />
            </React.Suspense>
          </Loadable>
        </Paper>
        {!wide && !sideEmpty && <div className="border-t bg-background">{side}</div>}
      </Canvas>
      {wide && !(sideEmpty && !attention) && (
        <ResizableAside
          side="right"
          storageKey="doc-side"
          defaultWidth={320}
          min={280}
          max={520}
          label="About this context item"
          collapsed={!panelOpen}
          onCollapsedChange={(c) => setPanelOpen(!c)}
          rail={<PanelRail label="Show the panel" onShow={() => setPanelOpen(true)} />}
          railWidth={48}
          className="border-l bg-background"
        >
          <Panel
            title="About this item"
            onClose={() => setPanelOpen(false)}
            closeLabel="Fold the panel"
          >
            {side}
          </Panel>
        </ResizableAside>
      )}
      {decides && decision.dialogs}
      <DeleteDialog
        open={deleting}
        onOpenChange={setDeleting}
        noun="draft"
        titles={fact.status === 'Draft' ? [fact.title] : []}
        consequence="Nobody published it, so agents never got it. It is removed for good; you can undo it for a few seconds."
        archive={
          fact.status === 'Draft' ? undefined : { count: 1, onArchive: () => void archive() }
        }
        onDelete={() => void deleteDraft()}
      />
    </Page>
  )
}
