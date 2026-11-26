import type { Page } from '@playwright/test'
import { expect, go, mode, test } from './go.ts'

// J115: the drafts someone imported are read one after another in the Inbox's pane. A draft opens
// in the card's place, held in the address, with "15 of 21", J and K through the drafts and Esc
// back to their list, which comes back as it was left: scrolled where it was, the draft's row
// focused. Publish (Enter) and Don't publish (a delete, with Undo and no question) each open the
// next draft. A draft that needs a fix says what, and Edit is its one decision.

const pane = (page: Page) => page.getByRole('region', { name: /drafts from your import$/ })
const list = (page: Page) => pane(page).getByRole('list', { name: 'Your drafts' })
const row = (page: Page, title: string | RegExp) => list(page).getByRole('link', { name: title })
const heading = (page: Page) => pane(page).getByRole('heading', { level: 2 }).first()
/** A line on the screen: the toast's, or one said to a screen reader. */
const said = (page: Page, text: string) => page.getByText(text, { exact: true }).last()

test.beforeEach(async ({ page }) => {
  test.skip(mode === 'http', 'The 21 imported drafts are the mock demo’s (?demo=imported).')
  await page.setViewportSize({ width: 1440, height: 700 })
  await go(page, '/inbox?demo=imported&card=drafts%3Ayours')
  await expect(list(page).getByRole('listitem')).toHaveCount(21)
})

test('A draft opens in the card’s place, steps with J and K, and Esc returns to the list as it was', async ({
  page,
}) => {
  const title = 'Gross margin in Spain uses last month’s costs'
  const body = pane(page).locator('[data-slot=panel-body]')
  await row(page, title).scrollIntoViewIfNeeded()
  const scrolled = await body.evaluate((b) => b.scrollTop)
  expect(scrolled).toBeGreaterThan(0)
  await row(page, title).click()
  await expect(page).toHaveURL(/[?&]draft=/)
  await expect(heading(page)).toHaveText('15 of 21')
  await expect(pane(page).getByRole('heading', { name: title })).toBeVisible()
  await expect(pane(page)).toContainText('your draft, only you can see it')
  await expect(pane(page).getByRole('button', { name: 'Back to 21 drafts' })).toBeVisible()

  await page.locator('body').click({ position: { x: 1, y: 1 } })
  await page.keyboard.press('j')
  await expect(heading(page)).toHaveText('16 of 21')
  await page.keyboard.press('k')
  await page.keyboard.press('k')
  await expect(heading(page)).toHaveText('14 of 21')
  const last = await pane(page).getByRole('heading', { level: 2 }).nth(1).textContent()

  // Esc: the list as it was left, the draft last read focused.
  await page.keyboard.press('Escape')
  await expect(page).not.toHaveURL(/[?&]draft=/)
  await expect(row(page, last!)).toBeFocused()
  await expect(row(page, last!)).toBeInViewport()
  expect(await body.evaluate((b) => b.scrollTop)).toBeGreaterThan(0)
  // The card stays open.
  await expect(page).toHaveURL(/card=drafts/)

  // The browser's Back does the same.
  await row(page, title).click()
  await expect(heading(page)).toHaveText('15 of 21')
  await page.goBack()
  await expect(page).not.toHaveURL(/[?&]draft=/)
  await expect(row(page, title)).toBeFocused()

  // So does the editor's: Edit, then Back, comes back to the same draft.
  await row(page, title).click()
  await pane(page).getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page).toHaveURL(/\/context\/[^/]+\/edit/)
  await page.goBack()
  await expect(heading(page)).toHaveText('15 of 21')
})

test('Publish and Don’t publish each open the next draft, with Undo', async ({ page }) => {
  await row(page, 'Return on ad spend leaves out brand campaigns').click()
  await expect(heading(page)).toHaveText('5 of 21')
  await expect(pane(page)).toContainText('Then the next draft opens')
  // Enter publishes: one draft is "it".
  await page.locator('body').click({ position: { x: 1, y: 1 } })
  await page.keyboard.press('Enter')
  await expect(said(page, 'Published')).toBeVisible()
  await expect(said(page, 'Agents get it from the next question.')).toBeVisible()
  await expect(heading(page)).toHaveText('5 of 20')
  const next = await pane(page).getByRole('heading', { level: 2 }).nth(1).textContent()
  expect(next).not.toBe('Return on ad spend leaves out brand campaigns')

  // Don't publish deletes it at once, with no question, and Undo brings it back.
  await pane(page).getByRole('button', { name: "Don't publish" }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(said(page, 'Deleted 1 draft')).toBeVisible()
  await expect(heading(page)).toHaveText('5 of 19')
  await page.getByRole('button', { name: 'Undo' }).first().click()
  await expect(heading(page)).toHaveText(/ of 20$/)
})

test('A draft that needs a fix says what, and its one decision is Edit', async ({ page }) => {
  await row(page, /^Orders in Norway leave out test orders/).click()
  await expect(pane(page).getByRole('note')).toHaveText('Add a source first.')
  await expect(pane(page)).toContainText('It needs a fix before it can go')
  await expect(pane(page).getByRole('button', { name: 'Publish', exact: true })).toBeDisabled()
  await page.locator('body').click({ position: { x: 1, y: 1 } })
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/context\/[^/]+\/edit/)
})
