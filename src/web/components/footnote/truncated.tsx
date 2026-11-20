import * as React from 'react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// A title that may be cut off with an ellipsis, and the full title when it is: one component for
// every list (Inbox, the review's queue, Context, Definitions, Ask history). It measures itself
// (scrollWidth against clientWidth, kept current as the row resizes), so a title that fits gets no
// pointless tooltip, and no tooltip is mounted for it. The tooltip is a light hairline surface,
// 13px, up to 320px wide and wrapping, after 400ms; keyboard focus on the row shows it too. Touch
// gets nothing, and nothing shifts.

const surface =
  'max-w-80 rounded-md border bg-popover px-2.5 py-1.5 text-xs leading-snug text-popover-foreground whitespace-normal shadow-none [&>:last-child]:hidden'

/** `text` is what the tooltip says; `children` (a highlighted match, say) is what the row shows, by default the text. */
export function TruncatedText({
  text,
  children,
  className,
  lines = 1,
}: {
  text: string
  children?: React.ReactNode
  className?: string
  lines?: 1 | 2
}) {
  const [el, setEl] = React.useState<HTMLSpanElement | null>(null)
  const [cut, setCut] = React.useState(false)
  const [open, setOpen] = React.useState(false)

  // Measured once the browser has laid it out, and again as it resizes: a long list that draws its
  // rows as they scroll in never forces a layout for each title.
  React.useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(() =>
      setCut(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1),
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [el, text])

  // The row (a button or a link around the title) taking keyboard focus opens it as well.
  React.useEffect(() => {
    const row = el?.closest<HTMLElement>('button, a, [tabindex]')
    if (!row || !cut) return
    const on = () => row.matches(':focus-visible') && setOpen(true)
    const off = () => setOpen(false)
    row.addEventListener('focus', on)
    row.addEventListener('blur', off)
    return () => {
      row.removeEventListener('focus', on)
      row.removeEventListener('blur', off)
    }
  }, [el, cut])

  const span = (
    <span
      ref={setEl}
      className={cn('block min-w-0', lines === 2 ? 'line-clamp-2' : 'truncate', className)}
    />
  )
  // A title that fits is a plain span: only a cut one carries its tooltip.
  if (!cut) return React.cloneElement(span, undefined, children ?? text)
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger delay={400} render={span}>
        {children ?? text}
      </TooltipTrigger>
      <TooltipContent side="top" align="start" sideOffset={6} className={surface}>
        {text}
      </TooltipContent>
    </Tooltip>
  )
}
