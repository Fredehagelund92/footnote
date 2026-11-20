// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { FieldsDiff, TextComparison } from '@/components/footnote/source-review'
import { compareCounts, missingWords } from '@/lib/review-compare'
import { reviewFor } from '@/api/mock/data/review'
import { fieldKeys, fieldLabel, fieldRows, type FieldKey } from '@/model/review-fields'
import type { FieldSide } from '@/model/review'
import type { SourcePlace } from '@/model/source-places'

// K1 to K4 of the comparison, as the done-when lines of the slices say them: the table of
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
      holds: (at: SourcePlace) => 'field' in at && at.field === 'kind',
      comment: () => {},
    }
    const el = render(
      React.createElement(FieldsDiff, { before: now, after, person: 'Kept', notes }),
    )
    // The name cell also holds the comment button, so compare what comes before it.
    const names = bodyRows(el).map((r) =>
      r.querySelector('th')!.textContent.replace(/Comment on .*$/, ''),
    )
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

describe('K3, a new look, a move and a link in the text', () => {
  const text = (before: string, after: string) =>
    render(React.createElement(TextComparison, { before, after }))
  const legendOf = (el: HTMLElement) =>
    [...el.querySelector('header p')!.children].map((c) => c.textContent.replace(/^text/, ''))
  const badgeOf = (el: HTMLElement) => el.querySelector('header [data-slot="badge"]')!.textContent

  it('shows a change of look alone with no list or bold symbols, and says The same words', () => {
    const r = reviewFor('sug-ines-format')!
    const el = text(r.source.before, r.source.after)
    expect(el.querySelector('del, ins')).toBeNull()
    const body = el.querySelector('.py-4')!.textContent
    expect(body).not.toMatch(/\*\*|__|(^|\s)[-*+] |(^|\s)_\w/)
    // The look is drawn and named: bold words in bold, the steps numbered, each tagged.
    expect(el.querySelector('strong')!.textContent).toContain('the only way to buy there')
    expect(body).toContain('Bold')
    expect(body).toContain('Italic')
    // One tag for the list, under its last step; each step says it to a screen reader.
    const tags = [...el.querySelectorAll('[aria-hidden="true"]')].filter(
      (t) => t.textContent === 'Now numbered',
    )
    expect(tags).toHaveLength(1)
    expect(body.match(/\[Now numbered\]/g)).toHaveLength(2)
    expect(badgeOf(el)).toBe('The same words')
    expect(legendOf(el)).toEqual(['New look'])
  })

  it('marks a moved step once on each side, not struck and not added', () => {
    const r = reviewFor('sug-ines-order')!
    const el = text(r.source.before, r.source.after)
    expect(el.querySelector('del, ins')).toBeNull()
    const moved = [...el.querySelectorAll('[data-mark="moved"]')]
    const step =
      "Check for a few very large orders. One big order at full price can lift a week's margin."
    // Where it goes on the right, on the first row; where it was on the left, as step 2.
    expect(moved.map((m) => m.textContent)).toEqual([
      `1.${step}Moved up, from step 2 to step 1`,
      `2.${step}Moves up`,
    ])
    // One change, one stop: where it goes.
    const stops = [...el.querySelectorAll('[data-review-change]')]
    expect(stops).toHaveLength(1)
    expect(stops[0]!.textContent).toContain('Moved up, from step 2 to step 1')
    expect(el.textContent).toContain('1 passage changed')
    expect(badgeOf(el)).toBe('The same words')
    expect(legendOf(el)).toEqual(['Moved'])
  })

  it('draws a moved bullet that became a paragraph with both marks', () => {
    const el = text(
      'Intro.\n\n- First point.\n\n- Second point.',
      'Intro.\n\nSecond point.\n\n- First point.',
    )
    const moved = [...el.querySelectorAll('[data-mark="moved"]')]
    const came = moved.find((m) => m.textContent!.includes('Moved'))!
    expect(came.textContent).toContain('No longer a list')
    expect(came.textContent).toContain('[No longer a list]')
    expect(legendOf(el)).toContain('New look')
    expect(legendOf(el)).toContain('Moved')
  })

  it('draws a new link and a new look on the same words, both tagged and listed', () => {
    const el = text('Please ship it.', 'Please [**ship**](https://x.example) it.')
    expect(el.textContent).toContain('Link')
    expect(el.textContent).toContain('Bold')
    expect(legendOf(el)).toEqual(['New look', 'New link'])
  })

  it('tags a new link on the same words, and lists only the marks in use', () => {
    const el = text(
      'Units sold leaves out the 312 test accounts our teams use.',
      'Units sold leaves out the 340 [test accounts](https://wiki.example/test-accounts) our teams use.',
    )
    expect([...el.querySelectorAll('del:not([aria-hidden])')].map((d) => d.textContent)).toEqual([
      '[removed: 312]',
    ])
    expect([...el.querySelectorAll('ins:not([aria-hidden])')].map((d) => d.textContent)).toEqual([
      '[added: 340]',
    ])
    expect(el.textContent).toContain('[Link: test accounts]Link')
    expect(badgeOf(el)).toBe('Changed')
    expect(legendOf(el)).toEqual(['Removed', 'Added', 'New link'])
  })

  it('says The same when nothing changed at all, and shows the text once', () => {
    const el = text('Orders fell.\n\n- Parcels arrived.', 'Orders fell.\n\n- Parcels arrived.')
    expect(badgeOf(el)).toBe('The same')
    expect(el.querySelector('header p')).toBeNull()
    expect(el.textContent).toContain('The text is the same')
  })
})

describe('K4, a new item and an archive', () => {
  const heads = (el: HTMLElement) => [...el.querySelectorAll('thead th')].map((t) => t.textContent)
  const cells = (el: HTMLElement, label: string) => [
    ...bodyRows(el)
      .find((r) => r.querySelector('th')!.textContent === label)!
      .querySelectorAll('td'),
  ]

  it('draws a new item in the same table, the Now column empty and nothing marked', () => {
    const el = render(React.createElement(FieldsDiff, { before: null, after: now, person: 'New' }))
    expect(heads(el)).toEqual(['Field', 'Now', 'Suggested'])
    expect(bodyRows(el)).toHaveLength(9)
    const [left, right] = cells(el, 'Title')
    expect(left!.textContent).toBe('')
    expect(right!.textContent).toBe(now.title)
    expect(el.querySelector('del, ins, [class*="bg-caution"]')).toBeNull()
    expect(el.querySelector('[role="switch"]')).toBeNull()
  })

  it('draws an archive in the same table, the Suggested column empty', () => {
    const el = render(React.createElement(FieldsDiff, { before: now, after: null, person: 'Old' }))
    expect(heads(el)).toEqual(['Field', 'Now', 'Suggested'])
    const [left, right] = cells(el, "Don't conclude")
    expect(left!.textContent).toBe(now.dontConclude)
    expect(right!.textContent).toBe('')
    expect(el.querySelector('del, ins, [class*="bg-caution"]')).toBeNull()
  })

  it('shows a new text with no mark, and what stands on the side with none', () => {
    const el = render(
      React.createElement(TextComparison, {
        before: '',
        after: 'Card payments in Spain failed from 14 to 16 October 2026.',
        missing: missingWords({
          mode: 'new',
          tryIt: { ...reviewFor('gap-spain')!.tryIt, before: { state: 'missing', text: '' } },
        }),
      }),
    )
    expect(el.querySelector('del, ins, [data-mark]')).toBeNull()
    expect(el.querySelector('header [data-slot="badge"]')!.textContent).toBe('New')
    // Now comes first: above on a phone, on the left when there is room.
    const text = el.textContent
    expect(text.indexOf('Nothing yet. Agents hear Not found.')).toBeLessThan(
      text.indexOf('Card payments'),
    )
    expect(el.querySelectorAll('[data-review-change]')).toHaveLength(0)
  })

  it('shows an archive with what agents hear afterwards', () => {
    const r = reviewFor('sug-lars-retire')!
    const hear = missingWords(r)!
    expect(hear).toBe(
      `Nothing. Asked “${r.tryIt.question}”, agents will hear: “${r.tryIt.after.text}”`,
    )
    const el = render(
      React.createElement(TextComparison, { before: r.source.before, after: '', missing: hear }),
    )
    expect(el.querySelector('del, ins, [data-mark]')).toBeNull()
    expect(el.querySelector('header [data-slot="badge"]')!.textContent).toBe('Goes')
    expect(el.textContent).toContain(hear)
    expect(el.textContent).toContain('The text goes with the item')
    expect(el.textContent.indexOf('Sweden orders')).toBeLessThan(el.textContent.indexOf(hear))
  })
})
