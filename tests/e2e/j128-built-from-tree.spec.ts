import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J128, what a metric is built from as a tree (FR-143): a synced metric's page, and its quick view,
// show the metrics it is built from at every depth as an indented tree, the metric on top, each
// line with its kind and how many published context items about it the person may read. A line
// opens its metric in the side panel, by pointer or by the list's keys; a level folds and opens.
// Counts only: no item's words, no figure. The same at 1440 and 390 wide, never scrolling sideways.

const widths = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
] as const

/** Each line of a tree as a reader reads it: its level, its name and its count. */
const lines = (page: Page, name: string) =>
  page
    .getByRole('tree', { name: `What ${name} is built from` })
    .getByRole('treeitem')
    .evaluateAll((items) =>
      items.map((item) => `${item.getAttribute('aria-level')} ${item.textContent}`),
    )

for (const { name, width, height } of widths) {
  test.describe(name, () => {
    test.use({ viewport: { width, height } })

    test('shows the tree with counts, and a line opens its metric beside the page', async ({
      page,
    }) => {
      await go(page, '/definitions/Return%20on%20ad%20spend')
      const built = page.getByRole('main').getByRole('region', { name: 'How it is built' })
      const tree = built.getByRole('tree', { name: 'What Return on ad spend is built from' })
      await expect(tree).toBeVisible()
      await expect
        .poll(() => lines(page, 'Return on ad spend'))
        .toEqual([
          '1 Return on ad spend3 context items',
          '2 Net revenue2 context items',
          '3 Gross salesNo context',
          '3 Returns1 context item',
          '3 Discount cost2 context items',
          '2 Marketing spendNo context',
        ])
      // Each line says its kind.
      await expect(tree.getByRole('img', { name: 'Metric' })).toHaveCount(6)
      await expect(built).toContainText('5 metrics below it, read from Cube.')

      // The top line is this metric: it opens nothing.
      await tree.getByRole('treeitem').first().click()
      await expect(page).not.toHaveURL(/dock=/)
      await tree.getByRole('treeitem', { name: /Net revenue/ }).click()
      await expect(page).toHaveURL(/dock=def\.Net(\+|%20)revenue/)
      const panel = page.getByRole('region', { name: 'Definition' })
      await expect(panel.getByRole('heading', { name: 'Net revenue' })).toBeVisible()
      // The quick view has the tree of the metric it shows.
      await expect
        .poll(() => lines(page, 'Net revenue'))
        .toEqual([
          '1 Net revenue2 context items',
          '2 Gross salesNo context',
          '2 Returns1 context item',
          '2 Discount cost2 context items',
        ])
      await panel
        .getByRole('tree', { name: 'What Net revenue is built from' })
        .getByRole('treeitem', { name: /Returns/ })
        .click()
      await expect(page).toHaveURL(/dock=def\.Returns/)
      await expect(panel.getByRole('heading', { name: 'Returns' })).toBeVisible()
      // Returns is built from no metric: its quick view draws no tree.
      await expect(panel.getByRole('tree')).toHaveCount(0)

      const sideways = await page.evaluate(
        () => document.scrollingElement!.scrollWidth - document.documentElement.clientWidth,
      )
      expect(sideways).toBe(0)
    })
  })
}

test('moves with the list keys, folds and opens a level, and Enter opens a line', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await go(page, '/definitions/Return%20on%20ad%20spend')
  const tree = page.getByRole('tree', { name: 'What Return on ad spend is built from' })
  const item = (name: string) => tree.getByRole('treeitem', { name: new RegExp(name) })
  await item('Return on ad spend').focus()

  await page.keyboard.press('ArrowDown')
  await expect(item('Net revenue')).toBeFocused()
  await expect(item('Net revenue')).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('ArrowLeft')
  await expect(item('Net revenue')).toHaveAttribute('aria-expanded', 'false')
  await expect(item('Gross sales')).toHaveCount(0)
  await page.keyboard.press('j')
  await expect(item('Marketing spend')).toBeFocused()
  await page.keyboard.press('k')
  await page.keyboard.press('ArrowRight')
  await expect(item('Net revenue')).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('ArrowRight')
  await expect(item('Gross sales')).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(item('Net revenue')).toBeFocused()
  await page.keyboard.press('End')
  await expect(item('Marketing spend')).toBeFocused()
  await page.keyboard.press('Home')
  await expect(item('Return on ad spend')).toBeFocused()

  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/dock=def\.Marketing(\+|%20)spend/)
  // The line shown beside the page is marked, as a list marks the row it shows.
  await expect(item('Marketing spend')).toHaveAttribute('data-peeked', 'true')
})
