// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DetailsBody } from '@/components/footnote/details-body'
import { ContextText } from '@/components/footnote/context-text'
import { SourcePassages, SourceText, sourceWords } from '@/components/footnote/source-text'
import { MeaningWords } from '@/components/footnote/family-meaning'
import type { FamilyMeaning } from '@/lib/definitions'
import type { Fact } from '@/model/items'

// Words a source wrote in Markdown, as the app draws them: an item's quote under Details, a tool's
// description, the item's own text. The small subset the editor writes is drawn (bold, italic,
// code, links) and its marks are never shown as characters; nothing else is: no HTML, and a link
// only to a web or mail address. The stored words stay as they were.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | undefined
let host: HTMLElement | undefined
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

function render(node: React.ReactNode) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(node))
  return host
}

/** What a reader sees: the words, the screen reader's own left out. */
const seen = (el: Element) => {
  const shown = el.cloneNode(true) as Element
  for (const hidden of shown.querySelectorAll('.sr-only')) hidden.remove()
  return shown.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}

// The captain's quote, as a Markdown document in Git gives it.
const captains =
  '**Unallocated on commercial dimensions** (`campaign`, `partner`, `brand_asset`, `contributing_*`) means broken campaign-naming or a failed ad-platform mapping.'

describe('a quote under Details', () => {
  const fact = {
    id: 'itm_quote',
    title: 'Unallocated spend',
    summary: 'Spend with no campaign.',
    domain: 'marketing',
    kind: 'note',
    where: [],
    valid: {},
    status: 'Live',
    when: 'Always',
    source: 'https://git.example/docs/allocation.md',
    quote: `${captains} See the [mapping notes](https://git.example/docs/mapping.md).`,
  } as unknown as Fact

  it('draws its marks, never the characters', () => {
    const el = render(React.createElement(DetailsBody, { fact, leaveOut: ['related'] }))
    const quote = el.querySelector('blockquote')!
    expect(seen(quote)).toBe(
      'Unallocated on commercial dimensions (campaign, partner, brand_asset, contributing_*) means broken campaign-naming or a failed ad-platform mapping. See the mapping notes.',
    )
    expect(quote.querySelector('strong')?.textContent).toBe('Unallocated on commercial dimensions')
    expect([...quote.querySelectorAll('code')].map((c) => c.textContent)).toEqual([
      'campaign',
      'partner',
      'brand_asset',
      'contributing_*',
    ])
    const link = quote.querySelector('a')!
    expect(link.getAttribute('href')).toBe('https://git.example/docs/mapping.md')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noreferrer')
    // Where it was copied from stays under it.
    expect(seen(el.querySelector('figcaption')!)).toBe('Copied from git.example')
  })

  it('keeps the stored words as they were, for a copy or an export', () => {
    const before = fact.quote
    render(React.createElement(DetailsBody, { fact, leaveOut: ['related'] }))
    expect(fact.quote).toBe(before)
  })
})

describe('the subset, and nothing more', () => {
  it('draws no HTML, and a link only to a web or mail address', () => {
    const el = render(
      React.createElement(SourcePassages, {
        text: '<script>alert(1)</script> <img src=x onerror=alert(1)> [run](javascript:alert(1)) [data](data:text/html,x) [mail](mailto:ops@example.com) [web](http://example.com)',
      }),
    )
    expect(el.querySelector('script, img')).toBeNull()
    expect(seen(el)).toContain('<script>alert(1)</script> <img src=x onerror=alert(1)>')
    expect([...el.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      'mailto:ops@example.com',
      'http://example.com',
    ])
    expect(seen(el)).toContain('run data mail web')
  })

  it('draws paragraphs and lists, and breaks a long name to fit', () => {
    const el = render(
      React.createElement(SourcePassages, {
        text: 'Read from `a_very_long_table_name_that_never_breaks_on_its_own_at_all`.\n\n- **One**\n- _Two_\n\n1. First\n2. Second',
      }),
    )
    expect(el.querySelectorAll('p')).toHaveLength(1)
    expect([...el.querySelectorAll('ul li')].map(seen)).toEqual(['One', 'Two'])
    expect([...el.querySelectorAll('ol li')].map(seen)).toEqual(['First', 'Second'])
    expect(el.firstElementChild!.className).toContain('wrap-anywhere')
  })

  it('in one line, draws the marks and leaves a link as words; a tooltip has neither', () => {
    const el = render(React.createElement(SourceText, { text: captains }))
    expect(el.querySelector('a')).toBeNull()
    expect(el.querySelector('strong')?.textContent).toBe('Unallocated on commercial dimensions')
    expect(sourceWords(`${captains} [notes](https://x.example)`)).toBe(
      'Unallocated on commercial dimensions (campaign, partner, brand_asset, contributing_*) means broken campaign-naming or a failed ad-platform mapping. notes',
    )
  })
})

describe('an item’s own text (FR-119)', () => {
  it('draws its marks in paragraphs, lists and quotes', () => {
    const el = render(
      React.createElement(ContextText, {
        text: 'Read **net revenue** from `orders_daily`.\n\n- Not _gross_\n\n> See [the wiki](https://wiki.example/x).',
      }),
    )
    expect(seen(el)).toBe('Read net revenue from orders_daily.Not grossSee the wiki.')
    expect(el.querySelector('p strong')?.textContent).toBe('net revenue')
    expect(el.querySelector('p code')?.textContent).toBe('orders_daily')
    expect(el.querySelector('li em')?.textContent).toBe('gross')
    expect(el.querySelector('blockquote a')?.getAttribute('href')).toBe('https://wiki.example/x')
  })
})

describe('a family’s meaning', () => {
  const meaning = {
    source: 'common',
    words: '**Fees** partners report in {Currency}. Not our revenue: see `commission_eur`.',
    differing: [],
    revision: 0,
  } as unknown as FamilyMeaning

  it('draws its marks, and each value it varies by as a chip', () => {
    const el = render(React.createElement(MeaningWords, { meaning, by: ['Currency'] }))
    expect(seen(el)).toBe('Fees partners report in Currency. Not our revenue: see commission_eur.')
    expect(el.querySelector('strong')?.textContent).toBe('Fees')
    expect(el.querySelector('code')?.textContent).toBe('commission_eur')
    expect(el.querySelector('span.rounded-sm')?.textContent).toBe('Currency')
  })

  it('keeps a value inside the mark around it', () => {
    const el = render(
      React.createElement(MeaningWords, {
        meaning: { ...meaning, words: 'Paid **in {Currency}** only.' },
        by: ['Currency'],
      }),
    )
    expect(el.querySelector('strong')?.textContent).toBe('in Currency')
    expect(el.querySelector('strong span')?.textContent).toBe('Currency')
  })

  it('on the page, reads a value as the few it holds, and as its axis past three', () => {
    const held = (values: string[]) =>
      render(
        React.createElement(MeaningWords, {
          meaning,
          by: ['Currency'],
          values: () => values,
        }),
      )
    const two = held(['EUR', 'USD'])
    expect(seen(two)).toBe(
      'Fees partners report in EUR or USD. Not our revenue: see commission_eur.',
    )
    expect(two.querySelector('[title]')?.getAttribute('title')).toBe(
      'One metric for each Currency: EUR and USD',
    )
    expect(seen(held(['EUR', 'GBP', 'USD']))).toContain('in EUR, GBP or USD.')
    const many = held(['EUR', 'GBP', 'NOK', 'SEK', 'USD', 'DKK', 'CHF', 'PLN'])
    expect(seen(many)).toContain('report in Currency.')
    expect(many.querySelector('[title]')?.getAttribute('title')).toBe(
      'One metric for each Currency: EUR, GBP, NOK, SEK, USD, DKK and 2 more',
    )
  })
})
