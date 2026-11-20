// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Bars } from '@/components/obs/charts'
import { obsData } from '@/api/mock/data/observability'
import { obsPage } from '@/api/mock/obs-page'

// Feedback's chart (S7 of the Observability audit): answers marked in Ask, good and wrong
// together, a bar for each week of the range, and the week under way drawn as "so far", so a short
// week never reads as a drop.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

let root: Root | undefined
let host: HTMLElement | undefined
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

const feedbackOf = (range: 7 | 30 | 90, domain?: string) =>
  obsPage(obsData('normal'), { range, ...(domain ? { domain } : {}) }, { admin: true, owns: [] })
    .feedback!

function draw(range: 7 | 30 | 90) {
  const weeks = feedbackOf(range).byWeek
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() =>
    root!.render(
      React.createElement(Bars, {
        parts: [
          { name: 'Good', values: weeks.map((w) => w.good), fill: 'var(--chart-2)' },
          {
            name: 'Something was wrong',
            values: weeks.map((w) => w.wrong),
            fill: 'var(--caution)',
          },
        ],
        labels: weeks.map((w) => w.label),
        soFar: weeks.at(-1)?.soFar,
        caption: 'Good answers and something wrong, by week',
      }),
    ),
  )
  return host
}

describe('the weeks follow the range', () => {
  it('has a week from Monday for each week the range touches, the first from its first day', () => {
    // The demo's last day counted is Thursday 22 October.
    expect(feedbackOf(7).byWeek.map((w) => w.label)).toEqual(['16 Oct', '19 Oct'])
    expect(feedbackOf(30).byWeek.map((w) => w.label)).toEqual([
      '23 Sept',
      '28 Sept',
      '5 Oct',
      '12 Oct',
      '19 Oct',
    ])
    expect(feedbackOf(90).byWeek).toHaveLength(14)
    for (const range of [7, 30, 90] as const)
      expect(feedbackOf(range).byWeek.map((w) => w.soFar)).toEqual([
        ...feedbackOf(range)
          .byWeek.slice(1)
          .map(() => false),
        true,
      ])
  })

  it('adds up to the cells, and narrows to a domain', () => {
    const f = feedbackOf(30)
    const sum = (key: 'good' | 'wrong') => f.byWeek.reduce((n, w) => n + (w[key] ?? 0), 0)
    expect(sum('good')).toBe(f.week.good)
    // A week wrong fewer than 5 times hides its count, and so many more weeks that what the
    // hidden ones add up to is never a small count to work out from the cell.
    for (const range of [7, 30, 90] as const) {
      const r = feedbackOf(range)
      for (const key of ['good', 'wrong'] as const) {
        const total = r.week[key]
        if (total === null) continue
        const left = total - r.byWeek.reduce((n, w) => n + (w[key] ?? 0), 0)
        expect(left === 0 || left >= 5, `${range} days, ${key}`).toBe(true)
      }
    }
    expect(f.byWeek.some((w) => w.wrong === null)).toBe(true)
    const sales = feedbackOf(30, 'sales').week
    expect(sales.good).toBeLessThan(f.week.good!)
    expect(sales.good).toBeGreaterThan(0)
  })
})

describe('at 30 days', () => {
  it('draws one bar per week, each split good and wrong, and labels the current week so far', () => {
    const page = draw(30)
    const bars = [...page.querySelectorAll('svg [data-bar]')]
    expect(bars).toHaveLength(5)
    for (const bar of bars) {
      expect(bar.querySelector('[data-part="Good"]')).not.toBeNull()
      expect(bar.querySelector('[data-part="Something was wrong"]')).not.toBeNull()
    }
    expect(bars.map((b) => b.hasAttribute('data-so-far'))).toEqual([
      false,
      false,
      false,
      false,
      true,
    ])
    expect(bars.at(-1)!.textContent).toBe('so far')
    // The table a screen reader gets says the same, each week with its good and its wrong.
    const rows = [...page.querySelectorAll('table tbody tr')].map((r) =>
      [...r.children].map((c) => c.textContent),
    )
    expect(rows).toHaveLength(5)
    expect(rows.at(-1)![0]).toBe('19 Oct, so far')
    expect(rows.every((r) => r.length === 3)).toBe(true)
  })
})
