import * as React from 'react'
import { SAID_MS, toast, type ToastOptions } from '@/lib/toast'
import type { UndoOffer } from '@/api/client'
import { isSignedOut, toApiError } from '@/api/errors'
import { useWrite } from '@/api/queries'
import { isTyping } from '@/lib/keys'

// Every Undo goes through here. A write that can be taken back answers with an offer: its token,
// and until when the service takes it (the window the admin sets, `limits.undo_seconds`). So a
// screen offers Undo for exactly that long and no longer, and says so in seconds when it says how
// long. The service may still refuse one in time (its card changed since), so a refusal is said,
// whichever screen offered it.
//
// The newest decision is also Command and Z's, from any screen, for as long as the service holds
// it: one last action, never a history of them. Newest is by when it was made, not when it
// answered: a decision still being sent holds the key, so an older one answering meanwhile is
// never taken back by mistake.

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

/** What is said once an offer was taken back. */
type Undone = { title: string; description?: string }

type Remembered = {
  /** What was done, as its toast said it. */
  message: string
  /** Said once it was taken back; without it Undo in the toast says nothing, and the key "Undone". */
  undone?: Undone | undefined
  /** What to do once it was taken back: put back what the screen kept, open the item again. */
  onUndone?: (() => void) | undefined
}

type OfferOptions = Omit<ToastOptions, 'action' | 'description' | 'duration' | 'firm'> &
  Omit<Remembered, 'message'> &
  Placed & {
    /** What else to say; given how long Undo holds ("6 seconds"), when it ends. */
    description?: string | ((held: string) => string | undefined) | undefined
  }

type Placed = {
  /** The send this offer answers: it takes that decision's place, never the place of a newer one. */
  sent?: Sending | undefined
}

/** A thing done that can be taken back, or a decision still being sent. */
type Held =
  | (Remembered & {
      kind: 'offer'
      undo: UndoOffer
      takeBack: (undo: UndoOffer) => Promise<boolean>
      /** Its toast, which goes when Command and Z takes it back. */
      toast?: string | number | undefined
    })
  | { kind: 'sending'; said: string; early?: (() => void) | undefined }

/** A decision being sent, as `rememberSending` gives it back. */
export type Sending = ReturnType<typeof rememberSending>

// What Command and Z may take back, in the order the decisions were made: the newest is the key's.
// One made before it is kept only while a newer one is still being sent, to be the key's again
// should that send fail; once a newer one can be taken back, the ones before it are gone.
let held: Held[] = []
const top = () => held.at(-1) ?? null
/** Drops `at` and everything made before it. */
const dropThrough = (at: Held) => {
  const i = held.indexOf(at)
  if (i >= 0) held = held.slice(i + 1)
}

/**
 * Command and Z takes this back once it is the newest decision: an offer made after it replaces it.
 * Given the send it answers (`sent`), it takes that send's place, so a decision made after that one
 * keeps the key; when that send is no longer held, a newer offer already took the key, and this
 * one is not the key's.
 */
export function rememberOffer(
  message: string,
  undo: UndoOffer,
  takeBack: (undo: UndoOffer) => Promise<boolean>,
  options: Omit<Remembered, 'message'> & Placed & { toast?: string | number } = {},
) {
  const { sent, ...rest } = options
  const offer: Held = { kind: 'offer', message, undo, takeBack, ...rest }
  if (!sent) return void (held = [offer])
  sent.answered(offer)
}

/**
 * A decision is being sent: until it answers, Command and Z says so (`said`, "Still publishing
 * “Sales targets”") instead of taking back the one before; or, given `early` (a screen whose Undo
 * already takes it back once it is in), does what its Undo does. What it gives back ends the wait:
 * pass it to the offer the answer makes (`sent`); or `failed` when the send failed, or answered
 * with nothing left to take back (what was the key's before it is again), and `undone` when it was
 * taken back as soon as it was in (nothing made before it is the key's).
 */
export function rememberSending(said: string, early?: () => void) {
  const sending: Held = { kind: 'sending', said, early }
  held = [...held, sending]
  return {
    answered: (offer: Held) => {
      const i = held.indexOf(sending)
      if (i >= 0) held = [offer, ...held.slice(i + 1)]
    },
    failed: () => {
      held = held.filter((h) => h !== sending)
    },
    undone: () => dropThrough(sending),
  }
}

/**
 * Taken back by any way (its toast, the page's own Undo, the key): its toast goes, and Command and
 * Z has nothing made before it left to take back.
 */
export function forget(undo: UndoOffer) {
  const at = held.find((h) => h.kind === 'offer' && h.undo.token === undo.token)
  if (!at || at.kind !== 'offer') return
  if (at.toast !== undefined) toast.dismiss(at.toast)
  dropThrough(at)
}

/** Nothing is held: a new session starts with nothing to take back. */
export function forgetAll() {
  held = []
}

/**
 * Command and Z: takes back the newest decision while the service holds it, and says what it did;
 * or says why there is nothing to take back. Resolves to whether something was taken back.
 */
export async function undoLast(now = Date.now()): Promise<boolean> {
  const at = top()
  if (!at) {
    toast('Nothing to undo')
    return false
  }
  if (at.kind === 'sending') {
    if (!at.early) {
      toast(at.said, { description: 'Undo it once it is done.' })
      return false
    }
    dropThrough(at)
    at.early()
    toast('Undone')
    return true
  }
  if (heldFor(at.undo, now) === 0) {
    dropThrough(at)
    toast("It's too late to undo that", { description: at.message })
    return false
  }
  if (at.toast !== undefined) toast.dismiss(at.toast)
  if (!(await at.takeBack(at.undo))) return false
  forget(at.undo)
  const said = at.undone ?? { title: 'Undone', description: at.message }
  toast(said.title, said.description ? { description: said.description } : {})
  at.onUndone?.()
  return true
}

/**
 * Says what was done in a toast with Undo, which goes when the offer ends: at its end, or after
 * LASTING_TOAST_MS when it has none. Given an id it updates that toast, whatever it was made with.
 * The offer is then Command and Z's, in the place of the send it answers (`sent`), if any.
 */
export function showOffer(
  message: string,
  undo: UndoOffer,
  takeBack: (undo: UndoOffer) => Promise<boolean>,
  options: OfferOptions = {},
  now = Date.now(),
) {
  const { description, onUndone, undone, sent, ...rest } = options
  const ms = heldFor(undo, now)
  const held = heldWords(undo, now)
  const said =
    typeof description === 'function' ? (held ? description(held) : undefined) : description
  const words = said ? { description: said } : {}
  // Too late already: say what was done, with nothing to take back. When it updates a toast that
  // had Undo and no end (id), that toast's duration and button go with it.
  if (ms === 0) {
    sent?.failed()
    return toast(message, { ...rest, ...words, duration: SAID_MS, action: undefined })
  }
  // An offer that never ends has a toast that does. A toast waits while it is pointed at, focused
  // or in a hidden tab; the end of an offer does not, so that toast's time is firm.
  const id = toast(message, {
    ...rest,
    ...words,
    duration: ms === Infinity ? LASTING_TOAST_MS : ms,
    firm: ms !== Infinity,
    action: {
      label: 'Undo',
      onClick: () =>
        void takeBack(undo).then((back) => {
          if (!back) return
          forget(undo)
          if (undone)
            toast(undone.title, undone.description ? { description: undone.description } : {})
          onUndone?.()
        }),
    },
  })
  rememberOffer(message, undo, takeBack, { undone, onUndone, sent, toast: id })
  return id
}

/**
 * Undo as the screens offer it: `takeBack` takes back what an offer stands for, saying so when the
 * service refuses; `offer` says what was done in a toast with Undo (`showOffer`); `remember` makes
 * an offer a screen shows in place Command and Z's too.
 */
export function useUndo() {
  const write = useWrite()
  return React.useMemo(() => {
    const takeBack = async (undo: UndoOffer) => {
      const back = await takeBackBy(() => write('undo', { token: undo.token }))
      if (back) forget(undo)
      return back
    }
    const offer = (message: string, undo: UndoOffer, options: OfferOptions = {}) =>
      showOffer(message, undo, takeBack, options)
    const remember = (
      message: string,
      undo: UndoOffer,
      options: Omit<Remembered, 'message'> & Placed = {},
    ) => rememberOffer(message, undo, takeBack, options)
    return { takeBack, offer, remember }
  }, [write])
}

/**
 * Command (or Control) and Z, from any screen, takes back the last offer. Never while someone
 * types (a field or an editor keeps its own undo) or in a dialog; Shift is redo, which there is
 * none of. Signing out forgets it.
 */
export function UndoKey() {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'z' || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return
      if (isTyping(e.target)) return
      e.preventDefault()
      void undoLast()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      forgetAll()
    }
  }, [])
  return null
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
