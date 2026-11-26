// Dates in British English, whatever language the browser is set to: Footnote is English only, so
// a date in another language would put two languages on one screen (copy.md 2.11). Month and
// weekday names come from Intl, never from a list typed in the code. A day the service names
// ("2026-10-21") is a UTC day; a moment is the reader's, in their own time zone.

/** The one locale every date and number is written in. */
export const LOCALE = 'en-GB'

type Input = Date | number | string
type Style = { utc?: boolean }

const formats = new Map<string, Intl.DateTimeFormat>()
const format = (options: Intl.DateTimeFormatOptions) => {
  const key = JSON.stringify(options)
  let f = formats.get(key)
  if (!f) formats.set(key, (f = new Intl.DateTimeFormat(LOCALE, options)))
  return f
}

/** An ISO day ("2026-10-21", or a time on it) is a UTC day; a Date or a time is a moment. */
const at = (when: Input): Date =>
  typeof when === 'string' ? new Date(`${when.slice(0, 10)}T00:00:00Z`) : new Date(when)
const zone = (when: Input, { utc }: Style): Intl.DateTimeFormatOptions =>
  typeof when === 'string' || utc ? { timeZone: 'UTC' } : {}

/** "21 Oct": a day without its year. */
export const dayMonth = (when: Input, style: Style = {}) =>
  format({ day: 'numeric', month: 'short', ...zone(when, style) }).format(at(when))

/** "21 Oct 2026". */
export const dayMonthYear = (when: Input, style: Style = {}) =>
  format({ day: 'numeric', month: 'short', year: 'numeric', ...zone(when, style) }).format(at(when))

/** "21 October 2026". */
export const dayMonthYearLong = (when: Input, style: Style = {}) =>
  format({ day: 'numeric', month: 'long', year: 'numeric', ...zone(when, style) }).format(at(when))

/** "Wednesday, 21 October 2026": a day in full, as a screen reader says a calendar's day. */
export const weekdayDayMonthYearLong = (when: Input, style: Style = {}) =>
  format({
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...zone(when, style),
  }).format(at(when))

/** "Tue 21 Oct". */
export const weekdayDayMonth = (when: Input, style: Style = {}) =>
  format({ weekday: 'short', day: 'numeric', month: 'short', ...zone(when, style) }).format(
    at(when),
  )

/** "Thu 22": a day as a chart's axis says it. */
export const weekdayDay = (when: Input, style: Style = {}) =>
  format({ weekday: 'short', day: 'numeric', ...zone(when, style) }).format(at(when))

/** "21": the day alone, for the start of a range that shares its month. */
export const dayNumber = (when: Input, style: Style = {}) =>
  format({ day: 'numeric', ...zone(when, style) }).format(at(when))

/** "09:41": the clock time of a moment, in the reader's own time zone. */
export const clockTime = (when: Date | number) =>
  format({ hour: '2-digit', minute: '2-digit' }).format(when)

/** "October": a month alone, in full. */
export const monthLong = (when: Input, style: Style = {}) =>
  format({ month: 'long', ...zone(when, style) }).format(at(when))

/** "Oct": a month alone. */
export const monthShort = (when: Input, style: Style = {}) =>
  format({ month: 'short', ...zone(when, style) }).format(at(when))

/** "October 2026", from any day of it. */
export const monthYearLong = (when: Input, style: Style = {}) =>
  format({ month: 'long', year: 'numeric', ...zone(when, style) }).format(at(when))

/** "Oct 2026", from any day of it. */
export const monthYear = (when: Input, style: Style = {}) =>
  format({ month: 'short', year: 'numeric', ...zone(when, style) }).format(at(when))

/** The twelve months' names, long and short, lower-cased and without dots ("sept"). */
const months = [...Array(12).keys()].map((m) =>
  (['long', 'short'] as const).map((month) =>
    new Intl.DateTimeFormat(LOCALE, { month, timeZone: 'UTC' })
      .format(Date.UTC(2026, m, 15))
      .toLowerCase()
      .replace(/\./g, ''),
  ),
)

/**
 * The month (0 to 11) a typed English name stands for; -1 for anything else. "Aug", "august",
 * "Sep" and "Sept" all read.
 */
export function monthOfName(name: string): number {
  const word = name.toLowerCase().replace(/\./g, '').trim()
  if (word.length < 3) return -1
  return months.findIndex(([long, short]) => {
    return long === word || short === word || long!.startsWith(word)
  })
}

/**
 * A typed day: "4 Aug 2026", "4 August 2026", "Aug 4, 2026", or with no year ("4 Aug", given
 * `year`). Null for anything else. The result is a UTC time.
 */
export function parseDay(text: string, year?: number): number | null {
  const words = text.trim()
  const m =
    words.match(/^(?<d>\d{1,2})\.?\s*(?<m>\p{L}+)\.?\s*(?<y>\d{4})?$/u) ??
    words.match(/^(?<m>\p{L}+)\.?\s*(?<d>\d{1,2}),?\s*(?<y>\d{4})?$/u)
  if (!m?.groups) return null
  const month = monthOfName(m.groups.m!)
  const y = m.groups.y ? Number(m.groups.y) : year
  return month < 0 || !y ? null : Date.UTC(y, month, Number(m.groups.d))
}

const padded = (n: number) => String(n).padStart(2, '0')
const isoDay = (d: string, month: string, year: string) => {
  const m = monthOfName(month)
  return m < 0 ? null : `${year}-${padded(m + 1)}-${padded(Number(d))}`
}

/**
 * The days an answer names, as the service reads them, both included: "1 to 31 Aug 2026", "1 Jul
 * to 30 Sep 2026", "30 Dec 2025 to 2 Jan 2026", "14 Oct 2026", or "from 9 May 2026" (to today).
 * Null for anything else.
 */
export function daysOfDates(
  dates: string | undefined,
  today: string,
): { from: string; to: string } | null {
  if (!dates) return null
  const words = dates.trim()
  let m = /^(\d{1,2}) to (\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(words)
  if (m) {
    const from = isoDay(m[1]!, m[3]!, m[4]!)
    const to = isoDay(m[2]!, m[3]!, m[4]!)
    return from && to ? { from, to } : null
  }
  m = /^(\d{1,2}) ([A-Z][a-z]{2}) to (\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(words)
  if (m) {
    const from = isoDay(m[1]!, m[2]!, m[5]!)
    const to = isoDay(m[3]!, m[4]!, m[5]!)
    return from && to ? { from, to } : null
  }
  m = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4}) to (\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(words)
  if (m) {
    const from = isoDay(m[1]!, m[2]!, m[3]!)
    const to = isoDay(m[4]!, m[5]!, m[6]!)
    return from && to ? { from, to } : null
  }
  m = /^(from )?(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(words)
  if (m) {
    const from = isoDay(m[2]!, m[3]!, m[4]!)
    if (!from) return null
    return { from, to: m[1] ? today : from }
  }
  return null
}
