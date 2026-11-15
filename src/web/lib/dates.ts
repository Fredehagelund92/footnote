// Dates as the reader's own locale writes them. Month and weekday names come from Intl, never from
// a list typed in the code, so the order, the punctuation and the language follow the browser
// (copy.md 2.11). A day the service names ("2026-10-21") is a UTC day; a moment is the reader's.

let override: string | undefined

/** The reader's locale: the browser's first language. Tests and previews can pin one. */
export function readerLocale(): string | undefined {
  if (override) return override
  return typeof navigator !== 'undefined'
    ? navigator.languages?.[0] || navigator.language
    : undefined
}

/** Pins the locale until called with nothing. For tests. */
export function setReaderLocale(locale?: string) {
  override = locale
}

type Input = Date | number | string
type Style = { utc?: boolean }

const formats = new Map<string, Intl.DateTimeFormat>()
const format = (options: Intl.DateTimeFormatOptions) => {
  const locale = readerLocale()
  const key = `${locale}|${JSON.stringify(options)}`
  let f = formats.get(key)
  if (!f) formats.set(key, (f = new Intl.DateTimeFormat(locale, options)))
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

/** "Oct": a month alone. */
export const monthShort = (when: Input, style: Style = {}) =>
  format({ month: 'short', ...zone(when, style) }).format(at(when))

/** "October 2026", from any day of it. */
export const monthYearLong = (when: Input, style: Style = {}) =>
  format({ month: 'long', year: 'numeric', ...zone(when, style) }).format(at(when))

/** "Oct 2026", from any day of it. */
export const monthYear = (when: Input, style: Style = {}) =>
  format({ month: 'short', year: 'numeric', ...zone(when, style) }).format(at(when))

/** The twelve months' names in a locale, long and short, lower-cased and without dots. */
const names = new Map<string, string[][]>()
const monthNames = (locale: string | undefined) => {
  const key = String(locale)
  let found = names.get(key)
  if (!found)
    names.set(
      key,
      (found = [...Array(12).keys()].map((m) =>
        (['long', 'short'] as const).map((month) =>
          new Intl.DateTimeFormat(locale, { month, timeZone: 'UTC' })
            .format(Date.UTC(2026, m, 15))
            .toLowerCase()
            .replace(/\./g, ''),
        ),
      )),
    )
  return found
}

/**
 * The month (0 to 11) a typed name stands for, in the reader's locale or in English; -1 for
 * anything else. "Aug", "august", "Sept" and "okt." all read, each in the language that has them.
 */
export function monthOfName(name: string): number {
  const word = name.toLowerCase().replace(/\./g, '').trim()
  if (word.length < 3) return -1
  for (const locale of [readerLocale(), 'en']) {
    const found = monthNames(locale).findIndex(([long, short]) => {
      return long === word || short === word || (long!.startsWith(word) && word.length >= 3)
    })
    if (found >= 0) return found
  }
  return -1
}

/**
 * A typed day, in the order the reader's locale writes it: "4 Aug 2026", "4 August 2026",
 * "4. okt. 2026", "Aug 4, 2026", or with no year ("4 Aug", given `year`). Null for anything else.
 * The result is a UTC time.
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
