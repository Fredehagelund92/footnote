import { expect, go, mode, test } from './go.ts'

// J61: a list says what it means in words (UX audit Q5 and Q9). A definition's meaning is in its
// row, so nobody opens each one to read it, and a Context date carries its year.

test.use({ viewport: { width: 1440, height: 900 } })

test.skip(mode === 'http', 'reads the mock world: the demo week names other definitions and dates')

test('a definition row shows its meaning', async ({ page }) => {
  await go(page, '/definitions')
  const row = (name: string) =>
    page.locator('tbody tr').filter({ has: page.locator(`[data-row-open="${name}"]`) })
  await expect(row('Net revenue')).toContainText('Gross sales after returns, discounts, VAT')
  await expect(page.getByRole('columnheader', { name: 'Meaning' })).toBeVisible()
})

test('a Context date carries its year', async ({ page }) => {
  await go(page, '/context')
  await expect(page.locator('[data-row-open]').first()).toBeVisible()
  // The When column is the one after Status; the mock holds dozens of dated items.
  const dates = await page.locator('tbody tr td:nth-child(6) > span span').allInnerTexts()
  expect(dates.length).toBeGreaterThan(10)
  // Every date ends in its year; a range may share one year between its two days.
  const undated = dates.filter((d) => /\d/.test(d) && !/ \d{4}$/.test(d))
  expect(undated).toEqual([])
})
