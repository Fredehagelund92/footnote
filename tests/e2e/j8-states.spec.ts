import { expect, test } from '@playwright/test'
import { go } from './go.ts'

// J8, when things go wrong: a list loading, a load that fails and comes back with Retry, being
// offline, and a Publish that fails and succeeds on Retry with the text kept.

test('a loading list draws its frame at once and its rows as a skeleton, not an empty page', async ({
  page,
}) => {
  await go(page, '/context?state=loading')
  await expect(page.getByRole('status', { name: 'Loading' })).toBeAttached()
  // The bar and the table head are in; only the rows wait, as skeleton rows with no data in them.
  await expect(page.getByPlaceholder('Search context')).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Context', exact: true })).toBeVisible()
  await expect(page.locator('main tbody [data-skeleton-row]').first()).toBeVisible()
  await expect(page.locator('main tbody tr:not([data-skeleton-row])')).toHaveCount(0)
})

test('a failed load says so calmly, and Retry brings the page back', async ({ page }) => {
  await go(page, '/context/itm_norway_stop?state=failed')
  const alert = page.getByRole('alert')
  await expect(alert).toContainText("Couldn't load this context item.")
  await alert.getByRole('button', { name: 'Retry' }).click()
  await expect(
    page.getByRole('heading', { name: 'Online sales to Norway stopped on 4 August 2026' }),
  ).toBeVisible()
})

test('offline, the app says so and Publish waits', async ({ page }) => {
  await go(page, '/context/itm_norway_stop/edit?state=offline')
  await expect(page.getByText("You're offline.")).toBeVisible()
  const save = page.getByRole('button', { name: 'Save', exact: true })
  await expect(save).toHaveAttribute('aria-disabled', 'true')
  // Nothing is kept anywhere while offline, so it never says it is saved on this device.
  await expect(page.getByText('Saved on this device')).toHaveCount(0)
})

test('a Publish that fails keeps the text, and Retry publishes it', async ({ page }) => {
  await go(page, '/context/new?draft=norway&state=failed')
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  const failed = page.getByRole('alert')
  await expect(failed).toContainText("Couldn't publish")
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'Online sales to Norway stopped on 4 August 2026',
  )
  await failed.getByRole('button', { name: 'Retry' }).click()
  await expect(page).toHaveURL(/\/context\/itm_new_/)
})
