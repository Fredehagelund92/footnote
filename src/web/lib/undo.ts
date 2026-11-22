import * as React from 'react'
import { SAID_MS, toast, type ToastOptions } from '@/lib/toast'
import type { UndoOffer } from '@/api/client'
import { isSignedOut, toApiError } from '@/api/errors'
import { useWrite } from '@/api/queries'

// Every Undo goes through here. A write that can be taken back answers with an offer: its token,
// and until when the service takes it (the window the admin sets, `limits.undo_seconds`). So a
// screen offers Undo for exactly that long and no longer, and says so in seconds when it says how
// long. The service may still refuse one in time (its card changed since), so a refusal is said,
// whichever screen offered it.

/** How long an offer still holds, in milliseconds: none once it ended, Infinity when it never ends. */
export function heldFor(offer: UndoOffer, now = Date.now()): number {
  return offer.until === null ? Infinity : Math.max(0, Date.parse(offer.until) - now)
}

/**
 * How long the toast of an offer stays when the offer never ends (the service takes it at any
 * time): a toast is a moment, so it goes by itself, as Sonner's own 4 seconds would take it, but
 * long enough to reach for Undo.
 */
export const LASTING_TOAST_MS = 10_000

/** How long an offer still holds, in words ("6 seconds"); null when it never ends. */
export function heldWords(offer: UndoOffer, now = Date.now()): string | null {
  const ms = heldFor(offer, now)
  if (ms === Infinity) return null
  const seconds = Math.max(1, Math.round(ms / 1000))
  return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`
}

/**
 * Runs an Undo and says why the service refused it. Resolves to whether it was taken back, so the
 * caller says "Undone" and restores what it kept only then. A session that ended is the app's to
 * handle (it opens sign-in), so it is not said here.
 */
export async function takeBackBy(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run()
    return true
  } catch (error) {
    if (!isSignedOut(error))
      toast.error("Couldn't undo it", { description: toApiError(error).message })
    return false
  }
}

type OfferOptions = Omit<ToastOptions, 'action' | 'description' | 'duration' | 'firm'> & {
  /** What else to say; given how long Undo holds ("6 seconds"), when it ends. */
  description?: string | ((held: string) => string | undefined) | undefined
  /** What to do once it was taken back. */
  onUndone?: () => void
}

/**
 * Says what was done in a toast with Undo, which goes when the offer ends: at its end, or after
 * LASTING_TOAST_MS when it has none. Given an id it updates that toast, whatever it was made with.
 */
export function showOffer(
  message: string,
  undo: UndoOffer,
  takeBack: (undo: UndoOffer) => Promise<boolean>,
  options: OfferOptions = {},
  now = Date.now(),
) {
  const { description, onUndone, ...rest } = options
  const ms = heldFor(undo, now)
  const held = heldWords(undo, now)
  const said =
    typeof description === 'function' ? (held ? description(held) : undefined) : description
  const words = said ? { description: said } : {}
  // Too late already: say what was done, with nothing to take back. When it updates a toast that
  // had Undo and no end (id), that toast's duration and button go with it.
  if (ms === 0) return toast(message, { ...rest, ...words, duration: SAID_MS, action: undefined })
  // An offer that never ends has a toast that does. A toast waits while it is pointed at, focused
  // or in a hidden tab; the end of an offer does not, so that toast's time is firm.
  return toast(message, {
    ...rest,
    ...words,
    duration: ms === Infinity ? LASTING_TOAST_MS : ms,
    firm: ms !== Infinity,
    action: {
      label: 'Undo',
      onClick: () => void takeBack(undo).then((back) => back && onUndone?.()),
    },
  })
}

/**
 * Undo as the screens offer it: `takeBack` takes back what an offer stands for, saying so when the
 * service refuses; `offer` says what was done in a toast with Undo (`showOffer`).
 */
export function useUndo() {
  const write = useWrite()
  return React.useMemo(() => {
    const takeBack = (undo: UndoOffer) => takeBackBy(() => write('undo', { token: undo.token }))
    const offer = (message: string, undo: UndoOffer, options: OfferOptions = {}) =>
      showOffer(message, undo, takeBack, options)
    return { takeBack, offer }
  }, [write])
}

/**
 * Whether an offer still holds, for an Undo shown on the page: false from when it ends, so the
 * button goes with it. Null holds nothing.
 */
export function useHeld(offer: UndoOffer | null | undefined): boolean {
  const [ended, setEnded] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!offer || offer.until === null) return
    const timer = setTimeout(() => setEnded(offer.token), heldFor(offer))
    return () => clearTimeout(timer)
  }, [offer])
  return !!offer && ended !== offer.token
}
