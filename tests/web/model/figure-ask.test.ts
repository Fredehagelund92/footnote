import { describe, expect, it } from 'vitest'
import { figureAskOf } from '@/model/figures'

// What an answer asks of the data. "Footwear orders in August 2026" is read for Footwear, a value
// of the product dimension, and named no market: its figure once read every product's orders and
// showed them as "Orders, 1 to 31 Aug 2026".

const answer = {
  metric: 'Orders',
  markets: [],
  dates: '1 to 31 Aug 2026',
  state: 'missing' as const,
  sources: [],
}

describe('the figure an answer asks for', () => {
  it("asks a loop answer's figure for the values its subject's read was read for", () => {
    const subject = {
      names: ['Orders', 'Norway'],
      about: ['metric:orders', 'value:market/norway'],
      period: '1 to 31 Aug 2026',
      note: null,
      assumedToday: false,
      carried: false,
      uncovered: [],
      unwritten: [],
    }
    const asked = figureAskOf({ ...answer, markets: ['Norway'], loop: { subject } as never })
    expect(asked.values).toEqual(['val:market/norway'])
  })

  it('asks for the markets by name when the answer has no subject', () => {
    const asked = figureAskOf({ ...answer, markets: ['Norway'] })
    expect(asked).not.toHaveProperty('values')
    expect(asked.markets).toEqual(['Norway'])
  })
})
