import { describe, expect, it } from 'vitest'
import { windowWords } from '@domain/dates'
import { whenOfPeriod } from '@/lib/when'
import { questionAbout } from '@/model/ask'

// The question travels both ways (FR-816, ask first): Not found's Write context takes the days
// the question was read on to the editor's When, and the published item's Ask again asks it.

describe('the days of a question, as the editor’s When', () => {
  it('reads every way Ask’s read line says days', () => {
    const window = (start: string, end: string | null) => windowWords({ start, end })
    expect(whenOfPeriod(window('2026-10-07', '2026-10-08'))).toEqual({
      mode: 'day',
      from: '2026-10-07',
      until: '2026-10-07',
    })
    expect(whenOfPeriod(window('2026-09-01', '2026-10-01'))).toEqual({
      mode: 'between',
      from: '2026-09-01',
      until: '2026-09-30',
    })
    expect(whenOfPeriod(window('2026-09-01', '2026-10-31'))).toEqual({
      mode: 'between',
      from: '2026-09-01',
      until: '2026-10-30',
    })
    expect(whenOfPeriod(window('2025-12-01', '2026-01-03'))).toEqual({
      mode: 'between',
      from: '2025-12-01',
      until: '2026-01-02',
    })
    expect(whenOfPeriod(window('2026-10-07', null))).toEqual({
      mode: 'from',
      from: '2026-10-07',
      until: '',
    })
    expect(whenOfPeriod('up to 7 Oct 2026')).toEqual({
      mode: 'until',
      from: '',
      until: '2026-10-07',
    })
  })

  it('reads no days from any date or other words', () => {
    expect(whenOfPeriod('any date')).toBeNull()
    expect(whenOfPeriod('last month')).toBeNull()
    expect(whenOfPeriod('7 Foo 2026')).toBeNull()
  })
})

describe('the question asked again about an item', () => {
  it('names what it applies to, on its dates when they miss today', () => {
    expect(questionAbout({ metric: 'New MRR', values: [] }, 'from 1 to 30 Sep 2026')).toBe(
      'What should I know about New MRR from 1 to 30 Sep 2026?',
    )
    expect(questionAbout({ metric: 'Orders', values: ['Norway'] }, '')).toBe(
      'What should I know about Orders in Norway?',
    )
    expect(questionAbout(null, '')).toBe('What should I know about our numbers?')
  })
})
