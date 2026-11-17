import * as React from 'react'
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  ChevronDownIcon,
  CloudAlertIcon,
  EyeOffIcon,
} from '@/components/icons'
import { cn } from '@/lib/utils'
import { StateLine } from '@/components/heed/bits'
import { Answering } from '@/components/heed/suggestions'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useQuery } from '@tanstack/react-query'
import { askedWeekQuery } from '@/api/queries'
import { ASKED_ROWS, type AskedRow } from '@/model/ask'
import { ANSWER_LINES } from '@/lib/help-content'
import { seesObservability } from '@/lib/obs'
import { useMe } from '@/lib/workspace'

// The empty Ask: what agents asked about most this week, each topic with the state Ask gives it now
// and how often it was asked. Everyone sees it, as counts only: never the words of a question, never
// who asked. An owner sees the draft or suggestion that waits on a Not found topic of their domain.

/**
 * One line per topic where there is room: the topic, its state in a column of its own and the count
 * in a right-aligned column, so every row is the same height and no count moves. On a phone the
 * state goes under the topic. The row's button covers the whole row; the owner's link and the
 * state, which has its sentence as a tooltip, sit above it.
 */
const rowClassName = cn(
  'relative flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5 last:border-b-0 @lg:h-13 @lg:flex-nowrap @lg:py-0',
)
const topicClassName = cn('flex min-w-0 flex-1 items-center gap-2')
const stateClassName = cn(
  'order-last basis-full @lg:order-none @lg:w-26 @lg:shrink-0 @lg:basis-auto',
)
const countClassName = cn('shrink-0 text-right text-xs text-muted-foreground tabular-nums @lg:w-16')

export function AskedThisWeek({ onPick }: { onPick: (question: string) => void }) {
  const me = useMe()
  const week = useQuery(askedWeekQuery())
  // The four most asked; the rest open in place, so the empty page stays calm.
  const [all, setAll] = React.useState(false)
  const w = week.data
  if (w && !w.rows.length) return null
  if (!w)
    return (
      <Card busy={!week.isError}>
        {week.isError ? (
          <div role="alert" className="flex items-center gap-2 px-4 py-3 text-sm">
            <CloudAlertIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <p className="min-w-0 flex-1 text-muted-foreground">
              Couldn&apos;t load this week&apos;s counts.
            </p>
            <button
              type="button"
              onClick={() => void week.refetch()}
              className="shrink-0 rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Retry
            </button>
          </div>
        ) : (
          // Rows of the real height while the week loads, so nothing moves when it arrives.
          <div role="status" aria-label="Loading">
            {Array.from({ length: ASKED_ROWS }, (_, i) => (
              <div key={i} data-skeleton-row className={rowClassName}>
                <span className={topicClassName}>
                  <Skeleton className="h-5" style={{ width: `${35 + ((i * 17) % 30)}%` }} />
                </span>
                <span className={stateClassName}>
                  <Skeleton className="h-5 w-20" />
                </span>
                <span className={countClassName}>
                  <Skeleton className="ml-auto h-4 w-12" />
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    )
  const more = w.rows.length - ASKED_ROWS
  const rows = all ? w.rows : w.rows.slice(0, ASKED_ROWS)
  const asked =
    w.asked !== null
      ? w.asked
      : w.askedAtLeast && w.askedAtLeast >= 5
        ? `${w.askedAtLeast}+`
        : 'fewer than 5'
  return (
    <Card caption={`${asked} times · counts only, never the words`}>
      <ul>
        {rows.map((r) => (
          <Row
            key={r.topic.id}
            row={r}
            mine={me.admin || (!!r.topic.domain && me.owns.includes(r.topic.domain))}
            onPick={onPick}
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

/** The card and its heading: the caption once the week is in, a bar of its height until then. */
function Card({
  caption,
  busy,
  children,
}: {
  caption?: string
  busy?: boolean
  children: React.ReactNode
}) {
  return (
    <section
      aria-labelledby="asked-week"
      aria-busy={busy || undefined}
      className="overflow-hidden rounded-frame border bg-background"
    >
      <div className="flex flex-col gap-0.5 border-b px-4 py-3 @lg:flex-row @lg:items-baseline @lg:justify-between @lg:gap-4">
        <h3 id="asked-week" className="text-sm font-semibold">
          Asked this week
        </h3>
        {caption ? (
          <p className="text-xs text-muted-foreground">{caption}</p>
        ) : (
          busy && (
            <p aria-hidden className="relative w-fit text-xs text-transparent">
              142 times · counts only, never the words
              <Skeleton className="absolute inset-0" />
            </p>
          )
        )}
      </div>
      {children}
    </section>
  )
}

function Row({
  row: r,
  mine,
  onPick,
}: {
  row: AskedRow
  mine: boolean
  onPick: (question: string) => void
}) {
  const answering = React.use(Answering)
  const id = React.useId()
  const line = ANSWER_LINES.find((l) => l.state === r.state)!
  const pick = () => !answering && onPick(r.question)
  return (
    <li className={cn(rowClassName, !answering && 'hover:bg-muted/50')}>
      <span className={topicClassName}>
        <button
          type="button"
          aria-disabled={answering || undefined}
          aria-describedby={`${id}-state ${id}-count`}
          onClick={pick}
          className="min-w-0 truncate text-left text-sm font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
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
          <TooltipTrigger render={<span aria-hidden className="flex w-fit" onClick={pick} />}>
            <StateLine state={r.state} tip={false} className="px-1.5 py-0.5 text-xs" />
          </TooltipTrigger>
          <TooltipContent className="max-w-64 text-pretty">{line.sentence}</TooltipContent>
        </Tooltip>
        <span id={`${id}-state`} className="sr-only">
          {line.label}. {line.sentence}
        </span>
      </span>
      <span id={`${id}-count`} className={cn(countClassName, answering && 'opacity-60')}>
        {r.count} times
      </span>
    </li>
  )
}
