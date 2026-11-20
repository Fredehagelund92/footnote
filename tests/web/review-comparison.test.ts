// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { FieldsDiff, TextComparison } from '@/components/footnote/source-review'
import { compareCounts } from '@/lib/review-compare'
import { fieldKeys, fieldLabel, fieldRows, type FieldKey } from '@/model/review-fields'
import type { FieldSide } from '@/model/review'

// K1 and K2 of the comparison, as the done-when lines of the slices say them: the table of
// fields with its tinted rows, its marks under Now and Suggested, its counts and its switch, and
// the text in two columns with its marks inside the passages. Invented demo data only.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
beforeEach(() => localStorage.clear())

let root: Root | undefined
let host: HTMLElement | undefined
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  host = undefined
  root = undefined
})

function render(node: React.ReactNode) {
  if (!host) {
    host = document.createElement('div')
    document.body.append(host)
  }
  root ??= createRoot(host)
  act(() => root!.render(node))
  return host
}

const now: FieldSide = {
  title: 'Online sales to Norway stopped on 4 August 2026',
  kind: 'Event',
  domain: 'Sales',
  owner: 'Jon Abara',
  scope: ['Gross sales', 'Orders', 'Units sold', 'Norway'],
  validity: { from: '2026-08-04', ongoing: true },
  reviewDate: '2027-02-19',
  sources: [{ url: 'https://customs.example/norway/notices/2026-08-04', quote: 'Sales stop.' }],
  dontConclude: 'Fewer orders in Norway after 4 August do not mean fewer customers.',
}

/** The suggested side with one field changed. */
const changing: Record<FieldKey, Partial<FieldSide>> = {
  title: { title: 'Online sales to Norway stopped on 5 August 2026' },
  kind: { kind: 'Warning' },
  domain: { domain: 'Marketing' },
  owner: { owner: 'Sofia Brandt' },
  scope: { scope: ['Gross sales', 'Orders', 'Norway', 'Webshop'] },
  validity: { validity: { from: '2026-08-04', until: '2026-11-30' } },
  reviewDate: { reviewDate: '2027-03-01' },
  sources: {
    sources: [{ url: 'https://customs.example/norway/notices/2026-08-05', quote: 'Sales stop.' }],
  },
  dontConclude: {
    dontConclude: 'Fewer orders in Norway after 4 August do not mean fewer buyers.',
  },
}

const fields = (after: FieldSide, person = 'Maria Lindqvist') =>
  render(React.createElement(FieldsDiff, { before: now, after, person }))
const rowNamed = (el: HTMLElement, name: string) =>
  [...el.querySelectorAll('tr')].find((r) => r.getAttribute('aria-label') === name)
const bodyRows = (el: HTMLElement) => [...el.querySelectorAll('tbody tr')]
const switchOf = (el: HTMLElement) => el.querySelector<HTMLElement>('[role="switch"]')!

describe('K1, the table of fields', () => {
  it.each(fieldKeys)(
    'tints a changed %s row, strikes its old value under Now and underlines the new one under Suggested',
    (key) => {
      const el = fields({ ...now, ...changing[key] })
      const label = fieldLabel[key]
      const row = rowNamed(el, `${label}, changed`)!
      expect(row).toBeDefined()
      expect(row.className).toContain('bg-caution/8')
      const [nowCell, suggestedCell] = [...row.querySelectorAll('td')]
      // Struck or underlined, and said so in words: never colour alone.
      expect(nowCell!.textContent).toMatch(/removed/)
      expect(nowCell!.textContent).not.toMatch(/added/)
      expect(suggestedCell!.textContent).toMatch(/added/)
      expect(suggestedCell!.textContent).not.toMatch(/removed/)
      expect(nowCell!.querySelector('del, [class*="line-through"]')).not.toBeNull()
      expect(suggestedCell!.querySelector('ins, [class*="underline"]')).not.toBeNull()
      // A screen reader hears "changed" on the row, read as a whole or cell by cell.
      expect(row.querySelector('th')!.textContent).toBe(`${label}, changed`)
    },
  )

  it('counts in the bar what the table shows: each changed field row', () => {
    const after = { ...now, ...changing.title, ...changing.scope, ...changing.validity }
    const source = { before: 'Orders fell to almost nothing.', after: 'Orders fell to 20 a day.' }
    const counts = compareCounts({ fields: { before: now, after }, source })
    const el = fields(after)
    const changedRows = bodyRows(el).filter((r) =>
      r.getAttribute('aria-label')?.endsWith(', changed'),
    )
    expect(counts).toMatchObject({ changed: changedRows.length, same: 9 - changedRows.length })
    expect(changedRows).toHaveLength(3)
    const unchanged = compareCounts({
      fields: { before: now, after },
      source: { before: 'Same.', after: 'Same.' },
    })
    expect(unchanged).toMatchObject({ changed: 3, same: 6 })
  })

  it('opens with only what changed, hides exactly the rows that stay the same and names them', () => {
    const after = { ...now, ...changing.title, ...changing.validity }
    const el = fields(after)
    expect(switchOf(el).getAttribute('aria-checked')).toBe('true')
    const same = fieldRows(now, after).filter((r) => !r.changed)
    expect(bodyRows(el).map((r) => r.querySelector('th')!.textContent)).toEqual([
      'Title, changed',
      'When, changed',
    ])
    expect(el.textContent).toContain(
      `${same.length} fields that stay the same are hidden: ${same.map((r) => r.label).join(', ')}.`,
    )

    // The switch off shows every field, the quiet ones untinted, and the line goes.
    act(() => switchOf(el).click())
    expect(bodyRows(el)).toHaveLength(9)
    const kind = bodyRows(el).find((r) => r.querySelector('th')!.textContent === 'Kind')!
    expect(kind.className).not.toContain('bg-caution')
    expect(kind.querySelector('del, ins')).toBeNull()
    expect(el.textContent).not.toContain('are hidden')
  })

  it('keeps a same row that holds a comment, says why, and hides and names the others', () => {
    const after = { ...now, ...changing.title }
    const notes = {
      under: () => null,
      holds: (at: { field?: string }) => at.field === 'kind',
      comment: () => {},
    }
    const el = render(React.createElement(FieldsDiff, { before: now, after, person: 'Kept', notes }))
    // The name cell also holds the comment button, so compare what comes before it.
    const names = bodyRows(el).map((r) => r.querySelector('th')!.textContent!.replace(/Comment on .*$/, ''))
    expect(names).toEqual(['Title, changed', 'KindKept: it has a comment'])
    const others = fieldRows(now, after).filter((r) => !r.changed && r.key !== 'kind')
    expect(others).toHaveLength(7)
    expect(el.textContent).toContain(
      `7 fields that stay the same are hidden: ${others.map((r) => r.label).join(', ')}.`,
    )
    expect(el.textContent).not.toMatch(/hidden:.*Kind/)
  })

  it('remembers the switch for each person', () => {
    const after = { ...now, ...changing.title }
    const first = fields(after, 'Maria Lindqvist')
    act(() => switchOf(first).click())
    act(() => root!.unmount())
    root = undefined
    expect(bodyRows(fields(after, 'Maria Lindqvist'))).toHaveLength(9)
    act(() => root!.unmount())
    root = undefined
    // Someone else still opens with only what changed.
    expect(bodyRows(fields(after, 'Jon Abara'))).toHaveLength(1)
  })

  it('says so when no field changed', () => {
    const el = fields(now)
    expect(bodyRows(el)).toHaveLength(0)
    expect(el.textContent).toContain('No field changed. 9 fields that stay the same are hidden:')
  })
})

describe('K2, the text in two columns', () => {
  const text = (before: string, after: string) =>
    render(React.createElement(TextComparison, { before, after }))
  const stops = (el: HTMLElement) => [...el.querySelectorAll('[data-review-change]')]

  it('draws one changed word as one struck and one underlined word, inside its sentence', () => {
    const el = text(
      'A new customs rule stopped all online sales, so orders fell to almost nothing.',
      'A new customs rule stopped all online sales, so orders fell to under 20 a day.',
    )
    expect([...el.querySelectorAll('del:not([aria-hidden])')].map((d) => d.textContent)).toEqual([
      '[removed: almost nothing]',
    ])
    expect([...el.querySelectorAll('ins:not([aria-hidden])')].map((d) => d.textContent)).toEqual([
      '[added: under 20 a day]',
    ])
    expect(stops(el)).toHaveLength(1)
    expect(stops(el)[0]!.getAttribute('aria-label')).toBe('Change 1 of 1 in the text')
    expect(el.textContent).toContain('1 passage changed')
  })

  it('marks an added sentence only on the right and a removed one only on the left', () => {
    const was = 'There are no stores in Norway, so the webshop was the only way to buy there.'
    const added = text(was, `${was} Marketplace orders stopped too.`)
    const [left, right] = [...stops(added)[0]!.children].filter((c) => c.tagName === 'DIV')
    expect(left!.querySelector('del, ins')).toBeNull()
    expect(right!.querySelector('ins')!.textContent).toBe(
      '[added: Marketplace orders stopped too.]',
    )

    const removed = text(`${was} Marketplace orders stopped too.`, was)
    const [l2, r2] = [...stops(removed)[0]!.children].filter((c) => c.tagName === 'DIV')
    expect(l2!.querySelector('del')!.textContent).toBe('[removed: Marketplace orders stopped too.]')
    expect(r2!.querySelector('del, ins')).toBeNull()
  })

  it('leaves a passage that stays the same unmarked, read once, and lines the sides up', () => {
    const el = text(
      'Orders fell.\n\n- Parcels already on their way still arrived.',
      'Orders fell to under 20 a day.\n\n- Parcels already on their way still arrived.',
    )
    const rows = [...el.querySelectorAll('[class*="grid-cols-2"], [data-review-change]')].filter(
      (r) => r.parentElement?.classList.contains('py-4') && !r.hasAttribute('aria-hidden'),
    )
    // Each row holds the passage now and the passage suggested, side by side.
    for (const row of rows)
      expect([...row.children].filter((c) => c.tagName === 'DIV')).toHaveLength(2)
    const same = rows.find((r) => !r.hasAttribute('data-review-change'))!
    expect(same.querySelector('del, ins')).toBeNull()
    expect(same.querySelector('[aria-hidden="true"]')!.textContent).toContain('Parcels')
  })

  it('names only the marks it uses in its legend', () => {
    const el = text('Orders fell.', 'Orders fell. Parcels arrived.')
    const legend = el.querySelector('header')!.textContent
    expect(legend).toContain('Added')
    expect(legend).not.toContain('Removed')
  })
})
