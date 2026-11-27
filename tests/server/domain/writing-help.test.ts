import { describe, expect, it } from 'vitest'
import { draftFieldNames } from '../../../src/domain/draft-stamps.ts'
import {
  earlierTurn,
  fixedReply,
  helpFieldNames,
  linksIn,
  pasteTooLong,
  turnsUsedUp,
} from '../../../src/domain/writing-help.ts'

// Writing help's rules that the service, the web app and its mock share (Route 3).

describe('the links of a message', () => {
  it('finds each link once, in the order written, without the punctuation after it', () => {
    expect(
      linksIn(
        'See https://customs.example/notices/2026-08-04. Also (http://wiki.example/a?b=1), and https://customs.example/notices/2026-08-04!',
      ),
    ).toEqual(['https://customs.example/notices/2026-08-04', 'http://wiki.example/a?b=1'])
  })

  it('finds none in plain words, and takes no other kind of address', () => {
    expect(linksIn('Ops told us orders to Norway stopped on 4 August.')).toEqual([])
    expect(linksIn('file:///etc/passwd ftp://files.example/x javascript:alert(1)')).toEqual([])
  })
})

describe('what it writes and says', () => {
  it('writes every field an agent writes but the domain, which is the person’s', () => {
    expect(helpFieldNames).toEqual(draftFieldNames.filter((name) => name !== 'area'))
  })

  it('cuts an earlier turn short before it is sent again', () => {
    const turn = earlierTurn('a'.repeat(3_000), 'b'.repeat(10))
    expect(turn.said).toHaveLength(2_000)
    expect(turn.reply).toBe('b'.repeat(10))
  })

  it('says each limit in a sentence the person reads', () => {
    expect(pasteTooLong(12_345, 12_000)).toBe(
      'That is 12,345 characters, and writing help reads at most 12,000 at once. Paste the part that matters.',
    )
    expect(turnsUsedUp(40, 59)).toBe(
      "You've used writing help 40 times in the last 24 hours, the most allowed. Try again in 1 minute, or change the draft yourself.",
    )
    expect(turnsUsedUp(40, 3 * 60 * 60)).toContain('Try again in 3 hours')
    expect(fixedReply(true)).toBe(
      'I changed the draft. Check each field I wrote before you send it.',
    )
    expect(fixedReply(false)).toBe('I changed nothing in the draft.')
  })
})
