import { describe, expect, it } from 'vitest'
import { checkedTip, trustOf } from '@/lib/timeframe'
import type { Fact } from '@/model/items'

// The dot in the Checked column, and the Context footer that counts it, say what the service says.

const fact = (over: Partial<Fact>) => ({ status: 'Live', checkedOn: '', ...over }) as Fact

describe('the trust of a context item', () => {
  it('reads an item the service calls due as due, though nobody ever checked it', () => {
    expect(trustOf(fact({ status: 'Needs a recheck', checkedOn: '' }))).toBe('due')
  })

  it('reads an item never checked and not due as a draft', () => {
    expect(trustOf(fact({ status: 'Live', checkedOn: '' }))).toBe('draft')
  })

  it('reads an archived item as retired before anything else', () => {
    expect(trustOf(fact({ status: 'Archived', checkedOn: '' }))).toBe('retired')
  })

  it('says Needs a recheck in the dot tooltip, with no second name for it', () => {
    const tip = checkedTip(
      fact({ status: 'Needs a recheck', checkedOn: '1 Oct 2026', checkedBy: 'Ines Duarte' }),
    )
    expect(tip).toContain('Needs a recheck')
    expect(tip).not.toMatch(/overdue|needs checking|outdated|due for a check/i)
  })
})
