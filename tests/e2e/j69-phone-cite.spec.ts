import { devices } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J69, a citation on a phone (Used section research, slice 0): pressing a source's number opens
// its item in the Context quick view, which fills the screen, and the number's own card closes
// rather than sitting on top of the item's first lines.

test.use({ ...devices['iPhone 13'], browserName: 'chromium' })

test('pressing a source opens its quick view with no card over it', async ({ page }) => {
  await go(page, '/ask?example=loop-checked')
  const log = page.getByRole('log')
  await log
    .getByRole('button', { name: /^Source 1: / })
    .first()
    .tap()
  const peek = page.getByRole('region', { name: 'Context' })
  await expect(peek.getByRole('button', { name: /^Details/ })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('pressing a metric opens its definition with no card over it', async ({ page }) => {
  await go(page, '/ask?example=loop-checked')
  const log = page.getByRole('log')
  await log
    .getByRole('button', { name: /^Orders ?, metric/ })
    .first()
    .tap()
  await expect(page.getByRole('region', { name: 'Definition' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
