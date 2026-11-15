import { describe, expect, it } from 'vitest'
import { readFailureLines } from '@/lib/read-failure'

const failed = {
  failures: 3,
  failure: 'the repository refused the token (401)',
  lastGood: { day: '21 Oct', time: '06:00' },
  staleAfter: '6 hours',
}

describe('the sentences of a failed read', () => {
  it('says what failed, what agents still get and what to do, each as a whole sentence', () => {
    expect(readFailureLines(failed)).toEqual({
      what: 'The last 3 reads failed: the repository refused the token (401).',
      next: 'Agents still get what was read on 21 Oct at 06:00. Press Read again. If it still fails after 6 hours, admins get a card.',
    })
  })

  it('says a day by its name, and one failed read in the singular', () => {
    const one = readFailureLines({
      ...failed,
      failures: 1,
      lastGood: { day: 'Today', time: '06:00' },
    })
    expect(one.what).toBe('The last read failed: the repository refused the token (401).')
    expect(one.next).toContain('what was read today at 06:00.')
    expect(
      readFailureLines({ ...failed, lastGood: { day: 'Yesterday', time: '06:00' } }).next,
    ).toContain('what was read yesterday at 06:00.')
  })

  it('says so when nothing was read before, and when the reason is not known', () => {
    const none = readFailureLines({ ...failed, lastGood: null, failure: null })
    expect(none.what).toBe("The last 3 reads failed: it couldn't be read.")
    expect(none.next).toBe(
      'Nothing was read yet. Press Read again. If it still fails after 6 hours, admins get a card.',
    )
  })

  it('never glues the sentence from parts that need a comma and a lower-case word', () => {
    const { what, next } = readFailureLines(failed)
    expect(`${what} ${next}`).not.toMatch(/stays|can't be reached|Admins are told/)
  })
})
