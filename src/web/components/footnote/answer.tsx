import * as React from 'react'
import type { ChosenPeriodInput } from '@contract/answer'
import {
  ArrowLeftRightIcon,
  BookmarkIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleStopIcon,
  EllipsisIcon,
  FileTextIcon,
  FlagIcon,
  PencilIcon,
  RefreshCwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from '@/components/icons'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { marksExceptions } from '@/lib/marks'
import { AnswerFooter } from '@/components/footnote/answer-footer'
import type { RatingChain, Verdict } from '@/components/footnote/answer-rating'
import { kindIcons } from '@/components/footnote/kind-icons'
import { DefinitionHelp, StateHelp } from '@/components/footnote/state-help'
import { asksWhatItIs } from '@domain/scope'
import { loopParts } from '@/components/footnote/loop-parts'
import { today } from '@/lib/today'
import { dateLabel } from '@/model/validity'
import { ReadingLine } from '@/components/footnote/reading'
import { answerKey, keepShown, useReportSent } from '@/lib/shown-answers'
import { sentencesOf, type Sentence } from '@/lib/where'
import {
  ASK_CADENCE,
  useReveal,
  useShownStage,
  useStillLooking,
  type ShownStage,
} from '@/lib/ask-motion'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { FoldTrigger } from '@/components/footnote/fold'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CopiedIcon, useCopied } from '@/components/footnote/copied-icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  askedOf,
  scopeText,
  type Answer,
  type AskedDefinition,
  type QuestionPart,
} from '@/model/ask'
import { drawnByLoop, isLive, type Turn } from '@/model/ask-turn'
import { MentionChip } from '@/components/footnote/mention-chip'
import type { Fact } from '@/model/items'
import { closeDock, openDock, openFromButton, useDock } from '@/lib/dock'
import { useReadAhead, useReadCitedAhead } from '@/lib/read-ahead'
import { href, useRoute } from '@/lib/router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ConflictPairCompact } from '@/components/footnote/conflict-pair'
import { conflictQuery, myReportsQuery, useWrite } from '@/api/queries'
import { useDomains, useFacts, useMe } from '@/lib/workspace'
import { listOf } from '@/model/people'
import { SaveQuestion } from '@/components/obs/save-question'
import { agentReply } from '@/lib/agent-reply'
import { parseMentionId, plainText } from '@/lib/mentions'
import { useRelated } from '@/hooks/use-related'

// One turn of Ask, drawn the way the chat apps people know draw a thread: the question as a quiet
// muted bubble on the right, the answer as plain 16/26 text at a reading measure under its state
// badge, its sources as numbered chips with what was looked up beside them, and one row of icons
// under the answer, the rest in More.

function IconButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-pressed={active}
            onClick={onClick}
            className={cn(
              'text-muted-foreground hover:text-foreground pointer-coarse:size-9',
              active && 'bg-accent text-foreground',
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/* ---------- the question ---------- */

/** What Ask's loop answer is handed of Ask: its parts, and the answer's own actions. */
const loopAnswerParts = () => ({
  ...loopParts,
  AnswerActions,
  ReportLine,
  SomethingWrong,
})

/** Ask's loop draws its own answer, loaded with the first one: most chats never need it. */
const LoopAnswerBody = React.lazy(() =>
  import('@/components/footnote/loop-answer').then((m) => ({ default: m.LoopAnswerBody })),
)
const LoopReadLine = React.lazy(() =>
  import('@/components/footnote/loop-answer').then((m) => ({ default: m.LoopReadLine })),
)
const AskedAtLine = React.lazy(() =>
  import('@/components/footnote/loop-answer').then((m) => ({ default: m.AskedAtLine })),
)

export function Question({
  answer,
  onRescope,
  onReperiod,
  onEdit,
}: {
  answer: Answer
  onRescope?: (parts: QuestionPart[]) => void
  /** Asks the question again at a period chosen on the loop's read line. */
  onReperiod?: (period: ChosenPeriodInput) => void
  onEdit?: (parts: QuestionPart[]) => void
}) {
  const [copied, copy] = useCopied()
  // Ask's loop says what it read as, with its chips, every time.
  return (
    <div className="group/q flex flex-col items-end gap-2">
      <div className="max-w-22/25 min-w-0 rounded-surface bg-muted px-4 py-2.5 text-base leading-chat wrap-anywhere whitespace-pre-line @lg:max-w-4/5 [&_.mention-chip]:bg-background">
        {answer.parts
          ? answer.parts.map((p, i) =>
              typeof p === 'string' ? (
                <React.Fragment key={i}>{p}</React.Fragment>
              ) : (
                <MentionChip key={i} mention={p} />
              ),
            )
          : answer.question}
      </div>
      {answer.loop ? (
        <React.Suspense fallback={null}>
          <LoopReadLine
            parts={loopAnswerParts()}
            answer={answer}
            onRescope={onRescope}
            onReperiod={onReperiod}
          />
        </React.Suspense>
      ) : (
        // Asked again at a period chosen on the read line: it says so at once.
        answer.period && (
          <React.Suspense fallback={null}>
            <AskedAtLine period={answer.period} />
          </React.Suspense>
        )
      )}
      {/* Copy, and Edit to put the question back in the box: under the bubble, so it keeps its width; always there on a touch screen. */}
      <div className="-my-1 flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover/q:opacity-100 focus-within:opacity-100 pointer-coarse:gap-2.5 pointer-coarse:opacity-100">
        <IconButton
          label="Copy"
          onClick={() => {
            copy(answer.question)
            toast('Copied')
          }}
        >
          <CopiedIcon copied={copied} />
        </IconButton>
        {onEdit && (
          <IconButton
            label="Edit and ask again"
            onClick={() => onEdit(answer.parts ?? [answer.question])}
          >
            <PencilIcon />
          </IconButton>
        )}
      </div>
      {answer.again && (
        <p className="max-w-22/25 text-right text-xs text-muted-foreground @lg:max-w-4/5">
          Asked again: {answer.again.question}
        </p>
      )}
    </div>
  )
}

/** How a scoped question was read: its mentions, and what came from the words, said once in the answer's header. */
function ScopeLine({ answer }: { answer: Answer }) {
  const domains = useDomains()
  const scope = answer.scope ?? []
  if (!scope.length) return null
  const kinds = scope.map((m) => parseMentionId(m.id).kind)
  const fromWords = [
    !kinds.some((k) => k === 'metric' || k === 'term' || k === 'context') && answer.metric,
    !kinds.some((k) => k === 'market' || k === 'context') && answer.markets.join(' and '),
  ].filter(Boolean)
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-6 text-muted-foreground">
      <span>Scoped to</span>
      {scope.map((m) => (
        <MentionChip key={m.id} mention={m} />
      ))}
      {fromWords.length > 0 && <span>- the rest read as {fromWords.join(' in ')}</span>}
      {/* A scoped domain says what it covers, in its owners' words. */}
      {scope
        .map((m) => parseMentionId(m.id))
        .filter((m) => m.kind === 'domain' && domains[m.key])
        .map((m) => (
          <span key={m.key} className="basis-full text-xs leading-5">
            {domains[m.key]?.name}: {domains[m.key]?.covers}
          </span>
        ))}
    </p>
  )
}

/* ---------- what Footnote looked up ---------- */

/**
 * What the look-up is doing, then what it did. While it works, one line where the state line will
 * be; once the answer is in, a quiet line at the end of the sources row (`children`, the chips) that
 * opens What agents get.
 */
function LookupCard({
  answer,
  facts,
  turn,
  shown,
  children,
}: {
  answer: Answer
  facts: Fact[]
  turn: Turn
  /** The stage on screen: the look-up's own steps, each label held long enough to read. */
  shown: ShownStage
  children?: React.ReactNode
}) {
  const { stopped } = turn
  const answered = shown === 'answered'
  const scope = scopeText(answer) || 'Nothing matched'
  const raw = agentReply(answer, facts)
  // Looking up and reading come from the look-up's own steps, until its answer is in.
  const running = !stopped && !answered
  const still = useStillLooking(running && shown === 'looking', turn.working)
  const found = turn.found ?? 0
  // One quiet line that says what the look-up is doing; opened, the card in the chat's soft surface.
  // A look-up that answers within moments shows none: the answer comes instead.
  if (shown === 'quiet' && !stopped) return null
  // Stopped before an answer, the notice under it says so, once.
  if (stopped && !answered) return null
  const line = running
    ? shown === 'looking'
      ? still
        ? 'Still looking up…'
        : (turn.working ?? 'Looking up context…')
      : found
        ? `Reading ${found} context ${found === 1 ? 'item' : 'items'}…`
        : 'Found no context items'
    : answer.read
      ? // Ask's loop: what it cited, else that it read, from its own reads.
        facts.length
        ? `Used ${facts.length} context ${facts.length === 1 ? 'item' : 'items'}`
        : answer.read.length
          ? 'What Ask read'
          : 'Nothing was looked up'
      : answer.state === null
        ? 'Nothing was looked up'
        : answer.state === 'failed'
          ? 'Not looked up'
          : facts.length
            ? `Looked up ${facts.length} context ${facts.length === 1 ? 'item' : 'items'}`
            : 'Looked up: no context items'
  if (!answered)
    return (
      <p className="flex min-h-6 items-center">
        <ReadingLine running={running} className="text-sm">
          {line}
        </ReadingLine>
      </p>
    )
  return (
    <Collapsible className="flex flex-col gap-2 text-sm">
      {/* On a touch screen the rows sit a finger apart: 24 px chips 20 px apart. */}
      <div className="flex flex-wrap items-center gap-1.5 pointer-coarse:gap-y-5">
        {children}
        <FoldTrigger variant="inline" label={line} className="px-1 text-xs text-muted-foreground" />
      </div>
      <CollapsibleContent>
        {answer.read ? (
          <LoopReads answer={answer} />
        ) : (
          <div className="flex max-w-reading flex-col gap-2 rounded-frame border bg-background px-3.5 py-3 text-muted-foreground">
            <p className="text-xs font-medium text-foreground">What agents get</p>
            <p>
              <span className="text-foreground">Read:</span> {scope}.
            </p>
            <p>
              <span className="text-foreground">Told the agent:</span> “{answer.said}”
            </p>
            {facts.length > 0 && (
              <p>
                The agent got each context item with its source, who checked it, and its “don't
                conclude” line.
              </p>
            )}
            <Collapsible>
              <FoldTrigger
                variant="inline"
                label="Developer details"
                className="mt-1 -ml-1 px-1 text-xs text-muted-foreground"
              />
              <CollapsibleContent>
                <p className="mt-2 text-xs">
                  Tool <span className="font-mono text-foreground">get_context</span>
                </p>
                <pre className="mt-1 overflow-x-auto rounded-md bg-muted/50 p-2.5 font-mono text-xs leading-relaxed text-foreground">
                  {JSON.stringify(raw, null, 2)}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * What Ask's loop read for an answer (FR-720.9): each search with its words and period, what it
 * counted and each item it read, in lines written by code from the reads; and the reads
 * themselves, by tool and input, under Developer details.
 */
function LoopReads({ answer }: { answer: Answer }) {
  const lines = answer.read ?? []
  return (
    <div className="flex max-w-reading flex-col gap-2 rounded-frame border bg-background px-3.5 py-3 text-muted-foreground">
      <p className="text-xs font-medium text-foreground">What Ask read</p>
      {lines.length ? (
        <ul className="flex flex-col gap-1.5">
          {lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : (
        <p>Nothing was read for this answer.</p>
      )}
      <p className="text-xs">
        Each read runs as you, so it sees only what your own pages show you. Earlier reads in this
        chat are read again before they are used.
      </p>
      {!!answer.reads?.length && (
        <Collapsible>
          <FoldTrigger
            variant="inline"
            label="Developer details"
            className="mt-1 -ml-1 px-1 text-xs text-muted-foreground"
          />
          <CollapsibleContent>
            <pre className="mt-2 overflow-x-auto rounded-md bg-muted/50 p-2.5 font-mono text-xs leading-relaxed text-foreground">
              {JSON.stringify(answer.reads, null, 2)}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

/* ---------- the answer ---------- */

/** One citation: a small marker; hovered or pressed, a card with the context item and a way to open it. */
function Citation({ n, fact, draft }: { n: number; fact?: Fact; draft?: boolean }) {
  const marker =
    // 24px to see, 44px to tap: the hit area grows, the marker doesn't.
    'relative ml-0.5 mr-px inline-flex h-6 min-w-6 -translate-y-px items-center justify-center rounded-md bg-muted px-1.5 align-middle text-xs font-medium text-foreground tabular-nums outline-none after:absolute after:-inset-[13px] hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50'
  if (!fact || draft)
    return (
      <span className={marker} aria-label={`Source ${n}`}>
        {n}
      </span>
    )
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={120}
        closeDelay={80}
        render={
          <button type="button" className={marker} aria-label={`Source ${n}: ${fact.title}`} />
        }
      >
        {n}
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 gap-1.5 p-3">
        <SourceCard fact={fact} />
      </PopoverContent>
    </Popover>
  )
}

/** A source's card, from its marker or its chip: the item, who checked it and when, and a way to open it. */
function SourceCard({ fact }: { fact: Fact }) {
  const domains = useDomains()
  const ahead = useReadAhead()
  return (
    <>
      <p className="text-sm leading-snug font-medium">{fact.title}</p>
      <p className="text-xs text-muted-foreground">
        {domains[fact.domain]?.name} - checked by {fact.checkedBy}, {fact.checkedOn}
      </p>
      <p className="line-clamp-3 text-sm text-muted-foreground">{plainText(fact.summary)}</p>
      <SourceLinks fact={fact} />
      <Button
        variant="ghost"
        className="-ml-3 w-fit text-primary"
        {...ahead(fact.id)}
        onClick={() => openDock('context', fact.id)}
      >
        Open it
      </Button>
    </>
  )
}

/** In a source's card: the links an agent can follow from it, a retired one marked. */
function SourceLinks({ fact }: { fact: Fact }) {
  const related = useRelated(`context:${fact.id}`)
  const links = related.links.filter((l) => l.rel !== 'mentioned_by' && l.rel !== 'replaced_by')
  if (!links.length) return null
  return (
    <div className="flex flex-col gap-1 border-t pt-1.5">
      <p className="text-xs text-muted-foreground">Links an agent can follow from it</p>
      <p className="flex flex-wrap items-center gap-1">
        {links.slice(0, 4).map((l) => (
          <MentionChip key={l.to.id} mention={{ id: l.to.id, label: l.to.label }} />
        ))}
        {links.length > 4 && (
          <span className="text-xs text-muted-foreground">+{links.length - 4}</span>
        )}
      </p>
    </div>
  )
}

/**
 * Which sentences come from the items that disagree (`conflict`, their ids): each is marked as
 * words that differ, unless every sentence would be, when none is.
 */
function differingSentences(
  sentences: ReturnType<typeof sentencesOf>,
  facts: Fact[],
  conflict: string[] | undefined,
) {
  const differs = sentences.map((s) =>
    s.cites.some((n) => !!conflict?.includes(facts[n - 1]?.id ?? '')),
  )
  return marksExceptions(differs, (d) => d) ? differs : differs.map(() => false)
}

/**
 * A finished answer's sentences, each one a way to see where it says that: selected, the right panel
 * walks it back to its context item and the source line. Its numbers stay as markers inside it.
 * In a conflict, the sentences from the items that disagree (`conflict`, their ids) are marked as
 * the ones that differ, unless every sentence is.
 */
/** How a word comes in as it is revealed: a fade, none with reduced motion (the tokens). */
const wordIn = 'animate-in fade-in-0 duration-(--ask-word-fade)'
/** How a sentence comes in whole (`ASK_CADENCE` sentences): a fade, none with reduced motion. */
const sentenceIn = 'animate-in fade-in-0 duration-(--dur-3)'

/**
 * An answer's words, the same from its first revealed word to the finished answer, so nothing is
 * drawn again when it ends. Only the first `revealed` characters show, word by word; a sentence's
 * citation markers come with its last word. With `where`, once finished, each sentence opens where
 * it says that in the right panel; and the sentences from two items that disagree sit together
 * behind an amber rule, as they arrive.
 */
function AnswerWords({
  sentences,
  revealed,
  facts,
  conflict,
  answerId,
  where,
  live,
  draft,
}: {
  sentences: Sentence[]
  revealed: number
  facts: Fact[]
  conflict?: string[]
  answerId: string
  /** Each sentence opens where it says that (not in a draft, or Ask in the right panel). */
  where: boolean
  /** Still being revealed: words fade in, and nothing opens yet. */
  live: boolean
  draft?: boolean
}) {
  const dock = useDock()
  const { query } = useRoute()
  const open = dock?.kind === 'where' && dock.id === answerId ? Number(query.get('wn')) || 1 : 0
  const show = (n: number) => openDock('where', answerId, { wn: String(n) })
  // Where each sentence's words end, counted over the sentences joined by spaces.
  const placed = sentences.reduce<
    (Sentence & { start: number; words: { word: string; end: number }[] })[]
  >((all, s) => {
    const prev = all.at(-1)
    const start = prev ? prev.start + prev.text.length + 1 : 0
    const words = [...s.text.matchAll(/\S+/g)].map((m) => ({
      word: m[0],
      end: start + m.index + m[0].length,
    }))
    return [...all, { ...s, start, words }]
  }, [])
  const shown = placed.filter((s) => s.words.length && s.words[0]!.end <= revealed)
  const marked = differingSentences(shown, facts, conflict)
  const first = marked.indexOf(true)
  const last = marked.lastIndexOf(true)
  const fade = ASK_CADENCE === 'words' ? wordIn : undefined
  const sentence = (s: (typeof placed)[number], i: number) => {
    const done = s.words.at(-1)!.end <= revealed
    const words = s.words.map((w, k) =>
      w.end <= revealed ? (
        <React.Fragment key={k}>
          {k > 0 && ' '}
          <span className={live ? fade : undefined}>{w.word}</span>
        </React.Fragment>
      ) : null,
    )
    const cites = done
      ? s.cites.map((n) =>
          where ? (
            <span
              key={n}
              aria-hidden
              className={cn(
                'ml-1 inline-flex h-5 min-w-5 -translate-y-px items-center justify-center rounded-md bg-muted px-1 align-middle text-xs font-medium text-foreground tabular-nums',
                live && fade,
              )}
            >
              {n}
            </span>
          ) : (
            <Citation key={n} n={n} fact={facts[n - 1]} draft={draft} />
          ),
        )
      : null
    const sentenceClass = live && ASK_CADENCE === 'sentences' ? sentenceIn : undefined
    if (!where)
      return (
        <span key={i} className={sentenceClass}>
          {words}
          {cites}
        </span>
      )
    // Only a sentence with a source behind it opens: there is nothing to show for Ask's own words.
    const opens = !live && done && s.cites.length > 0
    const pressed = opens && open === i + 1
    // A second press puts the sources away again.
    const toggle = () => (pressed ? closeDock() : show(i + 1))
    return (
      <span
        key={i}
        role={opens ? 'button' : undefined}
        tabIndex={opens ? 0 : undefined}
        aria-pressed={opens ? pressed : undefined}
        onClick={opens ? toggle : undefined}
        onKeyDown={
          opens
            ? (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                toggle()
              }
            : undefined
        }
        className={cn(
          sentenceClass,
          'rounded-xs box-decoration-clone transition-colors outline-none',
          // py-1: an inline box is its font's height (about 19px), so one that fits a line is under the
          // 24px target size; the padding makes it 24px or more and leaves the line height alone.
          opens &&
            'cursor-pointer py-1 decoration-muted-foreground/40 underline-offset-4 hover:underline focus-visible:underline focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:bg-primary/12 dark:aria-pressed:bg-primary/25',
        )}
      >
        {words}
        {cites}
        {done && (
          <span className="sr-only">
            {s.cites.length
              ? `, from ${s.cites.map((n) => facts[n - 1]?.title ?? `source ${n}`).join(' and ')}`
              : ", Ask's own wording"}
            {marked[i] && ', which says something different from another item'}
          </span>
        )}
      </span>
    )
  }
  // Sentences in their paragraphs: a sentence that starts one begins a new block.
  const paragraph = (from: number, to: number) => (
    <p key={from}>
      {shown.slice(from, to).map((s, j) => (
        <React.Fragment key={from + j}>
          {j > 0 && ' '}
          {sentence(s, from + j)}
        </React.Fragment>
      ))}
    </p>
  )
  const run = (from: number, to: number) => {
    const starts = [
      from,
      ...shown.slice(from + 1, to).flatMap((s, j) => (s.starts ? [from + 1 + j] : [])),
    ]
    if (starts.length === 1) return paragraph(from, to)
    return (
      <div className="flex flex-col gap-3">
        {starts.map((at, k) => paragraph(at, starts[k + 1] ?? to))}
      </div>
    )
  }
  if (first < 0) return run(0, shown.length)
  return (
    <div className="flex flex-col gap-4">
      {first > 0 && run(0, first)}
      {/* The one mark on the sentences that differ: an amber rule, the words plain. The badge's card
          says which two items disagree. */}
      <div data-differ className="border-l-2 border-caution pl-3.5">
        {run(first, last + 1)}
      </div>
      {last < shown.length - 1 && run(last + 1, shown.length)}
    </div>
  )
}

/**
 * One source under the words: the one chip, numbered as its markers, with its kind's icon and its
 * title. Hovered or focused, its card; pressed, the item opens in the right panel. An answer from a
 * draft has nothing to open.
 */
function SourceChip({
  n,
  fact,
  draft,
  card: hasCard = true,
}: {
  n: number
  fact: Fact
  draft?: boolean
  /** Its card on hover; off inside another card. */
  card?: boolean
}) {
  const [card, setCard] = React.useState(false)
  const ahead = useReadAhead()
  const Icon = kindIcons[fact.kind]
  const chip =
    'inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-sm bg-muted pr-2 pl-1.5 text-xs font-medium @lg:max-w-70'
  const label = (
    <>
      <span className="text-muted-foreground tabular-nums">{n}</span>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />{' '}
      <span className="truncate">{fact.title}</span>
    </>
  )
  if (draft) return <span className={chip}>{label}</span>
  const press = cn(
    chip,
    'transition-colors outline-none hover:bg-foreground/10 focus-visible:ring-3 focus-visible:ring-ring/50',
  )
  if (!hasCard)
    return (
      <button
        type="button"
        aria-label={`Source ${n}: ${fact.title}`}
        {...ahead(fact.id)}
        onClick={() => openDock('context', fact.id)}
        className={press}
      >
        {label}
      </button>
    )
  return (
    <Popover
      open={card}
      // A press opens the item itself; the card is for a look on the way.
      onOpenChange={(open, { reason }) => reason !== 'trigger-press' && setCard(open)}
    >
      <PopoverTrigger
        openOnHover
        delay={120}
        closeDelay={80}
        render={
          <button
            type="button"
            aria-label={`Source ${n}: ${fact.title}`}
            {...ahead(fact.id)}
            onClick={() => openDock('context', fact.id)}
            className={press}
          />
        }
      >
        {label}
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 gap-1.5 p-3">
        <SourceCard fact={fact} />
      </PopoverContent>
    </Popover>
  )
}

/** What became of your report, in this chat only: sent, then what the owners did. */
export function ReportLine({
  report,
  focus,
}: {
  report: NonNullable<Answer['report']>
  /** Sent from the form under the answer: focus comes here, where the form was. */
  focus?: boolean
}) {
  const line = React.useRef<HTMLParagraphElement>(null)
  React.useEffect(() => {
    if (focus) line.current?.focus({ preventScroll: true })
  }, [focus])
  return (
    <p
      ref={line}
      role="status"
      tabIndex={focus ? -1 : undefined}
      className="flex animate-in items-start gap-2 text-sm text-muted-foreground duration-(--dur-4) fade-in-0 outline-none"
    >
      <FlagIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {report.outcome ?? (
          <>
            You reported this {report.on}. The owners see it in their Inbox; you'll see here what
            they do. Agents keep getting the item until it changes.
          </>
        )}
      </span>
    </p>
  )
}

const ReportForm = React.lazy(() =>
  import('@/components/footnote/report-panel').then((m) => ({ default: m.ReportForm })),
)

/**
 * Something wrong? under the answer, where Ask is itself in the right panel: the same form as the
 * panel beside an answer (report-panel.tsx), which comes with its own code.
 */
export function SomethingWrong({
  onSent,
  ...props
}: {
  answer: Answer
  facts: Fact[]
  onClose: () => void
  onSent: () => void
}) {
  return (
    <React.Suspense fallback={null}>
      <ReportForm {...props} onSent={() => onSent()} />
    </React.Suspense>
  )
}

/**
 * What the definition source says a metric means, beside the answer, as agents get it with theirs
 * (FR-703). The source's own words, labelled as its; the state stays the context's.
 */
function AnswerDefinitions({ definitions }: { definitions: AskedDefinition[] }) {
  return (
    <div className="flex flex-col gap-2">
      {definitions.map((d) => (
        <figure
          key={d.name}
          className="flex flex-col gap-1 rounded-surface border bg-background px-3 py-2.5 text-sm"
        >
          <figcaption className="text-xs text-muted-foreground">
            <a
              href={`/definitions/${encodeURIComponent(d.name)}`}
              className="rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {d.name}
            </a>
            , as {d.tool} defines it
          </figcaption>
          {d.words ? (
            <blockquote className="text-pretty">{d.words}</blockquote>
          ) : (
            <p className="text-muted-foreground">{d.tool} gives no description of it.</p>
          )}
        </figure>
      ))}
    </div>
  )
}

/** The next step that fits the state: for the owner, or for everyone else. */
export function NextStep({ answer, facts }: { answer: Answer; facts: Fact[] }) {
  const me = useMe()
  const write = useWrite()
  const owns = me.owns.includes('sales') || me.admin
  const scope = scopeText({ metric: answer.metric, markets: answer.markets.slice(-1) })
  if (answer.state === 'missing' || answer.state === 'partial') {
    if (!owns) return null
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {owns && (
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <a
                href={href('/context/new', {
                  metric: answer.metric,
                  market: answer.markets.at(-1),
                  dates: answer.dates,
                })}
              />
            }
          >
            <PencilIcon data-icon="inline-start" />
            {scope ? `Write context for ${scope}` : 'Write context'}
          </Button>
        )}
      </div>
    )
  }
  // The two items that disagree, side by side, and the way to the comparison: never another item
  // the answer also gives.
  if (answer.state === 'conflict' && answer.conflict?.length === 2) {
    return <ConflictNextStep pairKey={answer.conflict.join('.')} />
  }
  if (answer.state === 'stale') {
    const f = facts.find((x) => x.outOfDate) ?? facts[0]
    if (!f) return null
    return owns ? (
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() =>
            void write('editItem', {
              id: f.id,
              patch: {
                status: 'Live',
                outOfDate: undefined,
                checkedBy: me.name,
                checkedOn: dateLabel(today()),
              },
            }).then(() =>
              toast('Checked: still true', {
                description: 'Agents get it without the warning from now on.',
              }),
            )
          }
        >
          Mark it still true
        </Button>
        <Button
          variant="ghost"
          nativeButton={false}
          render={<a href={href(`/context/${f.id}/edit`)} />}
        >
          Edit
        </Button>
        <span className="basis-full text-xs text-muted-foreground">
          Its check date passed. Mark it still true if it is, and the warning goes.
        </span>
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">Its owner can check it.</p>
    )
  }
  return null
}

const RELATED_SHOWN = 4

/** Items that apply to the scope but not to this question: named, not used. One row each, 44px tall on a touch screen. */
export function Related({ ids }: { ids: string[] }) {
  const all = useFacts()
  const domains = useDomains()
  const ahead = useReadAhead()
  const [everything, setAll] = React.useState(false)
  const items = [...new Set(ids)]
    .map((id) => all.find((f) => f.id === id))
    .filter((f): f is Fact => !!f)
  const shown = everything ? items : items.slice(0, RELATED_SHOWN)
  const titles = new Map<string, number>()
  for (const f of items) titles.set(f.title, (titles.get(f.title) ?? 0) + 1)
  return (
    <div className="text-xs text-muted-foreground">
      <p>Also related, not used here:</p>
      <ul className="mt-0.5 flex flex-col pointer-coarse:gap-0.5">
        {shown.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-x-2">
            <button
              type="button"
              className="flex min-h-7 items-center rounded-sm text-left text-foreground underline decoration-foreground/25 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-11"
              {...ahead(f.id)}
              onClick={() => openDock('context', f.id)}
            >
              {f.title}
            </button>
            {titles.get(f.title)! > 1 ? (
              <span>
                {[domains[f.domain]?.name, f.checkedOn ? `checked ${f.checkedOn}` : undefined]
                  .filter(Boolean)
                  .join(' - ')}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {items.length > RELATED_SHOWN && !everything ? (
        <button
          type="button"
          className="mt-0.5 flex min-h-7 items-center rounded-sm underline decoration-foreground/25 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-11"
          onClick={() => setAll(true)}
        >
          Show {items.length - RELATED_SHOWN} more
        </button>
      ) : null}
    </div>
  )
}

type AnswerBodyProps = {
  /** The question and its answer, as far as the look-up has got. */
  turn: Turn
  draft?: Fact
  /** Ask is itself in the right panel: what would open there opens in place. */
  docked?: boolean
  onRetry?: () => void
  /** Sends one of a question back's choices as the person's reply: the chat's last answer only. */
  onAsk?: (question: string) => void
  /** Told while the turn's words are still on their way to the screen, and when the last shows. */
  onRevealing?: (id: string, revealing: boolean) => void
  /** The chat's last answer: its actions always show, and it can be asked again from them. */
  latest?: boolean
}

/**
 * For a question about what a metric is, its definition as the answer itself: the source's own
 * words at the answer's size, and where they come from, which opens it in Definitions. Never a
 * model's words (FR-703).
 */
function DefinitionLead({
  definitions,
  ref,
}: {
  definitions: AskedDefinition[]
  ref?: React.Ref<HTMLDivElement>
}) {
  return (
    <div ref={ref} data-answer-definition className="flex max-w-reading flex-col gap-4">
      {definitions.map((d) => (
        <figure key={d.name} className="flex flex-col gap-1">
          {d.words ? (
            <blockquote className="text-base leading-chat text-pretty">{d.words}</blockquote>
          ) : (
            <p className="text-base leading-chat text-muted-foreground">
              {d.tool} gives no description of it.
            </p>
          )}
          <figcaption className="text-sm text-muted-foreground">
            From {d.tool},{' '}
            <a
              href={`/definitions/${encodeURIComponent(d.name)}`}
              className="rounded-sm text-foreground underline decoration-muted-foreground/50 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {d.name}
            </a>
          </figcaption>
        </figure>
      ))}
    </div>
  )
}

/**
 * An answer in the chat: a turn of Ask's loop, drawn by its own body; or an answer it could not
 * give, a draft's preview, or nothing shared yet, with its state and sources.
 */
export function AnswerBody(props: AnswerBodyProps) {
  if (props.turn.error) return <Unanswered error={props.turn.error} onRetry={props.onRetry} />
  // Ask's loop: from its first read's step to its answer, drawn by its own body.
  if (drawnByLoop(props.turn))
    return (
      <React.Suspense
        fallback={<ReadingLine running>{props.turn.working ?? 'Reading…'}</ReadingLine>}
      >
        <LoopAnswerBody parts={loopAnswerParts()} {...props} />
      </React.Suspense>
    )
  return <ContextAnswerBody {...props} />
}

/** Questions to press, each sent as the next question; on an earlier turn they only show. */
function QuestionChoices({
  choices,
  onAsk,
}: {
  choices: readonly string[]
  onAsk: ((question: string) => void) | undefined
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {choices.map((choice) =>
        onAsk ? (
          <Button key={choice} variant="outline" onClick={() => onAsk(choice)}>
            {choice}
          </Button>
        ) : (
          <span
            key={choice}
            className="rounded-full border px-3 py-1 text-sm text-muted-foreground"
          >
            {choice}
          </span>
        ),
      )}
    </div>
  )
}

/** A question that got nothing back: it says so, and can be asked again. */
function Unanswered({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
      <span className="flex items-center gap-2">
        <CircleAlertIcon className="size-4 shrink-0" aria-hidden />
        {error}
      </span>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          <RefreshCwIcon data-icon="inline-start" />
          Ask again
        </Button>
      )}
    </div>
  )
}

function ContextAnswerBody({
  turn,
  draft,
  onRetry,
  onAsk,
  docked,
  onRevealing,
  latest,
}: AnswerBodyProps) {
  const { answer, stopped } = turn
  // A Conflict's pair is read while the answer is still being written, so it shows with the rest
  // of the finished answer and nothing below it moves once it is in view.
  const queryClient = useQueryClient()
  const pairKey =
    answer.state === 'conflict' && answer.conflict?.length === 2 ? answer.conflict.join('.') : null
  React.useEffect(() => {
    if (pairKey) void queryClient.prefetchQuery(conflictQuery(pairKey))
  }, [pairKey, queryClient])
  // The items it cites are read ahead once it is written, so their quick views open whole.
  useReadCitedAhead(answer.sources, !!latest && turn.stage === 'done')
  const all = useFacts()
  const facts = React.useMemo(
    () =>
      draft
        ? [draft]
        : answer.sources.flatMap((id) => {
            const f = all.find((x) => x.id === id)
            return f ? [f] : []
          }),
    [draft, answer.sources, all],
  )
  const key = answerKey(answer)
  // Something wrong? opens beside the answer, or under it where Ask is itself in the right panel.
  const dock = useDock()
  const [wrong, setWrong] = React.useState(false)
  const [sentNow, setSentNow] = React.useState(answer.report)
  const sentBeside = useReportSent(key)
  // A report the person sent about this answer, here or before: what the owners did comes back.
  const mine = useQuery({ ...myReportsQuery(), enabled: !draft }).data?.find(
    (r) => r.question.toLowerCase() === askedOf(answer).toLowerCase(),
  )
  const report = mine
    ? { on: mine.on, outcome: mine.outcome }
    : (sentNow ?? (sentBeside ? { on: 'just now' } : undefined))
  const canReport = !draft && facts.length > 0 && !report
  const reporting = docked ? wrong : dock?.kind === 'report' && dock.id === key
  const onWrong = (open: boolean, from?: HTMLElement | null) => {
    if (!canReport) return
    if (docked) setWrong(open)
    else if (open) openFromButton('report', key, from ?? null)
    else if (reporting) closeDock()
  }

  // Where the answer has got to: its labels held long enough to read, then the answer, whole.
  const shownStage = useShownStage(turn)
  const answered = shownStage === 'answered'
  const sentences = React.useMemo(
    () => sentencesOf(turn.stage === 'done' ? answer.text : ''),
    [turn.stage, answer.text],
  )
  // Where each sentence ends, in the characters the reveal counts (the sentences joined by spaces).
  const ends = sentences.reduce<number[]>(
    (all, sentence) => [...all, (all.at(-1) ?? -1) + 1 + sentence.text.length],
    [],
  )
  const total = answered ? (ends.at(-1) ?? 0) : 0
  const [limit, setLimit] = React.useState(total)
  const revealed = useReveal(limit, { instant: true })
  // Stopped, it finishes the sentence on screen, which was checked, and shows no more.
  const started = ends.findIndex((_, i) => (i ? ends[i - 1]! + 1 : 0) >= revealed)
  const upTo = stopped ? (started < 0 ? total : started ? ends[started - 1]! : 0) : total
  if (upTo !== limit) setLimit(upTo)
  const revealing = isLive(turn) || revealed < limit
  // The chat holds Stop and Escape until the last word shows, not only until the answer is in.
  // Before paint, so Ask never flashes in Stop's place as the answer comes in.
  const id = answer.id
  React.useLayoutEffect(() => {
    if (!revealing || !onRevealing) return
    onRevealing(id, true)
    return () => onRevealing(id, false)
  }, [revealing, onRevealing, id])
  const finished = turn.stage === 'done' && answered && !revealing && !stopped
  const writing = answered && isLive(turn) && !revealed
  const where = !draft && !docked && facts.length > 0
  // A finished answer is kept by its key, so the right panel can share it, report it or show where
  // it says that.
  const note = answer.note
  const key = answerKey(answer)
  React.useEffect(() => {
    if (finished && !draft) keepShown(key, { answer, facts })
  }, [finished, draft, key, answer, facts])
  // While the words are revealed a screen reader hears each sentence once it is whole, never word
  // by word; the words on screen are read once finished.
  const whole = sentences.filter((_, i) => ends[i]! <= revealed)

  // The words, which the state's card goes beside when the thread has room.
  const wordsRef = React.useRef<HTMLDivElement>(null)
  // A question about what a metric is leads with its definition, the source's words; the context
  // follows with its state. With no context the definition is the whole answer: a Definition mark
  // stands for Not found, and one quiet line says nothing else is written.
  const lead =
    !draft &&
    !!answer.definitions?.some((d) => d.words) &&
    asksWhatItIs(askedOf(answer), { values: answer.markets.length > 0, dates: !!answer.dates })
      ? answer.definitions
      : null
  const definitionOnly = !!lead && answer.state === 'missing'
  const leadRef = React.useRef<HTMLDivElement>(null)
  const defined = lead ? listOf(lead.map((d) => d.name)) : ''
  const copyText = lead
    ? [
        ...lead.map(
          (d) => `${d.name}, from ${d.tool}: ${d.words ?? `${d.tool} gives no description of it.`}`,
        ),
        definitionOnly ? `Nothing else is written about ${defined} yet.` : answer.text,
      ].join('\n\n')
    : answer.text
  // The two items that disagree, as the answer numbers them: named in the state's card.
  const disagree =
    answer.state === 'conflict'
      ? facts.flatMap((f, i) => (answer.conflict?.includes(f.id) ? [{ n: i + 1, fact: f }] : []))
      : []

  return (
    // Busy only until the engine's answer is in: from then on its words are read as they come.
    <div className="group/msg flex min-w-0 flex-col gap-4" aria-busy={isLive(turn) && !answered}>
      {/* While it works, what the look-up is doing, where the state will be. */}
      {!answered && <LookupCard answer={answer} facts={facts} turn={turn} shown={shownStage} />}
      {/* What the metric is, from its source: the answer, so it comes first. */}
      {answered && lead && (
        <div className="flex animate-in flex-col gap-4 duration-(--dur-3) fade-in-0">
          {!!answer.scope?.length && <ScopeLine answer={answer} />}
          {definitionOnly && (
            <DefinitionHelp names={lead.map((d) => d.name)} tool={lead[0]!.tool} words={leadRef} />
          )}
          <DefinitionLead definitions={lead} ref={leadRef} />
          {definitionOnly && (
            <p className="text-sm text-muted-foreground">
              Nothing else is written about {defined} yet.
            </p>
          )}
          {definitionOnly && note && <p className="text-sm text-muted-foreground">{note}</p>}
        </div>
      )}
      {answered &&
        !definitionOnly &&
        (answer.state !== null || note || (!lead && !!answer.scope?.length)) && (
          <div className="flex animate-in flex-col gap-2 duration-(--dur-3) fade-in-0">
            {!lead && <ScopeLine answer={answer} />}
            {/* The badge alone; what it means is its card, on hover, focus or a tap. */}
            {answer.state && (
              <StateHelp state={answer.state} draft={!!draft} words={wordsRef}>
                {disagree.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <p className="text-sm font-medium">These two disagree</p>
                    <div className="flex flex-wrap gap-1.5">
                      {disagree.map(({ n, fact }) => (
                        <SourceChip key={fact.id} n={n} fact={fact} draft={!!draft} card={false} />
                      ))}
                    </div>
                  </div>
                )}
              </StateHelp>
            )}
            {note && <p className="text-sm text-muted-foreground">{note}</p>}
          </div>
        )}
      {/* What the metric means, from its source, beside an answer about its data. */}
      {answered && !lead && answer.definitions && (
        <div className="animate-in duration-(--dur-3) fade-in-0">
          <AnswerDefinitions definitions={answer.definitions} />
        </div>
      )}
      {/* The words: a model's checked sentences as they come, revealed word by word, or the
            engine's own whole; drawn the same way from the first word to the end. */}
      {writing && !definitionOnly && (
        <p className="flex min-h-6 items-center">
          <ReadingLine running className="text-sm">
            Writing the answer…
          </ReadingLine>
        </p>
      )}
      {revealed > 0 && !definitionOnly && (
        <div
          ref={wordsRef}
          data-answer-words
          aria-hidden={revealing || undefined}
          aria-live="off"
          className={cn('max-w-reading text-base leading-chat', turn.asked > 0 && sentenceIn)}
        >
          <AnswerWords
            sentences={sentences}
            revealed={revealed}
            facts={facts}
            conflict={answer.state === 'conflict' ? answer.conflict : undefined}
            answerId={key}
            where={where}
            live={revealing}
            draft={!!draft}
          />
        </div>
      )}
      {revealing && !definitionOnly && (
        <p className="sr-only" aria-live="polite">
          {whole.map((sentence, i) => (
            <span key={i}>{sentence.text} </span>
          ))}
        </p>
      )}
      {/* A question back's readings, under it: the last one's send the choice as the reply. */}
      {answered && !!answer.choices?.length && (
        <QuestionChoices choices={answer.choices} onAsk={onAsk} />
      )}
      {/* The sources are the engine's, in with its answer; a model's words never change them. Then
            what was looked up, which opens What agents get. */}
      {answered && (
        <LookupCard answer={answer} facts={facts} turn={turn} shown={shownStage}>
          {facts.map((f, i) => (
            <SourceChip key={f.id} n={i + 1} fact={f} draft={!!draft} />
          ))}
        </LookupCard>
      )}
      {/* The chat's own status line says it was stopped (src/web/pages/ask.tsx). */}
      {stopped && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            <CircleStopIcon className="size-4 shrink-0" aria-hidden />
            Stopped{answered ? '. This is not a finished answer.' : ' before an answer.'}
          </span>
          {onRetry && (
            <Button variant="outline" onClick={onRetry}>
              <RefreshCwIcon data-icon="inline-start" />
              Ask again
            </Button>
          )}
        </div>
      )}
      {finished && (
        <div className="flex animate-in flex-col gap-4 delay-(--dur-3) duration-(--dur-4) fade-in-0 fill-mode-backwards slide-in-from-bottom-1">
          {(answer.state === 'failed' || answer.stopped) && onRetry && (
            <Button variant="outline" className="w-fit" onClick={onRetry}>
              <RefreshCwIcon data-icon="inline-start" />
              Ask again
            </Button>
          )}
          {answer.footer && (
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <AnswerFooter footer={answer.footer} />
            </div>
          )}
          {answer.related?.length ? <Related ids={answer.related} /> : null}
          {answer.state !== null && !draft && <NextStep answer={answer} facts={facts} />}
          {!draft && report && <ReportLine report={report} focus={!!sentNow && !answer.report} />}
          {docked && wrong && canReport && (
            <SomethingWrong
              answer={answer}
              facts={facts}
              onClose={() => setWrong(false)}
              onSent={() => {
                setWrong(false)
                setSentNow({ on: 'just now' })
              }}
            />
          )}
          <AnswerActions
            answer={answer}
            copyText={copyText}
            facts={facts}
            draft={!!draft}
            latest={latest}
            onRetry={onRetry}
            wrong={reporting}
            onWrong={onWrong}
            canReport={canReport}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Good and Bad answer (FR-712): a click counts the verdict, a second click on the same one takes
 * it back, and the other one takes it back and counts its own. The service keeps only the verdict,
 * the domain and the hour; the rating's id stays in this answer's memory, the one way back to it.
 */
function useRating(answer: Answer) {
  const write = useWrite()
  const [rated, setRated] = React.useState<Verdict | null>(null)
  const chain = React.useRef<RatingChain | null>(null)
  // The chain loads with the first click: most answers are never rated.
  const rate = (verdict: Verdict) => {
    void import('@/components/footnote/answer-rating').then((m) =>
      m.rate((chain.current ??= m.newChain()), verdict, answer, write, setRated, (t, d) =>
        toast.error(t, { description: d }),
      ),
    )
  }
  return { rated, rate }
}

/**
 * One row of icons under a finished answer: Copy, Good, Bad, Ask again on the chat's last answer,
 * and More with the rest (Something wrong?, Save question). The last answer always shows them; an
 * earlier one on hover or focus, and always on a touch screen. A chat is shared whole, from the
 * chat's header (FR-721), never one answer.
 */
export function AnswerActions({
  answer,
  copyText,
  facts,
  draft,
  latest,
  onRetry,
  wrong,
  onWrong,
  canReport,
}: {
  answer: Answer
  /** What Copy copies: the words on screen, the definition first when it leads. */
  copyText: string
  facts: Fact[]
  draft: boolean
  latest?: boolean
  onRetry?: () => void
  /** Whether Something wrong? is open for this answer. */
  wrong: boolean
  /** Opens Something wrong?, or closes it: from the button it was opened with, for focus. */
  onWrong: (wrong: boolean, from?: HTMLElement | null) => void
  canReport: boolean
}) {
  const { rated, rate } = useRating(answer)
  const [copied, copy] = useCopied()
  // Saving a question is for the owners of the domain it is about, and admins.
  const me = useMe()
  const domainsById = useDomains()
  const saveDomain = facts[0]?.domain ?? me.owns.find((d) => !domainsById[d]?.sandbox) ?? 'sales'
  const canSave = me.admin || me.owns.includes(saveDomain)
  // What More opened that needs a card of its own, beside the More button.
  const more = React.useRef<HTMLButtonElement>(null)
  const [opened, setOpened] = React.useState<'save' | null>(null)
  const save = !draft && !!answer.state && answer.state !== 'failed' && canSave
  const hasMore = canReport || save
  // A check that did not run has its own Ask again above, and nothing to rate, copy or report.
  if (answer.state === 'failed' && !copyText && !hasMore) return null
  return (
    <div
      role="group"
      aria-label="Answer actions"
      className={cn(
        '-ml-1.5 flex flex-wrap items-center gap-0.5 pointer-coarse:gap-2.5',
        !latest &&
          !opened &&
          'opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100 has-aria-expanded:opacity-100 pointer-coarse:opacity-100',
      )}
    >
      {copyText && (
        <IconButton
          label="Copy"
          onClick={() => {
            copy(copyText.replace(/\[\d+\]/g, ''))
            toast('Copied')
          }}
        >
          <CopiedIcon copied={copied} />
        </IconButton>
      )}
      {answer.state !== 'failed' && !draft && (
        <>
          <IconButton
            label="Good answer"
            active={rated === 'helpful'}
            onClick={() => rate('helpful')}
          >
            {rated === 'helpful' ? <CheckIcon /> : <ThumbsUpIcon />}
          </IconButton>
          {/* The door to Something wrong?: a bad answer counts, then asks the owners why. */}
          <IconButton
            label="Bad answer"
            active={rated === 'wrong'}
            onClick={(e) => {
              rate('wrong')
              if (rated !== 'wrong') onWrong(true, e.currentTarget)
            }}
          >
            <ThumbsDownIcon />
          </IconButton>
        </>
      )}
      {latest && onRetry && answer.state !== 'failed' && (
        <IconButton label="Ask again" onClick={onRetry}>
          <RefreshCwIcon />
        </IconButton>
      )}
      {hasMore && (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  ref={more}
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="More"
                      className="text-muted-foreground hover:text-foreground pointer-coarse:size-9"
                    />
                  }
                />
              }
            >
              <EllipsisIcon />
            </TooltipTrigger>
            <TooltipContent>More</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="w-auto">
            {canReport && (
              <DropdownMenuItem onClick={() => onWrong(!wrong, more.current)}>
                <FlagIcon />
                Something wrong?
              </DropdownMenuItem>
            )}
            {/* Keep checking this answer after every change: for the owners of its domain and admins. */}
            {save && (
              <DropdownMenuItem onClick={() => setOpened('save')}>
                <BookmarkIcon />
                Save question
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {opened === 'save' && (
        <SaveQuestion
          question={askedOf(answer)}
          domain={saveDomain}
          answer={answer}
          from={more}
          onClose={() => setOpened(null)}
        />
      )}
    </div>
  )
}

export function DraftBanner() {
  return (
    <div className="flex items-center gap-2 rounded-surface border border-dashed border-input px-3 py-2 text-sm">
      <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      Trying the draft. Agents don't get it yet.
    </div>
  )
}

/** Under a Conflict answer: the pair, compact, and Compare and decide (or Compare the two). */
function ConflictNextStep({ pairKey }: { pairKey: string }) {
  const pair = useQuery(conflictQuery(pairKey)).data
  if (!pair) return null
  const can = Object.values(pair.rights).some(Boolean)
  return (
    <div className="flex flex-col gap-3">
      <ConflictPairCompact pair={pair} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button variant="outline" onClick={() => openDock('conflict', pair.key)}>
          <ArrowLeftRightIcon data-icon="inline-start" />
          {can ? 'Compare and decide' : 'Compare the two'}
        </Button>
        <span className="text-xs text-muted-foreground">
          {can
            ? 'You can keep one, narrow one to where it applies, or keep both.'
            : 'See them side by side, and ask the owner.'}
        </span>
      </div>
    </div>
  )
}
