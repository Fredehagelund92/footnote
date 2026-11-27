import { describe, expect, it } from 'vitest'
import { domainNameOf, freeAreaId, namesPlace } from '../../../src/domain/names-place.ts'

const none = new Set<string>()

describe('a new domain id', () => {
  it('is made from its name, and another when that one is taken', () => {
    expect(freeAreaId('Customer value', none)).toBe('customer_value')
    expect(freeAreaId('Finance', new Set(['finance', 'finance_2']))).toBe('finance_3')
    expect(freeAreaId('Café & Bar', none)).toBe('cafe_bar')
    expect(freeAreaId('2026 plans', none)).toBe('area_2026_plans')
    expect(freeAreaId('!!', none)).toBe('area_domain')
  })

  it('reads a tool word as a name', () => {
    expect(domainNameOf('customer_success')).toBe('Customer success')
    expect(domainNameOf('_shared')).toBe('Shared')
    expect(domainNameOf('__')).toBe('')
  })
})

describe('where names with no domain go (F08)', () => {
  const unplaced = (named: string | null, ...views: string[]) => ({ named, views })

  it('offers nothing when every name has a domain', () => {
    expect(namesPlace({ unplaced: [], domains: [], taken: none })).toBeNull()
  })

  it('offers the domain the tool names, as a new one', () => {
    expect(
      namesPlace({
        unplaced: [unplaced('sales', 'orders'), unplaced('sales', 'orders'), unplaced(null, 'x')],
        domains: [],
        taken: none,
      }),
    ).toEqual({ id: null, name: 'Sales', names: 3 })
  })

  it('offers a domain that has the tool name as its name', () => {
    expect(
      namesPlace({
        unplaced: [unplaced('sales', 'orders')],
        domains: [{ id: 'sales_team', name: 'Sales', owned: false }],
        taken: new Set(['sales_team']),
      }),
    ).toEqual({ id: 'sales_team', name: 'Sales', names: 1 })
  })

  it('skips a tool domain whose id a deleted domain keeps, for the one domain the reader owns', () => {
    expect(
      namesPlace({
        unplaced: [unplaced('sales', 'orders')],
        domains: [{ id: 'revenue', name: 'Revenue', owned: true }],
        taken: new Set(['sales', 'revenue']),
      }),
    ).toEqual({ id: 'revenue', name: 'Revenue', names: 1 })
  })

  it('names a new one for the view most names are in, or Company with no view', () => {
    const domains = [
      { id: 'a', name: 'A', owned: true },
      { id: 'b', name: 'B', owned: true },
    ]
    expect(
      namesPlace({
        unplaced: [unplaced(null, 'subscriptions'), unplaced(null, 'subscriptions', 'support')],
        domains,
        taken: new Set(['a', 'b']),
      }),
    ).toEqual({ id: null, name: 'Subscriptions', names: 2 })
    expect(namesPlace({ unplaced: [unplaced(null)], domains: [], taken: none })).toEqual({
      id: null,
      name: 'Company',
      names: 1,
    })
  })
})
