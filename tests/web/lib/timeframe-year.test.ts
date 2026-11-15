import { describe, expect, it } from 'vitest'
import { parseWhen, timeDate, timeShort } from '@/lib/timeframe'

// A date in a list carries its year: "4 Aug" with no year cannot be told from last year's (P09).

describe('the dates a list shows', () => {
  it.each([
    ['From 4 Aug 2026, still going on', 'Since 4 Aug 2026', '4 Aug 2026'],
    ['Until 19 Jan 2026', 'Until 19 Jan 2026', '19 Jan 2026'],
    ['Until 19 Jan 2027', 'Until 19 Jan 2027', '19 Jan 2027'],
    ['12 to 19 May 2026', '12–19 May 2026', '12–19 May 2026'],
    ['24 Mar to 9 May 2026', '24 Mar – 9 May 2026', '24 Mar – 9 May 2026'],
    ['3 Aug 2025 to 5 Jun 2026', '3 Aug 2025 – 5 Jun 2026', '3 Aug 2025 – 5 Jun 2026'],
  ])('%s reads %s, and its date %s', (when, short, date) => {
    expect(timeShort(parseWhen(when))).toBe(short)
    expect(timeDate(parseWhen(when))).toBe(date)
  })
})
