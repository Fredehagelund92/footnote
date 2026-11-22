import * as React from 'react'
import { toast as sonner } from 'sonner'
import { OctagonXIcon, XIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { cn } from '@/lib/utils'

// Every toast in the app goes through here. Sonner places, stacks and moves them; the time is kept
// here, by each toast, so it can be seen: a bar along its foot empties as its time runs out and
// stands still while the pointer is over it, while it holds focus or while the tab is hidden. Then
// it slides out to the right (index.css), as Close does. A toast whose time is firm (an Undo the
// service takes only until a moment) runs on regardless, and one with no end has no bar.

/** How long a toast stays when nothing says otherwise: Sonner's own default, written out. */
export const SAID_MS = 4000

type Action = {
  label: string
  /** Runs, then the toast goes; unless the press was prevented (`event.preventDefault()`). */
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}

export type ToastOptions = {
  /** Given an id, a toast updates the one with it, its time starting again. */
  id?: string | number
  description?: React.ReactNode
  action?: Action | undefined
  /** A second, quieter action. */
  cancel?: Action | undefined
  /** In milliseconds; Infinity stays until it is closed or dismissed. */
  duration?: number
  /** The time runs on while pointed at or focused: the moment it ends is a promise. */
  firm?: boolean
  onDismiss?: () => void
}

type Said = Omit<ToastOptions, 'id' | 'duration' | 'onDismiss'> & {
  id: string | number
  title: React.ReactNode
  error: boolean
  ms: number
}

let made = 0

function say(error: boolean, title: React.ReactNode, options: ToastOptions = {}) {
  const { id, duration = SAID_MS, onDismiss, ...said } = options
  // A new key each time, so an update (the same id) starts its time and its bar again.
  const key = ++made
  return sonner.custom(
    (at) => <Toast key={key} id={at} title={title} error={error} ms={duration} {...said} />,
    { id, duration: Infinity, onDismiss: onDismiss && (() => onDismiss()) },
  )
}

export const toast = Object.assign(
  (title: React.ReactNode, options?: ToastOptions) => say(false, title, options),
  {
    error: (title: React.ReactNode, options?: ToastOptions) => say(true, title, options),
    /** Takes the toast with that id away, or every toast with none. */
    dismiss: (id?: string | number) => sonner.dismiss(id),
  },
)

const onVisibility = (change: () => void) => {
  document.addEventListener('visibilitychange', change)
  return () => document.removeEventListener('visibilitychange', change)
}

function Toast({ id, title, description, action, cancel, error, ms, firm = false }: Said) {
  const reduced = useReducedMotion()
  const [pointed, setPointed] = React.useState(false)
  const [focused, setFocused] = React.useState(false)
  const hidden = React.useSyncExternalStore(onVisibility, () => document.hidden)
  const timed = ms !== Infinity
  const held = timed && !firm && (pointed || focused || hidden)

  // What is left of the time, counted down only while it runs.
  const left = React.useRef(ms)
  React.useEffect(() => {
    if (!timed || held) return
    const from = Date.now()
    const timer = setTimeout(() => sonner.dismiss(id), left.current)
    return () => {
      clearTimeout(timer)
      left.current -= Date.now() - from
    }
  }, [id, timed, held])

  // Focus and keys are read on Sonner's item around the toast: the keyboard reaches it there first
  // (its hotkey, Alt+T, then Tab), as well as on the buttons inside. Only the keyboard's focus
  // holds it: a click or a tap focuses the item too, and that focus would hold it for good.
  const self = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const item = self.current?.closest<HTMLElement>('[data-sonner-toast]')
    if (!item) return
    const focusIn = (e: FocusEvent) => setFocused((e.target as Element).matches(':focus-visible'))
    const focusOut = (e: FocusEvent) => {
      if (!item.contains(e.relatedTarget as Node | null)) setFocused(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') sonner.dismiss(id)
    }
    item.addEventListener('focusin', focusIn)
    item.addEventListener('focusout', focusOut)
    item.addEventListener('keydown', key)
    return () => {
      item.removeEventListener('focusin', focusIn)
      item.removeEventListener('focusout', focusOut)
      item.removeEventListener('keydown', key)
    }
  }, [id])

  const close = () => sonner.dismiss(id)
  const press = (a: Action) => (event: React.MouseEvent<HTMLButtonElement>) => {
    a.onClick(event)
    if (!event.defaultPrevented) close()
  }

  return (
    <div
      ref={self}
      data-slot="toast"
      data-timed={timed || undefined}
      data-held={held || undefined}
      // A finger that taps the toast is not a pointer resting on it: it would hold it for good.
      onPointerEnter={(e) => e.pointerType !== 'touch' && setPointed(true)}
      onPointerLeave={() => setPointed(false)}
      className="relative flex w-full items-center gap-3 overflow-hidden rounded-md border bg-popover py-3 pr-2 pl-4 text-sm text-popover-foreground shadow-lg"
    >
      {error && <OctagonXIcon aria-hidden className="mt-0.5 size-4 shrink-0 self-start" />}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
        <p className="font-medium">{title}</p>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
      {cancel && (
        <Button variant="ghost" onClick={press(cancel)}>
          {cancel.label}
        </Button>
      )}
      {action && (
        <Button variant="outline" onClick={press(action)}>
          {action.label}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="self-start text-muted-foreground"
        aria-label="Close"
        onClick={close}
      >
        <XIcon />
      </Button>
      {timed && !reduced && (
        <span
          aria-hidden
          data-slot="toast-time"
          className={cn(
            'absolute inset-x-0 bottom-0 h-0.5 origin-left transition-colors',
            held ? 'bg-foreground' : 'bg-muted-foreground/40',
          )}
          style={{
            animation: `countdown ${ms}ms linear forwards`,
            animationPlayState: held ? 'paused' : 'running',
          }}
        />
      )}
    </div>
  )
}
