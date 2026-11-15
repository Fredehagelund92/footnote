import { expect, go, test } from './go.ts'
import type { Page } from '@playwright/test'

// J60: the Inbox opens on what people wait on. Mentioned you and Suggestions come before the
// chores, every group folds from its header, and a long run of checks starts folded so it does
// not bury the suggestions (P03).

const headers = (page: Page) => page.locator('li > button[aria-expanded]')
const header = (page: Page, name: string) =>
  page.getByRole('button', { name: new RegExp(`^${name} \\d+$`) })

test('suggestions come before the chores', async ({ page }) => {
  await go(page, '/inbox')
  const names = (await headers(page).allInnerTexts()).map((t) => t.replace(/\s*\d+$/, ''))
  const at = (n: string) => names.indexOf(n)
  expect(at('Suggestions')).toBeGreaterThanOrEqual(0)
  expect(at('Suggestions')).toBeLessThan(at('Not found'))
  expect(at('Suggestions')).toBeLessThan(at('Due for a check'))
})

test('a group folds from its header and opens again', async ({ page }) => {
  await go(page, '/inbox')
  const suggestions = header(page, 'Suggestions')
  await expect(suggestions).toHaveAttribute('aria-expanded', 'true')
  const rows = page.locator('[data-row-open]')
  const before = await rows.count()
  await suggestions.click()
  await expect(suggestions).toHaveAttribute('aria-expanded', 'false')
  expect(await rows.count()).toBeLessThan(before)
  // The count stays on the header, so a folded group still says how much is in it.
  await expect(suggestions).toHaveText(/Suggestions\s*\d+/)
  await suggestions.click()
  await expect(suggestions).toHaveAttribute('aria-expanded', 'true')
  await expect(rows).toHaveCount(before)
})

test('more than 10 checks start folded', async ({ page }) => {
  // The mock holds three checks; the demo week on the service holds dozens.
  await go(page, '/inbox')
  const checks = header(page, 'Due for a check')
  const count = Number((await checks.innerText()).replace(/\D/g, ''))
  await expect(checks).toHaveAttribute('aria-expanded', count > 10 ? 'false' : 'true')
})
