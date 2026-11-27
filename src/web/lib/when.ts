import { datesInText } from '@domain/text-dates'
import { shiftDate } from '@domain/validity'
import { monthOfName } from '@/lib/dates'
import { dateLabel, whenLabel, type Validity } from '@/model/validity'

// The edit pages' When: six presets over the stored dates, and the one line the field shows.

export type WhenMode = 'always' | 'from' | 'until' | 'between' | 'ongoing' | 'day'

/** Each choice, with the line under it that tells it from the others. */
export const WHEN_PRESETS: { value: WhenMode; label: string; hint: string }[] = [
  { value: 'always', label: 'Always', hint: 'Any dates asked about' },
  { value: 'from', label: 'From a date', hint: 'From a day on, for good' },
  { value: 'until', label: 'Until a date', hint: 'Up to a day, and not after' },
  { value: 'between', label: 'Between dates', hint: 'From one day to another' },
  { value: 'ongoing', label: 'Ongoing', hint: 'Not over yet' },
  { value: 'day', label: 'A single day', hint: 'One day only' },
]

export type WhenValue = { mode: WhenMode; from: string; until: string }

/** The stored dates a When says. Ongoing may start on a date or not. */
export function validOfWhen(w: WhenValue): Validity {
  switch (w.mode) {
    case 'always':
      return {}
    case 'from':
      return { from: w.from || undefined }
    case 'until':
      return { until: w.until || undefined }
    case 'between':
      return { from: w.from || undefined, until: w.until || undefined }
    case 'ongoing':
      return { from: w.from || undefined, ongoing: true }
    case 'day':
      return { from: w.from || undefined, until: w.from || undefined }
  }
}

/** The editor's When from stored dates. */
export function whenOfValid(v: Validity): WhenValue {
  const mode: WhenMode =
    v.from && v.until
      ? v.from === v.until
        ? 'day'
        : 'between'
      : v.until
        ? 'until'
        : v.ongoing
          ? 'ongoing'
          : v.from
            ? 'from'
            : 'always'
  return { mode, from: v.from ?? '', until: v.until ?? '' }
}

/** Which dates a mode still needs, so the field can say so instead of showing half a sentence. */
export function missingDates(w: WhenValue) {
  if (w.mode === 'from' || w.mode === 'day') return !w.from
  if (w.mode === 'until') return !w.until
  if (w.mode === 'between') return !w.from || !w.until
  return false
}

/** The When in one line: "From 4 Aug 2026, still going on", or what is left to pick. */
export function whenSummary(w: WhenValue) {
  if (!missingDates(w)) return whenLabel(validOfWhen(w))
  if (w.mode === 'between')
    return w.from ? `From ${dateLabel(w.from)} - pick the end` : 'Between dates - pick the start'
  return `${WHEN_PRESETS.find((p) => p.value === w.mode)!.label} - pick a date`
}

const pad = (n: number) => String(n).padStart(2, '0')
/** A day of the words Ask reads a question's days in: "7", "Oct", "2026" is 2026-10-07. */
const dayOf = (d: string, month: string, year: string) => {
  const m = monthOfName(month)
  return m < 0 ? '' : `${year}-${pad(m + 1)}-${pad(Number(d))}`
}

/**
 * The When of the days a question was read on, in the words Ask's read line says them
 * (`windowWords`): "7 Oct 2026", "1-30 Sep 2026", "1 Sep to 30 Oct 2026", "1 Dec 2025 to 2 Jan
 * 2026", "from 7 Oct 2026" or "up to 7 Oct 2026". Null for any date, and for anything else.
 */
export function whenOfPeriod(period: string): WhenValue | null {
  const when = readPeriod(period)
  return when && !missingDates(when) ? when : null
}

function readPeriod(period: string): WhenValue | null {
  const D = '(\\d{1,2})'
  const M = '([A-Z][a-z]{2})'
  const Y = '(\\d{4})'
  const read = (pattern: string) => new RegExp(`^${pattern}$`).exec(period.trim())
  let m = read(`${D} ${M} ${Y}`)
  if (m) {
    const day = dayOf(m[1]!, m[2]!, m[3]!)
    return { mode: 'day', from: day, until: day }
  }
  m = read(`${D}-${D} ${M} ${Y}`)
  if (m)
    return { mode: 'between', from: dayOf(m[1]!, m[3]!, m[4]!), until: dayOf(m[2]!, m[3]!, m[4]!) }
  m = read(`${D} ${M} to ${D} ${M} ${Y}`)
  if (m)
    return { mode: 'between', from: dayOf(m[1]!, m[2]!, m[5]!), until: dayOf(m[3]!, m[4]!, m[5]!) }
  m = read(`${D} ${M} ${Y} to ${D} ${M} ${Y}`)
  if (m)
    return { mode: 'between', from: dayOf(m[1]!, m[2]!, m[3]!), until: dayOf(m[4]!, m[5]!, m[6]!) }
  m = read(`from ${D} ${M} ${Y}`)
  if (m) return { mode: 'from', from: dayOf(m[1]!, m[2]!, m[3]!), until: '' }
  m = read(`up to ${D} ${M} ${Y}`)
  if (m) return { mode: 'until', from: '', until: dayOf(m[1]!, m[2]!, m[3]!) }
  return null
}

/** Whether two Whens say the same dates. */
export const sameWhen = (a: WhenValue, b: WhenValue) =>
  JSON.stringify(validOfWhen(a)) === JSON.stringify(validOfWhen(b))

/**
 * The Whens the dates in a text could mean, to offer in one press: a range as Between dates, and
 * one day as that day or from it on. None when the text names no date.
 */
export function whensOfText(text: string, today: string): WhenValue[] {
  const dates = datesInText(text, today)
  if (!dates) return []
  if (dates.end) return [{ mode: 'between', from: dates.start, until: shiftDate(dates.end, -1) }]
  return [
    { mode: 'day', from: dates.start, until: dates.start },
    { mode: 'from', from: dates.start, until: '' },
  ]
}

/**
 * The When a typed date gives in the mode picked: "4 Aug 2024", "2024-08-04" or, for Between
 * dates, "3 to 14 August 2024". One day typed for Between dates is its start, or its end once the
 * start is there. Null when the words name no day.
 */
export function whenOfTyped(typed: string, value: WhenValue, today: string): WhenValue | null {
  const dates = datesInText(typed, today)
  if (!dates) return null
  const day = dates.start
  switch (value.mode) {
    case 'always':
      return null
    case 'between':
      if (dates.end) return { ...value, from: day, until: shiftDate(dates.end, -1) }
      return value.from && !value.until && day >= value.from
        ? { ...value, until: day }
        : { ...value, from: day, until: '' }
    case 'until':
      return { ...value, until: day }
    case 'day':
      return { ...value, from: day, until: day }
    default:
      return { ...value, from: day }
  }
}
