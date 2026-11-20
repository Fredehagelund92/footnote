import { describe, expect, it } from 'vitest'
import { raisedWhen } from '@/api/http-alerts'
import { dayMonthYear, monthOfName, parseDay, weekdayDayMonthYearLong } from '@/lib/dates'
import { parseWhen, timeShort } from '@/lib/timeframe'
import { readDates } from '@domain/dates'
import { dateLabel, labelDay, questionDates, whenLabel, type Validity } from '@/model/validity'
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

// The setup's first question is about the item just written: one about a day that has passed
// names that day, or Ask reads it as today and the item does not apply.
describe('the dates a question about a window needs', () => {
  const today = '2026-11-20'
  const asked = (v: Validity) => questionDates(v, today)

  it('says nothing when the window holds today', () => {
    expect(asked({})).toBe('')
    expect(asked({ from: '2026-08-04', ongoing: true })).toBe('')
    expect(asked({ until: '2026-12-01' })).toBe('')
    expect(asked({ from: '2026-11-01', until: '2026-11-30' })).toBe('')
    expect(asked({ from: today, until: today })).toBe('')
  })

  it('names a window that misses today, and Ask reads it as that window', () => {
    const cases: [Validity, string, { start: string; end: string }][] = [
      [
        { from: '2026-11-09', until: '2026-11-09' },
        'on 9 Nov 2026',
        { start: '2026-11-09', end: '2026-11-10' },
      ],
      [
        { from: '2026-05-12', until: '2026-05-19' },
        'from 12 to 19 May 2026',
        { start: '2026-05-12', end: '2026-05-20' },
      ],
      [
        { from: '2026-09-03', until: '2026-10-04' },
        'from 3 Sept to 4 Oct 2026',
        { start: '2026-09-03', end: '2026-10-05' },
      ],
      [
        { from: '2025-12-28', until: '2026-01-03' },
        'from 28 Dec 2025 to 3 Jan 2026',
        { start: '2025-12-28', end: '2026-01-04' },
      ],
      [
        { from: '2026-12-01', until: '2026-12-01' },
        'on 1 Dec 2026',
        { start: '2026-12-01', end: '2026-12-02' },
      ],
      [{ until: '2026-01-19' }, 'on 19 Jan 2026', { start: '2026-01-19', end: '2026-01-20' }],
      [
        { from: '2027-02-01', ongoing: true },
        'on 1 Feb 2027',
        { start: '2027-02-01', end: '2027-02-02' },
      ],
    ]
    for (const [valid, words, window] of cases) {
      expect(asked(valid)).toBe(words)
      const read = readDates(`what should i know about net revenue ${words.toLowerCase()}?`, today)
      expect(read).toMatchObject({ status: 'read', window })
    }
  })
})
