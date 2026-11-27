import { describe, expect, it } from 'vitest'
import { sameWhen, whenOfTyped, whensOfText, whenSummary, type WhenValue } from '@/lib/when'

const today = '2026-11-26'
const when = (mode: WhenValue['mode'], from = '', until = ''): WhenValue => ({ mode, from, until })

describe('the dates a text names, offered in When', () => {
  it('offers one day as that day or from it on', () => {
    const offers = whensOfText(
      'Annual plan price went up 12% on 1 September\nWe raised it on 1 September 2026.',
      today,
    )
    expect(offers).toEqual([when('day', '2026-09-01', '2026-09-01'), when('from', '2026-09-01')])
    expect(offers.map(whenSummary)).toEqual(['1 Sept 2026', 'From 1 Sept 2026'])
  })

  it('offers a range as its first and last day', () => {
    expect(whensOfText('No reports from 3 to 14 August 2026.', today)).toEqual([
      when('between', '2026-08-03', '2026-08-14'),
    ])
  })

  it('offers nothing for a text with no date', () => {
    expect(whensOfText('Checkout was down since the migration.', today)).toEqual([])
  })
})

describe('a typed date', () => {
  it('sets the day of the mode picked, years back with no calendar presses', () => {
    expect(whenOfTyped('4 Aug 2024', when('day'), today)).toEqual(
      when('day', '2024-08-04', '2024-08-04'),
    )
    expect(whenOfTyped('2024-08-04', when('from'), today)).toEqual(when('from', '2024-08-04'))
    expect(whenOfTyped('August 4, 2024', when('until'), today)).toEqual(
      when('until', '', '2024-08-04'),
    )
    expect(whenOfTyped('4 Aug 2024', when('ongoing'), today)).toEqual(when('ongoing', '2024-08-04'))
  })

  it('takes a range, or one day at a time, for Between dates', () => {
    expect(whenOfTyped('3 to 14 August 2024', when('between'), today)).toEqual(
      when('between', '2024-08-03', '2024-08-14'),
    )
    const started = whenOfTyped('3 Aug 2024', when('between'), today)!
    expect(started).toEqual(when('between', '2024-08-03'))
    expect(whenOfTyped('14 Aug 2024', started, today)).toEqual(
      when('between', '2024-08-03', '2024-08-14'),
    )
    // A day before the start starts again from it.
    expect(whenOfTyped('1 Aug 2024', started, today)).toEqual(when('between', '2024-08-01'))
  })

  it('gives nothing for words that name no day, and for Always', () => {
    expect(whenOfTyped('last spring', when('day'), today)).toBeNull()
    expect(whenOfTyped('31 February 2024', when('day'), today)).toBeNull()
    expect(whenOfTyped('4 Aug 2024', when('always'), today)).toBeNull()
  })
})

describe('two Whens with the same dates', () => {
  it('are the same however their unused dates read', () => {
    expect(sameWhen(when('from', '2026-09-01', '2026-10-01'), when('from', '2026-09-01'))).toBe(
      true,
    )
    expect(sameWhen(when('day', '2026-09-01', '2026-09-01'), when('from', '2026-09-01'))).toBe(
      false,
    )
  })
})
