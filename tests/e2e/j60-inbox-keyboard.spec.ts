import { card, expect, go, test } from './go.ts'

// J60: the Inbox works without a mouse. Enter on a card opens it and puts the focus on the pane's
// one decision, so Enter again takes it; and the "Skip to the content" link is drawn over the page
// when it takes focus, instead of pushing the sidebar sideways.

test('Enter on a card moves the focus to the pane’s main action', async ({ page }) => {
  await go(page, `/inbox?card=${card('sug-ines')}`)
  const rows = page.locator('[data-row-open]')
  const other = rows.nth(1)
  await other.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('button[data-primary]')).toBeFocused()
  // The row that was already open takes Enter the same way.
  await rows.nth(1).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('button[data-primary]')).toBeFocused()
})

test('the skip link is drawn over the page and moves nothing', async ({ page }) => {
  await go(page, '/inbox')
  const sidebar = page.locator('[data-slot=sidebar-container]').first()
  const before = (await sidebar.boundingBox())?.x
  await page.keyboard.press('Tab')
  const skip = page.getByRole('button', { name: 'Skip to the content' })
  await expect(skip).toBeFocused()
  await expect(skip).toHaveCSS('position', 'fixed')
  expect((await sidebar.boundingBox())?.x).toBe(before)
})
