import { expect, go, mode, test, userMenu } from './go.ts'
import type { Page } from '@playwright/test'

// J112: Select all ticks every row shown: drafts, items waiting for review and published items. With
// more drafts than one Publish takes, Publish still works: it takes the first 50, says what it
// left and why, and keeps the rest ticked, so a second press publishes them.

const bar = (page: Page) => page.getByRole('region', { name: 'Selected context' })
/** A line on the screen: the toast's, or the one above the bar, each also said to a screen reader. */
const said = (page: Page, text: string) => page.getByText(text, { exact: true }).last()
const line = (page: Page) => bar(page).locator('..')

test('After Select all, Publish publishes the drafts in batches and says what it left', async ({
  page,
}) => {
  test.skip(mode === 'http', 'The 60 drafts are the mock demo’s (?demo=backlog).')
  // Jon Abara, signed in as the demo starts, is an admin; the drafts come with a fresh load.
  await go(page, '/context?demo=backlog')
  await expect(userMenu(page)).toContainText('admin')
  await expect(page.getByText('88 of 90 context items')).toBeVisible()
  await page.getByRole('checkbox', { name: 'Select all context shown' }).click()
  const publish = bar(page).getByRole('button', { name: 'Publish' })
  await expect(publish).not.toHaveAttribute('aria-disabled', 'true')
  await publish.click()
  const first = page.getByRole('dialog', { name: 'Publish 50 drafts?' })
  await expect(first).toContainText('over 50 at once')
  await first.getByRole('button', { name: 'Publish 50 drafts' }).click()
  await expect(said(page, '50 published')).toBeVisible()
  // The drafts past the batch stay ticked, with the rest, and the line says why.
  await expect(line(page)).toContainText('12 over 50 at once')
  await publish.click()
  const second = page.getByRole('dialog', { name: 'Publish 12 drafts?' })
  await second.getByRole('button', { name: 'Publish 12 drafts' }).click()
  await expect(said(page, '12 published')).toBeVisible()
  // What is left has nothing to publish: published items and the ones an owner decides on their page.
  await expect(line(page)).toContainText('21 published, 1 missing a source, 4 waiting for review')
  await expect(publish).toHaveAttribute('aria-disabled', 'true')
})
