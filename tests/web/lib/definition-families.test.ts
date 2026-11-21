import { describe, expect, it } from 'vitest'
import { familyDefinitions } from '@/api/mock/data/variants'
import {
  definitionCounts,
  familyBy,
  findDefinition,
  listIndex,
  type Definition,
} from '@/lib/definitions'
import type { Fact } from '@/model/items'

// Families of metrics in Definitions (FR-142): a family is one entry for its variants, counted as
// one metric with its variants said apart, found by a variant's name, and its context is the
// context about any of them.

// The twenty families of one calculation each, 250 variants by Currency and Channel.
const families = familyDefinitions('Cube').filter((d) => d.family?.variants.length === 250)
const dimensions: Definition[] = ['Currency', 'Channel', 'Status'].map((name) => ({
  name,
  type: 'dimension',
  definition: '',
  synced: true,
  sourceNames: [],
  updated: '',
}))

describe('a family in Definitions', () => {
  it('counts as one metric, its variants said apart', () => {
    expect(definitionCounts([...families, ...dimensions])).toBe(
      '20 metrics (5,000 variants), 3 dimensions',
    )
    expect(definitionCounts(dimensions)).toBe('3 dimensions')
    expect(familyBy(families[0]!.family!)).toBe('by Currency and Channel')
    expect(familyBy({ by: ['Currency'], variants: [] })).toBe('by Currency')
  })

  it('is what a variant’s name finds: a variant has no entry of its own', () => {
    const all = [...families, ...dimensions]
    expect(findDefinition(all, 'Revenue (EUR) web')?.name).toBe('Revenue')
    expect(all.some((d) => d.name === 'Revenue (EUR) web')).toBe(false)
  })

  it('has the context about any of its variants', () => {
    const fact = (id: string, where: string[]) =>
      ({ id, where, status: 'Live', title: id, summary: '' }) as unknown as Fact
    const facts = [fact('about-family', ['Revenue']), fact('about-one', ['Revenue (EUR) web'])]
    const index = listIndex(families, facts)
    const revenue = families.find((d) => d.name === 'Revenue')!
    expect(index.contextAbout(revenue).map((f) => f.id)).toEqual(['about-family', 'about-one'])
  })
})
