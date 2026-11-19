import { expect, go, test } from './go.ts'

// J81: Observability's pages keep the design contract. The range and Feedback's states are words
// to choose from (TextSwitch), never line tabs or a segmented track; and on a phone a saved
// question's domain dot stays on one line with its name.

for (const address of [
  '/observability',
  '/observability/quality',
  '/observability/feedback',
  '/observability/usage',
  '/observability/alerts',
])
  test(`${address}: no tabs, and the range is words to choose from`, async ({ page }) => {
    await go(page, address)
    await expect(page.locator('main [data-slot="kpi"], main h2').first()).toBeVisible()
    await expect(page.locator('main [role="tablist"], main [role="tab"]')).toHaveCount(0)
    const time = page.getByRole('radiogroup', { name: 'Time' })
    if (await time.count()) await expect(time.getByRole('radio', { name: '30 days' })).toBeVisible()
  })

test.describe('at 390', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('Quality: the domain dot and "Sales" are on one line', async ({ page }) => {
    await go(page, '/observability/quality')
    const domain = page.locator('[data-slot="domain"]', { hasText: 'Sales' }).first()
    await expect(domain).toBeVisible()
    const box = (await domain.boundingBox())!
    const dot = (await domain.locator('span[aria-hidden]').first().boundingBox())!
    const name = await domain.evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents(el.lastChild!)
      return range.getClientRects().length
    })
    // One line: the name is one run of text, and the dot sits inside the same line box.
    expect(name).toBe(1)
    expect(box.height).toBeLessThan(24)
    expect(dot.y).toBeGreaterThanOrEqual(box.y - 0.5)
    expect(dot.y + dot.height).toBeLessThanOrEqual(box.y + box.height + 0.5)
  })
})
