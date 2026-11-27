import * as React from 'react'
import {
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  MessageSquarePlusIcon,
  PlusIcon,
} from '@/components/icons'
import { MentionText } from '@/components/footnote/mention-chip'
import { Marks, SourceText, answerCode } from '@/components/footnote/source-text'
import { safeHref } from '@/lib/host'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { FoldTrigger } from '@/components/footnote/fold'
import { cn } from '@/lib/utils'
import { TOUCH_LINK } from '@/lib/touch'
import {
  changeWords,
  diffStats,
  hunks,
  isBreak,
  lineDiff,
  wordDiff,
  type Row,
  type Word,
} from '@/lib/line-diff'
import {
  passageDiff,
  passageStats,
  type LinkChange,
  type Look,
  type Move,
  type Passage,
  type PassageRow,
  type PassageRun,
} from '@/lib/passage-diff'
import type { BlockShape } from '@domain/markdown-blocks'
import { useOnlyChanged } from '@/lib/review-compare'
import { fieldRows, type FieldRow } from '@/model/review-fields'
import type { FieldSide } from '@/model/review'
import { placeKey, placeLabel, type SourcePlace } from '@/model/source-places'

// The Source review as "the comparison", its parts each fed two sides, so the same parts compare a
// suggestion with the live item today and, later, a live item with a suggestion beside it:
//
// - CompareBar, on top: what is compared, now and suggested with who and when, and how many of
//   the fields change and stay the same.
// - FieldsDiff, the Fields table: every field but the text with its value now and suggested, a
//   changed row tinted, a row that stays the same quiet. Its switch leaves only what changed.
// - TextComparison, the text as a reader sees it, now beside suggested, passage beside passage,
//   with the changed words marked inside the sentences (src/web/lib/passage-diff.ts), and the
//   changes that keep the words marked as what they are: a new look dotted with a tag that says
//   it, a new link with its tag, a moved passage in a tinted block that says where it went.
// - TextDiff, behind one key, S: the stored text line by line, in the app's own font: line numbers, removed lines
//   before added ones, only the changed words marked when most of a block stays (compared across
//   its lines, so a split paragraph marks only what changed), a blank line in a change shown as
//   the paragraph break it is, and the unchanged stretches folded, three lines around each change.
//
// Marks are never colour alone: a removed line has a minus and says "removed", removed words are
// struck through, added words underlined. Every change is a stop for N and P (`data-review-change`),
// which the page steps through.
//
// Given `notes`, every line and every field row is a place to comment (`data-source-place`): a
// "+" beside it on hover, C on the one in focus, and on a touch screen a Comment button under the
// one tapped. Its threads hang under it, and a fold that holds one opens.

/**
 * Comments on the source, when the parts take them: what hangs under a line or a field (its
 * threads, an open composer), whether one holds a thread, and how to start one there.
 */
export type SourceNotes = {
  under: (at: SourcePlace) => React.ReactNode
  holds: (at: SourcePlace) => boolean
  comment: (at: SourcePlace) => void
}

/** The place of a line: a removed one on the text before, any other on the text after. */
export const placeOfRow = (row: Row): SourcePlace =>
  row.t === '-' ? { side: 'before', line: row.a! } : { side: 'after', line: row.b! }

/** A place to comment, focusable for C and the arrow keys; ringed while in focus. */
const place =
  'group/row outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset'

/** The "+" beside a line or a field, on hover; a finger gets the Comment button instead. */
function AddNote({
  at,
  notes,
  className,
}: {
  at: SourcePlace
  notes: SourceNotes
  className?: string
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={`Comment on ${placeLabel(at)}`}
      onClick={() => notes.comment(at)}
      className={cn(
        'absolute z-raised flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 transition-opacity duration-(--dur-1) outline-none group-hover/row:opacity-100 pointer-coarse:hidden',
        className,
      )}
    >
      <PlusIcon aria-hidden className="size-3.5" />
    </button>
  )
}

/** Under the line or field a finger tapped: one button to comment on it. */
function TouchNote({ at, notes }: { at: SourcePlace; notes: SourceNotes }) {
  return (
    <Button variant="ghost" className="text-muted-foreground" onClick={() => notes.comment(at)}>
      <MessageSquarePlusIcon data-icon="inline-start" />
      Comment on {placeLabel(at).toLowerCase()}
    </Button>
  )
}

/** What each side is called: "Now" and "Suggested" in a review. */
export type SideLabels = { before: string; after: string }
const REVIEW_SIDES: SideLabels = { before: 'Now', after: 'Suggested' }

/**
 * What stays the same, folded into a full-width row of the table or the text: the fold's inline
 * toggle at the box's width, as tall as a finger needs on a touch screen.
 */
const fullWidthToggle =
  'flex w-full gap-1.5 rounded-none px-3 text-xs text-muted-foreground focus-visible:ring-inset pointer-coarse:min-h-11 pointer-coarse:after:hidden'

/** A stop for N and P, ringed while it is the one stepped to. */
const stop =
  'scroll-mt-24 outline-none data-active:outline-2 data-active:-outline-offset-2 data-active:outline-ring data-active:outline-solid'

/* ---------- words ---------- */

/** Words that go, struck through, or words that come, underlined; said so to a screen reader. */
function Marked({ side, children }: { side: 'before' | 'after'; children: React.ReactNode }) {
  return side === 'before' ? (
    <del className="rounded-xs bg-mark-del-word text-foreground decoration-[var(--mark-del-line)] decoration-2">
      <span className="sr-only">[removed: </span>
      {children}
      <span className="sr-only">]</span>
    </del>
  ) : (
    <ins className="rounded-xs bg-mark-add-word text-foreground underline decoration-[var(--mark-add-line)] decoration-2 underline-offset-3">
      <span className="sr-only">[added: </span>
      {children}
      <span className="sr-only">]</span>
    </ins>
  )
}

/** Text with its mentions as chips, and its changed runs struck through or underlined. */
function Words({ words, side }: { words: Word[]; side: 'before' | 'after' }) {
  return words.map((w, i) =>
    !w.changed || !w.text.trim() ? (
      <MentionText key={i} text={w.text} />
    ) : (
      <Marked key={i} side={side}>
        <MentionText text={w.text} />
      </Marked>
    ),
  )
}

/* ---------- the Fields table ---------- */

/** A value that was replaced whole: struck through on one side, underlined on the other. */
function Whole({
  text,
  side,
  marked,
}: {
  text: string
  side: 'before' | 'after'
  marked: boolean
}) {
  if (!marked) return <>{text}</>
  return <Words words={[{ text, changed: true }]} side={side} />
}

/** A name in Applies to, as a small chip; one added or removed says so in words and marks. */
function Name({ name, change }: { name: string; change?: 'added' | 'removed' }) {
  return (
    <li
      className={cn(
        'inline-flex h-6 items-center rounded-md border px-1.5 text-xs',
        change === 'added' &&
          'border-[var(--mark-add-line)] bg-[var(--mark-add)] underline decoration-[var(--mark-add-line)] underline-offset-3',
        change === 'removed' &&
          'border-[var(--mark-del-line)] bg-[var(--mark-del)] line-through decoration-[var(--mark-del-line)]',
      )}
    >
      {change && <span className="sr-only">{change}: </span>}
      {name}
    </li>
  )
}

/** A source: its address, with only the changed part marked, and the sentence copied from it. */
function SourceValue({
  source,
  other,
  side,
}: {
  source: FieldSide['sources'][number]
  other?: FieldSide['sources'][number]
  side: 'before' | 'after'
}) {
  const [l, r] = other
    ? side === 'before'
      ? wordDiff(source.url, other.url)
      : wordDiff(other.url, source.url)
    : [[{ text: source.url, changed: false }], [{ text: source.url, changed: false }]]
  const quote = other && other.quote !== source.quote
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {/* An address a reader may not follow (javascript:) is shown, never linked. */}
      {safeHref(source.url) ? (
        <span>
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className={cn(
              'break-all underline decoration-muted-foreground/40 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
              TOUCH_LINK,
            )}
          >
            <Words words={side === 'before' ? l : r} side={side} />
          </a>
        </span>
      ) : (
        <span className="break-all">
          <Words words={side === 'before' ? l : r} side={side} />
        </span>
      )}
      {source.quote && (
        <q className="text-muted-foreground italic">
          {/* A changed quote is compared character by character; one that stays reads drawn. */}
          {quote ? (
            <Whole text={source.quote} side={side} marked />
          ) : (
            <SourceText text={source.quote} />
          )}
        </q>
      )}
    </div>
  )
}

/** One side of a row. */
function Value({ row, side }: { row: FieldRow; side: 'before' | 'after' }) {
  const marked = row.changed
  switch (row.type) {
    case 'words': {
      const text = row[side]
      if (text === undefined) return null
      if (!marked) return <>{text}</>
      const [l, r] = wordDiff(row.before!, row.after!)
      return <Words words={side === 'before' ? l : r} side={side} />
    }
    case 'value': {
      const text = row[side]
      return text === undefined ? null : <Whole text={text} side={side} marked={marked} />
    }
    case 'names': {
      const names = row[side]
      if (!names) return null
      if (!names.length) return <span className="text-muted-foreground">Nothing</span>
      return (
        <ul className="flex flex-wrap gap-1">
          {names.map((n) => (
            <Name
              key={n}
              name={n}
              change={
                side === 'before' && row.removed.includes(n)
                  ? 'removed'
                  : side === 'after' && row.added.includes(n)
                    ? 'added'
                    : undefined
              }
            />
          ))}
        </ul>
      )
    }
    case 'sources': {
      const list = row[side]
      if (!list) return null
      if (!list.length) return <span className="text-muted-foreground">Not set</span>
      const others = side === 'before' ? row.after : row.before
      return (
        <div className="flex flex-col gap-2">
          {list.map((s, i) => (
            <SourceValue
              key={`${s.url}-${i}`}
              source={s}
              other={marked ? others?.[i] : undefined}
              side={side}
            />
          ))}
        </div>
      )
    }
  }
}

/** "5 fields that stay the same are hidden: Kind, Domain, ...", the line under a table that hides them. */
function hiddenLine(hidden: readonly FieldRow[], shown: number) {
  const n = hidden.length
  const list = `${n} ${n === 1 ? 'field that stays' : 'fields that stay'} the same ${n === 1 ? 'is' : 'are'} hidden: ${hidden.map((r) => r.label).join(', ')}.`
  return shown ? list : `No field changed. ${list}`
}

/**
 * The Fields table: every field of the two sides, its value now and suggested. With both sides a
 * changed row is tinted, its old value struck through and its new one underlined, and a row that
 * stays the same is quiet; the switch, on until the person turns it off and remembered for them,
 * leaves only the rows that change and names the ones it hides. A new item and an archive show
 * every field in the column of the side they have, the other column empty and nothing marked.
 */
export function FieldsDiff({
  before,
  after,
  person,
  labels = REVIEW_SIDES,
  notes,
  oneSide,
}: {
  before: FieldSide | null
  after: FieldSide | null
  /** Who reads it: the switch is remembered for each person. */
  person: string
  labels?: SideLabels
  notes?: SourceNotes
  /** What the header says when one side is missing, in place of the review's words. */
  oneSide?: string
}) {
  const id = React.useId()
  const [only, setOnly] = useOnlyChanged(person)
  const rows = fieldRows(before, after)
  const both = !!before && !!after
  // A row with a thread stays in sight, the switch on or not.
  const held = (r: FieldRow) => !!notes?.holds({ field: r.key })
  const hides = both && only
  const shown = hides ? rows.filter((r) => r.changed || held(r)) : rows
  const hidden = hides ? rows.filter((r) => !r.changed && !held(r)) : []
  // A new item and an archive keep both columns, the side they do not have left empty.
  const sides = ['before', 'after'] as const
  return (
    <section aria-labelledby={`${id}-h`} className="overflow-hidden rounded-frame border">
      <header className="flex min-h-16 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 id={`${id}-h`} className="text-xl font-semibold">
            Fields
          </h3>
          {!both && (
            <span className="text-xs text-muted-foreground">
              {oneSide ?? (after ? 'All set by the suggestion' : 'As they are now')}
            </span>
          )}
        </div>
        {both && (
          <label htmlFor={`${id}-only`} className="flex items-center gap-2.5 text-sm">
            <Switch id={`${id}-only`} checked={only} onCheckedChange={setOnly} />
            Only what changed
          </label>
        )}
      </header>
      {shown.length > 0 && (
        <table className="w-full table-fixed border-t text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground @max-lg:sr-only">
            <tr>
              <th
                scope="col"
                className={cn(
                  'w-36 px-5 py-3 font-medium',
                  notes && 'w-40 pl-8 pointer-coarse:pl-5',
                )}
              >
                Field
              </th>
              {sides.map((s) => (
                <th key={s} scope="col" className="px-5 py-3 font-medium">
                  {labels[s]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const at: SourcePlace = { field: row.key }
              const under = notes?.under(at)
              return (
                <React.Fragment key={row.key}>
                  <tr
                    data-review-change={row.changed ? '' : undefined}
                    data-source-place={notes ? placeKey(at) : undefined}
                    tabIndex={row.changed || notes ? -1 : undefined}
                    aria-label={row.changed ? `${row.label}, changed` : undefined}
                    className={cn(
                      'border-t align-top @max-lg:grid @max-lg:gap-1.5 @max-lg:px-5 @max-lg:py-3',
                      row.changed && cn('bg-caution/8', stop),
                      notes && place,
                    )}
                  >
                    <th
                      scope="row"
                      className={cn(
                        'relative px-5 py-3.5 text-left font-medium @max-lg:p-0',
                        // A gutter for the + beside the field's name, which a finger doesn't get.
                        notes &&
                          'pl-8 @max-lg:pl-0 pointer-coarse:pl-5 @max-lg:pointer-coarse:pl-0',
                      )}
                    >
                      {notes && (
                        <AddNote
                          at={at}
                          notes={notes}
                          className="top-3.5 left-1.5 @max-lg:top-0 @max-lg:-left-5"
                        />
                      )}
                      {row.label}
                      {hides && !row.changed && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          Kept: it has a comment
                        </span>
                      )}
                      {/* The tint and the marks say it on the screen; a screen reader hears it. */}
                      {row.changed && <span className="sr-only">, changed</span>}
                      {notes && (
                        <span className="hidden pointer-coarse:group-focus-within/row:flex">
                          <TouchNote at={at} notes={notes} />
                        </span>
                      )}
                    </th>
                    {sides.map((s) => (
                      <td
                        key={s}
                        className={cn(
                          'px-5 py-3.5 break-words @max-lg:p-0',
                          row.changed && '@max-lg:grid @max-lg:gap-0.5',
                          // A value that stays the same is said once on a narrow pane, an empty side not at all.
                          both && !row.changed && s === 'before' && '@max-lg:hidden',
                          !(s === 'before' ? before : after) && '@max-lg:hidden',
                        )}
                      >
                        {both && row.changed && (
                          <span className="text-xs text-muted-foreground @lg:sr-only">
                            {labels[s]}
                          </span>
                        )}
                        <span className="min-w-0">
                          <Value row={row} side={s} />
                        </span>
                      </td>
                    ))}
                  </tr>
                  {under && (
                    <tr className={cn(row.changed && 'bg-caution/8')}>
                      <td colSpan={sides.length + 1} className="px-5 pb-3">
                        {under}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      )}
      {hidden.length > 0 && (
        <p className="border-t bg-muted/50 px-5 py-2.5 text-xs text-muted-foreground">
          {hiddenLine(hidden, shown.length)}
        </p>
      )}
    </section>
  )
}

/* ---------- the Text diff ---------- */

/** One line: its numbers, its sign in a glyph and in words, and its text; its threads under it. */
function Line({ row, notes }: { row: Row; notes?: SourceNotes }) {
  const side = row.t === '-' ? 'before' : 'after'
  // A blank line added or removed only starts or joins a paragraph: no sign, said in words.
  const pause = isBreak(row)
  const at = placeOfRow(row)
  const line = (
    <div
      className={cn(
        'grid grid-cols-(--cols-diff) @max-lg:grid-cols-(--cols-diff-one)',
        row.t === '+' && 'bg-[var(--mark-add)]',
        row.t === '-' && 'bg-[var(--mark-del)]',
      )}
    >
      <span
        aria-hidden
        className="border-r px-2 py-0.5 text-right text-xs leading-6 text-muted-foreground tabular-nums select-none @max-lg:hidden"
      >
        {row.a}
      </span>
      <span className="relative border-r px-2 py-0.5 text-right text-xs leading-6 text-muted-foreground tabular-nums select-none">
        <span aria-hidden>
          {row.t === '-' ? <span className="@lg:hidden">{row.a}</span> : row.b}
        </span>
        {notes && <AddNote at={at} notes={notes} className="top-1 left-0" />}
      </span>
      <span
        className="py-0.5 text-center leading-6 text-muted-foreground select-none"
        aria-label={
          pause ? undefined : row.t === '+' ? 'added' : row.t === '-' ? 'removed' : undefined
        }
      >
        {pause ? '' : row.t === '+' ? '+' : row.t === '-' ? '−' : ''}
      </span>
      <span className="min-w-0 py-0.5 pr-3 text-sm leading-6 break-words whitespace-pre-wrap">
        <span className="sr-only">
          Line {row.t === '-' ? row.a : row.b}
          {': '}
        </span>
        {pause ? (
          <span className="sr-only">{row.t === '+' ? 'New paragraph' : 'Paragraphs joined'}</span>
        ) : row.words ? (
          <Words words={row.words} side={side} />
        ) : row.line ? (
          <MentionText text={row.line} />
        ) : (
          ' '
        )}
      </span>
    </div>
  )
  if (!notes) return line
  return (
    <>
      <div data-source-place={placeKey(at)} tabIndex={-1} className={place}>
        {line}
        <span className="hidden justify-end pointer-coarse:group-focus-within/row:flex">
          <TouchNote at={at} notes={notes} />
        </span>
      </div>
      {notes.under(at)}
    </>
  )
}

/** Unchanged lines folded into one row that opens them; a fold that holds a thread is open. */
function Fold({ rows, all, notes }: { rows: Row[]; all: boolean; notes?: SourceNotes }) {
  const [open, setOpen] = React.useState(false)
  const held = !!notes && rows.some((row) => notes.holds(placeOfRow(row)))
  if (open || held)
    return (
      <div className={cn(open && 'animate-in duration-(--dur-3) fade-in-0 slide-in-from-top-1')}>
        {rows.map((row, i) => (
          <Line key={i} row={row} notes={notes} />
        ))}
      </div>
    )
  const n = rows.length
  return (
    <FoldTrigger
      variant="inline"
      expanded={false}
      onClick={() => setOpen(true)}
      label={all ? `The text is the same: show its ${n} lines` : `Show ${n} unchanged lines`}
      className={cn(
        fullWidthToggle,
        'min-h-8 border-y bg-muted/40 py-1 first:border-t-0 last:border-b-0 hover:bg-muted',
      )}
    />
  )
}

/**
 * The Text diff of two stored texts: every change a stop for N and P, with what stays the same
 * folded around it. One number column on a narrow pane, two when there is room.
 */
export function TextDiff({
  before,
  after,
  notes,
  action,
}: {
  before: string
  after: string
  notes?: SourceNotes
  /** What sits at the end of its header: the way back to the comparison. */
  action?: React.ReactNode
}) {
  const id = React.useId()
  const rows = React.useMemo(() => lineDiff(before, after), [before, after])
  const parts = React.useMemo(() => hunks(rows), [rows])
  const stats = diffStats(rows)
  const changes = stats.changes
  const line = !rows.length
    ? 'No text'
    : !changes
      ? 'No change'
      : `${changeWords(stats)} in ${changes} ${changes === 1 ? 'place' : 'places'}`
  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-2">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 id={`${id}-h`} className="text-sm font-medium">
          Text
        </h3>
        <span className="text-xs text-muted-foreground">{line}</span>
        {action && <span className="ml-auto self-center">{action}</span>}
      </header>
      {rows.length > 0 && (
        <div className="overflow-hidden rounded-frame border">
          {parts.map((part, i) =>
            part.t === 'fold' ? (
              <Fold key={i} rows={part.rows} all={!changes} notes={notes} />
            ) : part.t === 'same' ? (
              part.rows.map((row, k) => <Line key={`${i}-${k}`} row={row} notes={notes} />)
            ) : (
              <div
                key={i}
                role="group"
                aria-label={`Change ${part.n + 1} of ${changes} in the text`}
                data-review-change=""
                tabIndex={-1}
                className={stop}
              >
                {part.rows.some((r) => r.long) && (
                  <p className="border-b bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
                    Too long to mark the changed words: shown as whole lines.
                  </p>
                )}
                {part.rows.map((row, k) => (
                  <Line key={k} row={row} notes={notes} />
                ))}
              </div>
            ),
          )}
        </div>
      )}
    </section>
  )
}

/* ---------- the comparison's text ---------- */

/** A mark's name, as a new look says it. */
const markWord = { bold: 'bold', italic: 'italic', strike: 'struck through', code: 'code' }

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** What a new look does to the same words, as its tag says it: "Bold", "Not italic". */
export const lookWords = (look: Look) =>
  upperFirst(
    [...look.added.map((m) => markWord[m]), ...look.removed.map((m) => `not ${markWord[m]}`)].join(
      ', ',
    ),
  )

/** What became of a passage's shape, as its tag says it: "Now numbered", "Now a heading". */
export function shapeWords(was: BlockShape, now: BlockShape) {
  const list = (x: BlockShape) => x.type === 'bullet' || x.type === 'number'
  if (now.type === 'number' && was.type === 'bullet') return 'Now numbered'
  if (now.type === 'bullet' && was.type === 'number') return 'No longer numbered'
  if (list(now) && list(was) && 'depth' in now && 'depth' in was)
    return now.depth > was.depth ? 'Now one step in' : 'Now one step out'
  if (now.type === 'heading' && was.type === 'heading')
    return now.level < was.level ? 'Now a larger heading' : 'Now a smaller heading'
  if (now.type === 'heading') return 'Now a heading'
  if (now.type === 'quote') return 'Now a quote'
  if (list(now)) return now.type === 'number' ? 'Now a numbered step' : 'Now a point'
  if (was.type === 'heading') return 'No longer a heading'
  if (was.type === 'quote') return 'No longer a quote'
  if (list(was)) return 'No longer a list'
  return 'New look'
}

/** What became of a link on the same words, as its tag says it. */
const linkWords: Record<LinkChange, string> = {
  added: 'Link',
  removed: 'No link',
  address: 'New address',
}

/**
 * A tag after words that keep their words: what changed about them, in a word or two, in the
 * text colour on its mark's fill, edged in the mark's line.
 */
function Tag({ kind, children }: { kind: 'look' | 'link'; children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        'ml-1 inline-block rounded-sm border px-1 align-(--nudge) text-xs leading-4 font-medium whitespace-nowrap text-foreground',
        kind === 'look'
          ? 'border-[var(--mark-fmt-line)] bg-[var(--mark-fmt)]'
          : 'border-[var(--mark-link-line)] bg-[var(--mark-link)]',
      )}
    >
      {children}
    </span>
  )
}

/** The same words with a new look: dotted, and on the suggested side tagged with what changed. */
function LookMark({
  look,
  side,
  children,
}: {
  look: Look
  side: 'before' | 'after'
  children: React.ReactNode
}) {
  const words = lookWords(look)
  return (
    <>
      <span className="rounded-xs bg-[var(--mark-fmt)] box-decoration-clone underline decoration-[var(--mark-fmt-line)] decoration-dotted decoration-2 underline-offset-3">
        <span className="sr-only">{side === 'after' ? `[${words}: ` : '[Look changes: '}</span>
        {children}
        <span className="sr-only">]</span>
      </span>
      {side === 'after' && <Tag kind="look">{words}</Tag>}
    </>
  )
}

/** The same words with a new link, or theirs taken off: tinted, tagged on the suggested side. */
function LinkMark({
  link,
  side,
  children,
}: {
  link: LinkChange
  side: 'before' | 'after'
  children: React.ReactNode
}) {
  return (
    <>
      <span className="rounded-xs bg-[var(--mark-link)] box-decoration-clone underline decoration-[var(--mark-link-line)] decoration-2 underline-offset-3">
        <span className="sr-only">
          {side === 'after' ? `[${linkWords[link]}: ` : '[Link changes: '}
        </span>
        {children}
        <span className="sr-only">]</span>
      </span>
      {side === 'after' && <Tag kind="link">{linkWords[link]}</Tag>}
    </>
  )
}

/**
 * A run of a passage: its marks and link as the reader sees them, struck or underlined if its
 * words changed, dotted for a new look and tinted for a new link if they did not.
 */
function RunView({
  run,
  side,
  plain,
}: {
  run: PassageRun
  side: 'before' | 'after'
  plain?: boolean
}) {
  let node: React.ReactNode = (
    <Marks marks={run.marks} code={answerCode}>
      {run.mention ? <MentionText text={run.mention} /> : run.text}
    </Marks>
  )
  const href = safeHref(run.href)
  if (href)
    node = (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="underline decoration-muted-foreground/40 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {node}
      </a>
    )
  if (plain || !run.text.trim()) return node
  if (run.changed) return <Marked side={side}>{node}</Marked>
  if (run.link)
    node = (
      <LinkMark link={run.link} side={side}>
        {node}
      </LinkMark>
    )
  if (run.look)
    node = (
      <LookMark look={run.look} side={side}>
        {node}
      </LookMark>
    )
  return node
}

/** Where a moved passage went, as the line under it says it on each side. */
function moveWords(move: Move, side: 'before' | 'after') {
  const way = move.up ? 'up' : 'down'
  if (side === 'before') return `Moves ${way}`
  return move.steps
    ? `Moved ${way}, from step ${move.steps.from} to step ${move.steps.to}`
    : `Moved ${way}`
}

/** How deep a list item sits: each level one step in. */
const listDepth = ['', 'pl-6', 'pl-12', 'pl-18']

/**
 * A passage drawn as a reader sees it: a paragraph, a heading, a quote, a step or a point. `plain`
 * draws it without its marks, for a text only one side has. A moved passage sits in a tinted block
 * with a line that says where it went; one with a new shape has a dotted line beside it, and on
 * the suggested side `tag` puts the words of its new shape under it.
 */
function PassageView({
  passage,
  side,
  plain,
  tag,
}: {
  passage: Passage
  side: 'before' | 'after'
  plain?: boolean
  tag?: boolean
}) {
  // Punctuation that follows a mention travels with its chip, so it never starts a line alone.
  const lead = (k: number) => {
    const next = passage.runs[k + 1]
    return passage.runs[k]!.mention && next && !next.mention
      ? (/^[.,;:!?)]+/.exec(next.text)?.[0] ?? '')
      : ''
  }
  const words = passage.runs.map((run, i) => {
    const carried = i > 0 ? lead(i - 1) : ''
    const own = carried ? { ...run, text: run.text.slice(carried.length) } : run
    const punct = lead(i)
    const view = own.text || own.mention ? <RunView run={own} side={side} plain={plain} /> : null
    if (!punct) return <React.Fragment key={i}>{view}</React.Fragment>
    const next = passage.runs[i + 1]!
    return (
      <span key={i} className="inline-flex max-w-full items-baseline whitespace-nowrap">
        {view}
        <RunView run={{ ...next, text: punct }} side={side} plain={plain} />
      </span>
    )
  })
  const { shape } = passage
  let body: React.ReactNode
  switch (shape.type) {
    case 'heading':
      body = <p className="font-semibold">{words}</p>
      break
    case 'quote':
      body = (
        <blockquote className="border-l-2 pl-4 text-muted-foreground italic">{words}</blockquote>
      )
      break
    case 'rule':
      body = <hr className="my-3" />
      break
    case 'bullet':
    case 'number':
      body = (
        <div className={cn('flex gap-2', listDepth[Math.min(shape.depth, listDepth.length - 1)])}>
          {shape.type === 'number' ? (
            <span className="w-5 shrink-0 text-right tabular-nums">{passage.n}.</span>
          ) : (
            <span aria-hidden className="w-5 shrink-0 text-right">
              •
            </span>
          )}
          <span className="min-w-0">{words}</span>
        </div>
      )
      break
    default:
      body = <p>{words}</p>
  }
  if (plain) return body
  if (passage.moved) {
    const Arrow = passage.moved.up ? ArrowUpIcon : ArrowDownIcon
    return (
      <div
        data-mark="moved"
        className="-ml-2.5 rounded-r-md border-l-2 border-[var(--mark-move-line)] bg-[var(--mark-move)] py-0.5 pr-2 pl-2"
      >
        {passage.was && side === 'after' ? (
          <span className="sr-only">{`[${shapeWords(passage.was, shape)}] `}</span>
        ) : null}
        {body}
        {passage.was && side === 'after' && tag && (
          <p className="pt-1">
            <Tag kind="look">{shapeWords(passage.was, shape)}</Tag>
          </p>
        )}
        <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Arrow aria-hidden className="size-3" />
          {moveWords(passage.moved, side)}
        </p>
      </div>
    )
  }
  if (passage.was)
    return (
      <div
        data-mark="look"
        className="-ml-3.5 border-l-2 border-dotted border-[var(--mark-fmt-line)] pl-3"
      >
        {side === 'after' ? (
          <span className="sr-only">{`[${shapeWords(passage.was, shape)}] `}</span>
        ) : null}
        {body}
        {side === 'after' && tag && (
          <p className="pt-1">
            <Tag kind="look">{shapeWords(passage.was, shape)}</Tag>
          </p>
        )}
      </div>
    )
  return body
}

/** The place a passage is commented on: its first line on the suggested side, or on the side it has. */
const placeOfPassage = (row: PassageRow): SourcePlace =>
  row.after ? { side: 'after', line: row.after.line } : { side: 'before', line: row.before!.line }

/**
 * The places of the stored text each row stands for: the lines of its passages on each side, and
 * a line between passages (a blank one) goes with the row after it, so every thread on the text
 * hangs under a row.
 */
function placesOfRows(rows: readonly PassageRow[], before: string, after: string) {
  const owned = rows.map((): SourcePlace[] => [])
  const text = { before, after }
  for (const side of ['before', 'after'] as const) {
    const has = rows.flatMap((r, k) => (r[side] ? [k] : []))
    if (!has.length) continue
    const lines = text[side].split('\n').length
    for (let line = 1; line <= lines; line++) {
      const k = has.find((x) => rows[x]![side]!.last >= line) ?? has.at(-1)!
      owned[k]!.push({ side, line })
    }
  }
  return owned
}

/** The marks a text can use, as its legend names them. */
type MarkKind = 'removed' | 'added' | 'look' | 'moved' | 'link'

/** The marks the rows use, in the legend's order. */
function marksIn(rows: readonly PassageRow[]): MarkKind[] {
  const runs = (r: PassageRow, s: 'before' | 'after') =>
    (r[s]?.runs ?? []).filter((x) => x.text.trim())
  const used = new Set<MarkKind>()
  for (const r of rows) {
    if (runs(r, 'before').some((x) => x.changed)) used.add('removed')
    if (runs(r, 'after').some((x) => x.changed)) used.add('added')
    if (r.after?.was || r.before?.was || runs(r, 'after').some((x) => !x.changed && x.look))
      used.add('look')
    if (r.after?.moved || r.before?.moved) used.add('moved')
    if (
      runs(r, 'after').some((x) => !x.changed && x.link) ||
      runs(r, 'before').some((x) => !x.changed && x.link)
    )
      used.add('link')
  }
  return (['removed', 'added', 'look', 'moved', 'link'] as const).filter((k) => used.has(k))
}

/** The legend of the marks a text uses, and only those. */
function Legend({ marks }: { marks: readonly MarkKind[] }) {
  if (!marks.length) return null
  const sample = 'rounded-xs px-1 decoration-2'
  const swatch: Record<MarkKind, React.ReactNode> = {
    removed: (
      <del
        aria-hidden
        className={cn(sample, 'bg-mark-del-word text-foreground decoration-[var(--mark-del-line)]')}
      >
        text
      </del>
    ),
    added: (
      <ins
        aria-hidden
        className={cn(
          sample,
          'bg-mark-add-word text-foreground underline decoration-[var(--mark-add-line)] underline-offset-3',
        )}
      >
        text
      </ins>
    ),
    look: (
      <span
        aria-hidden
        className={cn(
          sample,
          'bg-[var(--mark-fmt)] text-foreground underline decoration-[var(--mark-fmt-line)] decoration-dotted underline-offset-3',
        )}
      >
        text
      </span>
    ),
    moved: (
      <span
        aria-hidden
        className="rounded-r-xs border-l-2 border-[var(--mark-move-line)] bg-[var(--mark-move)] px-1 text-foreground"
      >
        text
      </span>
    ),
    link: (
      <span
        aria-hidden
        className={cn(
          sample,
          'bg-[var(--mark-link)] text-foreground underline decoration-[var(--mark-link-line)] underline-offset-3',
        )}
      >
        text
      </span>
    ),
  }
  const name: Record<MarkKind, string> = {
    removed: 'Removed',
    added: 'Added',
    look: 'New look',
    moved: 'Moved',
    link: 'New link',
  }
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {marks.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          {swatch[k]}
          {name[k]}
        </span>
      ))}
    </p>
  )
}

/** The column of a side with no text: its name, and what stands there instead. */
function Missing({ label, say, first }: { label: string; say?: string; first?: boolean }) {
  return (
    <div
      className={cn(
        'min-w-0 px-6 py-4',
        first ? 'border-b @2xl:border-r @2xl:border-b-0' : 'border-t @2xl:border-t-0',
      )}
    >
      <p className="pb-1.5 text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-muted-foreground">{say ?? 'Nothing'}</p>
    </div>
  )
}

/**
 * The text of the comparison: drawn as a reader sees it, now beside suggested, passage beside
 * passage, with removed words struck on the left and added words underlined on the right, a legend
 * of the marks in use and a footer that counts. A changed passage is a stop for N and P, and with
 * `notes` each passage is a place to comment, its threads under it. A text that stays the same is
 * shown once. One that only one side has (a new item, an archive) keeps both columns: its own
 * text in one, and in the other `missing`, what stands there instead, such as what agents hear. On
 * a narrow pane a changed passage, and a one-sided text, shows now above suggested. `action` sits
 * in its header: the way to the lines.
 */
export function TextComparison({
  before,
  after,
  labels = REVIEW_SIDES,
  notes,
  action,
  missing,
}: {
  before: string
  after: string
  labels?: SideLabels
  notes?: SourceNotes
  action?: React.ReactNode
  /** What the side with no text says: "Nothing yet. Agents hear Not found." */
  missing?: string
}) {
  const id = React.useId()
  const rows = React.useMemo(() => passageDiff(before, after), [before, after])
  const stats = passageStats(rows)
  const owned = React.useMemo(() => placesOfRows(rows, before, after), [rows, before, after])
  const one = !before.trim() || !after.trim()
  const once = one || !stats.changed
  const side: 'before' | 'after' = after.trim() ? 'after' : 'before'
  const legend = once ? [] : marksIn(rows)
  // A new shape's tag goes under the last passage of a run that takes the same new shape.
  const shapeTag = (k: number) => {
    const p = rows[k]?.after
    if (!p?.was) return false
    const next = rows[k + 1]?.after
    return !next?.was || shapeWords(next.was, next.shape) !== shapeWords(p.was, p.shape)
  }
  let n = 0
  const foot = !rows.length
    ? []
    : one
      ? [
          side === 'after' ? 'New text' : 'The text goes with the item',
          `Words: ${stats.words[side]}`,
        ]
      : !stats.changed
        ? ['The text is the same', `Words: ${stats.words.after}`]
        : [
            `${stats.changed} ${stats.changed === 1 ? 'passage' : 'passages'} changed`,
            `${labels.before}: ${stats.words.before} words`,
            `${labels.after}: ${stats.words.after} words`,
          ]
  const passages = (
    <div className="py-4 text-base">
      {!once && (
        <div aria-hidden className="grid grid-cols-2 pb-1.5 text-xs font-medium @max-2xl:hidden">
          <span className="border-r px-6 text-muted-foreground">{labels.before}</span>
          <span className="px-6">{labels.after}</span>
        </div>
      )}
      {once && (
        <p className="px-6 pb-1.5 text-xs font-medium text-muted-foreground">{labels[side]}</p>
      )}
      {rows.map((row, i) => {
        const at = placeOfPassage(row)
        const stopN = row.stop && !once ? ++n : 0
        // Its own place, and every other line of it that holds a thread.
        const threads = notes
          ? [at, ...owned[i]!.filter((p) => placeKey(p) !== placeKey(at) && notes.holds(p))].map(
              (p) => <React.Fragment key={placeKey(p)}>{notes.under(p)}</React.Fragment>,
            )
          : null
        const cell = (s: 'before' | 'after') => {
          const p = row[s]
          return (
            <div
              className={cn(
                'min-w-0 px-6 py-1.5 break-words',
                s === 'before' && '@2xl:border-r',
                // On a narrow pane: a passage that stays the same is said once, a missing side not at all.
                (!p || (!row.changed && s === 'before')) && '@max-2xl:hidden',
              )}
              // A passage that stays the same is read once.
              aria-hidden={!row.changed && s === 'before' ? true : undefined}
            >
              {row.changed && p && (
                <span className="block text-xs text-muted-foreground @2xl:sr-only">
                  {labels[s]}
                </span>
              )}
              {p && <PassageView passage={p} side={s} tag={s === 'after' && shapeTag(i)} />}
            </div>
          )
        }
        return (
          <React.Fragment key={i}>
            <div
              role={stopN ? 'group' : undefined}
              aria-label={stopN ? `Change ${stopN} of ${stats.changed} in the text` : undefined}
              data-review-change={stopN ? '' : undefined}
              data-source-place={notes ? placeKey(at) : undefined}
              tabIndex={stopN || notes ? -1 : undefined}
              className={cn(
                'relative',
                !once && 'grid @max-2xl:gap-1 @2xl:grid-cols-2',
                stopN && stop,
                notes && place,
              )}
            >
              {notes && <AddNote at={at} notes={notes} className="top-2 left-0.5" />}
              {once ? (
                <div className="min-w-0 px-6 py-1.5 break-words">
                  <PassageView passage={row[side]!} side={side} plain />
                </div>
              ) : (
                <>
                  {cell('before')}
                  {cell('after')}
                </>
              )}
              {notes && (
                <span className="hidden justify-end px-6 @2xl:col-span-2 pointer-coarse:group-focus-within/row:flex">
                  <TouchNote at={at} notes={notes} />
                </span>
              )}
            </div>
            {threads}
          </React.Fragment>
        )
      })}
    </div>
  )
  return (
    <section aria-labelledby={`${id}-h`} className="overflow-hidden rounded-frame border">
      <header className="flex min-h-16 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-5 py-3">
        <div className="flex items-center gap-3">
          <h3 id={`${id}-h`} className="text-xl font-semibold">
            Text
          </h3>
          {one && rows.length > 0 ? (
            <Badge
              variant="outline"
              className={cn(
                'border-transparent',
                side === 'after' ? 'bg-good/8 text-good' : 'bg-destructive/8 text-destructive',
              )}
            >
              {side === 'after' ? 'New' : 'Goes'}
            </Badge>
          ) : (
            rows.length > 0 && (
              <Badge
                variant={stats.reworded ? 'outline' : 'secondary'}
                className={cn(stats.reworded && 'border-transparent bg-caution/8 text-caution')}
              >
                {stats.reworded ? 'Changed' : stats.changed ? 'The same words' : 'The same'}
              </Badge>
            )
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Legend marks={legend} />
          {action}
        </div>
      </header>
      {!rows.length ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">No text</p>
      ) : one ? (
        <div className="grid @2xl:grid-cols-2">
          {side === 'after' && <Missing label={labels.before} say={missing} first />}
          <div className={cn('min-w-0', side === 'before' && '@2xl:border-r')}>{passages}</div>
          {side === 'before' && <Missing label={labels.after} say={missing} />}
        </div>
      ) : (
        passages
      )}
      {foot.length > 0 && (
        <p className="flex flex-wrap gap-x-6 gap-y-1 border-t bg-muted/50 px-6 py-3 text-xs text-muted-foreground">
          {foot.map((f) => (
            <span key={f}>{f}</span>
          ))}
        </p>
      )}
    </section>
  )
}

/* ---------- the bar ---------- */

/**
 * The bar on top of the comparison: what is compared, now and suggested, each with who and when,
 * and how many of the fields change and stay the same. A new item and
 * an archive have one side, and the bar says which of the two it is.
 */
export function CompareBar({
  now,
  suggested,
  by,
  mode,
  changed,
  same,
  labels = REVIEW_SIDES,
}: {
  /** Who and when on each side, in words. */
  now: string
  suggested: string
  /** The face of whoever suggested it. */
  by?: React.ReactNode
  mode: 'edit' | 'new' | 'retire'
  changed: number
  same: number
  labels?: SideLabels
}) {
  return (
    <section
      aria-label="What is compared"
      className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-frame border bg-muted/50 px-5 py-4 text-sm"
    >
      <p className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 @max-lg:basis-full">
        <span
          aria-hidden
          className="grid size-7 shrink-0 place-items-center rounded-full border bg-background"
        >
          <span className={cn('size-2 rounded-full', mode === 'new' ? 'bg-input' : 'bg-good')} />
        </span>
        {/* Spaces between the words, which a flex row does not draw, so they read as a sentence. */}
        <span className="font-semibold">{labels.before}</span>{' '}
        <span className="text-muted-foreground">{now}</span>
      </p>{' '}
      {/* The arrow leads the suggested side, so it stays with it when the bar wraps. */}
      <p className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 @max-lg:basis-full">
        <span className="sr-only">to</span>{' '}
        <ArrowRightIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        {by && <span aria-hidden>{by}</span>}
        <span className="font-semibold">{labels.after}</span>{' '}
        <span className="text-muted-foreground">{suggested}</span>
      </p>{' '}
      <p className="ml-auto flex flex-wrap items-center gap-2 @max-lg:ml-0 @max-lg:basis-full">
        {mode === 'edit' ? (
          <>
            {/* Amber says look here; with no field changed there is nothing to look at. */}
            <Badge
              variant={changed ? 'outline' : 'secondary'}
              className={cn(changed && 'border-transparent bg-caution/8 text-caution')}
            >
              {changed} changed
            </Badge>{' '}
            <Badge variant="secondary">{same} the same</Badge>
          </>
        ) : (
          <Badge
            variant="outline"
            className={cn(
              'border-transparent',
              mode === 'new' ? 'bg-good/8 text-good' : 'bg-destructive/8 text-destructive',
            )}
          >
            {mode === 'new' ? 'A new item' : 'The whole item goes'}
          </Badge>
        )}
      </p>
    </section>
  )
}
