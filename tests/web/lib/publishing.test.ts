import { afterEach, describe, expect, it } from 'vitest'
import { publishing, refusedWords } from '@/lib/publishing'

afterEach(() => {
  for (const id of Object.keys(publishing.now())) publishing.clear(id)
})

describe('a Publish the review moved on from', () => {
  it('says Publishing until the service answers, and never Published itself', () => {
    publishing.start('sug-a')
    expect(publishing.now()).toEqual({ 'sug-a': { state: 'publishing' } })
    // The service said yes: the Inbox's outcome is the row's word from now on.
    publishing.answered('sug-a')
    expect(publishing.now()).toEqual({})
  })

  it('keeps a refusal on its row until it is tried again', () => {
    publishing.start('sug-a')
    publishing.start('sug-b')
    publishing.refused('sug-a', 'conflict', 'Another owner is already reviewing this suggestion.')
    expect(publishing.now()['sug-a']).toEqual({
      state: 'refused',
      failure: 'conflict',
      reason: 'Another owner is already reviewing this suggestion.',
    })
    expect(publishing.now()['sug-b']).toEqual({ state: 'publishing' })
    publishing.clear('sug-a')
    expect(Object.keys(publishing.now())).toEqual(['sug-b'])
  })

  it('gives a new value on every change, so a row that reads it draws again', () => {
    const before = publishing.now()
    publishing.start('sug-a')
    expect(publishing.now()).not.toBe(before)
  })
})

describe('what a refused row says', () => {
  it("is the service's reason, and that nothing changed", () => {
    expect(
      refusedWords({
        state: 'refused',
        failure: 'conflict',
        reason: 'Another owner is already reviewing this suggestion.',
      }),
    ).toBe('Another owner is already reviewing this suggestion. Nothing changed.')
  })

  it('says how to try again when the send only failed', () => {
    expect(refusedWords({ state: 'refused', failure: 'failed', reason: null })).toBe(
      'Nothing changed. Open it to try again.',
    )
  })
})
