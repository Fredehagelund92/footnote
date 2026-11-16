import { card, expect, go, test, topicId } from './go.ts'

// J65: a sentence states only what the screen knows. Three lines used to state a fact the page
// had no way to know (the source of every draft, a date for the next check, the time of the last
// read), and so were false for every install but the demo's.

test('a Not found topic with a draft does not say where the draft came from', async ({ page }) => {
  await go(page, `/observability?dock=topic.${topicId('orders-spain')}&ptab=warnings`)
  await expect(page.getByText('A draft is ready in the Inbox.', { exact: true })).toBeVisible()
  await expect(page.getByText(/status page/)).toHaveCount(0)
})

test('Still true on a check does not promise a date for the next one', async ({ page }) => {
  await go(page, `/inbox?demo=week&card=${card('check-returns')}`)
  await page.getByRole('button', { name: 'Still true' }).click()
  await expect(page.getByText('Checked: still true')).toBeVisible()
  await expect(page.getByText(/next check is due on/)).toHaveCount(0)
  await expect(page.getByText('It comes back when it is due for a check.')).toBeVisible()
})

test('a synced metric does not say when it was last read', async ({ page }) => {
  await go(page, '/definitions')
  await page
    .locator('tbody [data-row-open]')
    .filter({ hasText: /^Net revenue$/ })
    .click()
  const comes = page.getByRole('region', { name: 'Where it comes from' })
  await expect(comes).toContainText('read-only, read from')
  await expect(comes).not.toContainText('06:00')
  await expect(page.getByText(/read today at 06:00/)).toHaveCount(0)
})
