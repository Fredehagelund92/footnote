import * as React from 'react'
import { cn } from '@/lib/utils'
import type { Press } from '@/lib/list-motion'
import { ChevronDownIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// The three ways the app lets someone pick between things, one component each, so a later
// change is one edit:
//   ViewToggle   another view of the same thing, usually an advanced one: one quiet icon button
//   TextSwitch   a filter or a two-way option: words (with counts), the chosen one underlined
//   ChoiceMenu   a decision in a row, usually left as it is: the answer as a quiet menu button,
//                each answer in its menu with what it does
// No pill tabs, no segmented tracks.

/** Another view of the same thing: one icon button, pressed while that view is on. */
export function ViewToggle({
  pressed,
  onPressedChange,
  icon,
  text,
  on,
  off,
}: {
  pressed: boolean
  onPressedChange: (p: boolean) => void
  icon: React.ReactNode
  /** A short visible word beside the icon ("Source"), for a toggle that isn't obvious from its icon. */
  text?: string
  on: string
  off: string
}) {
  const label = pressed ? off : on
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="outline"
            size={text ? 'default' : 'icon'}
            aria-label={on}
            aria-pressed={pressed}
            onClick={() => onPressedChange(!pressed)}
            className="aria-pressed:border-foreground/40 aria-pressed:bg-muted aria-pressed:text-foreground"
          />
        }
      >
        {icon}
        {text}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export type TextOption<T extends string> = {
  value: T
  label: React.ReactNode
  /** The choice's name for a screen reader, where its label can fold away (a narrow page header). */
  name?: string
  count?: number
  icon?: React.ReactNode
}

/** Move the choice with the arrow keys, as a radio group does. */
function useArrows<T extends string>(values: T[], value: T, onChange: (v: T) => void) {
  return (e: React.KeyboardEvent<HTMLElement>) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0
    if (!step) return
    e.preventDefault()
    const next = values[(values.indexOf(value) + step + values.length) % values.length]!
    const group = e.currentTarget
    onChange(next)
    requestAnimationFrame(() => group.querySelector<HTMLElement>(`[data-value="${next}"]`)?.focus())
  }
}

/**
 * Words to choose from, Linear style: quiet text with an optional count, the chosen one in ink with
 * a 2px underline that slides to it. For a list filter ("Needs me 15  All 23") and for a two-way
 * option said as a sentence ("Answer as Draft - Published").
 */
export function TextSwitch<T extends string>({
  label,
  options,
  value,
  onChange,
  lead,
  separator,
  className,
}: {
  /** The group's name for screen readers. */
  label: string
  options: TextOption<T>[]
  value: T
  /** The press that chose, when one chose it: the keys report none, so they stay instant. */
  onChange: (v: T, press?: Press) => void
  /** Words before the choices, shown: "Answer as". */
  lead?: string
  /** A quiet mark between the words, for the sentence form. */
  separator?: string
  className?: string
}) {
  const wrap = React.useRef<HTMLDivElement>(null)
  // The underline slides only when the choice changes; a label growing (a count) just moves it.
  const [bar, setBar] = React.useState<{
    left: number
    width: number
    of: T
    slide: boolean
  } | null>(null)
  React.useLayoutEffect(() => {
    const el = wrap.current?.querySelector<HTMLElement>(`[data-value="${value}"]`)
    if (el)
      setBar((b) => ({
        left: el.offsetLeft,
        width: el.offsetWidth,
        of: value,
        slide: !!b && b.of !== value,
      }))
  }, [value, options])
  const onKeyDown = useArrows(
    options.map((o) => o.value),
    value,
    onChange,
  )
  return (
    <div className={cn('flex items-center gap-2 text-sm', className)}>
      {lead && <span className="text-muted-foreground">{lead}</span>}
      <div
        ref={wrap}
        role="radiogroup"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="relative flex items-center gap-3"
      >
        {options.map((o, i) => {
          const on = o.value === value
          return (
            <React.Fragment key={o.value}>
              {separator && i > 0 && (
                <span aria-hidden className="-mx-1.5 text-muted-foreground">
                  {separator}
                </span>
              )}
              <button
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={o.name}
                tabIndex={on ? 0 : -1}
                data-value={o.value}
                onClick={(e) => onChange(o.value, e)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-3.5',
                  on
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {o.icon}
                {o.label}
                {o.count !== undefined && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {o.count.toLocaleString('en-GB')}
                  </span>
                )}
              </button>
            </React.Fragment>
          )
        })}
        {bar && (
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute -bottom-px h-0.5 rounded-full bg-foreground',
              bar.slide && 'transition-[left,width] duration-(--dur-3) ease-out',
            )}
            style={{ left: bar.left, width: bar.width }}
          />
        )}
      </div>
    </div>
  )
}

/**
 * A decision that sits at the end of a row and is usually left as it is: the answer as a quiet
 * button with a chevron, and a menu that says what each answer does. The button is named for the
 * decision and its answer ("How this relates to X: Unrelated").
 */
export function ChoiceMenu<T extends string>({
  label,
  options,
  value,
  onChange,
  quiet,
  placeholder = 'Choose',
  className,
}: {
  label: string
  options: { value: T; label: string; hint: string }[]
  value: T | undefined
  onChange: (v: T) => void
  /** The answer most rows keep: shown muted, so the rows that say more stand out. */
  quiet?: T
  /** The button's words while there is no answer yet. */
  placeholder?: string
  className?: string
}) {
  const chosen = options.find((o) => o.value === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            aria-label={`${label}: ${chosen?.label ?? placeholder}`}
            className={cn(
              'shrink-0 gap-1 px-2 font-normal',
              chosen && chosen.value === quiet && 'text-muted-foreground',
              className,
            )}
          />
        }
      >
        {chosen?.label ?? placeholder}
        <ChevronDownIcon aria-hidden className="size-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuRadioGroup
          aria-label={label}
          value={value ?? null}
          onValueChange={(v) => onChange(v as T)}
        >
          {options.map((o) => (
            <DropdownMenuRadioItem
              key={o.value}
              value={o.value}
              closeOnClick
              className="items-start py-1.5"
            >
              <span className="flex flex-col">
                <span>{o.label}</span>
                <span className="text-xs text-muted-foreground">{o.hint}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
