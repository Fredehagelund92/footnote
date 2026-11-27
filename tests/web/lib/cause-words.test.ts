import { describe, expect, it } from 'vitest'
import { causeIn } from '@/lib/cause-words'

describe('the cause a text gives', () => {
  it('finds the words that give a cause, as written', () => {
    expect(
      causeIn(
        'New MRR rose in September because annual customers renewed at the new price, not because more signed up.',
      ),
    ).toBe('because')
    expect(causeIn('Net revenue reads low Due to the outage.')).toBe('Due to')
    expect(causeIn('The drop was caused by a broken checkout.')).toBe('caused by')
    expect(causeIn('Orders fell, driven by the strike.')).toBe('driven by')
  })

  it('finds none in a text that gives no cause, nor inside other words', () => {
    expect(causeIn('Annual plan price went up 12% on 1 September 2026.')).toBeNull()
    expect(causeIn('The ledto field and the thanksgiving sale.')).toBeNull()
  })
})
