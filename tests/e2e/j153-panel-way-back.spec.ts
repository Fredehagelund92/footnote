import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J153: the side panel has a way back. A definition pressed inside a context item takes the panel
// to that definition and puts "Back to <the item>" at the top, one step per press; H does the same
// and the browser's Back button walks the same entries, never leaving Context. The close X always
// leaves the panel, and Esc does too. A row picked in the list is a new place, not a step.

const ITEM = 'itm_norway_stop'
const TITLE = 'Online sales to Norway stopped on 4 August 2026'

const dock = (page: Page) => page.locator('[data-slot=dock]')
const back = (page: Page, to: string) => dock(page).getByRole('button', { name: `Back to ${to}` })
/** The item's words, with the definitions it names, are under Details. */
async function pressWebshop(page: Page) {
  const details = dock(page).getByRole('button', { name: /^Details/ })
  if ((await details.getAttribute('aria-expanded')) !== 'true') await details.click()
  await dock(page).getByRole('button', { name: 'Webshop' }).click()
}
const heading = (page: Page) => dock(page).getByRole('heading', { level: 2 }).first()
const entry = (page: Page) =>
  page.evaluate(() => (history.state as { __TSR_index: number }).__TSR_index)

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
})

test('a definition pressed in an item has a way back: the link, H and the browser Back button', async ({
  page,
}) => {
  await go(page, `/context?dock=context.${ITEM}`)
  await expect(dock(page).getByRole('heading', { name: TITLE })).toBeVisible()
  // Opened from the page, the item has no step to go back to.
  await expect(dock(page).locator('[data-dock-back]')).toHaveCount(0)

  await pressWebshop(page)
  await expect(page).toHaveURL(/[?&]dock=def\.Webshop/)
  await expect(dock(page).getByRole('heading', { name: 'Webshop' })).toBeVisible()
  await expect(back(page, TITLE)).toBeVisible()
  // The close X is there too, and the focus came with the panel.
  await expect(dock(page).getByRole('button', { name: 'Close the panel' })).toBeVisible()
  await expect(heading(page)).toBeFocused()

  // The link steps back one place, in the same entry the browser's Back button would go to.
  const at = await entry(page)
  await back(page, TITLE).click()
  await expect(page).toHaveURL(new RegExp(`[?&]dock=context\\.${ITEM}`))
  await expect(dock(page).getByRole('heading', { name: TITLE })).toBeVisible()
  await expect(dock(page).locator('[data-dock-back]')).toHaveCount(0)
  expect(await entry(page)).toBe(at - 1)
  await expect(page).toHaveURL(/\/context\?/)

  // Forward comes back to the definition with its link, kept with the entry, as does a reload.
  await page.goForward()
  await expect(back(page, TITLE)).toBeVisible()
  await page.reload()
  await expect(back(page, TITLE)).toBeVisible()

  // H is the same step, with the focus anywhere nobody is typing.
  await page.keyboard.press('h')
  await expect(page).toHaveURL(new RegExp(`[?&]dock=context\\.${ITEM}`))
  await expect(dock(page).locator('[data-dock-back]')).toHaveCount(0)

  // The browser's Back button follows the same trail, and stays in Context.
  await pressWebshop(page)
  await expect(back(page, TITLE)).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`[?&]dock=context\\.${ITEM}`))
  await expect(page).toHaveURL(/\/context\?/)
  await expect(dock(page).getByRole('heading', { name: TITLE })).toBeVisible()
})

test('each press goes back one place, through a definition to another item and on', async ({
  page,
}) => {
  await go(page, `/context?dock=context.${ITEM}`)
  await pressWebshop(page)
  await expect(back(page, TITLE)).toBeVisible()
  // The definition's list of items that link to it: another step.
  await dock(page).getByRole('button', { name: TITLE, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`[?&]dock=context\\.${ITEM}`))
  await expect(back(page, 'Webshop')).toBeVisible()
  await back(page, 'Webshop').click()
  await expect(page).toHaveURL(/[?&]dock=def\.Webshop/)
  await expect(back(page, TITLE)).toBeVisible()
  await back(page, TITLE).click()
  await expect(page).toHaveURL(new RegExp(`[?&]dock=context\\.${ITEM}`))
  await expect(dock(page).locator('[data-dock-back]')).toHaveCount(0)
})

test('the close X and Esc leave the panel; a row picked in the list is not a step', async ({
  page,
}) => {
  await go(page, `/context?dock=context.${ITEM}`)
  await pressWebshop(page)
  await expect(back(page, TITLE)).toBeVisible()
  await dock(page).getByRole('button', { name: 'Close the panel' }).click()
  await expect(page).not.toHaveURL(/dock=/)
  await expect(dock(page)).toHaveCount(0)

  await go(page, `/context?dock=context.${ITEM}`)
  await pressWebshop(page)
  await expect(back(page, TITLE)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).not.toHaveURL(/dock=/)

  // Another row, picked in the list with a peek open, is a new place: no Back to the old one.
  await go(page, `/context?dock=context.${ITEM}`)
  const other = page.locator('[data-row-open]:not([data-row-open="' + ITEM + '"])').first()
  await other.click()
  await expect(page).not.toHaveURL(new RegExp(`dock=context\\.${ITEM}`))
  await expect(dock(page).locator('[data-dock-back]')).toHaveCount(0)
})

test('on a phone the panel keeps its link, and the arrow leaves', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await go(page, `/context?dock=context.${ITEM}`)
  await pressWebshop(page)
  await expect(back(page, TITLE)).toBeVisible()
  await expect(dock(page).getByRole('button', { name: 'Close the panel' })).toBeVisible()
  await back(page, TITLE).click()
  await expect(dock(page).getByRole('heading', { name: TITLE })).toBeVisible()
  // With nothing to step back to, the arrow is Back, which leaves, as it was.
  await expect(dock(page).getByRole('button', { name: 'Back', exact: true })).toBeVisible()
})
