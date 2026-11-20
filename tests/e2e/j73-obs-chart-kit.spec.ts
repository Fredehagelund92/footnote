import { expect, go, test } from './go.ts'
import type { Locator, Page } from '@playwright/test'

// J73: one chart kit on every Observability page. The charts of Quality, Feedback and Usage give
// a point's exact value on hover and from the keys, as Overview's does: the tooltip sits beside
// the point, a screen reader hears the same words, and the value is the one in the chart's table.
// On a phone no two labels under a chart overlap, on those pages and on Overview.

const charts = [
  {
    page: 'Quality',
    address: '/observability/quality',
    name: /^Share of saved questions that answer/,
  },
  {
    page: 'Feedback',
    address: '/observability/feedback?range=30',
    name: /^Good answers and something wrong, by week/,
  },
  { page: 'Usage', address: '/observability/usage', name: /^How long a reply took/ },
]

const tip = (chart: Locator) => chart.locator('[data-chart-tip]')

/** A row of the chart's table, as the tooltip should say it: its label and each value. */
async function row(chart: Locator, at: number) {
  const r = chart.locator('table tbody tr').nth(at)
  return {
    label: (await r.locator('th').innerText()).trim(),
    values: (await r.locator('td').allInnerTexts()).map((v) => v.trim()),
  }
}

async function says(chart: Locator, want: { label: string; values: string[] }) {
  await expect(tip(chart)).toBeVisible()
  await expect(tip(chart)).toContainText(want.label)
  for (const v of want.values) await expect(tip(chart)).toContainText(v)
}

for (const c of charts)
  test(`${c.page}: hover and the keys give a point's exact value`, async ({ page }) => {
    await go(page, c.address)
    const chart = page.getByRole('group', { name: c.name })
    await expect(chart).toBeVisible()
    const n = await chart.locator('table tbody tr').count()
    expect(n).toBeGreaterThan(1)
    const last = await row(chart, n - 1)
    const before = await row(chart, n - 2)

    // The pointer on the last point: its value, beside it, inside the chart.
    const plot = chart.locator('svg').first()
    await plot.scrollIntoViewIfNeeded()
    const box = (await plot.boundingBox())!
    await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2)
    await says(chart, last)
    const at = (await tip(chart).boundingBox())!
    const frame = (await chart.boundingBox())!
    expect(at.x).toBeGreaterThanOrEqual(frame.x - 0.5)
    expect(at.x + at.width).toBeLessThanOrEqual(frame.x + frame.width + 0.5)
    // Left of the point it describes, since the point is at the right edge.
    expect(at.x + at.width).toBeLessThan(box.x + box.width - 4)

    // The pointer still rests on the last point: the keys win, Left shows the point before it.
    await chart.focus()
    await page.keyboard.press('ArrowLeft')
    await says(chart, before)
    await expect(chart.locator('[aria-live]')).toHaveText(
      new RegExp(
        `^${before.label}: .*${before.values.at(-1)!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      ),
    )
    await page.mouse.move(0, 0)
    await says(chart, before)
    await page.keyboard.press('End')
    await says(chart, last)
    await page.keyboard.press('Escape')
    await expect(tip(chart)).toHaveCount(0)
  })

test('Feedback: at 30 days a bar a week, each split good and wrong, the week under way so far', async ({
  page,
}) => {
  await go(page, '/observability/feedback?range=30')
  const chart = page.getByRole('group', { name: /^Good answers and something wrong, by week/ })
  await expect(chart.locator('svg [data-bar]')).toHaveCount(5)
  for (const bar of await chart.locator('svg [data-bar]').all()) {
    await expect(bar.locator('[data-part="Good"]')).toHaveCount(1)
    await expect(bar.locator('[data-part="Something was wrong"]')).toHaveCount(1)
  }
  await expect(chart.locator('svg [data-so-far]')).toHaveCount(1)
  await expect(chart.locator('svg [data-bar]').last()).toHaveAttribute('data-so-far', 'true')
  await expect(chart.locator('svg [data-so-far]')).toContainText('so far')
  await expect(chart.locator('table tbody tr').last().locator('th')).toHaveText(/, so far$/)
  // Another range has its own weeks.
  await page.getByRole('radio', { name: '90 days' }).click()
  await expect(chart.locator('svg [data-bar]')).toHaveCount(14)
})

test("Quality: the trend is the share that answers the same, each week's of its own", async ({
  page,
}) => {
  await go(page, '/observability/quality')
  const chart = page.getByRole('group', { name: /^Share of saved questions that answer/ })
  await expect(chart).toBeVisible()
  // The last week: 9 of the 12 saved questions answer as saved.
  const last = chart.locator('table tbody tr').last()
  await expect(last.locator('td')).toHaveText('75%')
  // The axis reads shares, up to all of them.
  await expect(chart.locator('svg text', { hasText: /^100%$/ })).toBeAttached()
  await expect(chart.locator('svg text', { hasText: /^0%$/ })).toBeAttached()
})

/** Every label under each chart on the page, by chart: none overlaps another or leaves the chart. */
async function labelsApart(page: Page) {
  const boxes = await page.locator('figure').evaluateAll((figures) =>
    figures.map((f) => ({
      chart: f.getBoundingClientRect().toJSON() as DOMRect,
      labels: [...f.querySelectorAll('[data-x-label]')].map(
        (l) => l.getBoundingClientRect().toJSON() as DOMRect,
      ),
    })),
  )
  const drawn = boxes.filter((b) => b.labels.length)
  expect(drawn.length).toBeGreaterThan(0)
  for (const { chart, labels } of drawn) {
    const sorted = [...labels].sort((a, b) => a.left - b.left)
    expect(sorted.length).toBeGreaterThan(1)
    for (const l of sorted) {
      expect(l.left).toBeGreaterThanOrEqual(chart.left - 0.5)
      expect(l.right).toBeLessThanOrEqual(chart.right + 0.5)
    }
    for (let i = 1; i < sorted.length; i++)
      expect(sorted[i - 1]!.right).toBeLessThan(sorted[i]!.left)
  }
}

test.describe('at 390', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  for (const c of [
    ...charts,
    { page: 'Overview, 30 days', address: '/observability?range=30' },
    { page: 'Overview, 90 days', address: '/observability?range=90' },
    { page: 'Usage, 90 days', address: '/observability/usage?range=90' },
    { page: 'Feedback, 90 days', address: '/observability/feedback?range=90' },
  ])
    test(`${c.page}: no two labels under a chart overlap`, async ({ page }) => {
      await go(page, c.address)
      await expect(page.locator('[data-x-label]').first()).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      await labelsApart(page)
    })

  test('Overview, 30 days: a tooltip that fits on neither side stays off the tallest bar', async ({
    page,
  }) => {
    await go(page, '/observability?range=30')
    const plot = page.locator('figure svg:has([data-part])').first()
    await plot.scrollIntoViewIfNeeded()
    const parts = await plot
      .locator('[data-part]')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect))
    const tallest = parts.reduce((a, b) => (b.top < a.top ? b : a))
    const column = parts.filter((r) => Math.abs(r.left - tallest.left) < 0.5)
    const left = Math.min(...column.map((r) => r.left))
    const right = Math.max(...column.map((r) => r.right))
    const top = Math.min(...column.map((r) => r.top))
    const bottom = Math.max(...column.map((r) => r.bottom))
    await page.mouse.move((left + right) / 2, (top + bottom) / 2)
    const tip = page.locator('[data-chart-tip]').first()
    await expect(tip).toBeVisible()
    const t = (await tip.boundingBox())!
    const apart =
      t.x + t.width <= left + 0.5 ||
      t.x >= right - 0.5 ||
      t.y + t.height <= top + 0.5 ||
      t.y >= bottom - 0.5
    expect(apart).toBe(true)
  })
})
