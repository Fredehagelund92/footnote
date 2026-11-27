import { isCalendarDate, shiftDate } from './validity.ts'

// The dates a text names, read by rule: what a pasted text or an agent's draft says When is, and
// the day the editor offers from what the writer typed. No clock: the capture day is given.

const monthNames = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]
const month =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const monthOf = (name: string) => monthNames.findIndex((full) => full.startsWith(name.slice(0, 3)))
const pad = (value: number) => String(value).padStart(2, '0')

/** A day from its parts, or null when it is no calendar day. */
function day(year: number, monthIndex: number, date: number): string | null {
  const value = `${year}-${pad(monthIndex + 1)}-${pad(date)}`
  return isCalendarDate(value) ? value : null
}

export type TextDates = {
  start: string
  /** The day after the last day (NFR-048), when the text names a range; otherwise undefined. */
  end?: string
  /** The text named no year, so the year of the capture day was assumed. */
  assumedYear: boolean
}

/**
 * The dates a text names, read deterministically: an ISO day, "4 August 2026", "August 4, 2026",
 * and a range such as "from 3 to 14 August 2026" (the end is the day after the last day). A day
 * without a year takes the capture day's year, or the year before when that would be in the
 * future, and says so. Phrases such as "since the migration" give nothing.
 */
export function datesInText(text: string, today: string): TextDates | null {
  const lower = text.toLowerCase()
  const thisYear = Number(today.slice(0, 4))
  let assumedYear = false
  const withYear = (date: number, monthIndex: number, year: string | undefined) => {
    if (year) return day(Number(year), monthIndex, date)
    assumedYear = true
    const guess = day(thisYear, monthIndex, date)
    return guess && guess > today ? day(thisYear - 1, monthIndex, date) : guess
  }
  const range = new RegExp(
    `\\b(?:from |between )?(\\d{1,2})(?:st|nd|rd|th)?(?: ${month})?(?: (\\d{4}))? ?(?:to|until|till|and|-|\\u2013) ?(\\d{1,2})(?:st|nd|rd|th)? ${month}(?: (\\d{4}))?\\b`,
  )
  const ranged = range.exec(lower)
  if (ranged) {
    const lastMonth = monthOf(ranged[5]!)
    const lastYear = ranged[6] ?? ranged[3]
    const last = withYear(Number(ranged[4]), lastMonth, lastYear)
    const first = withYear(
      Number(ranged[1]),
      ranged[2] ? monthOf(ranged[2]) : lastMonth,
      ranged[3] ?? lastYear,
    )
    if (first && last && first <= last)
      return { start: first, end: shiftDate(last, 1), assumedYear }
  }
  const found: { at: number; value: string }[] = []
  for (const match of lower.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const value = day(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    if (value) found.push({ at: match.index, value })
  }
  for (const match of lower.matchAll(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (?:of )?${month}(?:,? (\\d{4}))?\\b`, 'g'),
  )) {
    const value = withYear(Number(match[1]), monthOf(match[2]!), match[3])
    if (value) found.push({ at: match.index, value })
  }
  for (const match of lower.matchAll(
    new RegExp(`\\b${month} (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?\\b`, 'g'),
  )) {
    const value = withYear(Number(match[2]), monthOf(match[1]!), match[3])
    if (value) found.push({ at: match.index, value })
  }
  if (!found.length) return null
  found.sort((a, b) => a.at - b.at)
  return { start: found[0]!.value, assumedYear }
}
