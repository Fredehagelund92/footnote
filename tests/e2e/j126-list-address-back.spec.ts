import type { Page } from '@playwright/test'
import { card, expect, go, moveTo, queue, test } from './go.ts'

// J126: a list's view lives in the address, and Back is honest about it, as in Linear. A filtered,
// searched Context list comes back the same after a reload and after Back from an item's page,
// with that item's row focused. Moving the cursor (J in the Inbox, J with a peek open) takes the
// place of the address, so one Back leaves the list. Esc from a review opened from the Inbox goes
// back in history to the Inbox, on the card last reviewed, instead of adding a step.

/** Where this tab is in its history. */
const entry = (page: Page) =>
  page.evaluate(() => (history.state as { __TSR_index: number }).__TSR_index)
const count = (page: Page) => page.getByText(/ of [\d,]+ context items$/)
const search = (page: Page) => page.getByRole('textbox', { name: 'Search context' })
const opened = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.rowOpen)

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
})

test('a filtered, searched Context list survives a reload and Back from an item, its row focused', async ({
  page,
}) => {
  await go(page, '/context')
  await expect(page.locator('[data-row-open]').first()).toBeVisible()
  await page.getByRole('button', { name: /^Filter/ }).click()
  await page.getByRole('menuitemcheckbox', { name: /^Sales/ }).click()
  await page.keyboard.press('Escape')
  await search(page).fill('norway')
  await expect(page).toHaveURL(/[?&]domain=[^&]+.*[?&]q=norway/)
  const filtered = await count(page).innerText()
  const rows = await page
    .locator('[data-row-open]')
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.rowOpen))
  expect(rows.length).toBeGreaterThan(1)

  // A reload: the same list, the search words in the box and the filter said under the bar.
  await page.reload()
  await expect(count(page)).toHaveText(filtered)
  await expect(search(page)).toHaveValue('norway')
  await expect(page.getByRole('button', { name: /^Remove the filter: Domain/ })).toBeVisible()

  // Back from an item's page: the same list, the item's row focused.
  const item = rows[1]!
  const row = page.locator(`tr:has([data-row-open="${item}"])`)
  await row.hover()
  await row.getByRole('button', { name: /^More for / }).click()
  await page.getByRole('menuitem', { name: 'Open the page' }).click()
  await expect(page).toHaveURL(new RegExp(`/context/${item}$`))
  await page.goBack()
  await expect(count(page)).toHaveText(filtered)
  await expect(search(page)).toHaveValue('norway')
  await expect.poll(() => opened(page)).toBe(item)

  // The item page's way back is to the list as it was left, too.
  await page.locator(`[data-row-open="${item}"]`).click()
  await page.getByRole('button', { name: 'Open the page' }).click()
  await expect(page).toHaveURL(new RegExp(`/context/${item}$`))
  await page
    .locator('[data-site-header]')
    .getByRole('link', { name: 'Context', exact: true })
    .click()
  await expect(page).toHaveURL(/[?&]q=norway/)
  await expect(count(page)).toHaveText(filtered)
})

test('a search is one step in history, and J with the peek open takes the place of the address', async ({
  page,
}) => {
  await go(page, '/context')
  await expect(page.locator('[data-row-open]').first()).toBeVisible()
  const list = await entry(page)
  await search(page).pressSequentially('norway')
  await expect(page).toHaveURL(/[?&]q=norway/)
  expect(await entry(page)).toBe(list + 1)

  const first = page.locator('[data-row-open]').first()
  await first.click()
  await expect(page).toHaveURL(/[?&]dock=context\./)
  const peek = await entry(page)
  const peeked = page.url()
  await first.focus()
  await page.keyboard.press('j')
  await page.keyboard.press('j')
  await expect(page).not.toHaveURL(peeked)
  await expect(page).toHaveURL(/[?&]dock=context\./)
  expect(await entry(page)).toBe(peek)
  // Back closes the peek, then takes the search away in one press.
  await page.goBack()
  await expect(page).not.toHaveURL(/dock=/)
  await page.goBack()
  await expect(page).not.toHaveURL(/q=/)
  await expect(search(page)).toHaveValue('')
})

test('J in the Inbox moves without adding steps, so one Back leaves it', async ({ page }) => {
  await go(page, '/context')
  await expect(page.locator('[data-row-open]').first()).toBeVisible()
  await moveTo(page, '/inbox')
  await expect(page).toHaveURL(/\/inbox/)
  const inbox = await entry(page)
  await page.locator('body').click({ position: { x: 1, y: 1 } })
  await page.keyboard.press('j')
  await expect(page).toHaveURL(/[?&]card=/)
  const picked = page.url()
  await page.keyboard.press('j')
  await expect(page).not.toHaveURL(picked)
  expect(await entry(page)).toBe(inbox)
  await page.goBack()
  await expect(page).toHaveURL(/\/context$/)
})

test('Esc from a review goes back to the Inbox, on the card last reviewed', async ({ page }) => {
  const [first, second] = queue()
  await go(page, '/context')
  await expect(page.locator('[data-row-open]').first()).toBeVisible()
  await moveTo(page, `/inbox?card=${encodeURIComponent(card(first!))}`)
  const inbox = await entry(page)
  // The card's one decision opens its review.
  await page.locator('button[data-primary]').first().click()
  await expect(page).toHaveURL(new RegExp(`/inbox/${card(first!)}/review`))
  // The address changes before the review has drawn; a J before it is the Inbox's, and moves its cursor.
  await expect(page.locator('#change-heading')).toBeVisible()
  await page.locator('body').click({ position: { x: 1, y: 1 } })
  // J steps to the next suggestion in the same step of history.
  await page.keyboard.press('j')
  await expect(page).toHaveURL(new RegExp(`/inbox/${card(second!)}/review`))
  expect(await entry(page)).toBe(inbox + 1)

  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(new RegExp(`/inbox\\?card=${card(second!)}$`))
  expect(await entry(page)).toBe(inbox)
  // The next Back leaves the Inbox instead of reopening the review.
  await page.goBack()
  await expect(page).toHaveURL(/\/context$/)
})
