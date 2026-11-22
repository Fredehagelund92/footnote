import * as React from 'react'
import type {
  ChosenPeriodInput,
  DefinitionCard,
  FamilyShown,
  LoopBlock,
  LoopItem,
  LoopOverview,
  LoopRun,
  LoopTurn,
} from '@contract/answer'
import type { LucideIcon } from '@/components/icons'
import {
  CompactItemRow,
  ItemRow,
  LitSource,
  NounChip,
  PersonChip,
  SourceChip,
  Runs,
  dayText,
  runLength,
  useNeedsLook,
  statusWords,
  PartsContext,
  useParts,
  type LoopParts,
  type Nouns,
} from '@/components/footnote/loop-nouns'
import { useReveal } from '@/lib/ask-motion'
import type { Answer, QuestionPart } from '@/model/ask'
import type { Turn } from '@/model/ask-turn'
import type { Fact } from '@/model/items'

/*
  An answer of Ask's loop, as direction C draws it (FR-349, FR-718 to FR-720): the state and its
  fixed sentence on one line, the answer in one to three sentences with its nouns as chips, then
  the evidence code wrote from the reads in a fixed order (what disagrees, what was used, folded
  to one line, the closest written, who owns it), the next step, and one footer line that opens
  What Ask read.
  An overview is its groups. Everything but the model's own sentences is the service's, from the
  reads; this only draws it, and nothing here knows a dimension, a domain or a person by name.
*/

/** The most rows of the closest written shown before Show more. */
const CLOSEST_SHOWN = 4
/** The most rows of an overview's group shown before Show all. */
const GROUP_SHOWN = 4

type Props = {
  turn: Turn
  docked?: boolean
  onRetry?: () => void
  onAsk?: (question: string) => void
  latest?: boolean
}

/** The turn's nouns by id, and its items by their number as sources. */
function useMaps(loop: LoopTurn) {
  return React.useMemo(() => {
    const nouns: Nouns = new Map(loop.nouns.map((n) => [n.id, n]))
    const byId = new Map(loop.items.map((i) => [i.id, i]))
    const numbered = new Map<number, LoopItem>()
    loop.sources.forEach((id, i) => {
      const item = byId.get(id)
      if (item) numbered.set(i + 1, { ...item, n: i + 1 })
    })
    return { nouns, byId, numbered }
  }, [loop])
}

/* ---------- while it reads ---------- */

/** Each read as a step, the one under way moving; Stop and Escape stop it (the chat's own). */
export function LoopProgress({ turn }: { turn: Turn }) {
  const P = useParts()
  const reads = turn.reads
  const nouns: Nouns = React.useMemo(
    () => new Map((reads?.nouns ?? []).map((n) => [n.id, n])),
    [reads],
  )
  const steps = reads?.steps ?? []
  const done = steps.length > 0 && steps.every((s) => s.done)
  return (
    <ol className="flex flex-col gap-1.5 text-sm text-muted-foreground" aria-live="polite">
      {steps.map((s, i) => (
        <li key={i} className="flex items-center gap-2">
          {s.done ? (
            <P.CheckIcon aria-hidden className="size-4 shrink-0 text-good" />
          ) : (
            <span aria-hidden className="size-4 shrink-0" />
          )}
          {s.done ? (
            <span>
              <Runs runs={s.runs} nouns={nouns} items={new Map()} />
            </span>
          ) : (
            <P.ReadingLine running={!turn.stopped}>
              <Runs runs={s.runs} nouns={nouns} items={new Map()} />
            </P.ReadingLine>
          )}
        </li>
      ))}
      {/* Stopped, the notice under the reads says so, once. */}
      {!turn.stopped && (done || !steps.length) && (
        <li className="flex items-center gap-2">
          <span aria-hidden className="size-4 shrink-0" />
          <P.ReadingLine running={!turn.stopped}>
            {done ? 'Writing the answer…' : (turn.working ?? 'Reading…')}
          </P.ReadingLine>
        </li>
      )}
    </ol>
  )
}

/* ---------- under the question ---------- */

/**
 * How the question was read, under it: its nouns as chips and its days, and Change, which puts the
 * question back in the box with them; a follow-up says what it carried from the last question.
 * The days are a menu of other periods, each of which asks the question again at it (R12).
 */
/** How the question was read, under it, with Ask's parts (loop-parts.ts). */
export function LoopReadLine({
  parts,
  ...props
}: { parts: LoopParts } & React.ComponentProps<typeof ReadLine>) {
  return (
    <PartsContext.Provider value={parts}>
      <ReadLine {...props} />
    </PartsContext.Provider>
  )
}

function ReadLine({
  answer,
  onRescope,
  onReperiod,
}: {
  answer: Answer
  onRescope?: (parts: QuestionPart[]) => void
  onReperiod?: (period: ChosenPeriodInput) => void
}) {
  const P = useParts()
  const loop = answer.loop!
  const subject = loop.subject
  const nouns: Nouns = React.useMemo(() => new Map(loop.nouns.map((n) => [n.id, n])), [loop])
  if (!subject || (!subject.about.length && subject.assumedToday)) return null
  const about = subject.about.filter((id) => nouns.has(id))
  return (
    <p className="flex max-w-22/25 flex-wrap items-center justify-end gap-x-1.5 gap-y-1 text-right text-xs text-muted-foreground @lg:max-w-4/5">
      <span>{subject.carried ? 'Read with' : 'Read as'}</span>
      {/* Each dot stays with what it follows, so a line that wraps never starts with one. */}
      {about.map((id) => (
        <span key={id} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <NounChip id={id} nouns={nouns} />
          <span aria-hidden>·</span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <PeriodChip
          days={subject.assumedToday ? 'Today · assumed' : subject.period}
          onChoose={onReperiod}
        />
        {subject.note && <span aria-hidden>·</span>}
      </span>
      {subject.note && <span>{subject.note}</span>}
      {subject.carried && <span>carried from your last question</span>}
      {onRescope && (
        <button
          type="button"
          className="rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() =>
            onRescope([
              `${P.askedOf(answer)} `,
              ...about.flatMap((id) => {
                const label = nouns.get(id)?.name ?? id
                return [{ id: mentionOf(id, label), label }, ' ']
              }),
            ])
          }
        >
          {subject.carried ? 'Drop them' : 'Change'}
        </button>
      )}
    </p>
  )
}

/** The periods a question may be asked again at, in the menu's order. */
const PERIODS: readonly { label: string; period: ChosenPeriodInput }[] = [
  { label: 'Today', period: 'today' },
  { label: 'Any date', period: 'any date' },
  { label: 'Last month', period: 'last month' },
  { label: 'Last quarter', period: 'last quarter' },
  { label: 'Last year', period: 'last year' },
]

const periodRow =
  'flex w-full cursor-default items-center rounded-md px-1.5 py-1 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent pointer-coarse:py-2.5'

/**
 * The days the question was read at; with `onChoose`, a menu of other periods: each asks the
 * question again at it, and Pick dates at the days picked.
 */
function PeriodChip({
  days,
  onChoose,
}: {
  days: string
  onChoose?: ((period: ChosenPeriodInput) => void) | undefined
}) {
  const P = useParts()
  const [open, setOpen] = React.useState(false)
  const [picking, setPicking] = React.useState(false)
  const heading = React.useId()
  const pickRow = React.useRef<HTMLButtonElement>(null)
  const wasPicking = React.useRef(false)
  React.useEffect(() => {
    if (wasPicking.current && !picking) pickRow.current?.focus()
    wasPicking.current = picking
  }, [picking])
  const chip =
    'inline-flex items-center rounded-sm bg-muted px-1.5 py-px font-medium text-foreground'
  if (!onChoose) return <span className={chip}>{days}</span>
  const choose = (period: ChosenPeriodInput) => {
    setOpen(false)
    onChoose(period)
  }
  return (
    <P.Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setPicking(false)
      }}
    >
      <P.PopoverTrigger
        className={P.cn(
          chip,
          'gap-0.5 outline-none hover:bg-foreground/8 focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-foreground/8',
        )}
      >
        {days}
        <P.ChevronDownIcon aria-hidden className="size-3 text-muted-foreground" />
      </P.PopoverTrigger>
      <P.PopoverContent align="end" className={P.cn('gap-0 p-1', picking ? 'w-60' : 'w-44')}>
        {picking ? (
          <PeriodDays onPick={choose} onBack={() => setPicking(false)} />
        ) : (
          <div role="group" aria-labelledby={heading} className="flex flex-col">
            <p id={heading} className="px-1.5 pt-1 pb-1.5 text-xs text-muted-foreground">
              Ask it again at
            </p>
            {PERIODS.map((p) => (
              <button
                key={p.label}
                type="button"
                className={periodRow}
                onClick={() => choose(p.period)}
              >
                {p.label}
              </button>
            ))}
            <div aria-hidden className="-mx-1 my-1 h-px bg-border" />
            <button
              ref={pickRow}
              type="button"
              className={periodRow}
              onClick={() => setPicking(true)}
            >
              Pick dates
            </button>
          </div>
        )}
      </P.PopoverContent>
    </P.Popover>
  )
}

/**
 * Pick dates: the first day and the last, in the browser's own date fields, which a phone opens
 * as its own picker, and Ask at these dates. One day is the same day twice.
 */
function PeriodDays({
  onPick,
  onBack,
}: {
  onPick: (days: { from: string; to: string }) => void
  onBack: () => void
}) {
  const P = useParts()
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const ready = !!from && !!to && from <= to
  return (
    <form
      className="flex flex-col gap-2 pt-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) onPick({ from, to })
      }}
    >
      <label className="flex flex-col gap-1 px-1.5 text-xs text-muted-foreground">
        First day
        <P.Input
          autoFocus
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value)
            if (!to || e.target.value > to) setTo(e.target.value)
          }}
          className="text-foreground"
        />
      </label>
      <label className="flex flex-col gap-1 px-1.5 text-xs text-muted-foreground">
        Last day
        <P.Input
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => setTo(e.target.value)}
          className="text-foreground"
        />
      </label>
      <div className="flex items-center justify-between gap-2 border-t px-0.5 pt-1">
        <P.Button type="button" variant="ghost" onClick={onBack}>
          Back
        </P.Button>
        <P.Button type="submit" variant="secondary" disabled={!ready}>
          Ask at these dates
        </P.Button>
      </div>
    </form>
  )
}

/**
 * A noun's id as the composer's mention (src/web/lib/mentions.ts): a definition and a person by
 * name, a value and a domain by key, as the editor stores them.
 */
const mentionOf = (id: string, name: string) =>
  id.startsWith('metric:') || id.startsWith('dimension:') || id.startsWith('person:')
    ? `${id.slice(0, id.indexOf(':'))}:${name}`
    : id

/* ---------- the answer ---------- */

/**
 * The lines of each block that show: one sentence to a line, and the short lists' lines as they
 * are. Five sentences show before Show more (`all`), and a list whole up to twelve lines: a list is
 * what the person asked for (S19).
 */
function shownLines(body: readonly LoopBlock[], all: boolean) {
  const lines = body.map((b) => (b.t === 'p' ? sentencesOf(b.runs) : b.t === 'ul' ? b.items : []))
  const kept: number[] = []
  let sentences = 0
  for (const [i, b] of body.entries()) {
    const n = lines[i]!.length
    const cut = kept.some((k, j) => k < lines[j]!.length)
    const room = b.t === 'ul' ? LIST_SHOWN : Math.max(0, SENTENCES_SHOWN - sentences)
    kept.push(all ? n : cut ? 0 : Math.min(n, room))
    if (b.t === 'p') sentences += n
  }
  return body.map((_, i) => lines[i]!.slice(0, kept[i]))
}

/** The characters a line's runs take as the reveal counts them. */
const lineLength = (runs: readonly LoopRun[], nouns: Nouns) =>
  runs.reduce((n, r) => n + runLength(r, nouns), 0)

/** How many characters the words show before Show more: what the reveal types in (`Body` `upTo`). */
export const bodyLength = (body: readonly LoopBlock[], nouns: Nouns) =>
  shownLines(body, false)
    .flat()
    .reduce((n, runs) => n + lineLength(runs, nouns), 0)

/** How a block that is not words (a read's rows) comes in as the words reach it. */
const blockIn = 'animate-in fade-in-0 duration-(--dur-3)'

/**
 * The words as blocks: paragraphs, the model's short lists, and the lists of reads as rows. With
 * `upTo`, only that many characters of the words show (`bodyLength`), and a read's rows once the
 * words before them are in.
 */
function Body({
  body,
  nouns,
  numbered,
  byId,
  seen,
  upTo,
}: {
  body: readonly LoopBlock[]
  nouns: Nouns
  numbered: ReadonlyMap<number, LoopItem>
  byId: ReadonlyMap<string, LoopItem>
  seen: Set<string>
  upTo?: number
}) {
  const [all, setAll] = React.useState(false)
  const lines = shownLines(body, all)
  const total = body.reduce(
    (n, b) => n + (b.t === 'p' ? sentencesOf(b.runs).length : b.t === 'ul' ? b.items.length : 0),
    0,
  )
  const hidden = total - lines.reduce((n, l) => n + l.length, 0)
  // Where each block and each of its lines starts in the characters the reveal counts, and where
  // the words end.
  const blockAt: number[] = []
  const lineAt: number[][] = []
  let end = 0
  for (const block of lines) {
    blockAt.push(end)
    const starts: number[] = []
    for (const runs of block) {
      starts.push(end)
      end += lineLength(runs, nouns)
    }
    lineAt.push(starts)
  }
  const shows = (from: number) => upTo === undefined || from < upTo
  return (
    <div data-answer-words className="flex max-w-reading flex-col gap-3 text-base leading-chat">
      {body.map((b, i) => {
        if (b.t === 'list' || b.t === 'table' || b.t === 'code') {
          // A read's rows, a table and code come in whole once the words before them are in.
          if (upTo !== undefined && blockAt[i]! > upTo) return null
          const drawn =
            b.t === 'list' ? (
              <Rows
                key={i}
                items={b.rows.flatMap((id) => {
                  const item = byId.get(id)
                  return item ? [item] : []
                })}
                nouns={nouns}
                more={b.more}
              />
            ) : b.t === 'table' ? (
              <Table key={i} rows={b.rows} nouns={nouns} items={numbered} seen={seen} />
            ) : (
              <pre
                key={i}
                className="overflow-x-auto rounded-md bg-muted/50 p-2.5 font-mono text-xs leading-relaxed text-foreground"
              >
                <code>{b.text}</code>
              </pre>
            )
          return upTo === undefined ? (
            drawn
          ) : (
            <div key={i} className={blockIn}>
              {drawn}
            </div>
          )
        }
        const shown = lines[i]!.flatMap((runs, j) => {
          const from = lineAt[i]![j]!
          return shows(from)
            ? [{ runs, j, room: upTo === undefined ? undefined : upTo - from }]
            : []
        })
        if (!shown.length) return null
        const Line = b.t === 'p' ? 'p' : 'li'
        const rows = shown.map(({ runs, j, room }) => (
          <Line key={j}>
            <Runs runs={runs} nouns={nouns} items={numbered} seen={seen} upTo={room} />
          </Line>
        ))
        return b.t === 'p' ? (
          <div key={i} className="flex flex-col gap-1.5">
            {rows}
          </div>
        ) : b.start === undefined ? (
          <ul key={i} className="ml-6 list-disc space-y-1.5 marker:text-muted-foreground">
            {rows}
          </ul>
        ) : (
          <ol
            key={i}
            start={b.start}
            className="ml-6 list-decimal space-y-1.5"
          >
            {rows}
          </ol>
        )
      })}
      {hidden > 0 && (upTo === undefined || end <= upTo) && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="w-fit rounded-sm text-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Show {hidden} more
        </button>
      )}
    </div>
  )
}

/**
 * A short table the model wrote: its first row the heads, each cell's words drawn as a line's
 * are. It scrolls on its own when it is wider than the words, as on a phone.
 */
function Table({
  rows,
  nouns,
  items,
  seen,
}: {
  rows: readonly (readonly LoopRun[])[][]
  nouns: Nouns
  items: ReadonlyMap<number, LoopItem>
  seen: Set<string>
}) {
  const [head, ...body] = rows
  return (
    // Focusable, so a keyboard can scroll it when it is wider than the words.
    <div
      tabIndex={0}
      className="max-w-full overflow-x-auto rounded-md border outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <table className="w-full border-collapse text-sm leading-snug">
        <thead className="bg-muted/50">
          <tr>
            {head?.map((cell, j) => (
              <th key={j} scope="col" className="px-2.5 py-1.5 text-left align-bottom font-medium">
                <Runs runs={cell} nouns={nouns} items={items} seen={seen} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, k) => (
            <tr key={k} className="border-t">
              {row.map((cell, j) => (
                <td key={j} className="px-2.5 py-1.5 align-top">
                  <Runs runs={cell} nouns={nouns} items={items} seen={seen} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** How many sentences the words show before Show more, and how many lines of a list. */
const SENTENCES_SHOWN = 5
const LIST_SHOWN = 12

/**
 * A paragraph's runs as sentences: a sentence ends in a text run that ends in . ! or ?, and the
 * citations that follow it stay with it.
 */
function sentencesOf(runs: readonly LoopRun[]): LoopRun[][] {
  const out: LoopRun[][] = []
  let open: LoopRun[] = []
  let closed = false
  for (const run of runs) {
    if (closed && run.t === 'cite') {
      open.push(run)
      continue
    }
    if (closed) {
      out.push(open)
      open = []
      closed = false
    }
    open.push(run)
    if (run.t === 'text' && /[.!?]\s*$/.test(run.text)) closed = true
  }
  if (open.length) out.push(open)
  return out
}

/** Rows of items, each told apart from another with the same title. */
function Rows({
  items,
  nouns,
  more,
  shown = Infinity,
  moreLabel,
  compact,
}: {
  items: readonly LoopItem[]
  nouns: Nouns
  more?: number
  shown?: number
  moreLabel?: (n: number) => string
  /** One line a row: the number, the kind's icon and the title; the details on the number's card. */
  compact?: boolean
}) {
  const [all, setAll] = React.useState(false)
  const unique = items.filter((x, i) => items.findIndex((y) => y.id === x.id) === i)
  const titles = new Map<string, number>()
  for (const i of unique) titles.set(i.title, (titles.get(i.title) ?? 0) + 1)
  const visible = all ? unique : unique.slice(0, shown)
  const hidden = unique.length - visible.length
  return (
    <div className="flex flex-col gap-2">
      <ul className={compact ? 'flex flex-col gap-0.5' : 'flex flex-col gap-2.5'}>
        {visible.map((item) =>
          compact ? (
            <CompactItemRow key={item.id} item={item} />
          ) : (
            <ItemRow key={item.id} item={item} nouns={nouns} twin={titles.get(item.title)! > 1} />
          ),
        )}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="w-fit rounded-sm text-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {moreLabel ? moreLabel(hidden) : `Show ${hidden} more`}
        </button>
      )}
      {!!more && (
        <p className="text-xs text-muted-foreground">
          {more.toLocaleString('en-GB')} more {more === 1 ? 'was' : 'were'} found than listed.
        </p>
      )}
    </div>
  )
}

/** The most sources shown as chips before the rest fold behind +n. */
const SOURCES_SHOWN = 3

/**
 * What the answer rests on, as source chips under its words (the source chips): the first three
 * with their titles, the rest behind +n, so a reader sees what it rests on without a press. An item
 * that needs a look is never a chip: it stays under them, one line each, with what its owner can
 * do about it there.
 */
function Sources({
  items,
  owns,
}: {
  items: readonly LoopItem[]
  /** Whether the reader may mark what is due still true. */
  owns: boolean
}) {
  const needsLook = useNeedsLook()
  const [all, setAll] = React.useState(false)
  const look: LoopItem[] = []
  const rest: (LoopItem & { n: number })[] = []
  for (const i of items)
    if (needsLook(i)) look.push(i)
    else if (i.n) rest.push({ ...i, n: i.n })
  const shown = all ? rest : rest.slice(0, SOURCES_SHOWN)
  const hidden = rest.length - shown.length
  return (
    <div data-sources className="@container/sources flex max-w-reading flex-col gap-1.5">
      {rest.length > 0 && (
        <ul aria-label="Sources" className="flex flex-wrap items-center gap-1.5">
          {shown.map((item) => (
            <li key={item.id} className="flex max-w-full min-w-0">
              <SourceChip item={item} />
            </li>
          ))}
          {hidden > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setAll(true)}
                aria-label={`Show ${hidden} more ${hidden === 1 ? 'source' : 'sources'}`}
                className="inline-flex h-8 items-center rounded-md border px-2.5 text-sm font-medium tabular-nums transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                +{hidden}
              </button>
            </li>
          )}
        </ul>
      )}
      {look.length > 0 && (
        <ul data-pinned className="flex flex-col gap-0.5">
          {look.map((item) => (
            <PinnedRow key={item.id} item={item} owns={owns} />
          ))}
        </ul>
      )}
    </div>
  )
}

/** Whether a check of this item, due or out of date, is the reader's to say it still holds. */
const checkable = (item: LoopItem) =>
  item.status !== 'archived' && (item.status === 'due' || !!item.outOfDate)

/**
 * An item that needs a look, in one line, with what its owner can do about it there: say it is
 * still true. The row then reads as checked, as the item now is.
 */
function PinnedRow({ item, owns }: { item: LoopItem; owns: boolean }) {
  const [checked, setChecked] = React.useState(false)
  const shown = checked ? { ...item, status: 'live' as const, outOfDate: null } : item
  return (
    <CompactItemRow
      item={shown}
      action={
        checked ? (
          <CheckedStillTrue />
        ) : owns && checkable(item) ? (
          <>
            <span aria-hidden className="text-xs text-muted-foreground">
              ·
            </span>
            <MarkStillTrue inline item={item} onDone={() => setChecked(true)} />
          </>
        ) : null
      }
    />
  )
}

/** Says an item was just checked as still true, where its button was. */
function CheckedStillTrue() {
  const P = useParts()
  return (
    <span
      role="status"
      className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
    >
      <P.CheckIcon aria-hidden className="size-3.5 text-good" />
      Checked: still true
    </span>
  )
}

/**
 * Marks one item still true, as its owner. It names the item it marks, since an answer may have
 * more than one due. In a row it is words of the row's own size; under the answer, a button.
 */
function MarkStillTrue({
  item,
  onDone,
  inline,
}: {
  item: LoopItem
  onDone: () => void
  inline?: boolean
}) {
  const P = useParts()
  const me = P.useMe()
  const write = P.useWrite()
  const [sending, setSending] = React.useState(false)
  const press = {
    'aria-label': `Mark it still true: ${item.title}`,
    disabled: sending,
    onClick: () => {
      setSending(true)
      void write('editItem', {
        id: item.id,
        patch: { status: 'Live', outOfDate: undefined, checkedBy: me.name },
      }).then(
        () => onDone(),
        () => {
          setSending(false)
          P.toast.error('It was not marked still true', {
            description: 'Nothing changed: try again in a moment.',
          })
        },
      )
    },
  }
  if (!inline)
    return (
      <P.Button variant="outline" {...press}>
        Mark it still true
      </P.Button>
    )
  // Where the column is narrow, the words would cut the title to a few letters: its icon alone.
  return (
    <button
      type="button"
      {...press}
      className="relative -ml-1 inline-flex shrink-0 items-center rounded-sm px-1 text-xs font-medium text-foreground underline-offset-4 outline-none after:absolute after:-inset-x-1 after:-inset-y-2 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 disabled:text-muted-foreground @max-md/used:after:-inset-2"
    >
      <span className="@max-md/used:hidden">Mark it still true</span>
      <P.CheckIcon aria-hidden className="hidden size-4 @max-md/used:block" />
    </button>
  )
}

/** A small label over an evidence block, with its icon. */
const BlockLabel = ({ icon: Icon, children }: { icon?: LucideIcon; children: React.ReactNode }) => (
  <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
    {Icon && <Icon aria-hidden className="size-3.5" />}
    {children}
  </p>
)

/**
 * A subject as a sentence says it, with its chips: its metrics, then the values it narrowed,
 * "Orders in Poland"; the connecting word is the kind's, never a dimension's name.
 */
function Subject({ ids, nouns, still }: { ids: readonly string[]; nouns: Nouns; still?: boolean }) {
  const metrics = ids.filter((id) => !id.startsWith('value:'))
  const values = ids.filter((id) => id.startsWith('value:'))
  return (
    <>
      <Joined ids={metrics} nouns={nouns} still={still} />
      {metrics.length > 0 && values.length > 0 && ' in '}
      <Joined ids={values} nouns={nouns} still={still} />
    </>
  )
}

/** Names joined as a sentence says them: "A, B and C". */
function Joined({ ids, nouns, still }: { ids: readonly string[]; nouns: Nouns; still?: boolean }) {
  return (
    <>
      {ids.map((id, i) => (
        <React.Fragment key={id}>
          {i > 0 && (i === ids.length - 1 ? ' and ' : ', ')}
          <NounChip id={id} nouns={nouns} still={still} />
        </React.Fragment>
      ))}
    </>
  )
}

/** The two that disagree, side by side, and who decides which holds. */
function Disagree({ loop, maps }: { loop: LoopTurn; maps: ReturnType<typeof useMaps> }) {
  const P = useParts()
  const ahead = P.useReadAhead()
  const pair = loop.conflict.flatMap((id) => {
    const n = loop.sources.indexOf(id) + 1
    const item = maps.numbered.get(n)
    return item ? [item] : []
  })
  if (pair.length !== 2) return null
  const domains = [...new Set(pair.flatMap((i) => (i.domain ? [i.domain] : [])))]
  return (
    <div className="flex max-w-reading flex-col gap-2">
      <BlockLabel icon={P.TriangleAlertIcon}>These two disagree</BlockLabel>
      <div className="grid gap-2 @lg:grid-cols-2">
        {pair.map((item) => {
          const status = statusWords(item)
          return (
            <button
              key={item.id}
              type="button"
              {...ahead(item.id)}
              onClick={() => P.openDock('context', item.id)}
              className="flex flex-col gap-1.5 rounded-md border bg-background px-3 py-2.5 text-left text-sm transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="flex items-center gap-1.5 text-xs">
                <span className="text-muted-foreground tabular-nums">{item.n}</span>
                {item.domain && <NounChip id={item.domain} nouns={maps.nouns} still />}
              </span>
              <span className="font-medium">{item.title}</span>
              <span className="text-xs text-muted-foreground">
                {status.words}
                {status.day && `\u00a0· ${status.day}`}
              </span>
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
        {domains.length > 0 && (
          <span>
            Which one holds is for the owners of <Joined ids={domains} nouns={maps.nouns} /> to
            decide.
          </span>
        )}
        <P.Button variant="outline" onClick={() => P.openDock('conflict', loop.conflict.join('.'))}>
          <P.ArrowLeftRightIcon data-icon="inline-start" />
          Compare the two
        </P.Button>
      </div>
    </div>
  )
}

/** The people the words name: by their mention, or by their name in plain words. */
function namedIn(body: LoopTurn['body'], nouns: Nouns): Set<string> {
  const runs = body.flatMap((b) =>
    b.t === 'p' ? b.runs : b.t === 'ul' ? b.items.flat() : b.t === 'table' ? b.rows.flat(2) : [],
  )
  const words = runs.map((r) => (r.t === 'text' ? r.text : '')).join(' ')
  const named = new Set<string>()
  for (const r of runs) if (r.t === 'noun' && r.id.startsWith('person:')) named.add(r.id)
  for (const n of nouns.values())
    if (n.id.startsWith('person:') && words.includes(n.name)) named.add(n.id)
  return named
}

/**
 * Who owns the subject: "Orders is in Sales, owned by …", or each domain with its owners; only
 * the domains whose owners the words do not name already, so it adds something.
 */
function Owners({ loop, nouns }: { loop: LoopTurn; nouns: Nouns }) {
  const named = namedIn(loop.body, nouns)
  const all = loop.owners.filter((o) => o.people.length)
  const owned = all.filter((o) => !o.people.every((p) => named.has(p)))
  if (!owned.length) return null
  const metrics = (loop.subject?.about ?? []).filter((id) => id.startsWith('metric:'))
  return (
    <div className="flex max-w-reading flex-col gap-1 text-sm">
      {owned.map((o, i) => (
        <p key={o.domain}>
          {i === 0 && metrics.length === 1 && all.length === 1 ? (
            <>
              <NounChip id={metrics[0]!} nouns={nouns} /> is in{' '}
              <NounChip id={o.domain} nouns={nouns} />, owned by{' '}
            </>
          ) : (
            <>
              <NounChip id={o.domain} nouns={nouns} /> is owned by{' '}
            </>
          )}
          <Joined ids={o.people} nouns={nouns} />.
        </p>
      ))}
    </div>
  )
}

/** The closest written to a Not found's subject: counted by each value of the dimension it narrowed. */
function Closest({ loop, maps }: { loop: LoopTurn; maps: ReturnType<typeof useMaps> }) {
  const closest = loop.closest
  if (!closest?.items.length) return null
  const items = closest.items.flatMap((id) => maps.byId.get(id) ?? [])
  const metrics = (loop.subject?.about ?? []).filter((id) => id.startsWith('metric:'))
  return (
    <div className="flex max-w-reading flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <p className="text-xs leading-6 font-medium text-muted-foreground">
          Written nearest
          {metrics.length > 0 && (
            <>
              {' about '}
              <Joined ids={metrics} nouns={maps.nouns} />
            </>
          )}
          {closest.by && (
            <>
              {', by '}
              <NounChip id={closest.by} nouns={maps.nouns} />
            </>
          )}
        </p>
        {closest.counts.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
            {closest.counts.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1">
                <NounChip id={c.id} nouns={maps.nouns} />
                <span className="font-semibold tabular-nums">{c.count}</span>
              </span>
            ))}
          </p>
        )}
      </div>
      <Rows
        items={items}
        nouns={maps.nouns}
        shown={CLOSEST_SHOWN}
        moreLabel={(n) => `Show ${n} more`}
      />
    </div>
  )
}

/** What Ask read, folded under the footer: each read in code's words, and the reads by tool. */
function WhatAskRead({ loop, footer }: { loop: LoopTurn; footer: string[] }) {
  const P = useParts()
  return (
    <P.Collapsible className="flex flex-col gap-2 text-xs text-muted-foreground">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {footer.map((line, i) => (
          <span key={i}>{line}</span>
        ))}
        <P.FoldTrigger
          variant="inline"
          label="What Ask read"
          className="-ml-1 px-1 text-xs text-foreground"
        />
      </p>
      <P.CollapsibleContent>
        <div className="flex max-w-reading flex-col gap-2 rounded-frame border bg-background px-3.5 py-3 text-sm">
          {loop.read.length ? (
            <ul className="flex flex-col gap-1.5">
              {loop.read.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          ) : (
            <p>Nothing was read for this answer.</p>
          )}
          <p className="text-xs">
            Each read runs as you, so it sees only what your own pages show you. Earlier reads in
            this chat are read again before they are used.
          </p>
          {!!loop.reads.length && (
            <P.Collapsible>
              <P.FoldTrigger
                variant="inline"
                label="Developer details"
                className="mt-1 -ml-1 px-1 text-xs text-muted-foreground"
              />
              <P.CollapsibleContent>
                <pre className="mt-2 overflow-x-auto rounded-md bg-muted/50 p-2.5 font-mono text-xs leading-relaxed text-foreground">
                  {JSON.stringify({ reads: loop.reads, checks: loop.checks }, null, 2)}
                </pre>
              </P.CollapsibleContent>
            </P.Collapsible>
          )}
        </div>
      </P.CollapsibleContent>
    </P.Collapsible>
  )
}

/** Whether the reader owns what the answer is about, or is an admin: theirs to write or check. */
function useOwns(loop: LoopTurn) {
  const me = useParts().useMe()
  const owned = new Set(loop.owners.map((o) => o.domain.replace(/^domain:(area_)?/, '')))
  return me.admin || me.owns.some((d) => owned.has(d.replace(/^area_/, '')))
}

/** Names as a sentence says them: "A", "A and B", "A, B and C". */
const listed = (names: readonly string[]) =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/**
 * What is not written that the answer is about: the subject under Not found, and under Partial
 * what no item is about at all (`unwritten`), when the answer found nothing to cite (with sources, it is written in
 * part). Empty when the answer covers it, or names nothing a read named.
 */
const missingOf = (loop: LoopTurn, nouns: Nouns) =>
  (loop.state === 'partial' && !loop.sources.length
    ? (loop.subject?.unwritten ?? [])
    : loop.state === 'missing'
      ? (loop.subject?.about ?? [])
      : []
  ).filter((id) => nouns.has(id))

/**
 * Who a gap reaches: the owners of the subject's domains, by name, or the admins when no one owns
 * it or it is a word the workspace does not know (`toAdmins`). Said as the card says it, "Jon Abara and Sofia Brandt, the owners of Sales".
 */
function useTold(loop: LoopTurn, nouns: Nouns, toAdmins = false) {
  const P = useParts()
  const admins = P.usePeople().filter((p) => p.admin)
  const owned = toAdmins ? [] : loop.owners.filter((o) => o.people.length && nouns.has(o.domain))
  const people = [
    ...new Set(owned.flatMap((o) => o.people.map((id) => nouns.get(id)?.name ?? key(id)))),
  ]
  if (people.length) {
    const domains = listed(owned.map((o) => nouns.get(o.domain)!.name))
    return { people, role: `${people.length === 1 ? 'the owner' : 'the owners'} of ${domains}` }
  }
  const names = admins.map((a) => a.name)
  return { people: names, role: names.length === 1 ? 'an admin' : 'the admins' }
}

const key = (id: string) => id.slice(id.indexOf(':') + 1)

/** People by name, each as their chip, joined as a sentence says them: "A, B and C". */
function People({ names }: { names: readonly string[] }) {
  return (
    <>
      {names.map((name, i) => (
        <React.Fragment key={name}>
          {i > 0 && (i === names.length - 1 ? ' and ' : ', ')}
          <PersonChip name={name} />
        </React.Fragment>
      ))}
    </>
  )
}

/**
 * The gap prompt: a "nothing written" ends in something to press. Under Not found, and under
 * Partial for what no item covers, a dashed card says what is not written yet and offers its one
 * next step: to a reader who may write it, Write context for it; to anyone else, Tell the owner,
 * which reports the subject as missing to its owners' Inbox (decision 7 of the chat audit), its
 * metrics, values and days and nothing of the question, and then says who was told. For a word
 * the reads found nothing under (`unknown`), it is Tell an admin, which sends the word alone, or
 * to an admin, Add it to Definitions. Ask itself writes nothing.
 */
function GapCard({ loop, nouns, dates }: { loop: LoopTurn; nouns: Nouns; dates?: string }) {
  const P = useParts()
  const write = P.useWrite()
  const me = P.useMe()
  const owns = useOwns(loop)
  const [told, setTold] = React.useState(false)
  const [sending, setSending] = React.useState(false)
  const sentWords = React.useRef(new Set<string>())
  const about = missingOf(loop, nouns)
  const words = about.length ? [] : (loop.unknown ?? [])
  const to = useTold(loop, nouns, !about.length)
  if (!about.length && !words.length) return null
  const quoted = listed(words.map((w) => `“${w}”`))
  const said = about.length ? subjectWords(about, nouns) : quoted
  const mayWrite = about.length ? owns : me.admin
  const tell = () => {
    setSending(true)
    const sent = about.length
      ? [write('tellOwner', { about, ...(dates ? { dates } : {}) })]
      : words
          .filter((word) => !sentWords.current.has(word))
          .map((word) =>
            write('tellOwner', { about: [], word }).then(() => void sentWords.current.add(word)),
          )
    void Promise.allSettled(sent).then((results) => {
      if (results.every((r) => r.status === 'fulfilled')) setTold(true)
      else {
        setSending(false)
        P.toast.error("It wasn't sent", { description: 'Nothing was lost: try again in a moment.' })
      }
    })
  }
  const whom = to.people.length ? `${listed(to.people)}, ${to.role},` : `${to.role}`
  const Whom = `${whom.charAt(0).toUpperCase()}${whom.slice(1)}`
  const it = words.length > 1 ? 'these words' : 'this word'
  const line = about.length
    ? mayWrite
      ? 'No context item covers it yet. It is yours to write: agents get it once it is published.'
      : `No context item covers it yet. ${Whom} can write it.`
    : mayWrite
      ? `No metric, other name or context item uses ${it} yet. ${words.length > 1 ? 'They are' : 'It is'} yours to add.`
      : `No metric, other name or context item uses ${it} yet. ${Whom} can add ${words.length > 1 ? 'them' : 'it'}.`
  return (
    <section
      data-gap
      aria-label={`Not written yet: ${said}`}
      className="grid max-w-reading grid-cols-(--cols-lead-6) gap-x-1 gap-y-2.5 rounded-frame border border-dashed border-input py-3.5 pr-4 pl-3"
    >
      <P.CircleDashedIcon aria-hidden className="mt-1 size-4 text-muted-foreground" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-medium break-words">
          {about.length ? <Subject ids={about} nouns={nouns} /> : quoted}
        </p>
        {told ? (
          <p role="status" className="flex items-start gap-1.5 text-sm">
            <P.CheckIcon aria-hidden className="mt-1 size-4 shrink-0 text-good" />
            <span>
              Sent to{' '}
              {to.people.length ? (
                <>
                  <People names={to.people} />, {to.role}
                </>
              ) : (
                to.role
              )}
              . It waits in their Inbox.
            </span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{line}</p>
        )}
      </div>
      {!told && (
        <div className="col-start-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          {mayWrite ? (
            about.length ? (
              <P.Button
                variant="outline"
                nativeButton={false}
                aria-label={`Write context for ${said}`}
                render={
                  <a
                    href={P.href('/context/new', {
                      about: about.map((id) => nouns.get(id)!.name).join('|'),
                    })}
                  />
                }
              >
                <P.PencilIcon data-icon="inline-start" />
                Write context
              </P.Button>
            ) : (
              <P.Button
                variant="outline"
                nativeButton={false}
                render={<a href={P.href('/definitions/new')} />}
              >
                <P.BookOpenIcon data-icon="inline-start" />
                Add it to Definitions
              </P.Button>
            )
          ) : (
            <>
              <P.Button variant="outline" disabled={sending} onClick={tell}>
                <P.BellIcon data-icon="inline-start" />
                {about.length ? 'Tell the owner' : 'Tell an admin'}
              </P.Button>
              <span className="text-xs text-muted-foreground">
                {about.length
                  ? 'Only what it is about is sent, never your words.'
                  : `Only ${it} ${words.length > 1 ? 'are' : 'is'} sent, never your question.`}
              </span>
            </>
          )}
        </div>
      )}
    </section>
  )
}

/** A subject in plain words, as `Subject` says it with chips: "Orders in Poland". */
const subjectWords = (ids: readonly string[], nouns: Nouns) => {
  const name = (id: string) => nouns.get(id)?.name ?? key(id)
  const metrics = listed(ids.filter((id) => !id.startsWith('value:')).map(name))
  const values = listed(ids.filter((id) => id.startsWith('value:')).map(name))
  return metrics && values ? `${metrics} in ${values}` : metrics || values
}

/**
 * What to do next that fits the state, beside the gap card (`GapCard`), which offers what is not
 * written: under Partial with sources, its owner writes the part no item covers; under Outdated,
 * they check what may be old, when no row of Sources already offers it.
 */
function Next({
  loop,
  nouns,
  items,
}: {
  loop: LoopTurn
  nouns: Nouns
  /** The items used that no row of Sources pins: a check of one of them is offered here. */
  items: readonly LoopItem[]
}) {
  const P = useParts()
  const owns = useOwns(loop)
  if (loop.state === 'partial' && loop.sources.length) {
    const about = (loop.subject?.uncovered ?? []).filter((id) => nouns.has(id))
    if (!owns || !about.length) return null
    return (
      <P.Button
        variant="outline"
        className="w-fit"
        nativeButton={false}
        render={
          <a
            href={P.href('/context/new', {
              about: about.map((id) => nouns.get(id)!.name).join('|'),
            })}
          />
        }
      >
        <P.PencilIcon data-icon="inline-start" />
        Write context for <Subject ids={about} nouns={nouns} still />
      </P.Button>
    )
  }
  if (loop.state !== 'stale') return null
  const f = items.find(checkable)
  if (!f || !owns) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <MarkStillTrue
        item={f}
        onDone={() =>
          P.toast('Checked: still true', {
            description: 'Agents get it without the warning from now on.',
          })
        }
      />
      <P.Button
        variant="ghost"
        nativeButton={false}
        render={<a href={P.href(`/context/${f.id}/edit`)} />}
      >
        Edit
      </P.Button>
    </div>
  )
}

/**
 * The definition card, for an answer about what something is: the definition's chip and what it
 * is, the source's own words at the answer's size, then two quiet lines on where the words come
 * from and who owns it, and the context about it, which opens in the card. With the words of the
 * answer giving the same definition, the card stands in for them.
 */
function DefinitionCards({ loop, maps }: { loop: LoopTurn; maps: ReturnType<typeof useMaps> }) {
  const cards = loop.defined?.cards ?? []
  if (!cards.length) return null
  return (
    <div
      className={cards.length > 1 ? 'grid max-w-reading gap-3 @lg:grid-cols-2' : 'max-w-reading'}
    >
      {cards.map((c) => (
        <DefinitionCardOf key={c.id} card={c} maps={maps} />
      ))}
    </div>
  )
}

const kindWord = { metric: 'Metric', dimension: 'Dimension', term: 'Word' } as const

/** What a card says a definition is: "Metric", "Family of 2 metrics, by Currency". */
const kindOf = (card: DefinitionCard) =>
  card.family
    ? `Family of ${card.family.variants.toLocaleString('en-GB')} metrics, by ${listed(card.family.by)}`
    : kindWord[card.kind]

/**
 * A family's definition as an answer shows it (FR-142): its meaning, then the own words of its
 * variants that say something else or how they are worked out, each after its values. `mark` is
 * marked where it first shows.
 */
function FamilyDefinition({
  family,
  mark,
  className,
}: {
  family: FamilyShown
  mark?: string
  className?: string
}) {
  const parts = [family.meaning ?? '', ...family.own.map((o) => o.words)]
  const marked = mark ? parts.findIndex((p) => p.toLowerCase().includes(mark.toLowerCase())) : -1
  const words = (text: string, at: number) =>
    at === marked ? <Marked words={text} mark={mark!} /> : text
  return (
    <div className={className}>
      {family.meaning ? (
        <p>{words(family.meaning, 0)}</p>
      ) : (
        <p className="text-muted-foreground">No meaning yet: its variants say different things.</p>
      )}
      {family.own.length > 0 && (
        <ul aria-label="In its variants’ own words" className="mt-2 flex flex-col gap-1.5 text-sm">
          {family.own.map((o, i) => (
            <li key={o.values.join(', ')}>
              <span className="font-medium">{o.values.join(', ')}</span>
              {': '}
              {words(o.words, i + 1)}
            </li>
          ))}
        </ul>
      )}
      {family.more > 0 && (
        <p className="mt-1.5 text-sm text-muted-foreground">
          {family.more.toLocaleString('en-GB')} more{' '}
          {family.more === 1 ? 'has words of its' : 'have words of their'} own.
        </p>
      )}
    </div>
  )
}

function DefinitionCardOf({
  card,
  maps,
}: {
  card: DefinitionCard
  maps: ReturnType<typeof useMaps>
}) {
  const P = useParts()
  const [open, setOpen] = React.useState(false)
  const title = React.useId()
  const rows = card.context.items.flatMap((id) => maps.byId.get(id) ?? [])
  const count = card.context.count
  const items = `${count.toLocaleString('en-GB')} context ${count === 1 ? 'item' : 'items'}`
  return (
    <article
      data-definition-card
      aria-labelledby={title}
      className="flex min-w-0 flex-col rounded-frame border bg-card"
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-3.5">
        <span id={title} className="contents">
          {maps.nouns.has(card.id) ? (
            <NounChip id={card.id} nouns={maps.nouns} />
          ) : (
            <span className="text-sm font-medium">{card.name}</span>
          )}
        </span>
        <span className="text-xs text-muted-foreground">
          {kindOf(card)}
          {card.group && ` in the ${card.group} group`}
        </span>
      </header>
      {card.family ? (
        <blockquote className="px-4 pt-2.5 text-base leading-chat text-pretty">
          <FamilyDefinition family={card.family} />
        </blockquote>
      ) : (
        card.words && (
          <blockquote className="px-4 pt-2.5 text-base leading-chat text-pretty">
            {card.words}
          </blockquote>
        )
      )}
      <div className="mx-4 mt-3 flex flex-col gap-1 border-t pt-3 text-sm text-muted-foreground">
        <p>
          From {card.tool}
          {card.member && (
            <>
              {', as '}
              <code className="rounded-xs bg-muted px-1 py-px font-mono text-xs text-foreground">
                {card.member}
              </code>
            </>
          )}
        </p>
        {card.domain && (
          // Its owners, then its domain: no punctuation follows a chip.
          <p>
            {card.owners.length > 0 && (
              <>
                {'Owned by '}
                <People names={card.owners} />
                {', in '}
              </>
            )}
            {card.owners.length === 0 && 'In '}
            {card.domain.id ? (
              <NounChip id={card.domain.id} nouns={maps.nouns} />
            ) : (
              <span className="text-foreground">{card.domain.name}</span>
            )}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-3.5">
        <P.Button variant="outline" onClick={() => P.openDock('def', card.name)}>
          <P.BookOpenIcon data-icon="inline-start" />
          Open the definition
        </P.Button>
        {rows.length > 0 ? (
          <P.Button variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {`See the ${items}`}
            <P.ChevronDownIcon
              data-icon="inline-end"
              className={P.cn('transition-transform', open && 'rotate-180')}
            />
          </P.Button>
        ) : (
          count > 0 && <span className="text-sm text-muted-foreground">{items} about it</span>
        )}
      </div>
      {open && (
        <div className="border-t px-4 py-3">
          <Rows items={rows} nouns={maps.nouns} more={count - rows.length} compact />
        </div>
      )}
    </article>
  )
}

/** The definition, only when the service shows it: a quote captioned with its metric and tool. */
function Definitions({ loop, nouns }: { loop: LoopTurn; nouns: Nouns }) {
  const carded = new Set(loop.defined?.cards.map((c) => c.id))
  const shown = loop.definitions.filter((d) => !d.id || !carded.has(d.id))
  if (!shown.length) return null
  return (
    <div className="flex max-w-reading flex-col gap-2">
      {shown.map((d) => (
        <figure key={d.name} className="flex flex-col gap-1 border-l-2 pl-3 text-sm">
          <figcaption className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {d.mark && (
              <span className="basis-full font-medium">
                What the definition says about {d.mark}, in its own words
              </span>
            )}
            {d.id && nouns.has(d.id) ? <NounChip id={d.id} nouns={nouns} /> : d.name}
            <span>as {d.tool} defines it</span>
          </figcaption>
          <blockquote className="text-pretty">
            {d.family ? (
              <FamilyDefinition family={d.family} mark={d.mark} />
            ) : d.mark ? (
              <Marked words={d.words ?? ''} mark={d.mark} />
            ) : (
              d.words
            )}
          </blockquote>
        </figure>
      ))}
    </div>
  )
}

/** Words with one word marked, as the question turns on it. */
function Marked({ words, mark }: { words: string; mark: string }) {
  const at = words.toLowerCase().indexOf(mark.toLowerCase())
  if (at < 0) return <>{words}</>
  return (
    <>
      {words.slice(0, at)}
      <mark className="rounded-sm bg-caution/8 px-0.5 text-foreground">
        {words.slice(at, at + mark.length)}
      </mark>
      {words.slice(at + mark.length)}
    </>
  )
}

/** Each overview group's icon, by what it holds: the Inbox's own, else what it is by. */
const groupIcons = (P: LoopParts): Record<string, LucideIcon> => ({
  names: P.TagIcon,
  gap: P.CircleDashedIcon,
  flag: P.FlagIcon,
  look: P.TriangleAlertIcon,
  alert: P.BellIcon,
  mention: P.AtSignIcon,
  check: P.CalendarClockIcon,
  suggestion: P.GitPullRequestArrowIcon,
  due: P.CalendarClockIcon,
})

/** Where a group is shown filtered, when a page shows it: due items in Context, a domain's items. */
function groupPage(P: LoopParts, o: LoopOverview, key: string | null) {
  if (!key) return null
  if ((o.from === 'inbox' && key === 'check') || (o.from === 'records' && key === 'due'))
    return { href: '/context?due=1', label: 'Open in Context' }
  if (o.from === 'records' && key.startsWith('domain:'))
    return {
      href: P.href('/context', { domain: key.slice('domain:'.length) }),
      label: 'Open in Context',
    }
  return null
}

/**
 * An overview (FR-720): one line with the total the groups add up to, and the page's own count
 * when it differs, with why; then each group, in the read's stated order, with its icon, its count
 * and its rows, long ones folded behind Show all, each row cited and opening what it is about.
 */
function Overview({
  o,
  loop,
  maps,
}: {
  o: LoopOverview
  loop: LoopTurn
  maps: ReturnType<typeof useMaps>
}) {
  const P = useParts()
  const ahead = P.useReadAhead()
  const [open, setOpen] = React.useState<Record<number, boolean>>({})
  // Which nouns the words have named so far, afresh each render: a chip the first time only.
  const seen = new Set<string>()
  return (
    <div data-answer-words className="flex max-w-reading flex-col gap-5">
      <div className="flex flex-col gap-1">
        {/* The model's lead line, when code drew the overview in its place. */}
        {loop.body.map((b, i) =>
          b.t === 'p' ? (
            <p key={i} className="mb-2 text-base leading-chat">
              <Runs runs={b.runs} nouns={maps.nouns} items={maps.numbered} seen={seen} />
            </p>
          ) : null,
        )}
        <p className="text-base leading-chat">
          <Runs runs={o.headline} nouns={maps.nouns} items={maps.numbered} />
          {o.from === 'inbox' && (
            <>
              {' '}
              <a
                href="/inbox"
                className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Open the Inbox
                <P.ArrowRightIcon aria-hidden className="size-3.5" />
              </a>
            </>
          )}
        </p>
        {o.page && (
          <p className="text-sm text-muted-foreground">
            The page counts <span className="font-semibold tabular-nums">{o.page.count}</span>
            {o.page.why ? `: ${o.page.why}` : '.'}
          </p>
        )}
        {o.order && (
          <p className="text-xs text-muted-foreground">
            {o.order.charAt(0).toUpperCase()}
            {o.order.slice(1)}.
          </p>
        )}
      </div>
      {o.groups.map((g, i) => {
        const Icon = (g.key && groupIcons(P)[g.key]) || P.LayersIcon
        const page = groupPage(P, o, g.key)
        const rows = open[i] ? g.rows : g.rows.slice(0, GROUP_SHOWN)
        return (
          <section key={`${g.key}-${g.name}`} className="flex flex-col gap-2" aria-label={g.name}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span>{g.name}</span>
                <span className="rounded-md bg-muted px-1.5 text-xs font-medium tabular-nums">
                  {g.count.toLocaleString('en-GB')}
                </span>
              </h3>
              {page && (
                <a
                  href={page.href}
                  className="ml-auto inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {page.label}
                  <P.ArrowRightIcon aria-hidden className="size-3.5" />
                </a>
              )}
            </div>
            <ul className="ml-6 flex flex-col gap-2.5">
              {rows.map((row, j) => {
                const n = row.item ? loop.sources.indexOf(row.item) + 1 : 0
                const item = n ? maps.numbered.get(n) : undefined
                const values = row.about.filter((id) => id.startsWith('value:'))
                return (
                  <li key={j} className="flex flex-col gap-1 text-sm">
                    {/* The row's citation follows its title, as a citation follows what it supports:
                        one numbering across the answer, so a number here is no place in a list. */}
                    <span>
                      {row.card ? (
                        <a
                          href={P.href('/inbox', { card: row.card })}
                          className="rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          {row.title}
                        </a>
                      ) : item ? (
                        // The title opens the item, so its number is words in it, after the last word.
                        <button
                          type="button"
                          {...ahead(item.id)}
                          onClick={() => P.openDock('context', item.id)}
                          className="rounded-sm text-left font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          {row.title}
                          <span
                            aria-hidden
                            className="ml-1 inline-flex h-5 min-w-5 -translate-y-px items-center justify-center rounded-md bg-muted px-1 align-middle text-xs font-medium text-foreground tabular-nums"
                          >
                            {n}
                          </span>
                          <span className="sr-only">, source {n}</span>
                        </button>
                      ) : (
                        <span className="font-medium">{row.title}</span>
                      )}
                      {item && row.card ? (
                        <Runs runs={[{ t: 'cite', n }]} nouns={maps.nouns} items={maps.numbered} />
                      ) : null}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                      {values.map((id) => (
                        <NounChip key={id} id={id} nouns={maps.nouns} />
                      ))}
                      {row.domain && <NounChip id={row.domain} nouns={maps.nouns} />}
                      {(row.status || row.date) && (
                        <span className="min-w-0 tabular-nums">
                          {row.status}
                          {row.date && `${row.status ? '\u00a0· ' : ''}${dayText(row.date, true)}`}
                        </span>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
            {g.rows.length > GROUP_SHOWN && !open[i] && (
              <button
                type="button"
                onClick={() => setOpen((x) => ({ ...x, [i]: true }))}
                className="ml-6 w-fit rounded-sm text-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Show all {g.count.toLocaleString('en-GB')}
              </button>
            )}
            {open[i] && g.more > 0 && (
              <p className="ml-6 text-xs text-muted-foreground">
                {g.more.toLocaleString('en-GB')} more are on the page.
              </p>
            )}
          </section>
        )
      })}
      {o.note && (
        <p className="text-sm text-muted-foreground">
          <Runs runs={o.note} nouns={maps.nouns} items={maps.numbered} seen={seen} />
        </p>
      )}
    </div>
  )
}

/** The plain words a Copy takes: the answer's own, its marks gone. */
const copyOf = (answer: Answer) => answer.text.replace(/\[\d+\]/g, '')

/**
 * The state on one line with its fixed sentence; the Definition label for an answer that uses no
 * item and is about a definition; or From Footnote's records for a records answer.
 */
function StateRow({
  loop,
  words,
  className,
}: {
  loop: LoopTurn
  words: React.RefObject<HTMLElement | null>
  className?: string
}) {
  const P = useParts()
  const shown = (() => {
    if (loop.kind === 'stopped')
      return (
        <p className="flex w-fit items-center gap-2 rounded-md bg-muted px-2 py-1 text-sm font-semibold">
          <P.CircleStopIcon aria-hidden className="size-4" />
          Stopped
        </p>
      )
    if (!loop.state && loop.defined)
      return (
        <P.DefinitionHelp
          names={loop.defined.names}
          tool={loop.defined.tool}
          words={words}
          usesNoItem
        />
      )
    if (!loop.state && loop.help?.length)
      return (
        <p className="flex w-fit items-center gap-2 rounded-md bg-muted px-2 py-1 text-sm font-semibold">
          <P.BookOpenIcon aria-hidden className="size-4" />
          From {P.PRODUCT}&apos;s help
        </p>
      )
    if (!loop.state)
      return loop.reads.some((r) =>
        ['records', 'agent_questions', 'inbox', 'conflicts'].includes(r.tool),
      ) && !loop.overview ? (
        <p className="flex w-fit items-center gap-2 rounded-md bg-muted px-2 py-1 text-sm font-semibold">
          <P.TableIcon aria-hidden className="size-4" />
          From {P.PRODUCT}&apos;s records
        </p>
      ) : null
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <P.StateHelp state={loop.state} words={words} />
        {loop.state !== 'grounded' && (
          <span className="text-sm text-muted-foreground">
            {P.ANSWER_LINES.find((l) => l.state === loop.state)!.sentence}
          </span>
        )}
      </div>
    )
  })()
  return shown && <div className={className}>{shown}</div>
}

/**
 * The help pages an answer about Footnote itself rests on (FR-719.8), each opening at its part in
 * the documentation, which opens as its own site.
 */
function HelpSources({ loop }: { loop: LoopTurn }) {
  const P = useParts()
  if (!loop.help?.length) return null
  return (
    <div className="flex flex-col gap-1.5">
      <BlockLabel icon={P.BookOpenIcon}>From the help</BlockLabel>
      <ul className="flex flex-col gap-1">
        {loop.help.map((h) => (
          <li key={`${h.slug}#${h.id}`}>
            <a
              href={P.docHref(h.slug, h.id)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-6 w-fit items-center gap-1 text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:underline"
            >
              {h.heading === h.title ? h.title : `${h.title}: ${h.heading}`}
              <P.ArrowUpRightIcon className="size-3.5" aria-hidden />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The footer's lines, said once each: what was found out of what, and what may be out of date. */
const footerLines = (loop: LoopTurn) =>
  [loop.footer.denominator, loop.footer.stale, loop.footer.notSeen].filter((x): x is string => !!x)

/** A stopped turn's fixed sentence, under its Stopped mark. */
const StoppedLine = ({ text }: { text: string }) => (
  <p className="max-w-reading text-base leading-chat">{text}</p>
)

/**
 * A turn of the loop that stopped with no plain read under it: its fixed sentence, Ask again, and
 * a search for its words.
 */
function Stopped({ answer, onRetry }: { answer: Answer; onRetry?: () => void }) {
  const P = useParts()
  return (
    <div className="flex flex-col gap-3">
      <StoppedLine text={answer.text} />
      <div className="flex flex-wrap items-center gap-2">
        {onRetry && (
          <P.Button variant="outline" onClick={onRetry}>
            <P.RefreshCwIcon data-icon="inline-start" />
            Ask again
          </P.Button>
        )}
        <P.Button
          variant="ghost"
          nativeButton={false}
          render={<a href={P.href('/search', { q: P.askedOf(answer) })} />}
        >
          <P.SearchIcon data-icon="inline-start" />
          Search for these words
        </P.Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Nothing it wrote was checked, so nothing is shown.
      </p>
    </div>
  )
}

/**
 * The loop's answer in the chat: while it reads, each read as a step; once in, the answer, its
 * evidence, the next step, the footer and the actions, in direction C's order.
 */
/** The loop's answer in the chat, with Ask's parts (loop-parts.ts). */
export function LoopAnswerBody({ parts, ...props }: Props & { parts: LoopParts }) {
  return (
    <PartsContext.Provider value={parts}>
      <AnswerOfLoop {...props} />
    </PartsContext.Provider>
  )
}

/** Whether the person asked for less motion: the words then show at once. */
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** The characters of a turn's words that the reveal types in: its words, or its question back. */
const wordsLength = (loop: LoopTurn, nouns: Nouns) =>
  loop.overview || cardsStandIn(loop)
    ? 0
    : loop.kind === 'question'
      ? loop.text.length
      : bodyLength(loop.body, nouns)

/**
 * Whether the definition cards stand in for the answer's words: every definition the answer is
 * about has its card, and the words only give those definitions.
 */
const cardsStandIn = (loop: LoopTurn) =>
  !!loop.defined?.cards.length && loop.defined.cards.every((c) => c.inWords)

function AnswerOfLoop({ turn, docked, onRetry, onAsk, latest }: Props) {
  const P = useParts()
  const { answer, stopped } = turn
  const loop = answer.loop
  const done = turn.stage === 'done' && !!loop
  // What the words are drawn from: the finished answer, or the sentences checked so far.
  const shown = done ? loop : turn.words
  const words = React.useRef<HTMLDivElement>(null)
  const facts = P.useFacts()
  const [wrong, setWrong] = React.useState(false)
  const [sent, setSent] = React.useState<Answer['report']>(undefined)
  const key = P.answerKey(answer)
  const cited = React.useMemo(
    () => (loop ? loop.sources.flatMap((id) => facts.find((f) => f.id === id) ?? []) : []),
    [loop, facts],
  )
  // The items it cites are read ahead once it is written, so their quick views open whole.
  P.useReadCitedAhead(loop?.sources ?? [], done && !!latest)
  const { keepShown } = P
  React.useEffect(() => {
    if (done) keepShown(key, { answer, facts: cited })
  }, [done, key, answer, cited, keepShown])
  // The words are typed in at reading pace in the page, whatever size the pieces arrive in: a
  // turn asked here, as it comes, whether its words or its whole answer come first. One opened
  // from the history (asked before this page), or with reduced motion, shows at once, and Stop
  // shows what is in at once. Typing in is only how the words show: once the answer is in, the
  // chat asks the next question without waiting for the last word.
  const [typed] = React.useState(() => turn.asked > 0 && !reducedMotion())
  const nouns = React.useMemo(() => new Map((shown?.nouns ?? []).map((n) => [n.id, n])), [shown])
  const total = shown ? wordsLength(shown, nouns) : 0
  const revealed = useReveal(total, { instant: !typed || stopped })
  // The rest, its state and what backs it, comes in after the last word.
  const revealing = P.isLive(turn) || revealed < total
  if (!shown)
    return (
      <div className="flex min-w-0 flex-col gap-4" aria-busy={P.isLive(turn)}>
        <LoopProgress turn={turn} />
        {stopped && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <P.CircleStopIcon className="size-4 shrink-0" aria-hidden />
              You stopped it before an answer. Nothing was shown.
            </span>
            {onRetry && (
              <P.Button variant="outline" onClick={onRetry}>
                <P.RefreshCwIcon data-icon="inline-start" />
                Ask again
              </P.Button>
            )}
          </div>
        )}
      </div>
    )
  return (
    <Finished
      loop={shown}
      answer={answer}
      {...{
        typed,
        upTo: revealing ? revealed : undefined,
        // Stopped while the model wrote: the sentences checked so far, and nothing from the reads.
        unfinished: !done && stopped,
        busy: P.isLive(turn),
        docked,
        onRetry,
        onAsk,
        latest,
        words,
        wrong,
        setWrong,
        sent,
        setSent,
        cited,
        answerId: key,
      }}
    />
  )
}

function Finished({
  loop,
  answer,
  docked,
  onRetry,
  onAsk,
  latest,
  words,
  wrong,
  setWrong,
  sent,
  setSent,
  cited,
  answerId,
  typed,
  upTo,
  unfinished,
  busy,
}: {
  loop: LoopTurn
  answer: Answer
  /** Its words are typed in: the words come a word at a time, and the rest fades in after them. */
  typed: boolean
  /** How many characters of the words show while they are typed in; none once all are in. */
  upTo: number | undefined
  /** Stopped while the model wrote: the words so far and the stop, nothing else. */
  unfinished: boolean
  /** The turn is still on its way. */
  busy: boolean
  docked?: boolean
  onRetry?: () => void
  onAsk?: (question: string) => void
  latest?: boolean
  words: React.RefObject<HTMLDivElement | null>
  wrong: boolean
  setWrong: (w: boolean) => void
  sent: Answer['report']
  setSent: (s: Answer['report']) => void
  cited: Fact[]
  answerId: string
}) {
  const P = useParts()
  const maps = useMaps(loop)
  // Which nouns the words have named so far, afresh each render: a chip the first time only.
  const seen = new Set<string>()
  const used = loop.sources.flatMap((_, i) => {
    const item = maps.numbered.get(i + 1)
    return item && !loop.conflict.includes(item.id) ? [item] : []
  })
  const listed = new Set(loop.body.flatMap((b) => (b.t === 'list' ? b.rows : [])))
  const shownUsed = loop.overview ? [] : used.filter((i) => !listed.has(i.id))
  const owns = useOwns(loop)
  // The gap card names who owns what is not written: the owners line would say it twice.
  const gap = missingOf(loop, maps.nouns).length > 0 || !!loop.unknown?.length
  const showOwners =
    !gap && (loop.state === 'missing' || loop.state === 'partial' || loop.state === 'stale')
  const [lit, light] = React.useState<number | null>(null)
  const lighting = React.useMemo(() => ({ lit, light }), [lit])
  const footer = footerLines(loop)
  // A turn that stopped shows the plain read under its sentence, when it has one (decision 5).
  const bare = loop.kind === 'stopped' && !loop.body.length
  // While the words are typed in, the state keeps its place and shows with the rest after them.
  const typing = upTo !== undefined
  const rest = P.cn('flex flex-col gap-4', typed && 'animate-in duration-(--dur-4) fade-in-0')
  return (
    <LitSource.Provider value={lighting}>
      <div
        aria-busy={busy || typing}
        className={P.cn(
          'group/msg flex min-w-0 flex-col gap-4',
          !typed && 'animate-in duration-(--dur-3) fade-in-0',
        )}
      >
        {bare ? (
          <>
            <StateRow loop={loop} words={words} />
            <Stopped answer={answer} onRetry={onRetry} />
          </>
        ) : (
          <>
            <StateRow
              loop={loop}
              words={words}
              className={typing ? 'invisible' : typed ? rest : undefined}
            />
            {loop.kind === 'stopped' && <StoppedLine text={loop.text} />}
            <div ref={words}>
              {cardsStandIn(loop) ? (
                // The definition card is the answer: the source's own words, where they come from.
                !typing && (
                  <div data-answer-words className={typed ? rest : undefined}>
                    <DefinitionCards loop={loop} maps={maps} />
                  </div>
                )
              ) : loop.overview ? (
                <Overview o={loop.overview} loop={loop} maps={maps} />
              ) : loop.kind === 'question' ? (
                <p data-answer-words className="max-w-reading text-base leading-chat">
                  {typing ? (
                    <Runs
                      runs={[{ t: 'text', text: loop.text }]}
                      nouns={maps.nouns}
                      items={maps.numbered}
                      upTo={upTo}
                    />
                  ) : (
                    loop.text
                  )}
                </p>
              ) : (
                <Body
                  body={loop.body}
                  nouns={maps.nouns}
                  numbered={maps.numbered}
                  byId={maps.byId}
                  seen={seen}
                  upTo={upTo}
                />
              )}
            </div>
            {unfinished && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-2">
                  <P.CircleStopIcon className="size-4 shrink-0" aria-hidden />
                  You stopped it before the answer was finished.
                </span>
                {onRetry && (
                  <P.Button variant="outline" onClick={onRetry}>
                    <P.RefreshCwIcon data-icon="inline-start" />
                    Ask again
                  </P.Button>
                )}
              </div>
            )}
          </>
        )}
        {!typing && !unfinished && (
          <div className={rest}>
            {!bare && (
              <>
                {loop.choices.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {loop.choices.map((choice) =>
                      onAsk ? (
                        <P.Button key={choice} variant="outline" onClick={() => onAsk(choice)}>
                          {choice}
                        </P.Button>
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
                )}
                <HelpSources loop={loop} />
                {!cardsStandIn(loop) && <DefinitionCards loop={loop} maps={maps} />}
                {loop.state === 'conflict' && <Disagree loop={loop} maps={maps} />}
                {shownUsed.length > 0 && <Sources items={shownUsed} owns={owns} />}
                {gap && (
                  <GapCard
                    loop={loop}
                    nouns={maps.nouns}
                    {...(answer.dates ? { dates: answer.dates } : {})}
                  />
                )}
                {loop.state === 'missing' && <Closest loop={loop} maps={maps} />}
                {showOwners && <Owners loop={loop} nouns={maps.nouns} />}
                <Definitions loop={loop} nouns={maps.nouns} />
                {loop.kind === 'answer' && !loop.overview && <P.AnswerFigure answer={answer} />}
                <Next
                  loop={loop}
                  nouns={maps.nouns}
                  items={used.filter((i) => !shownUsed.includes(i))}
                />
                {(footer.length > 0 || loop.read.length > 0) && (
                  <WhatAskRead loop={loop} footer={footer} />
                )}
              </>
            )}
            {sent && <P.ReportLine report={sent} />}
            {wrong && !sent && cited.length > 0 && (
              <P.SomethingWrong
                answer={answer}
                facts={cited}
                onClose={() => setWrong(false)}
                onSent={() => {
                  setWrong(false)
                  setSent({ on: 'just now' })
                }}
              />
            )}
            <P.AnswerActions
              answer={answer}
              copyText={loop.kind === 'stopped' ? '' : copyOf(answer)}
              facts={cited}
              answerId={answerId}
              draft={false}
              docked={docked}
              latest={latest}
              onRetry={bare ? undefined : onRetry}
              wrong={wrong}
              onWrong={(w) => cited.length > 0 && !sent && setWrong(w)}
              canReport={cited.length > 0 && !sent}
            />
          </div>
        )}
      </div>
    </LitSource.Provider>
  )
}
