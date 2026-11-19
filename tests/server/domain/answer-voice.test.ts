import { describe, expect, it } from 'vitest'
import { spansIn, voiceBreak } from '../../../src/domain/answer-voice.ts'

// Ask's one voice (H14 of the hardening plan): each sentence below is one a real model wrote in
// the release judgement's run (A6, A7, A8), or one that keeps the voice and must stay.

const breaks = (s: string) => voiceBreak(s, 'Footnote')

describe('one voice', () => {
  it('fails a sentence that speaks as I or tells of the reads made', () => {
    for (const s of [
      'The Spain items I read for 1 to 31 October 2026 also include a rule that Orders excludes test accounts.',
      'I read 03/04/2026 as 3 April 2026 (day first).',
      "These two disagree, and I can't say which one applies.",
      'My earlier answer had a mistake.',
      'If you tell me which metric you mean, Ask can look it up.',
      "The first read found nothing for margin in Spain on today's date alone, and the wider search found items about Gross margin in Spain.",
      'The reads give no sign of an item explaining a drop in August 2025.',
      'An earlier, wider search for Norway orders on any date turned up a Norway launch campaign.',
      'Ask searched every domain for it.',
      'get_context found nothing for Poland.',
    ])
      expect(breaks(s), s).toBe('voice')
  })

  it('fails a sentence that gives the same days twice', () => {
    for (const s of [
      'For Returns in Norway, read for 1 Apr to 30 Jun 2026 (1 April to 30 June 2026), two items matter most.',
      'Taking fiscal year 2026 as 1 Jan to 31 Dec 2026 (from 1 January 2026 to 31 December 2026), three items apply.',
      'Q2 2026 is 2026-04-01 to 2026-06-30, so 1 April to 30 June 2026.',
    ])
      expect(breaks(s), s).toBe('period')
    expect(spansIn('1 to 31 October 2026')).toEqual(['1-10-2026/31-10-2026'])
  })

  it('fails a claim about what the product records that no read returned', () => {
    for (const s of [
      'Footnote does not record who wrote or published the item, only its owner.',
      'Ask does not answer questions about one person’s work, and Footnote holds no email addresses for the people in this workspace.',
      'Footnote does not keep who changed an item.',
    ])
      expect(breaks(s), s).toBe('claim')
  })

  it('lets stand what keeps the voice', () => {
    for (const s of [
      'Footnote keeps no order figures, so it cannot say how much Orders in Norway changed.',
      'Footnote keeps no figures for Discount cost in Norway.',
      'Footnote holds no metric called "revenue".',
      'Footnote holds no item about Japan.',
      'Ask does not answer questions about one person’s work.',
      'Ask does not make up definitions.',
      'The item covers 24 February 2024 to 29 January 2025.',
      'Q2 2026 covers 1 April to 30 June 2026, and the campaign ran from 7 June 2026 to 28 June 2026.',
      'The guide says "I always look at four weeks first" before explaining a jump.[1]',
      'Not answered here: this read every domain, not only Sales.',
      'Read the item before the close, it says.[1]',
      'Paid search in Norway rose after the campaign.',
    ])
      expect(breaks(s), s).toBeNull()
  })
})
