// The shape the real schema gives a context item's dates (item_versions: valid_from, valid_until,
// review_date), and the words people read derived from them by pure functions. The fixtures store
// the dates; the labels ("From 4 Aug 2026, still going on") are never typed by hand, so the port
// to the real data is a change of source, not of every screen.

import type { Validity as ServerValidity } from '@domain/item'
import { shiftDate } from '@domain/validity'
import { dayMonth, dayMonthYear, dayNumber, parseDay } from '@/lib/dates'

/**
 * When a context item applies: ISO dates, either open. `until` is the last day it applies, as
 * "12 to 19 May 2026" reads. `ongoing` says an open end is still going on.
 */
export type Validity = { from?: string; until?: string; ongoing?: boolean }

/**
 * The same window in the server's words: `from` is its start, and its end is the first day it no
 * longer applies, the day after `until`; both stay open when absent.
 */
export const toServerValidity = (v: Validity): Partial<ServerValidity> => ({
  ...(v.from ? { start: v.from } : {}),
  ...(v.until ? { end: shiftDate(v.until, 1) } : {}),
})

/** "4 Aug 2026". */
export const dateLabel = (iso: string) => dayMonthYear(iso)

/** The ISO day of a day's label: "4 Aug 2026" is 2026-08-04; anything else is null. */
export function labelDay(label: string): string | null {
  const at = parseDay(label)
  return at === null ? null : new Date(at).toISOString().slice(0, 10)
}

/** The When people read: "Always", "From 4 Aug 2026, still going on", "12 to 19 May 2026", "Until 19 Jan 2026", "4 Aug 2026". */
export function whenLabel(v: Validity): string {
  if (v.from && v.until) {
    if (v.from === v.until) return dateLabel(v.from)
    if (v.from.slice(0, 4) !== v.until.slice(0, 4))
      return `${dateLabel(v.from)} to ${dateLabel(v.until)}`
    if (v.from.slice(0, 7) !== v.until.slice(0, 7))
      return `${dayMonth(v.from)} to ${dateLabel(v.until)}`
    return `${dayNumber(v.from)} to ${dateLabel(v.until)}`
  }
  if (v.from) return `From ${dateLabel(v.from)}${v.ongoing ? ', still going on' : ''}`
  if (v.until) return `Until ${dateLabel(v.until)}`
  return v.ongoing ? 'Still going on' : 'Always'
}

/** Whether a check date has passed: an item past it reads "Due for a check". */
export const checkDue = (reviewDate: string, today: string) => reviewDate < today
