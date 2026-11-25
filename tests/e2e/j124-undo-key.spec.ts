import type { Page } from '@playwright/test'
import { cardIn, expect, go, moveTo, onMockOnly, settle, test } from './go.ts'

// J124, Command and Z (owner call Q4, 25 Nov 2026): it takes back the last decision from any
// screen for as long as the service holds it, and opens that suggestion again. It waits for a
// decision still being sent, says when it is too late, and leaves typing to the field's own undo.

const LINK = 'Returns changed definition on 28 April 2026'

const decide = (page: Page) => page.getByRole('complementary', { name: 'Try it and decide' })
const toasts = (page: Page) => page.locator('[data-sonner-toast]')
const undoKey = (page: Page) => page.keyboard.press('ControlOrMeta+z')

async function publishLink(page: Page) {
  await go(page, '/inbox/sug-ines-link/review')
  await decide(page).getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(toasts(page).filter({ hasText: `Published “${LINK}”` })).toBeVisible()
}

test('from another screen it takes back the last publish and opens it again', async ({ page }) => {
  await publishLink(page)
  await moveTo(page, '/inbox')
  await expect(page).toHaveURL(/\/inbox$/)
  await undoKey(page)
  await expect(toasts(page).filter({ hasText: /^Undone/ })).toContainText(`Published “${LINK}”`)
  await expect(page).toHaveURL(new RegExp(`${cardIn('sug-ines-link')}/review`))
  await expect(decide(page).getByRole('button', { name: 'Publish', exact: true })).toBeVisible()
  // One last decision, never a history: a second press has nothing to take back.
  await undoKey(page)
  await expect(toasts(page).filter({ hasText: 'Nothing to undo' })).toBeVisible()
})

test('while the publish is being sent it says so, then takes it back once it is in', async ({
  page,
}) => {
  await page.clock.install()
  await go(page, '/inbox/sug-ines-link/review')
  await expect(decide(page).getByRole('button', { name: 'Publish', exact: true })).toBeVisible()
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 500))
  await decide(page).getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${cardIn('sug-ines-order')}/review`))
  await undoKey(page)
  // A toast needs a moment of the stopped clock to show; the service still takes 600 ms.
  await page.clock.runFor(100)
  await expect(toasts(page).filter({ hasText: `Still publishing “${LINK}”` })).toBeVisible()
  await settle(page, 700)
  await expect(toasts(page).filter({ hasText: `Published “${LINK}”` })).toBeVisible()
  await undoKey(page)
  await settle(page, 700)
  await expect(page).toHaveURL(new RegExp(`${cardIn('sug-ines-link')}/review`))
  await expect(decide(page).getByRole('button', { name: 'Publish', exact: true })).toBeVisible()
})

test('once the service no longer holds it, it says it is too late', async ({ page }) => {
  // The mock holds an Undo for 15 seconds of the page's own clock; the service keeps its own time.
  await onMockOnly('Undo window on the stopped clock', async () => {
    await page.clock.install()
    await go(page, '/inbox/sug-ines-link/review')
    await expect(decide(page).getByRole('button', { name: 'Publish', exact: true })).toBeVisible()
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 500))
    await decide(page).getByRole('button', { name: 'Publish', exact: true }).click()
    await settle(page, 700)
    await page.clock.runFor(16_000)
    await undoKey(page)
    await page.clock.runFor(100)
    await expect(toasts(page).filter({ hasText: "It's too late to undo that" })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`${cardIn('sug-ines-order')}/review`))
  })
})

test('in a field it is the field’s own undo, and takes back no decision', async ({ page }) => {
  await publishLink(page)
  await decide(page).getByRole('button', { name: 'Send back with a note' }).click()
  const note = page.getByRole('textbox', { name: /^A note for/ })
  await note.pressSequentially('Which page?')
  await undoKey(page)
  await expect(toasts(page).filter({ hasText: /^Undone|Nothing to undo/ })).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`${cardIn('sug-ines-order')}/review`))
})

test('an Inbox decision is taken back by the key too', async ({ page }) => {
  await go(page, '/inbox?demo=week&card=check-returns')
  const card = page.locator('[data-row="check-returns"]')
  await expect(card).toBeVisible()
  await page.getByRole('button', { name: 'Still true', exact: true }).click()
  await expect(card).toHaveCount(0)
  await undoKey(page)
  await expect(card).toBeVisible()
})
