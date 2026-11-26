import * as React from 'react'
import type { ApiErrorKind } from '@/api/errors'

// A Publish the review answers at once: it moves on to the next suggestion while the service
// decides, and the row it left says how that goes. Nothing here ever says Published: that is the
// service's yes, read from the Inbox (its `done`) as every decision is. So a row says Publishing
// until the answer is in, then what the Inbox says; a refusal stays on its row, in the service's
// words, until it is tried again. Kept outside the page, so an answer that comes in after the
// person left the review still lands on its row.

export type Publishing =
  | { state: 'publishing' }
  /** `reason` is the service's, when it refused; null when the send only failed. */
  | { state: 'refused'; failure: ApiErrorKind; reason: string | null }

let all: Readonly<Record<string, Publishing>> = {}
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const set = (id: string, to: Publishing | null) => {
  const { [id]: _, ...rest } = all
  all = to ? { ...rest, [id]: to } : rest
  listeners.forEach((l) => l())
}

export const publishing = {
  /** Sent: its row says Publishing. */
  start: (id: string) => set(id, { state: 'publishing' }),
  /** The service said yes: the Inbox says Published from now on. */
  answered: (id: string) => set(id, null),
  refused: (id: string, failure: ApiErrorKind, reason: string | null) =>
    set(id, { state: 'refused', failure, reason }),
  /** Tried again in place: the row is the Inbox's again. */
  clear: (id: string) => set(id, null),
  /** Every Publish answered at once that the service has not said yes to, by suggestion. */
  now: (): Readonly<Record<string, Publishing>> => all,
}

export const usePublishing = () =>
  React.useSyncExternalStore(subscribe, publishing.now, publishing.now)

/** What a refused row says under its title, in plain words. */
export const refusedWords = (p: Extract<Publishing, { state: 'refused' }>) =>
  p.reason ? `${p.reason} Nothing changed.` : 'Nothing changed. Open it to try again.'
