import { monthOfName } from '@/lib/dates'
import { dateLabel, whenLabel, type Validity } from '@/model/validity'

// The edit pages' When: six presets over the stored dates, and the one line the field shows.

export type WhenMode = 'always' | 'from' | 'until' | 'between' | 'ongoing' | 'day'

export const WHEN_PRESETS: { value: WhenMode; label: string }[] = [
  { value: 'always', label: 'Always' },
  { value: 'from', label: 'From a date' },
  { value: 'until', label: 'Until a date' },
  { value: 'between', label: 'Between dates' },
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'day', label: 'A single day' },
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
