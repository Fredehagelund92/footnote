import {
  BadgeCheckIcon,
  CalendarClockIcon,
  CircleDashedIcon,
  CircleDotDashedIcon,
  CircleHalfIcon,
  SplitIcon,
  UnplugIcon,
} from '@/components/icons'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AnswerState } from '@/model/ask'
import { ANSWER_LINES } from '@/lib/help-content'

/** Each state's icon, the same wherever the state shows. */
export const stateIcon: Record<AnswerState, typeof BadgeCheckIcon> = {
  grounded: BadgeCheckIcon,
  partial: CircleHalfIcon,
  missing: CircleDashedIcon,
  conflict: SplitIcon,
  stale: CalendarClockIcon,
  failed: UnplugIcon,
}

/**
 * The one line that says what kind of answer this is, in one or two plain words from the one list
 * (`ANSWER_LINES`), always with its icon and tint, never colour alone and never the word alone.
 * `sentence` adds the short sentence under it for every state but Checked; the tooltip gives the
 * longer meaning. `draft` is an answer from text nobody has checked yet: a dashed ring, never the
 * checked mark. Built of spans, so it can sit inside a button.
 */
export function StateLine({
  state,
  draft,
  children,
  className,
  sentence,
  tip = true,
}: {
  state: AnswerState
  draft?: boolean
  /** Other words in place of the state's own, such as an answer from a draft. */
  children?: ReactNode
  className?: string
  sentence?: boolean
  /** The tooltip with the longer meaning; off where something else explains it. */
  tip?: boolean
}) {
  const line = ANSWER_LINES.find((l) => l.state === state)!
  const Icon = draft && state === 'grounded' ? CircleDotDashedIcon : stateIcon[state]
  const chip = (
    <span
      className={cn(
        'flex w-fit items-center gap-2 rounded-md px-2 py-1 text-sm font-semibold',
        draft ? 'border border-dashed border-input' : stateTone[state],
        className,
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span>{children ?? line.label}</span>
    </span>
  )
  const shown =
    tip && !draft ? (
      <Tooltip>
        <TooltipTrigger render={<span className="flex w-fit" />}>{chip}</TooltipTrigger>
        <TooltipContent className="block max-w-64 text-pretty">
          <span className="font-semibold">{line.long}.</span> {line.means}
        </TooltipContent>
      </Tooltip>
    ) : (
      chip
    )
  if (!sentence || draft || state === 'grounded') return shown
  return (
    <span className="flex flex-col gap-1">
      {shown}
      <span className="text-sm font-normal text-muted-foreground">{line.sentence}</span>
    </span>
  )
}

/**
 * Each state told apart at a glance, never by colour alone (the icon and the words differ too): a
 * quiet tint per state, the words in the text colour so they keep 4.5:1 in both themes. Where two
 * states share a tint, an edge tells them apart, and it is drawn at 3:1 or more: Conflict's ring is
 * the full amber, Partial is outlined, and Not looked up is the one grey chip.
 */
const stateTone: Record<AnswerState, string> = {
  grounded: 'bg-good/8 [&>svg]:text-good',
  partial: 'ring-1 ring-input ring-inset [&>svg]:text-foreground',
  missing: 'border border-dashed border-input [&>svg]:text-muted-foreground',
  conflict: 'bg-caution/8 ring-1 ring-caution ring-inset [&>svg]:text-caution',
  stale: 'bg-caution/8 [&>svg]:text-caution',
  failed: 'bg-muted [&>svg]:text-muted-foreground',
}

/**
 * The rule down the left edge of a row or a card that has a state, for a long list read by
 * scanning: solid green for Checked, dashed grey for Partial, thick amber for Conflict, dotted
 * amber for Outdated and solid grey for Not looked up. Not found has none, so the gaps are the
 * rows that stand back. The pattern is its own sign, so the rule never carries a state by colour
 * alone; the row's words and icon say it too. The row sets `relative`.
 */
const stateEdgeTone: Record<AnswerState, string | null> = {
  grounded: 'border-l-3 border-good',
  partial: 'border-l-3 border-dashed border-muted-foreground',
  missing: null,
  conflict: 'border-l-5 border-caution',
  stale: 'border-l-3 border-dotted border-caution',
  failed: 'border-l-3 border-input',
}

export function StateEdge({ state }: { state: AnswerState }) {
  const tone = stateEdgeTone[state]
  return tone && <span aria-hidden className={cn('absolute inset-y-0 left-0', tone)} />
}
