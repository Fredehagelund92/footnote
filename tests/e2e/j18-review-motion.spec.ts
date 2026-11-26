import type { Page } from '@playwright/test'
import { cardIn, expect, go, settle, test } from './go.ts'

// J18, after a decision: nothing holds the review. Publish opens the next suggestion at once,
// with reduced motion too, and focus is on its change; the Ready line never moves under the
// pointer; toasts keep clear of the decision.

const decide = (page: Page) => page.getByRole('complementary', { name: 'Try it and decide' })

/** Open a suggestion with time stopped, so only runFor moves it. */
async function open(page: Page, id: string) {
  await page.clock.install()
  await go(page, `/inbox/${id}/review`)
  await decide(page)
    .getByRole('button', { name: /Publish|Return/ })
    .first()
    .waitFor()
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 500))
}

test('Publish opens the next suggestion before the service answers', async ({ page }) => {
  await open(page, 'sug-ines-link')
  await decide(page).getByRole('button', { name: 'Publish', exact: true }).click()
  // Time is stopped, so the service has not answered: the review moved on all the same.
  await expect(page).toHaveURL(new RegExp(`${cardIn('sug-ines-order')}/review`))
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
  await settle(page, 700)
  await expect(page.locator('#change-heading')).toBeFocused()
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: /^Published “/ }),
  ).toBeVisible()
})

test('with reduced motion Publish moves on at once too: nothing waits for Next', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page, 'sug-ines-link')
  await decide(page).getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${cardIn('sug-ines-order')}/review`))
  await expect(decide(page).getByRole('button', { name: 'Next suggestion' })).toHaveCount(0)
})

test("a toast never covers the decision's buttons", async ({ page }) => {
  await open(page, 'sug-ines-format')
  // Read to the end of the change, as a reader scrolls to it.
  await page.getByText(/Counts as read after about \d+ seconds here./).scrollIntoViewIfNeeded()
  await expect(page.locator('[style*="readfill"]')).toHaveCSS('animation-play-state', 'running')
  await page.clock.runFor(8000)
  await page.getByRole('button', { name: "Publish the 1 you've read" }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Publish 1' }).click()
  await settle(page, 700)
  const toast = page.locator('[data-sonner-toast]').first()
  await expect(toast).toBeVisible()
  const t = (await toast.boundingBox())!
  for (const b of await decide(page).getByRole('button').all()) {
    const r = await b.boundingBox()
    if (!r) continue
    const overlaps =
      t.x < r.x + r.width && r.x < t.x + t.width && t.y < r.y + r.height && r.y < t.y + t.height
    expect(overlaps, (await b.textContent()) ?? '').toBe(false)
  }
})
