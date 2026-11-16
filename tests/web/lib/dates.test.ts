import { afterEach, describe, expect, it } from 'vitest'
import { raisedWhen } from '@/api/http-alerts'
import { dayMonthYear, monthOfName, parseDay, setReaderLocale } from '@/lib/dates'
import { parseWhen, timeShort } from '@/lib/timeframe'
import { dateLabel, labelDay, whenLabel } from '@/model/validity'
import { monthName, monthsLabel } from '@/model/observability'

// A Danish reader's dates. The code once typed English month names, so a reader in Denmark saw
// "21 Oct 2025"; the names now come from Intl in the reader's locale.
afterEach(() => setReaderLocale('en-GB'))

describe('dates in the reader’s locale', () => {
  it('writes a day in the reader’s language', () => {
    setReaderLocale('da-DK')
    expect(dayMonthYear('2025-10-21')).toBe('21. okt. 2025')
    expect(dateLabel('2026-05-12')).toBe('12. maj 2026')
    expect(monthName('2026-10')).toBe('oktober 2026')
    expect(monthsLabel(['2026-09', '2026-10'])).toBe('sep., okt. 2026')
  })

  it('writes the same days in British English as before', () => {
    expect(dateLabel('2026-10-21')).toBe('21 Oct 2026')
    expect(monthName('2026-10')).toBe('October 2026')
    expect(whenLabel({ from: '2026-05-12', until: '2026-05-19' })).toBe('12 to 19 May 2026')
  })

  it('writes a moment in the reader’s own day and language', () => {
    setReaderLocale('da-DK')
    const now = new Date(2026, 9, 23, 12)
    expect(raisedWhen(new Date(2026, 9, 20, 9).toISOString(), now)).toBe('tirs. 20. okt.')
  })

  it('reads back the day it wrote, in any locale', () => {
    for (const locale of ['en-GB', 'en-US', 'da-DK', 'de-DE', 'fr-FR']) {
      setReaderLocale(locale)
      for (const day of ['2026-01-19', '2026-03-04', '2026-09-30', '2025-12-31'])
        expect(labelDay(dateLabel(day))).toBe(day)
    }
  })

  it('reads the month names people type', () => {
    expect(monthOfName('Sep')).toBe(8)
    expect(monthOfName('sept')).toBe(8)
    expect(monthOfName('August')).toBe(7)
    expect(monthOfName('Mo')).toBe(-1)
    setReaderLocale('da-DK')
    expect(monthOfName('okt.')).toBe(9)
    expect(monthOfName('Oct')).toBe(9)
    expect(parseDay('4. maj 2026')).toBe(Date.UTC(2026, 4, 4))
    expect(parseDay('4 Aug')).toBeNull()
  })

  it('keeps the When editor’s text and its short form in step', () => {
    setReaderLocale('da-DK')
    const when = whenLabel({ from: '2026-05-12', until: '2026-09-03' })
    expect(timeShort(parseWhen(when))).toBe('12. maj – 3. sep. 2026')
  })
})
