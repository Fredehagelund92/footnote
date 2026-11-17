import * as React from 'react'
import type { WeekParts } from '@/components/heed/asked-week'
import type { AnswerState, AskedRow, AskedWeek } from '@/model/ask'

// Asked this week once the week is in: the bar of its topics by state, the rows and the footer. It
// loads on its own, with the week, and is handed what it uses of the first page (`weekParts` in
// asked-week.tsx): were it to import those itself, the bundler would split them into more chunks
// that the first page then fetches too.

/** The tile under a row's icon: the state's colour at 8 percent, a hairline where it has none. */
const tileTone: Record<AnswerState, string> = {
  grounded: 'bg-good/8',
  partial: 'bg-muted',
  missing: 'shadow-hairline',
  conflict: 'bg-caution/8 ring-1 ring-caution/45 ring-inset',
  stale: 'bg-caution/8',
  failed: 'bg-muted',
}

/**
 * How the bar fills each state, as Observability's chart does (`components/obs/charts.tsx`), so a
 * state looks the same in both: Not found is the hatch, by its pattern's id.
 */
const barFill = (state: AnswerState, hatch: string) =>
  ({
    grounded: 'var(--good)',
    partial: 'var(--chart-1)',
    conflict: 'var(--caution)',
    stale: 'color-mix(in oklab, var(--caution) 45%, var(--background))',
    missing: `url(#${hatch})`,
    failed: 'var(--chart-2)',
  })[state]
const BAR_ORDER: AnswerState[] = ['grounded', 'partial', 'conflict', 'stale', 'missing', 'failed']

/** The topics of the week by state: a bar, and under it each state's count in words. */
function StateBar({ rows, parts }: { rows: readonly AskedRow[]; parts: WeekParts }) {
  const { stateLabel } = parts
  // A pattern id unique on the page: useId's colons aren't allowed in url(#...).
  const hatch = `asked-hatch-${React.useId().replace(/[^a-zA-Z0-9-]/g, '')}`
  const counts = BAR_ORDER.map((state) => ({
    state,
    n: rows.filter((r) => r.state === state).length,
  })).filter((c) => c.n > 0)
  const named = counts.map((c) => `${c.n} ${stateLabel[c.state]}`).join(', ')
  return (
    <div className="flex flex-col gap-2.5">
      <svg aria-hidden className="absolute size-0">
        <defs>
          <pattern
            id={hatch}
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="5" height="5" fill="var(--muted)" />
            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--chart-2)" strokeWidth="1.6" />
          </pattern>
        </defs>
      </svg>
      <div role="img" aria-label={`${rows.length} topics: ${named}`} className="flex h-1.5 gap-0.5">
        {counts.map((c) => (
          <svg key={c.state} data-part={c.state} className="h-full min-w-0" style={{ flex: c.n }}>
            <rect width="100%" height="100%" fill={barFill(c.state, hatch)} />
          </svg>
        ))}
      </div>
      <p aria-hidden className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
        {counts.map((c) => (
          <span key={c.state} className="inline-flex items-center gap-1.5">
            <svg data-part={c.state} className="size-2.5 shrink-0">
              <rect width="10" height="10" fill={barFill(c.state, hatch)} />
            </svg>
            <span className="font-semibold text-foreground tabular-nums">{c.n}</span>
            {stateLabel[c.state]}
          </span>
        ))}
      </p>
    </div>
  )
}

export default function WeekList({
  week: w,
  onPick,
  parts,
}: {
  week: AskedWeek
  onPick: (question: string) => void
  parts: WeekParts
}) {
  const { ArrowUpRightIcon, ASKED_ROWS, Card, ChevronDownIcon, cn, EyeOffIcon, seesObservability } =
    parts
  const me = parts.useMe()
  // The four most asked; the rest open in place, so the empty page stays calm.
  const [all, setAll] = React.useState(false)
  const more = w.rows.length - ASKED_ROWS
  const rows = all ? w.rows : w.rows.slice(0, ASKED_ROWS)
  const asked =
    w.asked !== null
      ? w.asked
      : w.askedAtLeast && w.askedAtLeast >= 5
        ? `${w.askedAtLeast}+`
        : 'fewer than 5'
  return (
    <Card
      caption={`${asked} times · counts only, never the words`}
      bar={<StateBar rows={w.rows} parts={parts} />}
    >
      <ul>
        {rows.map((r) => (
          <Row
            key={r.topic.id}
            row={r}
            mine={me.admin || (!!r.topic.domain && me.owns.includes(r.topic.domain))}
            onPick={onPick}
            parts={parts}
          />
        ))}
      </ul>
      {(more > 0 || w.hidden > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2 text-xs text-muted-foreground">
          {more > 0 && (
            <button
              type="button"
              aria-expanded={all}
              onClick={() => setAll(!all)}
              className="-ml-1 inline-flex h-7 items-center gap-1 rounded-md px-1 font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {all ? 'Show fewer' : `Show ${more} more`}
              <ChevronDownIcon
                className={cn(
                  'size-3.5 transition-transform duration-(--dur-2)',
                  all && 'rotate-180',
                )}
                aria-hidden
              />
            </button>
          )}
          {w.hidden > 0 && (
            <span className="flex items-center gap-1.5">
              <EyeOffIcon className="size-3.5 shrink-0" aria-hidden />
              {w.hidden} questions were about topics asked fewer than 5 times, so they are not
              shown.
            </span>
          )}
          {seesObservability(me) && (
            <a
              href="/observability"
              className="ml-auto inline-flex items-center gap-0.5 underline-offset-4 hover:text-foreground hover:underline"
            >
              In Observability
              <ArrowUpRightIcon className="size-3" aria-hidden />
            </a>
          )}
        </div>
      )}
    </Card>
  )
}

function Row({
  row: r,
  mine,
  onPick,
  parts,
}: {
  row: AskedRow
  mine: boolean
  onPick: (question: string) => void
  parts: WeekParts
}) {
  const { ArrowRightIcon, cn, stateIcon, stateInk, Tooltip, TooltipContent, TooltipTrigger } = parts
  const { rowClassName, textClassName, topicClassName, stateClassName, countClassName } = parts
  const answering = React.use(parts.Answering)
  const ANSWER_LINES = parts.ANSWER_LINES
  const id = React.useId()
  const line = ANSWER_LINES.find((l) => l.state === r.state)!
  const pick = () => !answering && onPick(r.question)
  const Icon = stateIcon[r.state]
  return (
    <li className={cn(rowClassName, !answering && 'hover:bg-muted/50')}>
      <span
        aria-hidden
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-md',
          tileTone[r.state],
          answering && 'opacity-60',
        )}
      >
        <Icon className={cn('size-4', stateInk[r.state])} />
      </span>
      <span className={textClassName}>
        <span className={topicClassName}>
          <button
            type="button"
            aria-disabled={answering || undefined}
            aria-describedby={`${id}-state ${id}-count`}
            onClick={pick}
            className="static min-w-0 truncate text-left text-sm font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
          >
            {r.title}
          </button>
          {mine && r.next && (
            <a
              href={r.next.href}
              className="relative inline-flex shrink-0 items-center gap-0.5 rounded-sm text-xs font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {r.next.label}
              <span className="sr-only"> for {r.title}</span>
              <ArrowRightIcon className="size-3" aria-hidden />
            </a>
          )}
        </span>
        {/* Above the row's button, so the state's sentence shows on hover; a click on it asks too. */}
        <span className={cn(stateClassName, 'relative', answering && 'opacity-60')}>
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  aria-hidden
                  className={cn('text-xs font-semibold', stateInk[r.state])}
                  onClick={pick}
                />
              }
            >
              {line.label}
            </TooltipTrigger>
            <TooltipContent className="max-w-64 text-pretty">{line.sentence}</TooltipContent>
          </Tooltip>
          <span id={`${id}-state`} className="sr-only">
            {line.label}. {line.sentence}
          </span>
        </span>
      </span>
      <span id={`${id}-count`} className={cn(countClassName, answering && 'opacity-60')}>
        {r.count} times
      </span>
    </li>
  )
}

/** Under the lifted box: the three states an answer is most often in, taught once. */
const LEGEND: AnswerState[] = ['grounded', 'stale', 'missing']

export function Legend({ parts }: { parts: WeekParts }) {
  const { cn, stateIcon, stateInk, stateLabel } = parts
  return (
    <p className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {LEGEND.map((s, i) => {
        const Icon = stateIcon[s]
        return (
          <span key={s} className="inline-flex items-center gap-1">
            <Icon aria-hidden className={cn('size-3 shrink-0', stateInk[s])} />
            {stateLabel[s]}
            <span className="sr-only">{i < LEGEND.length - 1 ? ',' : '.'}</span>
          </span>
        )
      })}
      <span>Every answer says which.</span>
    </p>
  )
}
