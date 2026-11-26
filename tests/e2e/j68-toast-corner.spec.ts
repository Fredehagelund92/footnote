import { card, expect, go, test } from './go.ts'

// J68: a toast sits in the corner, 16px from the window's edges, just above what is at the foot
// under it, and goes by itself. Closing a gap ("Not something we write down") says so in a toast
// whose Undo the service takes at any time; that toast used to stay for good, and floated above
// the foot of the page as if a selection bar were there.

const sizes = [
  ['desktop', { width: 1440, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const

for (const [name, size] of sizes) {
  test.describe(name, () => {
    test.use({ viewport: size })

    test('closing a gap says so in the corner', async ({ page }) => {
      await page.clock.install()
      await go(page, `/inbox?card=${card('gap-spain')}`)
      await page.getByRole('button', { name: 'Not something we write down' }).first().click()

      const toast = page.locator('[data-sonner-toast]')
      await expect(toast).toContainText('Agents keep saying honestly that nothing is written down.')
      await expect(toast).toHaveAttribute('data-mounted', 'true')
      // Past its slide in, in the corner: 16px from the window's right edge, and 8px above the
      // card's decisions at the foot, which it never covers. The slide is a real CSS transition
      // the fake clock does not drive, so wait for it to settle.
      await page.clock.runFor(600)
      const foot = page.getByText('Reply to the comment, or mark it done')
      const gaps = async () => {
        const box = (await toast.boundingBox())!
        const above = await foot.evaluate(
          (el) => el.closest('.border-t')!.getBoundingClientRect().top,
        )
        return [size.width - (box.x + box.width), above - (box.y + box.height)].map(Math.round)
      }
      await expect.poll(gaps).toEqual([16, 8])
    })

    test('on Ask a toast sits just above the Ask box', async ({ page }) => {
      await page.clock.install()
      await go(page, '/ask?example=grounded')
      const copy = page.getByRole('button', { name: 'Copy', exact: true }).first()
      await expect(copy).toBeAttached()
      // "Copied" is said for 4 seconds: the clock stands still while it is measured.
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
      await copy.click({ force: true })
      const toast = page.locator('[data-sonner-toast]')
      await page.clock.runFor(100)
      await expect(toast).toHaveAttribute('data-mounted', 'true')
      await page.mouse.move(2, 2)
      const gaps = async () => {
        const box = (await toast.boundingBox())!
        const above = await page
          .locator('[data-dock]')
          .evaluate((el) => el.getBoundingClientRect().top)
        return [size.width - (box.x + box.width), above - (box.y + box.height)].map(Math.round)
      }
      await expect.poll(gaps).toEqual([16, 8])
    })

    test('the toast of a close that can always be undone goes by itself', async ({ page }) => {
      await page.clock.install()
      await go(page, `/inbox?card=${card('gap-spain')}`)
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
