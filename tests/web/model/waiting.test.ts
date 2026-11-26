import { describe, expect, it } from 'vitest'
import { agoWords, decidesWords, sentWords, waitedDays, waitingLine } from '@/model/waiting'

// The words of a suggestion waiting for review: who sent it, how long ago, and who decides.

describe('a suggestion waiting for review, in words', () => {
  it('counts whole days since it was sent, never below none', () => {
    expect(waitedDays('2026-10-20', '2026-10-23')).toBe(3)
    expect(waitedDays('2026-10-20T16:40:00Z', '2026-10-20')).toBe(0)
    expect(waitedDays('2026-10-24', '2026-10-23')).toBe(0)
    expect([0, 1, 12].map(agoWords)).toEqual(['today', 'yesterday', '12 days ago'])
  })

  it('names its sender, or you, or nobody when a sync sent it', () => {
    const sent = { by: 'Maria Lindqvist', sentAt: '2026-10-20' }
    expect(sentWords(sent, 'Jon Abara', '2026-10-23')).toBe('Maria Lindqvist sent it 3 days ago')
    expect(sentWords(sent, 'Maria Lindqvist', '2026-10-23')).toBe('You sent it 3 days ago')
    expect(sentWords({ by: '', sentAt: '2026-10-23' }, 'Jon Abara', '2026-10-23')).toBe(
      'Sent today',
    )
  })

  it('says who decides: you first, then the other owners, or an admin', () => {
    expect(decidesWords(['Jon Abara', 'Sofia Brandt'], 'Jon Abara')).toBe(
      'You or Sofia Brandt decide',
    )
    expect(decidesWords(['Jon Abara', 'Sofia Brandt'], 'Maria Lindqvist')).toBe(
      'Jon Abara or Sofia Brandt decide',
    )
    expect(decidesWords(['Jon Abara'], 'Maria Lindqvist')).toBe('Jon Abara decides')
    expect(decidesWords(['Jon Abara'], 'Jon Abara')).toBe('You decide')
    expect(decidesWords([], 'Maria Lindqvist')).toBe('An admin decides')
  })

  it('never names its sender among who decides, even an owner', () => {
    expect(
      waitingLine(
        { by: 'Sofia Brandt', sentAt: '2026-10-22' },
        ['Jon Abara', 'Sofia Brandt'],
        'Jon Abara',
        '2026-10-23',
      ),
    ).toBe('Sofia Brandt sent it yesterday. You decide.')
  })
})
