import { describe, expect, it } from 'vitest'
import { facts } from '@/api/mock/data/world'
import { markedPhrases, markShared, sentencesOf } from '@/lib/where'

const stop = facts.find((f) => f.id === 'itm_norway_stop')!
/** An answer's words: each source's sentence with its number, then one of Ask's own. */
const words =
  "Online sales to Norway stopped on 4 August 2026 under a new customs rule, and there are no stores there [1]. Price promotions in Norway have been paused since 9 May 2026 [2]. The context doesn't say how much each of these moved orders."

describe('where it says that', () => {
  it('cuts an answer into sentences, each with the sources it cites', () => {
    const s = sentencesOf(words)
    expect(s).toHaveLength(3)
    expect(s[0]!.cites).toEqual([1])
    expect(s[0]!.text).toBe(
      'Online sales to Norway stopped on 4 August 2026 under a new customs rule, and there are no stores there.',
    )
    expect(s[1]!.cites).toEqual([2])
    // Ask's own sentence cites nothing.
    expect(s[2]!.cites).toEqual([])
  })
  it('marks only exact phrases of three words or more', () => {
    const sentence = sentencesOf(words)[0]!.text
    expect(markedPhrases(markShared(sentence, [stop.summary]))).toEqual([
      'Online sales to Norway',
      '4 August 2026',
      'a new customs rule',
    ])
    // The source backs the date, not the wording: "new customs rule" is the owner's own.
    const quote = markedPhrases(markShared(stop.quote, [stop.summary]))
    expect(quote).toEqual(['from 4 August 2026'])
    expect(quote.join(' ')).not.toMatch(/customs rule/)
  })
  it('marks nothing when nothing matches, and keeps every character', () => {
    const text = 'Price promotions in Norway have been paused since 9 May 2026.'
    const segs = markShared(text, ['Nothing alike here at all.'])
    expect(markedPhrases(segs)).toEqual([])
    expect(segs.map((s) => s.text).join('')).toBe(text)
    const marked = markShared(stop.summary, [sentencesOf(words)[0]!.text, stop.quote])
    expect(marked.map((s) => s.text).join('')).toBe(stop.summary)
  })
})
