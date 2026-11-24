import { describe, expect, it } from 'vitest'
import {
  areas,
  demoTerms,
  FIXTURE_TODAY,
  people,
} from '../../../db/seed/fixtures/reference-data.ts'
import { TERMS } from '@/api/mock/data/terms'
describe("the demo library's terms", () => {
  it('are terms the mock starts with, with the same meaning, domain, owner and day', () => {
    expect(demoTerms.map((t) => t.name)).toEqual([
      'Marketplace commission',
      'Selling country',
      'Season',
    ])
    for (const t of demoTerms) {
      const mock = TERMS.find((m) => m.name === t.name)
      expect(mock, t.name).toBeDefined()
      expect(t.meaning).toBe(mock!.definition)
      expect(t.areaId).toBe(`area_${mock!.domain}`)
      expect(people.find((p) => p.id === t.personId)?.name).toBe(mock!.by)
      expect(Date.parse(`${mock!.updated} 12:00 UTC`)).toBe(Date.parse(`${t.day}T12:00:00Z`))
    }
  })

  it('are written in a domain the person owns, before the fixed today', () => {
    for (const t of demoTerms) {
      expect(areas.find((a) => a.id === t.areaId)?.ownerIds, t.name).toContain(t.personId)
      expect(t.day < FIXTURE_TODAY, t.name).toBe(true)
    }
  })
})
