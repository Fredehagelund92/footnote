import type { Page } from '@playwright/test'
import { expect, mode, test } from './go.ts'

/*
  The shell waits for the shared reads every screen uses, not for those only a few screens use
  (laterQueries in src/web/api/queries.ts). The reviews are the last of all to arrive, as their
  read waits for the Inbox's: Context draws without them, and the Inbox and a review in the dock
  wait for them in their own loading state.
*/

test.skip(mode === 'mock', 'The mock answers the shared reads at once: these hold the service')

/** Holds every answer to the reviews' read until `release` is called. */
async function holdReviews(page: Page) {
  let release = () => {}
  const released = new Promise<void>((resolve) => (release = resolve))
  await page.route('**/api/v1/review/sheets', async (route) => {
    const answer = await route.fetch()
    await released
    await route.fulfill({ response: answer })
  })
  return release
}

test('Context draws its rows while the reviews are still being read', async ({ page }) => {
  const release = await holdReviews(page)
  await page.goto('/context')
  await expect(page.getByRole('heading', { name: 'Context', level: 1 })).toBeVisible()
  await expect(page.locator('tbody tr').first()).toBeVisible()
  release()
})

test('the Inbox waits for the reviews in its own frame, inside the shell', async ({ page }) => {
  const release = await holdReviews(page)
  await page.goto('/inbox')
  await expect(page.getByRole('link', { name: /^Context/ })).toBeVisible()
  await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible()
  release()
  await expect(page.getByRole('textbox', { name: 'Search the Inbox' })).toBeVisible()
  await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0)
})
