import type { UndoOffer } from '@/api/client'
import {
  conflictQuery,
  conflictsQuery,
  inboxPageQuery,
  useDefinitions,
  useInbox,
  useReviews,
  useSavedQuestions,
  useSession,
  useWrite,
} from '@/api/queries'
import { FieldDiff, PersonAvatar } from '@/components/footnote/bits'
import { BulkBar, BulkButton } from '@/components/footnote/bulk-bar'
import { Cell } from '@/components/footnote/cell'
import { suggestionIcon } from '@/components/footnote/change-icons'
import { ConflictPairCompact } from '@/components/footnote/conflict-pair'
import {
  AskedAbout,
  cardIcon,
  Fold,
  ItemFold,
  PaneFoot,
  PaneHead,
  PrimaryAction,
} from '@/components/footnote/inbox-pane'
import { ListSkeleton, Loadable } from '@/components/footnote/load-state'
import { Mark } from '@/components/footnote/mark'
import { Panel } from '@/components/footnote/panel'
import { TextSwitch } from '@/components/footnote/switches'
import { ToolLogo } from '@/components/footnote/tool-logo'
import { TruncatedText } from '@/components/footnote/truncated'
import {
  ArrowLeftIcon,
  ArrowLeftRightIcon,
  AtSignIcon,
  BookOpenIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleCheckIcon,
  ClockIcon,
  InboxIcon,
  LinkIcon,
  MailOpenIcon,
  MessageSquareIcon,
  MessageSquareTextIcon,
  SearchIcon,
  TriangleAlertIcon,
  type FlagIcon,
} from '@/components/icons'
import { ResultIcon } from '@/components/obs/result'
import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import { CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import { useSelection, type RowSelection } from '@/hooks/use-selection'
import { useCommentActions, useNewReply, type MentionNote } from '@/lib/comments'
import { askInDock, openDock, openFromRow, useDock } from '@/lib/dock'
import { safeHref } from '@/lib/host'
import {
  dueScope,
  groupOf,
  INBOX_GROUPS,
  needs,
  rowId,
  rowTitle,
  startsFolded,
  useInboxRows,
  type InboxGroup,
  type InboxRow,
} from '@/lib/inbox-rows'
import { useListKeys } from '@/lib/list'
import { marksExceptions } from '@/lib/marks'
import { arriveRef, leaveThen, useLeavingRows } from '@/lib/presence'
import { backToList, changeQuery, navigate, openFromList, setQuery, useRoute } from '@/lib/router'
import { useOnline } from '@/lib/send'
import { mayOpenSettings } from '@/lib/settings-access'
import { toast } from '@/lib/toast'
import { TOUCH, TOUCH_LINK } from '@/lib/touch'
import { rememberSending, useUndo } from '@/lib/undo'
import { cn, midSentence } from '@/lib/utils'
import { useAdminsSaid, useDomains, useFacts, useMe } from '@/lib/workspace'
import type { Subject } from '@/model/comments'
import { pairOfKey } from '@/model/conflicts'
import type { Outcome } from '@/model/inbox'
import {
  ASK_SOMEONE,
  askSomeoneCopied,
  UPDATE_IT,
  type InboxCard,
  type Waiting,
} from '@/model/inbox'
import { follows, paneState, primaryLabel } from '@/model/inbox-pane'
import { integrationHref, lookOf } from '@/model/integrations'
import type { DomainId, Fact } from '@/model/items'
import {
  askedWords,
  careLine,
  changeWords,
  flagRowWords,
  gapRowWords,
  type Review,
} from '@/model/review'
import { QuickHead, QuickReview } from '@/pages/review'
import { andList } from '@domain/family-split'
import { questionPath } from '@domain/question-link'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
// Read only on an install that is new or has few items published, so kept out of the first load.
const NamesReview = React.lazy(() => import('@/components/footnote/names-review'))
const DraftsReview = React.lazy(() => import('@/components/footnote/drafts-review'))
const Setup = React.lazy(() => import('@/first-use').then((m) => ({ default: m.Setup })))
const NextCard = React.lazy(() => import('@/first-use').then((m) => ({ default: m.NextCard })))

// The Inbox, built like shadcn's Mail example (a list with All and Needs me and a search field, and
// a detail pane with the selected card's one primary action) and dressed as Efferd's dashboard 2:
// a frame of flat cells divided by hairlines. A suggestion's review opens in the dock, which takes
// the detail pane's place, so there is one right panel.

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
      : row.item.closed
        ? `Closed by ${row.item.closed.by}`
        : `Waiting for ${row.item.waitingFor.split(',')[0]}`
  const { card, done } = row
  if (done) return `${done.label}, ${midSentence(done.at)}`
  if (card.names || card.drafts) return card.line
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
  if (card.flag) return flagRowWords(card.flag)
  if (card.look) return 'Raised by an alert: saved questions answer worse'
  if (card.alert) return `Raised by an alert: ${card.alert.name}`
  return card.due === 'family'
    ? 'Its family was split'
    : card.due === 'source'
      ? 'A definition changed'
      : 'Its check date passed'
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
  // The selected row stays in sight: on a click, on J and K, and on a link straight to a card. A
  // card opened by its address is found before the list has its shape (the two panes and the week
  // line are still arriving), so the row is brought back as the list or its box changes size,
  // until the person scrolls the list themselves.
  React.useEffect(() => {
    const ul = list.current
    const box = ul?.parentElement
    if (!ul || !box || !selected) return
    const show = () =>
      ul
        .querySelector<HTMLElement>(`[data-row="${CSS.escape(selected)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    show()
    const watch = new ResizeObserver(show)
    watch.observe(ul)
    watch.observe(box)
    const release = () => watch.disconnect()
    const moves = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const
    for (const move of moves) box.addEventListener(move, release, { passive: true })
    return () => {
      release()
      for (const move of moves) box.removeEventListener(move, release)
    }
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
              : row.kind === 'waiting' && row.item.closed
                ? cardIcon.closed
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
        const unread = row.note
          ? true
          : row.kind === 'card'
            ? !row.done && !opened[row.card.id]
            : row.kind === 'waiting' && !!row.item.closed && !opened[row.item.id]
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
                    className={cn('size-3.5 shrink-0', folded.has(group) && '-rotate-90')}
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
                  <span className="ml-auto shrink-0 whitespace-nowrap">
                    <a
                      href={`${integrationHref(source.connector)}?state=suggestions`}
                      className={cn(
                        'text-muted-foreground underline-offset-4 hover:text-foreground hover:underline',
                        TOUCH_LINK,
                      )}
                    >
                      About this read
                    </a>
                  </span>
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
                    onClick={(e) => {
                      e.currentTarget.focus({ preventScroll: true })
                      return sel.rowClick(id, e) || onSelect(id, e.detail > 0, !e.detail)
                    }}
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
                              ? ((row.item.returned ?? row.item.closed)?.when.replace(
                                  /^Today, /,
                                  '',
                                ) ?? row.item.sent)
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
  /** Where the back arrow goes, said beside it ("21 drafts"): a draft open in its card's place. */
  backLabel?: string
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
  nav: { onStep, onBack, backLabel, position, fade },
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
        onBack &&
        (backLabel ? (
          <Button
            variant="ghost"
            aria-label={`Back to ${backLabel}`}
            className="-ml-1 text-muted-foreground"
            onClick={onBack}
          >
            <ArrowLeftIcon />
            {backLabel}
          </Button>
        ) : (
          <Button variant="ghost" size="icon" aria-label="Back to the list" onClick={onBack}>
            <ArrowLeftIcon />
          </Button>
        ))
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
        return openFromList(`/inbox/${card.id}/review`)
      case 'gap':
        // A draft waits: the same review as any suggestion. With none yet, the editor opens on the
        // scope, for this card, with writing help asking what happened: publishing what is
        // written there closes it.
        return card.gap?.draft
          ? openFromList(`/inbox/${card.id}/review`)
          : navigate('/context/new', {
              gap: card.id,
              metric: card.gap?.scope[0],
              about: card.gap?.scope[1],
              from: 'inbox',
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
          // About a family that was split, it is kept for each of its metrics.
          ...(card.splitInto
            ? {
                message: card.primary.replace(/^Keep/, 'Kept'),
                description: `It is about ${andList(card.splitInto)} now, and no longer due.`,
              }
            : {
                message: 'Checked: still true',
                description: 'It comes back when it needs a recheck.',
              }),
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
    // The item's editor, with writing help asking what changed since it was checked.
    [UPDATE_IT]: () => navigate(`/context/${card.factId}/edit`, { from: 'inbox' }),
    Archive: () =>
      run({
        outcome: 'Archived',
        message: 'Archived',
        description: 'Agents stop getting it from the next question.',
        patch: { status: 'Archived' },
      }),
  }
  // Ask someone who knows: the link is made, then copied as the service answers. Footnote sends
  // nothing; the owner pastes it where the company talks.
  const write = useWrite()
  secondary[ASK_SOMEONE] = () => {
    const link = new Promise<string>((resolve, reject) => {
      write('copyQuestionLink', { card: card.id }, ({ id }) =>
        resolve(`${window.location.origin}${questionPath(id)}`),
      ).catch(reject)
    })
    copyLater(link).then(
      // A link to this computer itself opens for nobody else: said, before it is sent.
      () => toast('Link copied', { description: askSomeoneCopied(window.location.origin) }),
      // The service's refusal, or the browser's when it would not copy, says what to do.
      (error: Error) => toast.error("Couldn't copy the link", { description: error.message }),
    )
  }
  // Only what writes needs the connection; Review and Edit only open a page.
  const writes = card.type === 'check' || (card.type === 'flag' && !card.factId)
  return { primary, secondary, online, writes }
}

/**
 * Copies words the service is still making: a browser keeps the press that asked for them as the
 * reason to copy, which a write after the answer would have lost.
 */
const copyLater = (text: Promise<string>) =>
  navigator.clipboard.write([
    new ClipboardItem({ 'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })) }),
  ])

/**
 * The card's link once copied, and what people answered there (asked-on.tsx): loaded only for a
 * card with a link, handed what it uses of the Inbox, so the first load is split no further.
 */
const AskedOn = React.lazy(() => import('@/components/footnote/asked-on'))
const askedParts = { PersonAvatar, LinkIcon, midSentence }

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
  const isMobile = useIsMobile()
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
  const offline = !online && (writes || card.secondary.some((l) => l !== UPDATE_IT))

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
            ? follows(card, review, isMobile)
            : `An admin looks into it${admins}.`
      }
    >
      {card.secondary.map((label) => (
        <Button
          key={label}
          variant="outline"
          size="lg"
          disabled={label !== UPDATE_IT && waits}
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
            {card.flag && <ReportedWords flag={card.flag} title={card.title} />}
            {card.changed && card.changed.length > 0 && (
              <React.Suspense fallback={null}>
                <ChangedDefinitions names={card.changed} />
              </React.Suspense>
            )}
            {card.asked && (
              <React.Suspense fallback={null}>
                <AskedOn asked={card.asked} parts={askedParts} />
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
 * The right words and the link a report from Ask was sent with, as its sender wrote them, and the
 * way to the suggestion the words became, while it waits for an owner.
 */
function ReportedWords({ flag, title }: { flag: NonNullable<InboxCard['flag']>; title: string }) {
  const link = safeHref(flag.link ?? null)
  if (!flag.correction && !link) return null
  return (
    <div className="flex flex-col items-start gap-2">
      {flag.correction && (
        <figure className="flex flex-col gap-2">
          <figcaption className="font-medium">
            {flag.by ? `${flag.by} suggests these words` : 'The right words'}
          </figcaption>
          <blockquote className="border-l-2 pl-3 text-pretty">{flag.correction}</blockquote>
        </figure>
      )}
      {link && (
        <p>
          <span className="font-medium">Link they sent:</span>{' '}
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="break-all text-primary underline-offset-4 hover:underline"
          >
            {link.replace(/^https?:\/\//, '')}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      )}
      {flag.suggestion && (
        <>
          <p className="text-muted-foreground">
            A suggestion on “{title}”. Ask and agents keep the item as it is until an owner
            publishes it.
          </p>
          <Button
            variant="outline"
            className="mt-1"
            onClick={() => navigate(`/inbox/${flag.suggestion}/review`)}
          >
            Review the suggestion
          </Button>
        </>
      )}
    </div>
  )
}

/**
 * The way to each definition that changed in its tool, beside a Needs a recheck card that says it
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

/** When, in the middle of a sentence: "on 3 Nov 2026", "today, 09:12". */
const dayWhen = (when: string) => (/^\d/.test(when) ? `on ${when}` : midSentence(when))

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
  const closed = item.closed
  const write = useWrite()
  return (
    <InboxPanel
      label={item.title}
      nav={nav}
      foot={
        closed ? (
          // Read once: Done takes it out of Needs me, and it stays under All for two weeks.
          <PaneFoot follows="It stays under All for two weeks.">
            <PrimaryAction
              onClick={() => {
                void write('markOpened', { ids: [item.id] })
                if (note) void write('markMentionSeen', { subject: note.subject })
                next()
              }}
            >
              Done
            </PrimaryAction>
          </PaneFoot>
        ) : returned ? (
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
          closed
            ? { label: 'Closed', icon: 'closed', tone: 'neutral' }
            : returned
              ? { label: 'Returned', icon: 'returned', tone: 'warn' }
              : { label: 'Waiting on others', icon: 'waiting', tone: 'neutral' }
        }
        domain={item.domain}
        title={item.title}
        summary={
          closed
            ? `${closed.by} closed it with the reason below. It won't be published, so agents never get it.`
            : returned
              ? `${returned.by} returned it with a note, in the comments below. Edit it and send it again.`
              : `Waiting for ${item.waitingFor}. You'll see here when it is published or returned.`
        }
        from={`Your suggestion, ${closed ? `closed ${dayWhen(closed.when)}` : returned ? `returned ${dayWhen(returned.when)}` : `sent ${item.sent.toLowerCase() === 'today' ? 'today' : `on ${item.sent}`}`}`}
      />
      <div className="flex max-w-2xl flex-col gap-4 px-4 pb-6 text-sm @md:px-7">
        {closed && (
          <section aria-label="Why it was closed" className="flex flex-col gap-1">
            <h3 className="font-medium">Closed by {closed.by}</h3>
            <blockquote className="border-l-2 pl-3 text-muted-foreground">
              {closed.reason}
            </blockquote>
          </section>
        )}
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

/** The person's own drafts that wait for them, in the Inbox's pane: one card publishes them all (FR-139). */
function DraftsDetail({ card, nav, next }: { card: InboxCard; nav: PaneNav; next: () => void }) {
  const write = useWrite()
  React.useEffect(() => {
    void write('markOpened', { ids: [card.id] })
    // Once per card opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id])
  return (
    <React.Suspense fallback={<ListSkeleton />}>
      <DraftsReview
        card={card}
        onFinished={next}
        frame={(body, foot, reading) => (
          <InboxPanel
            label={card.title}
            nav={reading ? { ...reading, fade: false } : nav}
            foot={foot}
          >
            {body}
          </InboxPanel>
        )}
      />
    </React.Suspense>
  )
}

/* ---------- setup and all done ---------- */

/**
 * What agents asked this week, in counts only: the quiet sign that it is working. The week is the
 * last 7 full days, so on the day an agent first asks, the line says it asked today.
 */
function WeekLine() {
  const { week } = useInbox()
  if (week.asked === 0)
    return week.askedToday ? (
      <>Agents asked today, for the first time this week.</>
    ) : (
      <>Agents asked nothing this week.</>
    )
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
    if (tab === 'needs' && !needs(r, inbox.opened)) return false
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
  const paneRef = React.useRef<HTMLDivElement>(null)
  const listRef = React.useRef<HTMLUListElement>(null)
  const primary = () => frameRef.current?.querySelector<HTMLButtonElement>('button[data-primary]')
  const rowButton = (id: string) =>
    listRef.current?.querySelector<HTMLElement>(`[data-row-open="${CSS.escape(id)}"]`)
  // The card on show, in the address. On a wide screen the pane follows the cursor, so a pick takes
  // the place of the address and Back leaves the Inbox in one press. On a phone a card opens over
  // the list as a page of its own: Back, or the card's back arrow, returns to the list.
  const show = (card: string | undefined, extra?: Record<string, string | undefined>) => {
    const changes = { card, draft: undefined, ...extra }
    const all = { ...Object.fromEntries(query), ...changes }
    if (isMobile && card && !selectedId) openFromList('/inbox', all)
    else if (isMobile && !card && selectedId) backToList('/inbox', all, { replace: true })
    else void changeQuery(changes, { replace: true })
  }
  // Enter on a row opens the card and moves the focus to the pane's one decision, or with none
  // there keeps it on the row.
  const select = (id?: string, pointer = false, key = false) => {
    // On a phone the whole card slides in; its body does not fade on top of that.
    setPicked({ id, fade: pointer && !isMobile, key })
    show(id ?? (isMobile ? undefined : 'none'))
  }
  React.useEffect(() => {
    if (picked.key && picked.id && picked.id === selectedId)
      (primary() ?? rowButton(picked.id))?.focus()
  }, [picked, selectedId])
  // The card Esc put away: its row takes the focus once the list shows, so the place is kept.
  const putAway = React.useRef<string | undefined>(undefined)
  React.useEffect(() => {
    const id = putAway.current
    if (!id || selectedId) return
    putAway.current = undefined
    rowButton(id)?.focus({ preventScroll: true })
  }, [selectedId])
  const ids = shown.map(rowId)
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
      if (r.kind === 'waiting' && r.item.closed) void write('markOpened', { ids: [r.item.id] })
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
    show(rest[0] && rowId(rest[0]), { dock: undefined })
  }

  // The page's list keys (lib/list.ts): J and K step through the cards, Enter on the card on show
  // presses its primary action. A draft open in its card's place takes J and K for its own drafts.
  useListKeys({
    list: listRef,
    order: ids,
    current: selectedId,
    panel: paneRef,
    // Stepped from inside the pane, the next card's one decision takes the focus.
    onMove: (id, from) => select(id, false, from.panel),
    onOpen: sel.count ? undefined : () => primary()?.click(),
    // Esc clears the selection: on a phone the list comes back, on a wide screen the pane empties,
    // and the card's row keeps the focus. Ticked rows clear first, in the selection's own Esc. A
    // panel open in the card's place (a family opened from the Names card) takes its own Esc and
    // closes: the card comes back.
    onEscape: () => {
      if (!selected || sel.count) return false
      putAway.current = selectedId
      select(undefined)
      return true
    },
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
    // Pressed as the save lands, this button can outlive the swap to the offer's own: take it
    // back now when the answer is in, else when it comes. Command and Z does the same.
    const takeBackWhenIn = () => {
      undone = true
      if (saved) void undo.takeBack(saved)
    }
    const said = toast(d.message, {
      description: d.description,
      duration: Infinity,
      action: { label: 'Undo', onClick: takeBackWhenIn },
      onDismiss: () => {
        gone = true
      },
    })
    const waiting = rememberSending('Still saving that decision', () => {
      toast.dismiss(said)
      takeBackWhenIn()
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
          if (undone) {
            waiting.undone()
            await undo.takeBack(decided.undo)
          } else if (!gone)
            undo.offer(d.message, decided.undo, {
              id: said,
              description: d.description,
              sent: waiting,
            })
          // Its toast was closed: Command and Z still takes it back while the service holds it.
          else undo.remember(d.message, decided.undo, { sent: waiting })
        } catch {
          waiting.failed()
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

  if (install === 'new')
    return (
      <React.Suspense fallback={null}>
        <Setup due={needing.filter((r) => groupOf(r) === 'check').length} />
      </React.Suspense>
    )

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
    ) : selected.kind === 'card' && selected.card.type === 'drafts' ? (
      <DraftsDetail key={selected.card.id} card={selected.card} nav={nav} next={next} />
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

  const pane = (
    <div ref={paneRef} className="h-full min-h-0">
      {detail}
    </div>
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
              {/* In the middle of the field at any height: under a finger the field is 44px. */}
              <SearchIcon
                className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
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
          {/* Under what already waits: a card that needs the person comes first. */}
          {tab === 'needs' && !search && (
            <React.Suspense fallback={null}>
              <NextCard />
            </React.Suspense>
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
      {selected ? pane : list}
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
        {pane}
      </ResizablePanel>
    </ResizablePanelGroup>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
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
      {/* Under a finger the list and the card are 44px controls; the header keeps its own size, as on every page. */}
      <div
        className={cn(
          '@container/main flex min-h-0 flex-1 flex-col',
          !(isMobile && selected) && 'p-4 md:p-6',
          TOUCH,
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
