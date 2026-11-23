import * as React from 'react'
import {
  ArrowLeftIcon,
  ArrowLeftRightIcon,
  AtSignIcon,
  BookOpenIcon,
  MessageSquareTextIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CircleCheckIcon,
  ClockIcon,
  type FlagIcon,
  InboxIcon,
  MailOpenIcon,
  MessageSquareIcon,
  SearchIcon,
  TriangleAlertIcon,
} from '@/components/icons'
import { toast } from '@/lib/toast'
import { cn, midSentence } from '@/lib/utils'
import { FieldDiff } from '@/components/footnote/bits'
import { Mark } from '@/components/footnote/mark'
import { marksExceptions } from '@/lib/marks'
import { ToolLogo } from '@/components/footnote/tool-logo'
import { pairOfKey } from '@/model/conflicts'
import { integrationHref, lookOf } from '@/model/integrations'
import { askedWords, careLine, changeWords, gapRowWords, type Review } from '@/model/review'
import { QuickHead, QuickReview } from '@/pages/review'
import {
  AskedAbout,
  cardIcon,
  Fold,
  ItemFold,
  PaneFoot,
  PaneHead,
  PrimaryAction,
} from '@/components/footnote/inbox-pane'
import { Panel } from '@/components/footnote/panel'
import { follows, paneState, primaryLabel } from '@/model/inbox-pane'
import { TOUCH } from '@/lib/touch'
import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { TextSwitch } from '@/components/footnote/switches'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { scopeText } from '@/model/ask'
import type { InboxCard, Waiting } from '@/model/inbox'
import type { DomainId, Fact } from '@/model/items'
import { questionDates } from '@/model/validity'
import { today } from '@/lib/today'
import { useIsMobile } from '@/hooks/use-mobile'
import { askInDock, openDock, openFromRow, useDock } from '@/lib/dock'
import { open } from '@/lib/events'
import { href, navigate, setQuery, useRoute } from '@/lib/router'
import { useQuery } from '@tanstack/react-query'
import {
  conflictQuery,
  conflictsQuery,
  inboxPageQuery,
  namesQuery,
  readQuestionQuery,
  useDefinitions,
  useInbox,
  useReviews,
  useSavedQuestions,
  useSession,
  useWorkspace,
  useWrite,
  workspaceQuery,
} from '@/api/queries'
import type { UndoOffer } from '@/api/client'
import { useUndo } from '@/lib/undo'
import { definitionsStep, setupHeading, setupSteps } from '@/lib/setup'
import { ConflictPairCompact } from '@/components/footnote/conflict-pair'
import { useAdminsSaid, useDomains, useFacts, useMe } from '@/lib/workspace'
import { mayOpenSettings } from '@/lib/settings-access'
import { homeDomain, listOf, type Domain, type Person } from '@/model/people'
import type { Outcome } from '@/model/inbox'
import { useCommentActions, useNewReply, type MentionNote } from '@/lib/comments'
import {
  groupOf,
  dueScope,
  INBOX_GROUPS,
  startsFolded,
  type InboxGroup,
  needs,
  rowId,
  rowTitle,
  useInboxRows,
  type InboxRow,
} from '@/lib/inbox-rows'
import { suggestionIcon } from '@/components/footnote/change-icons'
import type { Subject } from '@/model/comments'
import { TruncatedText } from '@/components/footnote/truncated'
import { ListSkeleton, Loadable } from '@/components/footnote/load-state'
import { BulkBar, BulkButton } from '@/components/footnote/bulk-bar'
import { useOnline } from '@/lib/send'
import { Checkbox } from '@/components/ui/checkbox'
import { useSelection, type RowSelection } from '@/hooks/use-selection'
import { pageKey } from '@/lib/keys'
import { ResultIcon } from '@/components/obs/result'
import { arriveRef, leaveThen, useLeavingRows } from '@/lib/presence'

// The Inbox, built like shadcn's Mail example (a list with All and Needs me and a search field, and
// a detail pane with the selected card's one primary action) and dressed as Efferd's dashboard 2:
// a frame of flat cells divided by hairlines. A suggestion's review opens in the dock, which takes
// the detail pane's place, so there is one right panel.

/** Efferd's dashboard card: a shadcn Card made flat, so the frame's hairlines are its only edges. */
function Cell({ className, ...props }: React.ComponentProps<typeof Card>) {
  return (
    <Card className={cn('rounded-none bg-background shadow-none ring-0', className)} {...props} />
  )
}

/* ---------- the list ---------- */

/**
 * What a suggestion does, from its review, in a sentence that starts with who it is from:
 * "Ines Duarte changed 2 sentences and 2 links."
 */
function didWords(from: string, r: Review | undefined) {
  if (!r) return from ? `From ${from}.` : ''
  const did =
    r.mode === 'new'
      ? 'suggests a new item'
      : r.mode === 'retire'
        ? 'suggests archiving an item'
        : changeWords(r.counts)
  if (!did) return from ? `From ${from}.` : ''
  return from ? `${from} ${did}.` : `${did[0]!.toUpperCase()}${did.slice(1)}.`
}

/** What a row's suggestion needs before it can go out, from its review: "About the same thing as 2 published items". */
function rowCare(row: InboxRow, reviews: Review[]) {
  if (row.kind !== 'card' || row.done) return undefined
  const review = reviews.find((r) => r.id === row.card.id)
  return review ? careLine(review) : undefined
}

/**
 * The row's second line: who it is from and what it is worth, so the list can be read without
 * opening. A suggestion's `care` (what it needs before it can go out) comes after who it is from.
 */
function meta(row: InboxRow, reviews: Review[], care?: React.ReactNode): React.ReactNode {
  if (row.kind === 'mention') return `Mentioned by ${row.note.from}`
  if (row.kind === 'waiting')
    return row.item.returned
      ? `Returned by ${row.item.returned.by}`
      : `Waiting for ${row.item.waitingFor.split(',')[0]}`
  const { card, done } = row
  if (done) return `${done.label}, ${midSentence(done.at)}`
  if (card.names) return card.line
  const s = card.suggestion
  const from = card.source
    ? `${card.source.tool}, ${card.source.folder}`
    : s
      ? s.agent
        ? `${s.agent}, with ${s.from}'s OK`
        : s.from
      : ''
  if (s || card.source) {
    const review = reviews.find((r) => r.id === card.id)
    const reach = review?.tryIt.reach
    return (
      <>
        {didWords(from, review)}
        {care && <> {care}.</>}
        {reach ? ` ${askedWords(reach)}` : ''}
      </>
    )
  }
  if (card.gap) return gapRowWords(card.gap)
  if (card.flag) return `Reported as ${card.flag.reason}: “${card.flag.note}”`
  if (card.look) return 'Raised by an alert: saved questions answer worse'
  if (card.alert) return `Raised by an alert: ${card.alert.name}`
  return card.due === 'source' ? 'A definition changed' : 'Its check date passed'
}

/**
 * The row's second line; a mention of you, or a reply in a suggestion's comments, takes its place,
 * quietly. What a suggestion needs is its one mark, after who it is from, unless `plain` says every
 * row in the list needs the same look; the row's triangle is the mark's icon.
 */
function RowMeta({ row, plain }: { row: InboxRow; plain: boolean }) {
  const reply = useNewReply(`review:${rowId(row)}`)
  const reviews = useReviews()
  if (row.note)
    return (
      <span className="line-clamp-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <AtSignIcon className="size-3 shrink-0" aria-hidden />
        Mentioned by {row.note.from}
      </span>
    )
  if (reply && row.kind === 'card' && !row.done)
    return (
      <span className="line-clamp-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <MessageSquareTextIcon className="size-3 shrink-0" aria-hidden />
        New reply from {reply.from}
      </span>
    )
  const care = rowCare(row, reviews)
  return (
    <span className="line-clamp-2 text-xs text-muted-foreground">
      {meta(
        row,
        reviews,
        care && !plain ? (
          <Mark role="needs" icon={false}>
            {care}
          </Mark>
        ) : (
          care
        ),
      )}
    </span>
  )
}

/** In the quick view: who answered, and what, with the way to the thread. */
function NewReply({ id }: { id: string }) {
  const reply = useNewReply(`review:${id}`)
  if (!reply) return null
  return (
    <div className="mb-5 flex flex-col gap-1.5 border-l-2 border-primary/60 py-0.5 pl-3 text-sm">
      <p className="flex items-center gap-1.5 font-medium">
        <MessageSquareTextIcon className="size-3.5" aria-hidden />
        New reply from {reply.from}, {midSentence(reply.when)}
      </p>
      <p className="line-clamp-3 text-muted-foreground">{reply.excerpt}</p>
      <a
        href={`/inbox/${id}/review`}
        className="w-fit text-primary underline-offset-4 hover:underline"
      >
        Read the comments
      </a>
    </div>
  )
}

function InboxList({
  rows,
  folded,
  onFold,
  selected,
  onSelect,
  sel,
  list,
}: {
  rows: InboxRow[]
  /** The groups whose rows are folded away; their header stays, with the count. */
  folded: ReadonlySet<InboxGroup>
  onFold: (group: InboxGroup) => void
  selected?: string
  /** `pointer` is false for a key (a click with detail 0), which keeps the pane change instant. */
  onSelect: (id: string, pointer: boolean, key?: boolean) => void
  sel: RowSelection
  list: React.RefObject<HTMLUListElement | null>
}) {
  const { opened } = useInbox()
  const me = useMe()
  const reviews = useReviews()
  const leaving = useLeavingRows()
  // Rows added after the list first shows open in; the first ones are simply there.
  React.useEffect(() => arriveRef(list.current), [list])
  // What a suggestion needs is marked on its row, unless every row needs the same look.
  const plain = !marksExceptions(rows, (row) => !!rowCare(row, reviews))
  // The selected row stays in sight: on a click, on J and K, and on a link straight to a card.
  React.useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-row="${CSS.escape(selected ?? '')}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [list, selected])
  return (
    <ul
      ref={list}
      className="flex flex-col divide-y divide-border border-b"
      onKeyDown={sel.onKeyDown}
    >
      {rows.map((row, i) => {
        const id = rowId(row)
        const review =
          row.kind === 'card' && row.card.type === 'suggestion'
            ? reviews.find((r) => r.id === row.card.id)
            : undefined
        const Icon = review
          ? suggestionIcon(review)
          : row.kind === 'card'
            ? cardIcon[row.card.type]
            : row.kind === 'waiting' && row.item.returned
              ? cardIcon.returned
              : row.kind === 'mention' || row.note
                ? AtSignIcon
                : ClockIcon
        // A suggestion that needs care says so on its row, before it is opened.
        const care = rowCare(row, reviews)
        const group = groupOf(row)
        const firstOfGroup = i === 0 || groupOf(rows[i - 1]!) !== group
        const inGroup = rows.filter((r) => groupOf(r) === group).length
        const source = row.kind === 'card' ? row.card.source : undefined
        const prev = rows[i - 1]
        // Suggestions from one sync read sit under one header: "From Google Drive, today 06:00".
        const firstOfRead =
          source && !(prev?.kind === 'card' && prev.card.source?.read === source.read)
        const fromRead = source
          ? rows.filter((r) => r.kind === 'card' && r.card.source?.read === source.read).length
          : 0
        const done = row.kind === 'card' && !!row.done && !row.note
        // The dot is "not opened yet": it goes once the card was opened here or in the review.
        const unread = row.note ? true : row.kind === 'card' && !row.done && !opened[row.card.id]
        const isSelected = selected === id
        const ticked = sel.isSelected(id)
        return (
          <React.Fragment key={id}>
            {firstOfGroup && (
              <li>
                <button
                  type="button"
                  aria-expanded={!folded.has(group)}
                  onClick={() => onFold(group)}
                  className="flex h-8 w-full items-end gap-1.5 px-4 pb-1.5 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset @md:px-6"
                >
                  {INBOX_GROUPS.find((g) => g.id === group)!.label}
                  <span className="font-normal tabular-nums">
                    {inGroup}
                    {group === 'check' && ` ${dueScope(me)}`}
                  </span>
                  <ChevronDownIcon
                    aria-hidden
                    className={cn('size-3.5', folded.has(group) && '-rotate-90')}
                  />
                </button>
              </li>
            )}
            {firstOfRead && !folded.has(group) && (
              <li className="flex h-10 items-center gap-2 bg-band px-4 text-xs @md:px-6">
                <ToolLogo c={lookOf(source.connector)} size="sm" />
                <span className="truncate font-medium">
                  From {source.tool}, {midSentence(source.read)}
                </span>
                <span className="shrink-0 text-muted-foreground @max-md:hidden">
                  {fromRead} new {fromRead === 1 ? 'suggestion' : 'suggestions'}
                </span>
                {/* The read's page is in an admin's Settings: an owner reads the header alone. */}
                {mayOpenSettings(integrationHref(source.connector), me) && (
                  <a
                    href={`${integrationHref(source.connector)}?state=suggestions`}
                    className="ml-auto shrink-0 whitespace-nowrap text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    About this read
                  </a>
                )}
              </li>
            )}
            {!folded.has(group) && (
              <li
                data-row={id}
                data-leaving={leaving.has(id) || undefined}
                onMouseDown={sel.onMouseDown}
                className={cn(
                  'group/row row-presence hover:bg-muted/50 has-[[data-row-open]:active]:bg-muted has-[[data-row-open]:focus-visible]:bg-muted/50 has-[[data-row-open]:focus-visible]:ring-3 has-[[data-row-open]:focus-visible]:ring-ring/50 has-[[data-row-open]:focus-visible]:ring-inset',
                  ticked &&
                    'bg-primary/[0.06] hover:bg-primary/10 dark:bg-primary/12 dark:hover:bg-primary/16',
                  isSelected && 'bg-muted hover:bg-muted',
                )}
              >
                <div className="flex">
                  {/* On a wide list each row has a checkbox, as in Context: shown on a hover, and on every row while rows are ticked. */}
                  <span className="hidden shrink-0 items-center pr-1 pl-5 @md:flex">
                    <Checkbox
                      aria-label={`Select ${rowTitle(row)}`}
                      {...sel.checkbox(id)}
                      className={cn(
                        'transition-opacity group-hover/row:opacity-100',
                        !sel.count && !ticked && 'opacity-0 focus-visible:opacity-100',
                      )}
                    />
                  </span>
                  <button
                    type="button"
                    data-row-open={id}
                    aria-current={isSelected || undefined}
                    onClick={(e) => sel.rowClick(id, e) || onSelect(id, e.detail > 0, !e.detail)}
                    className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-4 py-2 text-left outline-none @md:pr-6 @md:pl-0"
                  >
                    <span
                      aria-hidden={!care}
                      className={cn(
                        'flex size-10 shrink-0 items-center justify-center [&_svg]:size-4',
                        done && 'text-muted-foreground',
                      )}
                    >
                      {care ? (
                        <TriangleAlertIcon aria-label={care} className="text-caution" />
                      ) : source ? (
                        <ToolLogo c={lookOf(source.connector)} size="sm" />
                      ) : (
                        <Icon />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 space-y-1">
                      <TruncatedText
                        text={rowTitle(row)}
                        lines={2}
                        className={cn(
                          'text-sm leading-snug',
                          done ? 'text-muted-foreground' : 'text-foreground',
                        )}
                      />
                      <RowMeta row={row} plain={plain} />
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1.5 self-center">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {row.note
                          ? row.note.when.replace(/^Today, /, '')
                          : row.kind === 'card'
                            ? row.done
                              ? ''
                              : row.card.when
                            : row.kind === 'waiting'
                              ? (row.item.returned?.when.replace(/^Today, /, '') ?? row.item.sent)
                              : ''}
                      </span>
                      {unread ? (
                        <span
                          className="size-1.5 rounded-full bg-foreground"
                          aria-label="Not opened yet"
                        />
                      ) : (
                        <span className="size-1.5" />
                      )}
                    </span>
                  </button>
                </div>
              </li>
            )}
          </React.Fragment>
        )
      })}
    </ul>
  )
}

/* ---------- the detail pane ---------- */

/** An icon button whose tooltip names it, and its key when it has one. */
function IconAction({
  label,
  icon: Icon,
  onClick,
  disabled,
  shortcut,
}: {
  label: string
  icon: typeof FlagIcon
  onClick: () => void
  disabled?: boolean
  shortcut?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon" disabled={disabled} onClick={onClick} />}
      >
        <Icon />
        <span className="sr-only">{label}</span>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut && <Kbd className="ml-1">{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

/** How the pane moves: J and K through the list, back to it on a phone, and where in it you are. */
type PaneNav = {
  onStep: (d: 1 | -1) => void
  onBack?: () => void
  /** "3 of 20 in Needs me". */
  position?: string
  /** The new card's body fades in (a pointer pick or a decision); J and K stay at once. */
  fade?: boolean
}

/**
 * The pane's frame, the shared panel anatomy: a quiet 48 px bar with where you are in the list and
 * the arrows, one scrolling body that opens on the card's head, and the foot with the decision.
 */
function InboxPanel({
  label,
  nav: { onStep, onBack, position, fade },
  foot,
  children,
}: {
  label: string
  nav: PaneNav
  foot?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Panel
      label={label}
      title={position ?? label}
      quietTitle
      className="group/pane"
      bodyClassName={fade ? 'dock-swap' : undefined}
      leading={
        onBack && (
          <Button variant="ghost" size="icon" aria-label="Back to the list" onClick={onBack}>
            <ArrowLeftIcon />
          </Button>
        )
      }
      actions={
        <>
          <IconAction
            label="Previous"
            shortcut="K"
            icon={ChevronUpIcon}
            onClick={() => onStep(-1)}
          />
          <IconAction label="Next" shortcut="J" icon={ChevronDownIcon} onClick={() => onStep(1)} />
        </>
      }
      footer={foot}
    >
      {children}
    </Panel>
  )
}

/**
 * A card's actions. What changes context goes through the send state: offline it waits, and with
 * ?state=failed the first try fails and says so, with Try again. Opening the review just navigates.
 */
function useActions(card: InboxCard) {
  const me = useMe()
  const online = useOnline()
  const decide = React.useContext(Decide)
  const run = (d: Decision) => decide(card, d)
  const primary = () => {
    switch (card.type) {
      case 'suggestion':
        return navigate(`/inbox/${card.id}/review`)
      case 'gap':
        // A draft waits: the same review as any suggestion. With none yet, the editor opens on the
        // scope, for this card: publishing what is written there closes it.
        return card.gap?.draft
          ? navigate(`/inbox/${card.id}/review`)
          : navigate('/context/new', {
              gap: card.id,
              metric: card.gap?.scope[0],
              market: card.gap?.scope[1],
            })
      case 'flag':
        // A report that names no context item has one thing to decide.
        return card.factId ? openDock('context', card.factId, { flag: card.id }) : notAProblem()
      case 'look':
        return navigate(`/observability/quality?domain=${card.domain}`)
      case 'alert':
        return navigate(card.alert!.href)
      case 'check':
        return run({
          outcome: 'Checked',
          message: 'Checked: still true',
          description: 'It comes back when it is due for a check.',
          patch: {
            status: 'Live',
            outOfDate: undefined,
            checkedBy: me.name,
            checkedOn: '22 Oct 2026',
          },
        })
    }
  }
  function notAProblem() {
    run({
      outcome: 'Not a problem',
      message: 'Report closed',
      description: 'The context item stays as it is.',
    })
  }
  const secondary: Record<string, () => void> = {
    'Not something we write down': () =>
      run({
        outcome: 'Closed',
        message: 'Closed',
        description: 'Agents keep saying honestly that nothing is written down.',
      }),
    'Not a problem': notAProblem,
    Edit: () => navigate(`/context/${card.factId}/edit`),
    Archive: () =>
      run({
        outcome: 'Archived',
        message: 'Archived',
        description: 'Agents stop getting it from the next question.',
        patch: { status: 'Archived' },
      }),
  }
  // Only what writes needs the connection; Review and Edit only open a page.
  const writes = card.type === 'check' || (card.type === 'flag' && !card.factId)
  return { primary, secondary, online, writes }
}

/** A decision on a card: what it is called, what the toast says, and what it changes on the item. */
type Decision = { outcome: string; message: string; description?: string; patch?: Partial<Fact> }
const Decide = React.createContext<(card: InboxCard, d: Decision) => void>(() => {})

/**
 * Where a card came from, in one short line after its summary: who or what raised it, and when.
 * A suggestion's line is its sender's (Sender), so it is not here.
 */
function from(card: InboxCard) {
  const when = midSentence(card.when)
  const s = card.suggestion
  if (card.source) return `From ${card.source.tool}, ${card.source.folder}, ${when}`
  if (s)
    return s.agent ? `From ${s.agent}, with ${s.from}'s OK, ${when}` : `From ${s.from}, ${when}`
  if (card.flag)
    return card.flag.by
      ? `Reported by ${card.flag.by} from ${card.flag.via === 'Ask' ? 'Ask' : 'a chat with an agent'}, ${when}`
      : `Reported from a chat with an agent, ${when}`
  if (card.gap)
    return card.gap.times === 0 && card.gap.told
      ? `From Ask, where someone found nothing, ${when}`
      : `From what agents asked ${when}`
  if (card.look || card.alert)
    return `Raised by ${card.alert ? `the alert rule ${card.alert.name}` : 'an alert'}, ${when}`
  return `Due ${when}, from an automatic check`
}

function CardDetail({
  card,
  done,
  note,
  nav,
  next,
}: {
  card: InboxCard
  done?: Outcome
  note?: MentionNote
  nav: PaneNav
  next: () => void
}) {
  const { primary, secondary, online, writes } = useActions(card)
  const me = useMe()
  const admins = useAdminsSaid()
  // An alert whose page is in an admin's Settings, such as a tool that could not be read: anyone
  // else is told who looks into it, and has no button to a page that refuses them.
  const opens = !card.alert || mayOpenSettings(card.alert.href, me)
  // Opening a card in the quick view is reading it: its unread dot goes.
  const write = useWrite()
  const facts = useFacts()
  const reviews = useReviews()
  React.useEffect(() => {
    void write('markOpened', { ids: [card.id] })
    // Once per card opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id])
  const waits = !online
  const fact = card.factId ? facts.find((f) => f.id === card.factId) : undefined
  const s = card.suggestion
  const changed = s?.changes.filter((c) => c.before !== c.after) ?? []
  // A suggestion's pane is the quick view: what changes, and the decision that opens the full screen.
  const review = reviews.find((r) => r.id === card.id)
  const offline = !online && (writes || card.secondary.some((l) => l !== 'Edit'))

  const foot = done ? (
    <div className="flex h-bar items-center gap-3 px-4 @md:pl-7">
      <p className="flex flex-1 items-center gap-2 text-sm text-muted-foreground">
        <CircleCheckIcon className="size-4" aria-hidden /> {done.label}, {midSentence(done.at)}.
      </p>
      {note && <MentionDone subject={note.subject} next={next} />}
    </div>
  ) : (
    <PaneFoot
      follows={
        offline
          ? "Offline: changes wait until you're back."
          : opens
            ? follows(card, review)
            : `An admin looks into it${admins}.`
      }
    >
      {card.secondary.map((label) => (
        <Button
          key={label}
          variant="outline"
          size="lg"
          disabled={label !== 'Edit' && waits}
          onClick={secondary[label]}
        >
          {label}
        </Button>
      ))}
      {opens && (
        <PrimaryAction disabled={writes && !online} onClick={primary}>
          {primaryLabel(card, review)}
        </PrimaryAction>
      )}
    </PaneFoot>
  )

  return (
    <InboxPanel label={card.title} nav={nav} foot={foot}>
      {review ? (
        <QuickHead
          r={review}
          state={paneState(card, review)}
          title={card.title}
          domain={card.domain}
          when={midSentence(card.when)}
        />
      ) : (
        <PaneHead
          state={paneState(card)}
          domain={card.domain}
          title={card.title}
          summary={card.line}
          from={from(card)}
        />
      )}
      {/* J and K move between cards often: the next card is there at once. */}
      <div className="max-w-2xl px-4 pb-6 @md:px-7">
        {review ? (
          <>
            {note && <MentionBlock note={note} href={`/inbox/${card.id}/review`} />}
            <NewReply id={card.id} />
            <QuickReview
              r={review}
              asked={card.gap && <AskedAbout scope={card.gap.scope} times={card.gap.times} />}
            />
          </>
        ) : (
          // No answers to compare: the point and its decision, with the evidence folded (D's layout).
          <div className="flex flex-col gap-5 text-sm leading-relaxed">
            <p className="text-muted-foreground">
              {card.detail}
              {card.flag &&
                (card.flag.by
                  ? ' Only what was sent is kept: their words and the question.'
                  : ' Only the words that were sent are kept, not who sent them.')}
            </p>
            {card.flag?.question && (
              <ReportedQuestion by={card.flag.by} question={card.flag.question} />
            )}
            {card.changed && card.changed.length > 0 && (
              <React.Suspense fallback={null}>
                <ChangedDefinitions names={card.changed} />
              </React.Suspense>
            )}
            {card.look && <LookList ids={card.look.questions} />}
            {card.alert?.rule === 'disagree' && <AlertPair pair={card.alert.pair} />}
            <div className="border-b empty:hidden">
              {card.gap && (
                <Fold title="What agents asked">
                  <p>
                    {card.gap.times === 0
                      ? `Agents asked about ${card.gap.scope.join(', ')} before this week, not since.`
                      : `Agents asked about ${card.gap.scope.join(', ')}, ${card.gap.times ?? 'fewer than 5'} times this week.`}
                  </p>
                  <p>
                    <span className="font-medium">Where the fix probably belongs:</span>{' '}
                    {card.gap.belongs}.
                  </p>
                </Fold>
              )}
              {s && (
                <Fold title="What changes">
                  <div>
                    {(s.factId
                      ? changed
                      : s.changes.filter((c) =>
                          ['What agents should know', 'Where', 'When'].includes(c.label),
                        )
                    ).map((c) => (
                      <FieldDiff key={c.label} {...c} />
                    ))}
                  </div>
                </Fold>
              )}
              {s?.note && (
                <Fold title={`Why ${s.from} suggested it`}>
                  <blockquote className="border-l-2 pl-3 text-muted-foreground italic">
                    “{s.note}”
                  </blockquote>
                </Fold>
              )}
              {fact && card.type !== 'suggestion' && (
                // The way to the item's page shows here unless the card's decision is that way.
                <ItemFold
                  fact={fact}
                  link={primaryLabel(card, review) !== 'Open the context item'}
                  defaultOpen={card.type === 'check'}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </InboxPanel>
  )
}

/**
 * The question a report from Ask was sent about, as its sender asked it, and the way to ask it
 * again: Ask opens beside the Inbox with it typed in, not yet sent, as the owner, who may see more
 * than the sender did. The question goes to Ask in memory, never in the address.
 */
function ReportedQuestion({ by, question }: { by: string; question: string }) {
  return (
    <figure className="flex flex-col items-start gap-2">
      <figcaption className="font-medium">{by ? `${by} asked` : 'The question'}</figcaption>
      <blockquote className="border-l-2 pl-3 text-pretty">{question}</blockquote>
      <Button variant="outline" className="mt-1" onClick={() => askInDock(question)}>
        <MessageSquareIcon data-icon="inline-start" />
        Try this question
      </Button>
    </figure>
  )
}

/**
 * The way to each definition that changed in its tool, beside a Due for a check card that says it
 * changed: opened beside the Inbox. Only the ones the person can read, which are in their
 * Definitions; a single one is "the definition", as the card's line names it.
 */
function ChangedDefinitions({ names }: { names: readonly string[] }) {
  const definitions = useDefinitions()
  const shown = [...new Set(names)].filter((n) => definitions.some((d) => d.name === n))
  if (!shown.length) return null
  return (
    <div className="flex flex-wrap gap-2">
      {shown.map((name) => (
        <Button
          key={name}
          variant="outline"
          aria-label={`See the definition of ${name}`}
          onClick={() => openDock('def', name)}
        >
          <BookOpenIcon data-icon="inline-start" />
          {shown.length === 1 ? 'See the definition' : `See ${name}`}
        </Button>
      ))}
    </div>
  )
}

/** The saved questions an alert raised, each with what it answered and what it answers now. */
function LookList({ ids }: { ids: string[] }) {
  const all = useSavedQuestions()
  const qs = ids.map((id) => all.find((q) => q.id === id)).filter((q) => !!q)
  return (
    <ul className="flex flex-col border-y">
      {qs.map((q) => (
        <li key={q.id} className="flex gap-2.5 border-b py-3 last:border-b-0">
          <ResultIcon result={q.result} className="mt-0.5" />
          <div className="min-w-0">
            <p className="font-medium">{q.question}</p>
            <p className="text-muted-foreground">{q.why}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Who mentioned you, when, and what they wrote, with the way to the thread. */
function MentionBlock({
  note,
  href,
  link = 'Read the comments',
}: {
  note: MentionNote
  href?: string
  link?: string
}) {
  return (
    <div className="mb-5 flex flex-col gap-1.5 border-l-2 border-primary/60 py-0.5 pl-3 text-sm">
      <p className="flex items-center gap-1.5 font-medium">
        <AtSignIcon className="size-3.5" aria-hidden />
        {note.from} mentioned you, {midSentence(note.when)}
      </p>
      <p className="line-clamp-3 text-muted-foreground">{note.excerpt}</p>
      {href && (
        <a href={href} className="w-fit text-primary underline-offset-4 hover:underline">
          {link}
        </a>
      )}
    </div>
  )
}

/** Clears a mention from Needs you; the comment itself stays. */
function MentionDone({ subject, next }: { subject: Subject; next: () => void }) {
  const commentActions = useCommentActions()
  return (
    <PrimaryAction
      onClick={() => {
        void commentActions.seenMention(subject)
        toast('Done', { description: 'The comment stays in the comments.' })
        next()
      }}
    >
      Done
    </PrimaryAction>
  )
}

const NamesReview = React.lazy(() => import('@/components/footnote/names-review'))
const NamesDialog = React.lazy(() =>
  import('@/components/footnote/names-review').then((m) => ({ default: m.NamesDialog })),
)

const CommentBox = React.lazy(() =>
  import('@/components/templates/comment-box').then((m) => ({ default: m.CommentBox })),
)

/** The thread itself, to read and answer without leaving the Inbox. */
function Thread({ subject, domain }: { subject: Subject; domain: DomainId }) {
  const me = useMe()
  const domains = useDomains()
  return (
    <React.Suspense fallback={null}>
      <CommentBox
        subject={subject}
        me={me.name}
        owners={domains[domain]?.owners ?? []}
        className="border-t pt-5"
      />
    </React.Suspense>
  )
}

function WaitingDetail({
  item,
  note,
  nav,
  next,
}: {
  item: Waiting
  note?: MentionNote
  nav: PaneNav
  next: () => void
}) {
  const returned = item.returned
  return (
    <InboxPanel
      label={item.title}
      nav={nav}
      foot={
        returned ? (
          // Its words open in the editor; sending them again puts it back with the owners.
          <PaneFoot follows="It waits on the owners again once you send it.">
            <PrimaryAction keyHint={false} onClick={() => navigate(`/context/${item.card}/edit`)}>
              Edit and send again
            </PrimaryAction>
          </PaneFoot>
        ) : (
          note && (
            <PaneFoot>
              <MentionDone subject={note.subject} next={next} />
            </PaneFoot>
          )
        )
      }
    >
      <PaneHead
        state={
          returned
            ? { label: 'Returned', icon: 'returned', tone: 'warn' }
            : { label: 'Waiting on others', icon: 'waiting', tone: 'neutral' }
        }
        domain={item.domain}
        title={item.title}
        summary={
          returned
            ? `${returned.by} returned it with a note, in the comments below. Edit it and send it again.`
            : `Waiting for ${item.waitingFor}. You'll see here when it is published or returned.`
        }
        from={`Your suggestion, ${returned ? `returned ${/^\d/.test(returned.when) ? `on ${returned.when}` : midSentence(returned.when)}` : `sent ${item.sent.toLowerCase() === 'today' ? 'today' : `on ${item.sent}`}`}`}
      />
      <div className="flex max-w-2xl flex-col gap-4 px-4 pb-6 text-sm @md:px-7">
        {note && <MentionBlock note={note} />}
        <Thread subject={`review:${item.card}`} domain={item.domain} />
      </div>
    </InboxPanel>
  )
}

/** A mention on something that isn't in your Inbox otherwise: someone else's context item or suggestion. */
function MentionDetail({
  subject,
  title,
  note,
  nav,
  next,
}: {
  subject: Subject
  title: string
  note: MentionNote
  nav: PaneNav
  next: () => void
}) {
  const [kind, id] = subject.split(':')
  const facts = useFacts()
  const domains = useDomains()
  const { cards } = useInbox()
  const fact = kind === 'context' ? facts.find((f) => f.id === id) : undefined
  const card = kind === 'review' ? cards.find((c) => c.id === id) : undefined
  const domain = fact?.domain ?? card?.domain ?? 'sales'
  return (
    <InboxPanel
      label={title}
      nav={nav}
      foot={
        <PaneFoot follows="Reply to the comment, or mark it done">
          <MentionDone subject={note.subject} next={next} />
        </PaneFoot>
      }
    >
      <PaneHead
        state={{ label: 'Mentioned you', icon: 'mention', tone: 'neutral' }}
        domain={domain}
        title={title}
        from={`A comment on ${fact ? 'a context item' : 'a suggestion'} in ${domains[domain]?.name}`}
      />
      <div className="flex max-w-2xl flex-col gap-4 px-4 pb-6 text-sm @md:px-7">
        <MentionBlock
          note={note}
          href={fact ? `/context/${fact.id}` : undefined}
          link="Open the context item"
        />
        <Thread subject={subject} domain={domain} />
      </div>
    </InboxPanel>
  )
}

/** The names a read made, in the Inbox's pane: the one card that publishes them (FR-141). */
function NamesDetail({ card, nav, next }: { card: InboxCard; nav: PaneNav; next: () => void }) {
  const write = useWrite()
  const { query } = useRoute()
  const show = query.get('show')
  React.useEffect(() => {
    void write('markOpened', { ids: [card.id] })
    // Once per card opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id])
  return (
    <React.Suspense fallback={<ListSkeleton />}>
      <NamesReview
        onFinished={next}
        onOpenFamily={(key) => openFromRow('family', key)}
        show={show === 'families' || show === 'names' ? show : undefined}
        onShow={(next) => setQuery({ show: next })}
        frame={(body, foot) => (
          <InboxPanel label={card.title} nav={nav} foot={foot}>
            {body}
          </InboxPanel>
        )}
      />
    </React.Suspense>
  )
}

/* ---------- setup and all done ---------- */

/** Where the first context item goes, as the editor starts it, and who publishes it there. */
function whereContextGoes(me: Person, domains: Domain[]) {
  const home = homeDomain(me, domains)
  if (!home)
    return 'Context goes to a domain, and there is none yet: an admin adds one in Settings, under Domains and owners.'
  // Several of one's own: the editor starts on one, and the writer picks.
  const owned = domains.filter((domain) => me.owns.includes(domain.id) && !domain.sandbox).length
  if (owned > 1) return `Context goes to one of the ${owned} domains you own.`
  if (me.owns.includes(home.id)) return `Context goes to the domain ${home.name}, owned by you.`
  const by = home.owners.length ? `owned by ${listOf(home.owners)}` : 'which has no owner yet'
  return `Context goes to the domain ${home.name}, ${by}. ${
    me.admin ? 'As an admin, you publish it at once.' : 'Agents get it once an owner publishes it.'
  }`
}

/**
 * A new install's Inbox: the checklist, and what already waits, so a first test that changes a
 * definition sees its items Due for a check without finishing every step. `due` is how many.
 */
function Setup({ due }: { due: number }) {
  const {
    setup: { done: setupDone, serverSource },
    domains: domainList,
  } = useWorkspace()
  const me = useMe()
  const write = useWrite()
  // A read ends a moment after a tool is connected: its names show here by themselves. Any left
  // for a look stay on their step, as the Inbox's cards wait for the checklist to end.
  const canPublish = me.admin || me.owns.length > 0
  const namesRead = useQuery({
    ...namesQuery(),
    enabled: canPublish,
    refetchInterval: setupDone.definitions || !canPublish ? false : 3000,
  })
  const names = namesRead.data?.names.filter((name) => name.state !== 'left_out')
  // The server's own definitions are read by themselves too: the checklist asks until that read
  // has ended, then counts it ended only once the names read after it are in, so the step goes
  // from the read on its way straight to its names.
  const reading = serverSource?.state === 'reading' && !setupDone.definitions
  const workspaceRead = useQuery({ ...workspaceQuery(), refetchInterval: reading ? 3000 : false })
  const [sawReading, setSawReading] = React.useState(reading)
  if (reading && !sawReading) setSawReading(true)
  const { refetch: refetchNames } = namesRead
  const ended = sawReading && serverSource?.state === 'read'
  React.useEffect(() => {
    if (ended) void refetchNames()
  }, [ended, refetchNames])
  const namesBehind = ended && canPublish && namesRead.dataUpdatedAt < workspaceRead.dataUpdatedAt
  // The first names published end the step. A decision reads only the names again, so while the
  // step is open the checklist reads the workspace once the names change.
  const revision = namesRead.data?.revision
  const lastRevision = React.useRef(revision)
  const { refetch: refetchWorkspace } = workspaceRead
  React.useEffect(() => {
    const was = lastRevision.current
    lastRevision.current = revision
    if (was !== undefined && revision !== was && !setupDone.definitions) void refetchWorkspace()
  }, [revision, setupDone.definitions, refetchWorkspace])
  // A step done says what it is, whatever read its names.
  const definitions = definitionsStep(
    setupDone.definitions || !serverSource
      ? null
      : { ...serverSource, state: namesBehind ? 'reading' : serverSource.state },
    names?.length ?? 0,
  )
  const [reviewing, setReviewing] = React.useState(false)
  const { query } = useRoute()
  const asked = canPublish && query.get('card') === 'names:waiting'
  const askedShow = query.get('show')
  // A question about the first item, from what it applies to or, if that is empty, its own words,
  // on its own dates when they miss today: most first items are about a day that has passed.
  // A new install has only what this visit added, newest first.
  const item = useFacts()[0]
  const words = useQuery({
    ...readQuestionQuery(item ? `${item.title} ${item.summary}` : ''),
    enabled: !!item && !item.where.length,
  }).data
  const read =
    item && (item.where.length ? { metric: item.where[0], markets: item.where.slice(1) } : words)
  const scope = read && scopeText({ metric: read.metric ?? '', markets: read.markets })
  const dates = item ? questionDates(item.valid, today()) : ''
  const firstQuestion = scope
    ? `What should I know about ${scope}${dates ? ` ${dates}` : ''}?`
    : 'What should I know about our numbers?'
  const doneCount = setupSteps.filter((s) => setupDone[s.id]).length
  const admins = useAdminsSaid()
  // The steps done in an admin's Settings: anyone else reads who does them, and has no button.
  const inSettings: Record<string, string> = {
    about: '/settings/general',
    domain: '/settings/domains/new',
    ...(definitions.opens === 'names' ? {} : { definitions: '/settings/integrations' }),
  }
  const mayDo = (id: string) => mayOpenSettings(inSettings[id] ?? '', me)
  const first = setupSteps.find((s) => !setupDone[s.id] && mayDo(s.id))
  const go = (id: string) => {
    if (id === 'definitions' && definitions.opens === 'names') setReviewing(true)
    else if (id === 'definitions' && definitions.opens === 'source' && serverSource)
      navigate(`/settings/integrations/${serverSource.id}`)
    // The catalogue loads with the first page that needs it, never with the Inbox.
    else if (id === 'definitions')
      void import('@/model/catalogue').then(({ definitionsConnectHref }) =>
        navigate(definitionsConnectHref(), { setup: '1' }),
      )
    if (id === 'about') navigate('/settings/general', { setup: '1' })
    if (id === 'domain') navigate('/settings/domains/new', { setup: '1' })
    if (id === 'fact') navigate('/context/new', { setup: '1' })
    // A question about the first item, typed in and ready to send.
    if (id === 'ask') navigate('/ask', { setup: '1', n: 'setup', q: firstQuestion })
    if (id === 'agent') {
      void write('completeSetupStep', { step: 'agent' })
      open('connect')
    }
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The same header as the Inbox in every state, so the page keeps its shape. */}
      <SiteHeader title="Inbox" icon={<InboxIcon />}>
        <Button
          variant="outline"
          size="icon"
          aria-label="Ask in the side panel"
          onClick={() => openDock('ask')}
        >
          <MessageSquareIcon />
        </Button>
      </SiteHeader>
      <div className="@container/main min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col p-4 md:p-6">
          {/* What already waits comes first: on a phone the checklist is two screens long. */}
          {due > 0 && <DueRow due={due} />}
          <div className="grid grid-cols-1 gap-px bg-border p-px">
            <Cell className="gap-0 py-0">
              <CardHeader className="border-b px-4 py-4 md:px-5">
                <CardTitle className="text-base">{setupHeading}</CardTitle>
                <CardDescription>
                  Your team writes down what the numbers don't show, and every agent reads it before
                  it answers. Name your metrics, then write: about ten minutes to your first answer.{' '}
                  {whereContextGoes(me, domainList)}
                </CardDescription>
                <CardAction className="text-xs text-muted-foreground tabular-nums">
                  {doneCount} of {setupSteps.length} done
                </CardAction>
              </CardHeader>
              <CardContent className="px-0">
                <ol className="flex flex-col divide-y divide-border">
                  {setupSteps.map((step, i) => {
                    const isDone = setupDone[step.id]
                    const own = step.id === 'definitions'
                    const action = mayDo(step.id) ? (own ? definitions.action : step.action) : null
                    return (
                      <li
                        key={step.id}
                        className="flex min-h-16 items-center gap-3 px-4 py-3 @md:px-6"
                      >
                        <span
                          aria-hidden
                          className="flex size-10 shrink-0 items-center justify-center text-sm text-muted-foreground tabular-nums"
                        >
                          {isDone ? <CircleCheckIcon className="size-4 text-foreground" /> : i + 1}
                        </span>
                        <span className="min-w-0 flex-1 space-y-1">
                          <span
                            className={cn(
                              'block text-sm leading-snug',
                              isDone && 'text-muted-foreground line-through',
                            )}
                          >
                            {step.title}
                          </span>
                          <span
                            className="block text-xs text-muted-foreground"
                            aria-live={own ? 'polite' : undefined}
                          >
                            {own ? definitions.description : step.description}
                          </span>
                          {!isDone && !mayDo(step.id) && (
                            <span className="block text-xs text-muted-foreground">
                              An admin does this{admins}.
                            </span>
                          )}
                        </span>
                        {isDone && <span className="sr-only">Done</span>}
                        {action !== null && (!isDone || (own && definitions.opens === 'names')) && (
                          <Button
                            variant={first?.id === step.id ? 'default' : 'outline'}
                            onClick={() => go(step.id)}
                          >
                            {action}
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ol>
              </CardContent>
              {!setupDone.fact && (
                <CardFooter className="rounded-none border-t bg-background px-4 py-4 text-xs text-muted-foreground @md:px-6">
                  Until there is context, agents hear “Nothing is written down for this.” That is
                  the honest answer, not an error.
                </CardFooter>
              )}
            </Cell>
          </div>
        </div>
      </div>
      {(reviewing || asked) && (
        <React.Suspense fallback={null}>
          <NamesDialog
            show={askedShow === 'families' || askedShow === 'names' ? askedShow : undefined}
            onClose={() => {
              setReviewing(false)
              if (asked) setQuery({ card: undefined, show: undefined })
            }}
          />
        </React.Suspense>
      )}
    </div>
  )
}

/**
 * The Inbox's Due for a check row, above the checklist while setup is unfinished: how many, in
 * whose domains, and a link to them in Context.
 */
function DueRow({ due }: { due: number }) {
  const me = useMe()
  const Icon = cardIcon.check
  return (
    <section aria-label="Needs you" className="mb-4 grid grid-cols-1 gap-px bg-border p-px">
      <Cell className="gap-0 py-0">
        <a
          href={href('/context', { due: '1' })}
          className="flex min-h-16 items-center gap-3 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset @md:px-6"
        >
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center text-muted-foreground"
          >
            <Icon className="size-4" />
          </span>
          <span className="min-w-0 flex-1 space-y-1">
            <span className="block text-sm leading-snug font-medium">
              Due for a check{' '}
              <span className="font-normal text-muted-foreground tabular-nums">
                {due.toLocaleString('en-GB')} {dueScope(me)}
              </span>
            </span>
            <span className="block text-xs text-muted-foreground">
              A definition they rely on changed in its tool, or their check date passed.
            </span>
          </span>
          <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </a>
      </Cell>
    </section>
  )
}

/** What agents asked this week, in counts only: the quiet sign that it is working. */
function WeekLine() {
  const { week } = useInbox()
  if (week.asked === 0) return <>Agents asked nothing this week.</>
  // As Ask's Asked this week says it: a floor when the total would give a small count away.
  if (week.asked === null)
    return week.askedAtLeast >= 5 ? (
      <>This week agents asked {week.askedAtLeast}+ times.</>
    ) : (
      <>This week agents asked fewer than 5 times.</>
    )
  if (week.found === null || week.nothing === null)
    return <>This week agents asked {week.asked} times.</>
  const most = week.mostAbout ? `, most about ${week.mostAbout}` : ''
  return (
    <>
      <span className="max-sm:hidden">
        This week agents asked {week.asked} times. {week.found} found something written down;{' '}
        {week.nothing} found nothing written down{most}.
      </span>
      <span className="sm:hidden">
        Agents asked {week.asked} times this week; {week.nothing} found nothing written down.
      </span>
    </>
  )
}

function AllDone({
  waitingCount,
  arrive,
  onShown,
}: {
  waitingCount: number
  arrive: boolean
  onShown: () => void
}) {
  React.useEffect(onShown, [onShown])
  return (
    <Empty className="done-arrive py-10" data-arrive={arrive || undefined}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleCheckIcon />
        </EmptyMedia>
        <EmptyTitle>Nothing needs you</EmptyTitle>
        <EmptyDescription className="text-xs">
          No new suggestion, report or unanswered question waits for you.
          {waitingCount > 0 &&
            ` ${waitingCount === 1 ? 'One suggestion of yours is' : `${waitingCount} of yours are`} waiting on others, under All.`}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={() => navigate('/ask')}>
          <MessageSquareIcon data-icon="inline-start" />
          Ask a question
        </Button>
      </EmptyContent>
    </Empty>
  )
}

/* ---------- the page ---------- */

export function InboxPage() {
  const load = useQuery(inboxPageQuery())
  const inbox = useInbox()
  const { install } = useSession()
  const write = useWrite()
  const undo = useUndo()
  const commentActions = useCommentActions()
  const { query } = useRoute()
  const isMobile = useIsMobile()
  const dock = useDock()
  // A decision shows at once, while it is saved; a failed save takes it back by itself.
  const [decided, addDecided] = React.useOptimistic(
    inbox.done,
    (done, d: { card: string; outcome: string }) => ({
      ...done,
      [d.card]: { label: d.outcome, at: 'Just now' },
    }),
  )
  const { needing, rows, waiting: mineWaiting } = useInboxRows(decided)
  const tab = query.get('tab') === 'all' ? 'all' : 'needs'
  const [search, setSearch] = React.useState('')
  // The last card leaving while the page is open ends on a calm "Nothing needs you"; a page that
  // opens already empty just shows it.
  const emptied = needing.length === 0
  const [wasEmptied, setWasEmptied] = React.useState(emptied)
  const [arrive, setArrive] = React.useState(false)
  if (emptied !== wasEmptied) {
    setWasEmptied(emptied)
    setArrive(emptied)
  }
  // Once shown, the entrance is spent. Cleared in a transition: an urgent render would drop the
  // in-flight optimistic decision and flip `emptied` back and forth.
  const onShown = React.useCallback(() => {
    React.startTransition(() => setArrive(false))
  }, [])

  const visible = rows.filter((r) => {
    if (tab === 'needs' && !needs(r)) return false
    const text = r.kind === 'card' ? `${r.card.title} ${r.card.line}` : rowTitle(r)
    return text.toLowerCase().includes(search.toLowerCase())
  })
  // Groups fold by hand; a long run of checks starts folded, unless a link points into it. A
  // search shows every match.
  const [byHand, setByHand] = React.useState<Partial<Record<InboxGroup, boolean>>>({})
  const linked = rows.find((r) => rowId(r) === query.get('card'))
  const linkedGroup = linked && groupOf(linked)
  const folded = new Set(
    INBOX_GROUPS.map((g) => g.id).filter((id) => {
      const count = visible.filter((r) => groupOf(r) === id).length
      return count && (byHand[id] ?? (!(search || linkedGroup === id) && startsFolded(id, count)))
    }),
  )
  const toggleFold = (g: InboxGroup) => setByHand((b) => ({ ...b, [g]: !folded.has(g) }))
  // What the list shows, and so what the arrow keys, J and K, and a select-all walk through.
  const shown = visible.filter((r) => !folded.has(groupOf(r)))
  // ?card=none is the cleared selection (Esc): the pane says so instead of opening the first card.
  const cleared = query.get('card') === 'none'
  const selectedId = cleared
    ? undefined
    : (query.get('card') ?? (isMobile ? undefined : shown[0] && rowId(shown[0])))
  const selected = rows.find((r) => rowId(r) === selectedId)
  // How the card on show was picked: a pointer pick or a decision fades its body in, a key does not.
  const [picked, setPicked] = React.useState<{ id?: string; fade: boolean; key?: boolean }>({
    fade: false,
  })
  const frameRef = React.useRef<HTMLDivElement>(null)
  const primary = () => frameRef.current?.querySelector<HTMLButtonElement>('button[data-primary]')
  // Enter on a row opens the card and moves the focus to the pane's one decision.
  const select = (id?: string, pointer = false, key = false) => {
    // On a phone the whole card slides in; its body does not fade on top of that.
    setPicked({ id, fade: pointer && !isMobile, key })
    setQuery({ card: id ?? (isMobile ? undefined : 'none') })
  }
  React.useEffect(() => {
    if (picked.key && picked.id === selectedId) primary()?.focus()
  }, [picked, selectedId])
  const ids = shown.map(rowId)
  const listRef = React.useRef<HTMLUListElement>(null)
  const online = useOnline()
  const sel = useSelection(ids, { scope: listRef })
  // Ticked rows, read: the dot goes, and a mention or a new reply is marked seen.
  const markRead = () => {
    const picked = rows.filter((r) => sel.isSelected(rowId(r)))
    for (const r of picked) {
      if (r.kind === 'card') {
        void write('markOpened', { ids: [r.card.id] })
        void commentActions.seen(`review:${r.card.id}`)
      }
      if (r.note) void commentActions.seenMention(r.note.subject)
    }
    toast(`Marked ${picked.length} as read`)
    sel.clear()
  }
  const step = (d: 1 | -1) => {
    const i = ids.indexOf(selectedId ?? '')
    // With nothing selected, either key opens the first card.
    const nextId = i < 0 ? ids[0] : ids[Math.min(ids.length - 1, Math.max(0, i + d))]
    if (nextId) select(nextId)
  }
  // After acting on a card, move to the next one that needs you.
  const next = () => {
    const rest = needing.filter((r) => rowId(r) !== selectedId)
    setPicked({ id: rest[0] && rowId(rest[0]), fade: true })
    setQuery({ card: rest[0] && rowId(rest[0]), dock: undefined })
  }

  // J and K step through the list, Enter opens the selected card's primary action.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (!pageKey(e)) return
      if (e.key === 'j') step(1)
      if (e.key === 'k') step(-1)
      // Esc clears the selection: on a phone the list comes back, on a wide screen the pane empties.
      // Ticked rows clear first, in the selection's own Esc. A panel open in the card's place (a
      // family opened from the Names card) takes its own Esc and closes: the card comes back.
      if (e.key === 'Escape' && !e.defaultPrevented && selected && !sel.count) select(undefined)
      if (e.key === 'Enter' && t === document.body) primary()?.click()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /**
   * A decision on a card, without a wait: the row goes now and the next card opens, with Undo;
   * the save runs behind it (it takes as long as a send, and with ?decide=fail or ?state=failed the
   * mock fails each card's first one), and if it fails the card comes back with Try again. Undo
   * then stays for as long as the service's answer says it takes it.
   */
  const decide = (card: InboxCard, d: Decision) => {
    let undone = false
    let gone = false
    let saved: UndoOffer | undefined
    next()
    const said = toast(d.message, {
      description: d.description,
      duration: Infinity,
      action: {
        label: 'Undo',
        onClick: () => {
          // Pressed as the save lands, this button can outlive the swap to the offer's own: take it
          // back now when the answer is in, else when it comes.
          undone = true
          if (saved) void undo.takeBack(saved)
        },
      },
      onDismiss: () => {
        gone = true
      },
    })
    void leaveThen(card.id, () =>
      React.startTransition(async () => {
        addDecided({ card: card.id, outcome: d.outcome })
        try {
          const decided = await write('decideCard', {
            card: card.id,
            outcome: d.outcome,
            patch: d.patch,
          })
          saved = decided.undo
          // Undo was pressed while it was being saved: it is taken back as soon as it is in.
          if (undone) await undo.takeBack(decided.undo)
          else if (!gone)
            undo.offer(d.message, decided.undo, { id: said, description: d.description })
        } catch {
          toast.dismiss(said)
          if (undone) return
          toast.error("Couldn't save that decision", {
            description: 'Nothing changed. The card is back in the Inbox.',
            action: { label: 'Try again', onClick: () => decide(card, d) },
          })
        }
      }),
    )
  }

  if (install === 'new') return <Setup due={needing.filter((r) => groupOf(r) === 'check').length} />

  const allDone = tab === 'needs' && needing.length === 0

  const back = isMobile ? () => select(undefined) : undefined
  const at = ids.indexOf(selectedId ?? '')
  const nav: PaneNav = {
    onStep: step,
    onBack: back,
    fade: !!selectedId && picked.id === selectedId && picked.fade,
    position:
      at < 0 ? undefined : `${at + 1} of ${ids.length} in ${tab === 'all' ? 'All' : 'Needs me'}`,
  }
  const detail = selected ? (
    selected.kind === 'card' && selected.card.type === 'names' ? (
      <NamesDetail key={selected.card.id} card={selected.card} nav={nav} next={next} />
    ) : selected.kind === 'card' ? (
      <CardDetail
        key={selected.card.id}
        card={selected.card}
        done={selected.done}
        note={selected.note}
        nav={nav}
        next={next}
      />
    ) : selected.kind === 'waiting' ? (
      <WaitingDetail
        key={selected.item.id}
        item={selected.item}
        note={selected.note}
        nav={nav}
        next={next}
      />
    ) : (
      <MentionDetail
        key={selected.subject}
        subject={selected.subject}
        title={selected.title}
        note={selected.note}
        nav={nav}
        next={next}
      />
    )
  ) : (
    <Cell className="h-full justify-center">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Nothing selected</EmptyTitle>
          <EmptyDescription className="text-xs">
            Pick a card on the left, or press J to open the first.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </Cell>
  )

  const list = (
    <div className="flex h-full min-h-0 flex-col gap-0">
      <Cell className="h-full min-h-0 gap-0 py-0">
        <CardHeader className="border-b px-4 py-4 md:px-5">
          <CardTitle className="text-base @max-sm/card-header:col-span-full">
            {tab === 'all' ? 'Everything' : 'Needs you'}
          </CardTitle>
          <CardDescription className="@max-sm/card-header:col-span-full">
            {tab === 'all' ? 'Yours, waiting on others, and done.' : <WeekLine />}
          </CardDescription>
          {/* Beside the introduction on a wide list; under it on a phone, where a 180 px column would run it to three lines. */}
          <CardAction className="@max-sm/card-header:col-span-full @max-sm/card-header:row-span-1 @max-sm/card-header:row-start-3 @max-sm/card-header:mt-2 @max-sm/card-header:justify-self-start">
            {/* A filter, not navigation: quiet words with counts. */}
            <TextSwitch
              label="Show"
              value={tab}
              onChange={(v) => setQuery({ tab: v === 'all' ? 'all' : undefined, card: undefined })}
              options={[
                { value: 'needs', label: 'Needs me', count: needing.length },
                { value: 'all', label: 'All', count: rows.length },
              ]}
            />
          </CardAction>
          <form className="col-span-full mt-3" onSubmit={(e) => e.preventDefault()}>
            <div className="relative">
              <SearchIcon
                className="absolute top-2 left-2.5 size-4 text-muted-foreground"
                aria-hidden
              />
              <Input
                placeholder="Search the Inbox"
                aria-label="Search the Inbox"
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </form>
        </CardHeader>
        {/* The rows take focus, not the box they scroll in: no stop without a ring. */}
        <div tabIndex={-1} className="@container min-h-0 flex-1 overflow-y-auto outline-none">
          {allDone ? (
            <AllDone waitingCount={mineWaiting.length} arrive={arrive} onShown={onShown} />
          ) : visible.length === 0 ? (
            <p className="px-6 py-4 text-sm text-muted-foreground">No cards match “{search}”.</p>
          ) : (
            <InboxList
              rows={visible}
              folded={folded}
              onFold={toggleFold}
              selected={selectedId}
              onSelect={select}
              sel={sel}
              list={listRef}
            />
          )}
        </div>
        <BulkBar
          label="Selected cards"
          count={sel.count}
          onClear={sel.clear}
          note={
            online
              ? undefined
              : { text: "You're offline. Changes are off until you're back; nothing is lost." }
          }
        >
          <BulkButton
            reason={online ? undefined : "Off while you're offline. Nothing is lost."}
            onClick={markRead}
          >
            <MailOpenIcon />
            <span className="max-sm:sr-only">Mark as read</span>
          </BulkButton>
        </BulkBar>
      </Cell>
    </div>
  )

  const panes = isMobile ? (
    <div
      key={selected ? 'card' : 'list'}
      className={cn('h-full min-h-0', selected ? 'dock-enter' : !allDone && 'dock-swap')}
    >
      {selected ? detail : list}
    </div>
  ) : allDone || dock ? (
    <div className="h-full min-h-0">{list}</div>
  ) : (
    <ResizablePanelGroup orientation="horizontal" id="inbox">
      <ResizablePanel id="inbox-list" defaultSize="42" minSize={320}>
        {list}
      </ResizablePanel>
      <ResizableHandle className="w-px bg-border" />
      <ResizablePanel id="inbox-detail" defaultSize="58" minSize={360}>
        {detail}
      </ResizablePanel>
    </ResizablePanelGroup>
  )

  return (
    <div className={cn('flex h-full min-h-0 flex-col', TOUCH)}>
      <SiteHeader title="Inbox" icon={<InboxIcon />}>
        <Button
          variant="outline"
          size="icon"
          aria-label="Ask in the side panel"
          onClick={() => openDock('ask')}
        >
          <MessageSquareIcon />
        </Button>
      </SiteHeader>
      {/* On a phone an open card is a screen of its own, edge to edge, not a box inside the frame. */}
      <div
        className={cn(
          '@container/main flex min-h-0 flex-1 flex-col',
          !(isMobile && selected) && 'px-4 pt-4 md:px-6 md:pt-6',
        )}
        ref={frameRef}
      >
        <div
          className={cn(
            'mx-auto flex h-full min-h-0 w-full max-w-wide flex-col gap-px',
            !(isMobile && selected) && 'bg-border p-px',
          )}
        >
          <div className="min-h-0 flex-1 bg-background">
            <Loadable what="the Inbox" skeleton={<ListSkeleton />} query={load}>
              <Decide.Provider value={decide}>{panes}</Decide.Provider>
            </Loadable>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * A Conflict alert's pair (FR-220): the two items its topic gets, compact, and the way to the
 * comparison. The alert carries the pair its topic gave when it was raised; its items find the row.
 */
function AlertPair({ pair: key }: { pair: string | undefined }) {
  const rows = useQuery(conflictsQuery('all')).data ?? []
  const row = pairOfKey(rows, key)
  const pair = useQuery({ ...conflictQuery(row?.key ?? ''), enabled: !!row }).data
  if (!row || !pair) return null
  return (
    <div className="flex flex-col gap-3">
      <ConflictPairCompact pair={pair} />
      <div>
        <Button onClick={() => openDock('conflict', pair.key)}>
          <ArrowLeftRightIcon data-icon="inline-start" />
          {row.canSettle ? 'Compare and decide' : 'Compare the two'}
        </Button>
      </div>
    </div>
  )
}
