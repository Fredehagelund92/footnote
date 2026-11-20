import { describe, expect, it } from 'vitest'
import { facts } from '@/api/mock/data/world'
import { definitionSeed } from '@/api/mock/definitions'
import { createWorkspace } from '@/api/mock/workspace'
import { linksOf } from '@/lib/links'

// get_related: links both ways and the owners' relations, one step, a retired target shown and
// never followed, a definition from another domain marked, and the switch turns it all off.

const w = { facts, definitions: definitionSeed, domains: createWorkspace().domainMap() }

describe('links', () => {
  it("lists an item's links both ways, in a fixed order", () => {
    const links = linksOf('context:itm_norway_stop', w)
    expect(links.map((l) => [l.rel, l.to.id])).toEqual([
      ['mentions', 'term:Webshop'],
      ['mentions', 'metric:Orders'],
      ['mentions', 'context:itm_za26xpzv'],
      ['mentions', 'context:itm_kh4llvi9'],
    ])
    expect(links.find((l) => l.to.id === 'context:itm_kh4llvi9')!.to.retired).toBe(true)
    // Linked from: the Norway stop links here.
    expect(linksOf('context:itm_za26xpzv', w).map((l) => [l.rel, l.to.id])).toEqual([
      ['mentioned_by', 'context:itm_norway_stop'],
    ])
  })

  it("carries the owners' relations: replaces, and disagrees with both ways", () => {
    expect(linksOf('context:itm_0tmqp7o1', w)[0]).toMatchObject({
      rel: 'replaces',
      to: { id: 'context:itm_lag_two_days', retired: true },
    })
    expect(linksOf('context:itm_gift_store_credit', w)[0]).toMatchObject({
      rel: 'disagrees',
      to: { id: 'context:itm_gift_card_only' },
    })
  })

  it('names the domain a definition belongs to', () => {
    const orders = linksOf('context:itm_eprlkrz2', w).find((l) => l.to.id === 'metric:Orders')!
    expect(orders.to.domain).toBe('sales')
  })
})
