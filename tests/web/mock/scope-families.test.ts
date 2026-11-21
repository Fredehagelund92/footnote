import { describe, expect, it } from 'vitest'
import { familyDefinitions } from '@/api/mock/data/variants'
import { createScopeSearch } from '@/api/mock/scope'

// "Applies to" in the mock offers a family as the service does (FR-142): one row with how many
// variants it has, a variant's words find it, and no variant is offered apart.

describe('the mock’s Applies to with families', () => {
  const families = familyDefinitions('dbt')
  const search = (q: string) => createScopeSearch().search({ q }, [], families)

  it('offers the family for a variant’s words, with its count, never the variant', () => {
    const { metrics } = search('revenue eur web')
    expect(metrics.map((hit) => [hit.name, hit.variants])).toContainEqual(['Revenue', 250])
    expect(metrics.map((hit) => hit.name)).not.toContainEqual(expect.stringContaining('(EUR)'))
  })
})
