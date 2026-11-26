import { describe, expect, it } from 'vitest'
import { DRAFTS_READ } from '@domain/ask-chat'
import type { Answer } from '@/model/ask'
import { shareTurnOf } from '@/model/shared-chat'

// A chat shared as a link (FR-721) never carries what a search found not published yet: only the
// asker may know it (FR-718.2).

describe('a turn as a shared chat sends it', () => {
  it('leaves out the line of what was found not published yet, and keeps every other line', () => {
    const answer = {
      question: 'How are Black Friday orders counted?',
      read: [
        'Searched “Black Friday”, any date, every kind: 0 found.',
        `${DRAFTS_READ} for “Black Friday”: 1 found, not published.`,
      ],
      state: 'missing',
      text: 'Nothing published covers Black Friday orders yet.',
      sources: [],
    } as unknown as Answer
    expect(shareTurnOf(answer)?.read).toEqual([
      'Searched “Black Friday”, any date, every kind: 0 found.',
    ])
  })
})
