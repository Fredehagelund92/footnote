import { describe, expect, it } from 'vitest'
import {
  apartFromDrafts,
  draftsBlock,
  type DraftsRead,
} from '../../src/server/modules/answer/loop-drafts.ts'

// The block of what is not published yet (FR-718.2, as amended 25 Nov 2026): which of the model's
// sentences leave the answer, and the one the block keeps.

const read: DraftsRead = {
  words: ['payout journal'],
  found: 4,
  rows: [
    {
      id: '0b8f1c1e-0000-4000-8000-000000000001',
      ref: 'draft:12',
      state: 'draft',
      change: false,
      title: 'Payout journal entries start in 2026',
      domain: 'domain:area_sales',
      by: 'Jon Abara',
      on: '2026-10-20',
      owners: ['Jon Abara', 'Sofia Brandt'],
    },
    {
      id: '0b8f1c1e-0000-4000-8000-000000000002',
      ref: 'draft:14',
      state: 'waiting',
      change: false,
      title: 'Payout journal is booked a day late',
      domain: 'domain:area_sales',
      by: 'Kofi Mensah',
      on: '2026-10-21',
      owners: ['Jon Abara', 'Sofia Brandt'],
    },
  ],
}

describe('what leaves the answer', () => {
  it('keeps one conditional sentence that cites only what the searches gave', () => {
    const apart = apartFromDrafts(
      'Nothing published covers the payout journal. If they are published as written, the journal starts in 2026 [draft:12, draft:14].',
      read,
    )
    expect(apart).toEqual({
      text: 'Nothing published covers the payout journal.',
      sentence: 'If they are published as written, the journal starts in 2026.',
      checks: [],
    })
  })

  it('takes out a sentence that cites one as a fact, names one by its title, or cites one no search gave', () => {
    const apart = apartFromDrafts(
      [
        'The journal starts in 2026 [draft:12].',
        'Payout journal entries start in 2026, so earlier months show nothing.',
        'If it is published as written, the journal is late [draft:99].',
        'Nothing published covers it.',
      ].join(' '),
      read,
    )
    expect(apart.text).toBe('Nothing published covers it.')
    expect(apart.sentence).toBeNull()
    expect(apart.checks.map((c) => c.kind)).toEqual(['draft', 'draft', 'draft'])
  })

  it('keeps only the first conditional sentence, and drops one that cites no item or a source too', () => {
    const apart = apartFromDrafts(
      'If it is published as written, the journal is late.\n\n- If they are published as written, it starts in 2026 [itm_norwaystop, draft:12].\n- If it is published as written, it starts in 2026 [draft:12].\n- If it is published as written, it is booked late [draft:14].',
      read,
    )
    expect(apart.text).toBe('')
    expect(apart.sentence).toBe('If it is published as written, it starts in 2026.')
    expect(apart.checks).toHaveLength(3)
  })

  it('leaves words about nothing unpublished as they are, with no search either', () => {
    const text = 'Two items apply [itm_norwaystop].\n\n- Orders in Norway [itm_norwaystop]'
    expect(apartFromDrafts(text, null)).toEqual({ text, sentence: null, checks: [] })
  })
})

describe('the block', () => {
  it('offers to open a draft to its writer and to review a suggestion, and counts the rest', () => {
    const block = draftsBlock(read, null)
    expect(block.more).toBe(2)
    expect(block.rows.map((r) => r.action)).toEqual([
      {
        id: 'open_draft',
        draft: {
          id: read.rows[0]!.id,
          domain: 'domain:area_sales',
          mine: true,
          owners: read.rows[0]!.owners,
        },
      },
      {
        id: 'review_suggestion',
        draft: {
          id: read.rows[1]!.id,
          domain: 'domain:area_sales',
          mine: false,
          owners: read.rows[1]!.owners,
        },
      },
    ])
    expect(block.rows[0]).not.toHaveProperty('ref')
  })
})
