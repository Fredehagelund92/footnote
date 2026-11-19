import * as React from 'react'
import { Kpi } from '@/components/obs/controls'
import { dayLabel } from '@/model/observability'

// One empty state for every Observability page, as Overview's nothing connected draws it: the
// page's number cells with a dash, its chart faded with nothing in it, one sentence on why it is
// empty, and the next step. A reader hears the sentence and the step; the faded chart is only
// there to show where the numbers will go.

export function ObsEmpty({
  cells,
  chart,
  icon,
  title,
  sentence,
  next,
}: {
  /** The page's number cells, each with its icon and label: drawn with a dash, "Nothing yet". */
  cells: { icon: React.ReactNode; label: string }[]
  /** The page's chart with nothing in it, drawn faded; none on a page without a chart. */
  chart?: React.ReactNode
  icon: React.ReactNode
  title: string
  /** Why the page is empty, and what fills it, in one sentence. */
  sentence: string
  /** What to do next: a link or a button. */
  next: React.ReactNode
}) {
  return (
    <div data-slot="obs-empty" className="border-t">
      {cells.length > 0 && (
        <div className="grid grid-cols-2 gap-px border-b bg-border @3xl/main:grid-cols-4">
          {cells.map((c) => (
            <Kpi
              key={c.label}
              icon={c.icon}
              label={c.label}
              value={<span className="text-muted-foreground">-</span>}
              sub="Nothing yet"
            />
          ))}
        </div>
      )}
      <div className={chart ? 'grid grid-cols-1 @4xl/main:grid-cols-(--cols-split-6-5)' : ''}>
        {chart && (
          // On a narrow page the words and the next step come first, the faded chart after them.
          <div
            aria-hidden
            className="border-t px-4 py-6 opacity-50 md:px-5 @max-4xl/main:order-last @4xl/main:border-t-0"
          >
            {chart}
          </div>
        )}
        <div className={chart ? 'px-4 py-6 md:px-8 @4xl/main:border-l' : 'px-4 py-6 md:px-5'}>
          <div className="mb-1.5 flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-md border text-muted-foreground [&_svg]:size-5">
              {icon}
            </span>
            <h3 className="text-base font-semibold">{title}</h3>
          </div>
          <p className="mb-4 max-w-caption text-sm text-muted-foreground">{sentence}</p>
          <div data-slot="next-step" className="flex flex-wrap items-center gap-2">
            {next}
          </div>
        </div>
      </div>
    </div>
  )
}

/** The last 7 days' labels, up to the last day counted: the days an empty chart is drawn over. */
export const emptyDays = (last: number) =>
  Array.from({ length: 7 }, (_, i) => dayLabel(last - (6 - i) * 86_400_000))
