import { describe, expect, it } from 'vitest'
import { ended, midSentence } from '@/lib/utils'

describe('a time label inside a sentence', () => {
  it('lowers a leading word, never a month', () => {
    expect(midSentence('Today, 09:31')).toBe('today, 09:31')
    expect(midSentence('Yesterday, 14:20')).toBe('yesterday, 14:20')
    expect(midSentence('Just now')).toBe('just now')
    expect(midSentence('Since 2 Oct')).toBe('since 2 Oct')
    expect(midSentence('23 Oct')).toBe('23 Oct')
    expect(midSentence('21 Oct 2025')).toBe('21 Oct 2025')
    expect(midSentence('Tue 20 Oct')).toBe('Tue 20 Oct')
    expect(midSentence('October 2026')).toBe('October 2026')
  })
})

describe('words as a sentence', () => {
  it('end in one full stop, and keep the mark of a title that asks or exclaims', () => {
    expect(ended('none')).toBe('none.')
    expect(ended('Returns in Spain; Orders in Norway')).toBe('Returns in Spain; Orders in Norway.')
    // It once read "...with Spain as the baseline?." in the review.
    expect(ended('Why did returns rise with Spain as the baseline?')).toBe(
      'Why did returns rise with Spain as the baseline?',
    )
    expect(ended('Stop!')).toBe('Stop!')
    expect(ended('Checked today.')).toBe('Checked today.')
  })
})
