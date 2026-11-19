import { describe, expect, it } from 'vitest'
import { sameShare } from '@/model/saved-questions'

// Quality's trend: the share of saved questions that answer as saved, a week at a time. A week
// before the first question was saved has no share, so the chart leaves a gap instead of a fall
// to 0 (it drew "0, 0, 0, 2" for an install whose two questions were saved last week).

describe('sameShare', () => {
  it('leaves out the weeks before any question was saved', () => {
    expect(sameShare({ same: [0, 0, 0, 2], total: [0, 0, 0, 2] })).toEqual([null, null, null, 100])
  })

  it('reads each week as a whole percent of the questions saved by then', () => {
    expect(sameShare({ same: [11, 12, 9], total: [12, 12, 12] })).toEqual([92, 100, 75])
    expect(sameShare({ same: [1, 2], total: [1, 3] })).toEqual([100, 67])
  })
})
