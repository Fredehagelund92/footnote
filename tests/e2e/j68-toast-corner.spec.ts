import { card, expect, go, test } from './go.ts'

// J68: a toast sits in the corner and goes by itself. Closing a gap ("Not something we write down")
// says so in a toast whose Undo the service takes at any time; that toast used to stay for good,
// and floated above the foot of the page as if a selection bar were there.

const sizes = [
  ['desktop', { width: 1440, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const

for (const [name, size] of sizes) {
  test.describe(name, () => {
    test.use({ viewport: size })

    test('closing a gap says so in the corner', async ({ page }) => {
      await page.clock.install()
      await go(page, `/inbox?card=${card('gap-germany')}`)
      await page.getByRole('button', { name: 'Not something we write down' }).first().click()

      const toast = page.locator('[data-sonner-toast]')
      await expect(toast).toContainText('Agents keep saying honestly that nothing is written down.')
      await expect(toast).toHaveAttribute('data-mounted', 'true')
      // Past its slide in, in the corner: its right edge and its foot are the toaster's offsets
      // from the window's, with no selection bar for it to clear.
      await page.clock.runFor(600)
      const box = (await toast.boundingBox())!
      expect(size.width - (box.x + box.width)).toBeCloseTo(name === 'phone' ? 16 : 24, 0)
      expect(size.height - (box.y + box.height)).toBeCloseTo(64, 0)
    })

    test('the toast of a close that can always be undone goes by itself', async ({ page }) => {
      await page.clock.install()
      await go(page, `/inbox?card=${card('gap-germany')}`)
      await page.getByRole('button', { name: 'Not something we write down' }).first().click()

      // A toast waits while it is pointed at: the pointer that clicked is not over it.
      await page.mouse.move(2, 2)
      const toast = page.locator('[data-sonner-toast]')
      await expect(toast).toHaveCount(1)
      // Still there while Undo may be wanted, gone well within the next 15 seconds.
      await page.clock.runFor(3000)
      await expect(toast).toHaveCount(1)
      await page.clock.runFor(12_000)
      await expect(toast).toHaveCount(0)
    })
  })
}
