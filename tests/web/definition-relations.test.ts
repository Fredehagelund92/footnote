// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { DefinitionRelation } from '@/lib/definitions'

// A synced metric's page says what it is built from and what is built from it (FR-143): each
// definition a link to its page, each column a name in the tool, a conversion with its column, and
// an input that left the tool said so. Invented names.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const { RelationList } = await import('@/components/footnote/definition-relations')

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | undefined
let host: HTMLElement
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

function draw(relations: DefinitionRelation[]) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(React.createElement(RelationList, { relations, tool: 'dbt' })))
  return host
}

const relation = (r: Partial<DefinitionRelation> & Pick<DefinitionRelation, 'kind' | 'name'>) => ({
  column: false,
  linked: true,
  missing: false,
  ...r,
})

/** Each row's label and what it says, as a reader reads them. */
const rows = (page: HTMLElement) =>
  [...page.querySelectorAll('dl > div')].map((row) => [
    row.querySelector('dt')!.textContent,
    row.querySelector('dd')!.textContent,
  ])

describe('how a metric is built', () => {
  it('says what a metric is built from, and links a definition', () => {
    const page = draw([
      relation({ kind: 'built_from', name: 'Commission (EUR)' }),
      relation({ kind: 'built_from', name: 'commission_eur', column: true, linked: false }),
      relation({ kind: 'built_from', name: 'exchange_rate_usd', column: true, linked: false }),
    ])
    expect(rows(page)).toEqual([
      ['Built from', 'Commission (EUR)columnscommission_eurexchange_rate_usd'],
    ])
    const link = page.querySelector('a')!
    expect(link.textContent).toBe('Commission (EUR)')
    expect(link.getAttribute('href')).toBe('/definitions/Commission%20(EUR)')
    expect(page.querySelector('section')!.getAttribute('aria-label')).toBe('How it is built')
  })

  it('links a ratio’s inputs and says one that left the tool is no longer there', () => {
    const page = draw([
      relation({ kind: 'built_from', name: 'Signups' }),
      relation({ kind: 'built_from', name: 'Clicks', missing: true }),
      relation({ kind: 'used_by', name: 'partners.signup_quality', linked: false }),
    ])
    expect(rows(page)).toEqual([
      ['Built from', 'SignupsClicks- no longer in dbt'],
      ['Used by', 'partners.signup_quality'],
    ])
    expect([...page.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['Signups'])
  })

  it('shows nothing when the tool says nothing', () => {
    expect(draw([]).childElementCount).toBe(0)
  })

  it('shows a long Used by in steps', () => {
    const many = Array.from({ length: 30 }, (_, n) =>
      relation({ kind: 'used_by', name: `Metric ${String(n + 1).padStart(2, '0')}` }),
    )
    const page = draw(many)
    expect(page.querySelectorAll('a')).toHaveLength(12)
    const more = page.querySelector('button')!
    expect(more.textContent).toBe('Show 18 more(18 not shown)')
    act(() => more.click())
    expect(page.querySelectorAll('a')).toHaveLength(30)
  })
})
