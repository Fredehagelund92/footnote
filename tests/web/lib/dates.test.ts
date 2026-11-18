import { describe, expect, it } from 'vitest'
import { raisedWhen } from '@/api/http-alerts'
import { dayMonthYear, monthOfName, parseDay, weekdayDayMonthYearLong } from '@/lib/dates'
import { parseWhen, timeShort } from '@/lib/timeframe'
import { dateLabel, labelDay, whenLabel } from '@/model/validity'
import { monthName, monthsLabel } from '@/model/observability'

// Footnote is English only, so a date is British English whatever the browser's language: a
// Danish browser once read "21. okt. 2025" beside English words (copy.md 2.11). The browser's
// language is never read; tests/e2e/english-dates.spec.ts proves it in a Danish browser.
describe('dates in British English', () => {
  it('writes a day the British way', () => {
    expect(dayMonthYear('2025-10-21')).toBe('21 Oct 2025')
    expect(dateLabel('2026-10-21')).toBe('21 Oct 2026')
    expect(monthName('2026-10')).toBe('October 2026')
    expect(monthsLabel(['2026-09', '2026-10'])).toBe('Sept, Oct 2026')
    expect(whenLabel({ from: '2026-05-12', until: '2026-05-19' })).toBe('12 to 19 May 2026')
  })

  it('writes a moment in the reader’s own day', () => {
    const now = new Date(2026, 9, 23, 12)
    expect(raisedWhen(new Date(2026, 9, 20, 9).toISOString(), now)).toBe('Tue 20 Oct')
  })

  it('says a whole day the way a calendar’s caption writes it', () => {
    expect(weekdayDayMonthYearLong(new Date(2026, 9, 23))).toBe('Friday, 23 October 2026')
  })

  it('reads back the day it wrote', () => {
    for (const day of ['2026-01-19', '2026-03-04', '2026-09-30', '2025-12-31'])
      expect(labelDay(dateLabel(day))).toBe(day)
  })

  it('reads the English month names people type', () => {
    expect(monthOfName('Sep')).toBe(8)
    expect(monthOfName('sept')).toBe(8)
    expect(monthOfName('August')).toBe(7)
    expect(monthOfName('Mo')).toBe(-1)
    expect(monthOfName('okt.')).toBe(-1)
    expect(parseDay('4 Aug 2026')).toBe(Date.UTC(2026, 7, 4))
    expect(parseDay('Aug 4, 2026')).toBe(Date.UTC(2026, 7, 4))
    expect(parseDay('4 Aug')).toBeNull()
  })

  it('keeps the When editor’s text and its short form in step', () => {
    const when = whenLabel({ from: '2026-05-12', until: '2026-09-03' })
    expect(timeShort(parseWhen(when))).toBe('12 May – 3 Sept 2026')
  })
})
