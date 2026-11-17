import * as React from 'react'
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  ChevronDownIcon,
  CloudAlertIcon,
  EyeOffIcon,
} from '@/components/icons'
import { cn } from '@/lib/utils'
import { stateIcon } from '@/components/heed/state-line'
import { Answering } from '@/components/heed/suggestions'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useQuery } from '@tanstack/react-query'
import { askedWeekQuery } from '@/api/queries'
import { ASKED_ROWS, stateLabel, type AnswerState } from '@/model/ask'
import { ANSWER_LINES } from '@/lib/help-content'
import { seesObservability } from '@/lib/obs'
import { useMe } from '@/lib/workspace'

// The empty Ask: what agents asked about most this week, each topic with the state Ask gives it now
// and how often it was asked. Everyone sees it, as counts only: never the words of a question, never
// who asked. An owner sees the draft or suggestion that waits on a Not found topic of their domain.

const loadList = () => import('@/components/heed/asked-week-list')
const WeekList = React.lazy(loadList)

/**
 * One line per topic where there is room: the state's icon on a tile of its tint, the topic, the
 * state's word in its colour and the count in a right-aligned column, so every row is the same
 * height and no count moves. On a phone the word goes under the topic. The row's button covers the
 * whole row; the owner's link and the word, which has its sentence as a tooltip, sit above it.
 */
const rowClassName = cn(
  'relative flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0 @lg:h-13 @lg:py-0',
)
const textClassName = cn(
  'flex min-w-0 flex-1 flex-col gap-0.5 @lg:flex-row @lg:items-center @lg:gap-3',
)
const topicClassName = cn('flex min-w-0 flex-1 items-center gap-2')
const stateClassName = cn('flex @lg:w-20 @lg:shrink-0 @lg:justify-end')
const countClassName = cn('w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums')

/** A state's colour, never alone: green for checked, amber to look at, the muted grey for the rest. */
const stateInk: Record<AnswerState, string> = {
  grounded: 'text-good',
  partial: 'text-muted-foreground',
  missing: 'text-muted-foreground',
  conflict: 'text-caution',
  stale: 'text-caution',
  failed: 'text-muted-foreground',
}

/** Under the lifted box: the three states an answer is most often in, taught once. */
const LEGEND: AnswerState[] = ['grounded', 'stale', 'missing']

export function StateLegend() {
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

export function AskedThisWeek({ onPick }: { onPick: (question: string) => void }) {
  const week = useQuery(askedWeekQuery())
  // The list's code comes while the week is read, not after.
  React.useEffect(() => void loadList(), [])
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
              Try again
            </button>
          </div>
        ) : (
          <Loading />
        )}
      </Card>
    )
  // The list itself loads with the week, so the first page of the app carries only its skeleton.
  return (
    <React.Suspense
      fallback={
        <Card busy>
          <Loading />
        </Card>
      }
    >
      <WeekList week={w} onPick={onPick} parts={weekParts} />
    </React.Suspense>
  )
}

/** Rows of the real height while the week loads, so nothing moves when it arrives. */
function Loading() {
  return (
    <div role="status" aria-label="Loading">
      {Array.from({ length: ASKED_ROWS }, (_, i) => (
        <div key={i} data-skeleton-row className={rowClassName}>
          <Skeleton className="size-7 shrink-0 rounded-md" />
          <span className={textClassName}>
            <span className={topicClassName}>
              <Skeleton className="h-5" style={{ width: `${35 + ((i * 17) % 30)}%` }} />
            </span>
            <span className={stateClassName}>
              <Skeleton className="h-4 w-16" />
            </span>
          </span>
          <span className={countClassName}>
            <Skeleton className="ml-auto h-4 w-12" />
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * The card and its heading: the caption and the bar of states once the week is in, placeholders of
 * their height until then.
 */
function Card({
  caption,
  bar,
  busy,
  children,
}: {
  caption?: string
  bar?: React.ReactNode
  busy?: boolean
  children: React.ReactNode
}) {
  return (
    <section
      aria-labelledby="asked-week"
      aria-busy={busy || undefined}
      className="overflow-hidden rounded-frame border bg-background"
    >
      <div className="flex flex-col gap-3 border-b px-4 py-3">
        <div className="flex flex-col gap-0.5 @lg:flex-row @lg:items-baseline @lg:justify-between @lg:gap-4">
          <h3 id="asked-week" className="text-sm font-semibold">
            Asked this week
          </h3>
          {caption ? (
            <p className="text-xs text-muted-foreground">{caption}</p>
          ) : (
            busy && (
              <div aria-hidden className="relative w-fit text-xs text-transparent">
                142 times · counts only, never the words
                <Skeleton className="absolute inset-0" />
              </div>
            )
          )}
        </div>
        {bar ??
          (busy && (
            <div aria-hidden className="flex flex-col gap-2.5">
              <Skeleton className="h-1.5" />
              <Skeleton className="h-4 w-3/5" />
            </div>
          ))}
      </div>
      {children}
    </section>
  )
}

/** What the list once the week is in (asked-week-list.tsx) uses of the first page, handed to it. */
const weekParts = {
  ArrowRightIcon,
  ArrowUpRightIcon,
  ChevronDownIcon,
  EyeOffIcon,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Answering,
  Card,
  cn,
  stateIcon,
  stateInk,
  stateLabel,
  rowClassName,
  textClassName,
  topicClassName,
  stateClassName,
  countClassName,
  ASKED_ROWS,
  ANSWER_LINES,
  seesObservability,
  useMe,
}
export type WeekParts = typeof weekParts
