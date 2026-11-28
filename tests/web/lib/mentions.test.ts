import { describe, expect, it } from 'vitest'
import type { Definition } from '@/lib/definitions'
import { PLAIN_ROLE, type Domain, type Person } from '@/model/people'
import {
  SCOPE_KINDS,
  mentionablesOf,
  parseMentionId,
  searchMentions,
  valueDimension,
} from '@/lib/mentions'

// Ask's '@' list over a Cube view whose top metric is a family of two currencies (FR-142): typed
// in full, the family's name finds it first, ahead of the metrics that only end in its words, and
// two families a source named alike are one mention.

const core: Domain = { id: 'core', name: 'Core', owners: [], covers: '', text: '' }

const metric = (name: string, extra: Partial<Definition> = {}): Definition => ({
  name,
  type: 'metric',
  definition: '',
  synced: true,
  tool: 'Cube',
  sourceNames: [],
  domain: 'core',
  group: 'Ledger_revenue',
  updated: '',
  ...extra,
})

const family = (name: string, words: string): Definition =>
  metric(name, {
    family: {
      by: ['Currency'],
      found: 'names',
      variants: ['EUR', 'USD'].map((code) => ({
        name: `${name} (${code}) ${words}`.trim(),
        values: [code],
      })),
    },
  })

const world = (definitions: Definition[]) =>
  mentionablesOf({ facts: [], definitions, domains: [core], people: [] })

describe("Ask's '@' list and families", () => {
  const all = world([
    family('Ledger Revenue', ''),
    metric('Forecast Orders (ledger revenue)'),
    metric('Basket Value (ledger revenue)'),
    family('Forecast Takings', '(ledger revenue)'),
    family('Forecast Takings', '(ledger revenue)'),
  ])

  it('finds a family by its name, first, as one metric marked a family', () => {
    const [definitions] = searchMentions(all, SCOPE_KINDS, 'Ledger Revenue')
    expect(definitions?.label).toBe('Definitions')
    expect(definitions?.items.map((m) => m.label)).toEqual([
      'Ledger Revenue',
      'Basket Value (ledger revenue)',
      'Forecast Orders (ledger revenue)',
    ])
    expect(definitions?.items[0]).toMatchObject({
      id: 'metric:Ledger Revenue',
      kind: 'metric',
      hint: 'Core',
      family: true,
    })
  })

  it('never names a variant apart', () => {
    expect(searchMentions(all, SCOPE_KINDS, 'Ledger Revenue (EUR)')).toEqual([])
  })

  it('keeps one mention for two families of one name', () => {
    expect(all.filter((m) => m.id === 'metric:Forecast Takings')).toHaveLength(1)
  })
})

describe('a mention saved before Ask offered every value', () => {
  it("reads Ask's old market:Norway as that dimension's value, by its word", () => {
    expect(parseMentionId('market:Norway')).toEqual({ kind: 'value', key: 'market/Norway' })
    expect(valueDimension('market:Norway')).toBe('market')
    expect(parseMentionId('value:channel/email')).toEqual({ kind: 'value', key: 'channel/email' })
  })
})

describe("the '@' list's line under a person", () => {
  const person = (name: string, role: string, extra: Partial<Person> = {}): Person => ({
    id: name,
    name,
    role,
    owns: [],
    admin: false,
    ...extra,
  })
  const hints = mentionablesOf({
    facts: [],
    definitions: [],
    domains: [core],
    people: [
      person('Ines Duarte', PLAIN_ROLE),
      person('Lena Park', 'Admin', { admin: true }),
      person('Jon Abara', 'Owner of Core', { owns: ['core'] }),
    ],
  })
    .filter((m) => m.kind === 'person')
    .map((m) => [m.label, m.hint])

  it('says nothing for someone who is no admin and owns no domain', () => {
    expect(hints).toEqual([
      ['Ines Duarte', undefined],
      ['Lena Park', 'Admin'],
      ['Jon Abara', 'Owner of Core'],
    ])
  })
})
