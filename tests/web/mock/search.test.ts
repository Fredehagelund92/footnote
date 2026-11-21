import { describe, expect, it } from 'vitest'
import { createMockApi } from '@/api/mock'
import { SEARCH_GROUP_MAX, searchWorld } from '@/api/mock/search'
import { variantPart, type Definition } from '@/lib/definitions'

describe('search everywhere in the demo world', () => {
  it('finds context by its text, a title that starts with the words first, never a draft', async () => {
    const { api } = createMockApi()
    const { items } = await api.getLibrary()
    const found = await api.searchAll({ q: 'norway' })
    expect(found.items.length).toBeGreaterThan(0)
    expect(found.items.length).toBeLessThanOrEqual(SEARCH_GROUP_MAX)
    const drafts = new Set(items.filter((f) => f.status === 'Draft').map((f) => f.id))
    expect(found.items.some((hit) => drafts.has(hit.id))).toBe(false)
    const starts = found.items.map((hit) => hit.title.toLowerCase().startsWith('norway'))
    expect(starts).toEqual([...starts].sort((a, b) => Number(b) - Number(a)))
  })

  it('finds a definition by another name, and domains and people by name', async () => {
    const { api } = createMockApi()
    const definitions = await api.getDefinitions()
    const named = definitions.find((d) => d.sourceNames.length > 0)!
    const byOther = await api.searchAll({ q: named.sourceNames[0]! })
    expect(byOther.definitions.map((d) => d.name)).toContain(named.name)
    expect((await api.searchAll({ q: 'sales' })).domains.map((d) => d.name)).toContain('Sales')
    expect((await api.searchAll({ q: 'abara' })).people).toEqual([{ name: 'Jon Abara' }])
  })

  it('leaves out someone who is only invited', async () => {
    const { api } = createMockApi()
    await api.invite({ emails: ['new.person@example.test'], admin: false, owns: [] })
    expect((await api.searchAll({ q: 'new.person' })).people).toEqual([])
  })
})

describe('a family of metrics in search everywhere (F4, F5)', () => {
  const family = {
    name: 'Partner fees',
    type: 'metric',
    sourceNames: [],
    family: { variants: [{ name: 'Partner fees (EUR)' }, { name: 'Partner fees (USD)' }] },
  } as unknown as Definition
  const find = (q: string) =>
    searchWorld(q, { facts: [], definitions: [family], domains: [], people: [] }).definitions

  it('says it is a family, with its variants counted', () => {
    expect(find('partner fees')).toEqual([
      {
        name: 'Partner fees',
        type: 'metric',
        sourceNames: [],
        variants: { count: 2, matched: null },
      },
    ])
  })

  it('finds it by a currency word, brackets aside, and says which variant', () => {
    for (const q of ['partner fees usd', 'fees usd', 'Partner fees (USD)'])
      expect(find(q).map((d) => d.variants)).toEqual([{ count: 2, matched: 'Partner fees (USD)' }])
    expect(variantPart('Partner fees', 'Partner fees (USD)')).toBe('(USD)')
    expect(variantPart('Partner fees', 'Fees in dollars')).toBe('· Fees in dollars')
  })
})
