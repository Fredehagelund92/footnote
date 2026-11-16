import type { Page } from '@playwright/test'
import { expect, mode, test } from './go.ts'

/*
  The shell waits for the shared reads every screen uses, not for those only a few screens use
  (laterQueries in src/web/api/queries.ts). The reviews are the last of all to arrive, as their
  read waits for the Inbox's: Context draws without them. Opened at the Inbox, whose page they
  are, the shell waits for them; moved to before they are in, the Inbox waits in its own frame.
*/

test.skip(mode === 'mock', 'The mock answers the shared reads at once: these hold the service')

/**
 * Holds every answer to the reviews' read until the function it returns is called, which lets
 * them through and waits until the page has one, so no answer is still held as the test ends.
 */
async function holdReviews(page: Page) {
  let open = () => {}
  const released = new Promise<void>((resolve) => (open = resolve))
  await page.route('**/api/v1/review/sheets', async (route) => {
    const answer = await route.fetch()
    await released
    await route.fulfill({ response: answer })
  })
  return async () => {
    const answered = page.waitForResponse('**/api/v1/review/sheets')
    open()
    await answered
  }
}

test('Context draws its rows while the reviews are still being read', async ({ page }) => {
  const release = await holdReviews(page)
  await page.goto('/context')
  await expect(page.getByRole('heading', { name: 'Context', level: 1 })).toBeVisible()
  await expect(page.locator('tbody tr').first()).toBeVisible()
  await release()
})

test('opened at the Inbox, the shell waits for the reviews, the page they are', async ({
  page,
}) => {
  const release = await holdReviews(page)
  await page.goto('/inbox')
  // Nothing to search or click yet: the Inbox draws with the shell, never under a search started.
  await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Search/ })).toHaveCount(0)
  await release()
  await expect(page.getByRole('textbox', { name: 'Search the Inbox' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Search/ })).toBeVisible()
})

test('moved to while the reviews are read, the Inbox waits in its own frame', async ({ page }) => {
  const release = await holdReviews(page)
  await page.goto('/context')
  await expect(page.getByRole('heading', { name: 'Context', level: 1 })).toBeVisible()
  await page.getByRole('link', { name: /^Inbox/ }).click()
  await expect(page.getByRole('link', { name: /^Context/ })).toBeVisible()
  await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible()
  await release()
  await expect(page.getByRole('textbox', { name: 'Search the Inbox' })).toBeVisible()
  await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0)
})
