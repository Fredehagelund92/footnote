import type { Page } from '@playwright/test'
import { cardIn, expect, go, onMockOnly, settle, test } from './go.ts'

// J123, Publish moves on at once (owner call Q1, 25 Nov 2026): the review opens the next
// suggestion as Publish is pressed, and the row it left in the queue says Publishing, then
// Published once the service said yes, or Not published with the service's reason. Nothing says
// Published before then, and a refused one is tried again from its own row.

const LINK = 'Returns changed definition on 28 April 2026'

const decide = (page: Page) => page.getByRole('complementary', { name: 'Try it and decide' })
const queue = (page: Page) => page.getByRole('navigation', { name: 'Waiting suggestions' })
const row = (page: Page, title: string) =>
  queue(page).getByRole('button').filter({ hasText: title })
const toasts = (page: Page) => page.locator('[data-sonner-toast]')

test.describe('on a wide screen, where the queue is a column', () => {
  test.use({ viewport: { width: 1920, height: 1000 } })

  test('the row it left says Publishing, then Published, and nothing says it before', async ({
    page,
  }) => {
    await page.clock.install()
    await go(page, '/inbox/sug-ines-link/review')
    await expect(decide(page).getByRole('button', { name: 'Publish', exact: true })).toBeVisible()
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 500))
    await decide(page).getByRole('button', { name: 'Publish', exact: true }).click()
    // The next suggestion is open while the service has not answered (time is stopped).
    await expect(page).toHaveURL(new RegExp(`${cardIn('sug-ines-order')}/review`))
    await expect(row(page, LINK)).toContainText('Publishing…')
    await expect(row(page, LINK)).not.toContainText('Published')
    await expect(toasts(page)).toHaveCount(0)
    // The service said yes: now it says Published, on its row and in a toast with Undo.
    await settle(page, 700)
    await expect(row(page, LINK)).toContainText('Published')
    await expect(row(page, LINK)).not.toContainText('Publishing…')
    const said = toasts(page).filter({ hasText: `Published “${LINK}”` })
    await expect(said.getByRole('button', { name: 'Undo' })).toBeVisible()
  })

  test('a refusal stays on its row in plain words, and is tried again from it', async ({
    page,
  }) => {
    await onMockOnly('?publish=fail, a refusal on demand', async () => {
      await go(page, '/inbox/sug-ines-link/review?publish=fail')
      await decide(page).getByRole('button', { name: 'Publish', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`${cardIn('sug-ines-order')}/review`))
      const refused = row(page, LINK)
      await expect(refused).toContainText('Not published')
      await expect(refused).toContainText(
        'Another owner is already reviewing this suggestion. Nothing changed.',
      )
      await expect(toasts(page).filter({ hasText: `Couldn't publish “${LINK}”` })).toBeVisible()
      await expect(toasts(page).filter({ hasText: /^Published/ })).toHaveCount(0)
      // Opened again, its decision says why, with Try again in place of Publish.
      await refused.click()
      await expect(page).toHaveURL(new RegExp(`${cardIn('sug-ines-link')}/review`))
      await expect(decide(page).getByRole('alert')).toContainText(
        "Couldn't publish. Another owner is already reviewing this suggestion. Nothing changed.",
      )
      await decide(page).getByRole('button', { name: 'Try again' }).click()
      await expect(page).toHaveURL(new RegExp(`${cardIn('sug-ines-order')}/review`))
      await expect(row(page, LINK)).toContainText('Published')
      await expect(row(page, LINK)).not.toContainText('Not published')
    })
  })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("Publish in the bar moves on, and the queue's sheet says Published", async ({ page }) => {
    await go(page, '/inbox/sug-ines-link/review')
    const publish = page.getByRole('button', { name: 'Publish', exact: true }).last()
    await expect(publish).toBeVisible()
    await publish.tap()
    await expect(page).toHaveURL(new RegExp(`${cardIn('sug-ines-order')}/review`))
    await expect(toasts(page).filter({ hasText: `Published “${LINK}”` })).toBeVisible()
    await page.getByRole('button', { name: 'More' }).tap()
    await page.getByRole('menuitem', { name: 'Waiting suggestions' }).tap()
    await expect(row(page, LINK)).toContainText('Published')
  })
})
