import { expect, go, test } from './go.ts'

// J87, what a metric is built from (FR-143): a synced metric's page says, under its description,
// what its tool's structure says it is built from and what is built from it. A ratio's two inputs
// are lines of its tree; an input's page names the columns it reads and links the metrics it is
// used by. The same at 1440 and 390 wide, where the rows wrap and the page never scrolls sideways.

const widths = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
] as const

for (const { name, width, height } of widths) {
  test.describe(name, () => {
    test.use({ viewport: { width, height } })

    test('shows a ratio’s inputs, and an input says what uses it', async ({ page }) => {
      await go(page, '/definitions/Cost%20per%20acquisition')
      const main = page.getByRole('main')
      const built = main.getByRole('region', { name: 'How it is built' })
      await expect(built).toBeVisible()
      // Under the description, above where it is read from.
      const words = main.getByText('Marketing spend divided by first-time buyers', { exact: false })
      const source = main.getByText(/read-only, read from/)
      const box = async (l: typeof words) => (await l.boundingBox())!
      const [above, own, below] = [await box(words), await box(built), await box(source)]
      expect(own.y).toBeGreaterThanOrEqual(above.y + above.height)
      expect(own.y + own.height).toBeLessThanOrEqual(below.y)
      await expect(built).toContainText('Built from')
      // The inputs are the lines of its tree (J128), under the metric itself.
      await expect(built.getByRole('treeitem')).toContainText([
        'Cost per acquisition',
        'Marketing spend',
        'First-time buyers',
      ])

      await go(page, '/definitions/First-time%20buyers')
      const input = page.getByRole('main').getByRole('region', { name: 'How it is built' })
      await expect(input).toContainText('columnscustomer_idfirst_paid_order_at')
      await expect(input.getByRole('link')).toHaveText(['Cost per acquisition'])
      const sideways = await page.evaluate(
        () => document.scrollingElement!.scrollWidth - document.documentElement.clientWidth,
      )
      expect(sideways).toBe(0)
    })

    test('says nothing on a metric its tool says nothing of', async ({ page }) => {
      await go(page, '/definitions/Churn%20rate')
      const main = page.getByRole('main')
      await expect(main.getByRole('heading', { name: 'Churn rate', level: 2 })).toBeVisible()
      await expect(main.getByText(/read-only, read from/)).toBeVisible()
      await expect(main.getByRole('region', { name: 'How it is built' })).toHaveCount(0)
    })
  })
}
