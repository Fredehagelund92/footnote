import { expect, go, mode, test, userMenu } from './go.ts'
import type { Page } from '@playwright/test'

// J112: Select all ticks every row shown: drafts, items waiting for review and published items. With
// more drafts than one Publish takes, Publish still works: its confirmation says first that it
// takes the first 50 as the list shows them and keeps the rest ticked, and after it the line above
// the bar offers Publish next for them. What is left then says at once why there is nothing to
// publish, not only on a hover.

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
  await expect(page.getByText('87 of 89 context items')).toBeVisible()
  await page.getByRole('checkbox', { name: 'Select all context shown' }).click()
  const publish = bar(page).getByRole('button', { name: 'Publish' })
  await expect(publish).not.toHaveAttribute('aria-disabled', 'true')
  await publish.click()
  const first = page.getByRole('dialog', { name: 'Publish 50 drafts?' })
  await expect(first).toContainText(
    'You ticked 61 drafts. One Publish takes the first 50 as the list shows them; the other 11 stay ticked for the next one.',
  )
  await expect(first).toContainText(
    '21 published items you ticked stay as they are. 5 more are not in this Publish: 1 needs a fix first, 4 wait for review.',
  )
  // A few titles, and the rest one click away.
  const titles = first.getByRole('list', { name: 'To publish' }).getByRole('listitem')
  await expect(titles).toHaveCount(4)
  await first.getByRole('button', { name: 'Show all 50' }).click()
  await expect(titles).toHaveCount(50)
  await first.getByRole('button', { name: 'Publish 50 drafts' }).click()
  await expect(said(page, '50 published')).toBeVisible()
  // The drafts past the batch stay ticked, with the rest, and the line offers the next Publish.
  await expect(line(page)).toContainText('11 drafts are still ticked: one Publish takes 50.')
  await line(page).getByRole('button', { name: 'Publish next 11' }).click()
  const second = page.getByRole('dialog', { name: 'Publish 11 drafts?' })
  await second.getByRole('button', { name: 'Publish 11 drafts' }).click()
  await expect(said(page, '11 published')).toBeVisible()
  // What is left has nothing to publish: published items and the ones an owner decides on their
  // page. The line says so at once.
  await expect(line(page)).toContainText(
    'Nothing to publish: 21 are published, 1 needs a fix first, 4 wait for review. Open one to decide it.',
  )
  await expect(publish).toHaveAttribute('aria-disabled', 'true')
})
