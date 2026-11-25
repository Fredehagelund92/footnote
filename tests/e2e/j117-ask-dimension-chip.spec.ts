import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J117, a dimension in Ask's answer opens its definition in the pane, as a metric does: a press
// on the Market chip opens Market's quick view, and so does a press on a value of it (Germany),
// which has no page of its own. Pointed at, each chip's card says what it is and offers the way
// there: Open the definition for the dimension, Open Market for its value. At 1440 and 390.

for (const { name, viewport } of [
  { name: '1440', viewport: { width: 1440, height: 900 } },
  { name: '390', viewport: { width: 390, height: 844 } },
] as const)
  test.describe(name, () => {
    test.use({ viewport })

    const answer = async (page: Page, example: string) => {
      await go(page, `/ask?example=${example}`)
      const log = page.getByRole('log')
      await expect(log.getByRole('group', { name: 'Answer actions' })).toBeVisible({
        timeout: 20_000,
      })
      return log.locator('[data-answer-words]')
    }
    const pane = (page: Page) => page.getByRole('region', { name: 'Definition' })

    test("a press on a dimension's chip opens its definition in the pane", async ({ page }) => {
      const words = await answer(page, 'loop-definition-dimension')
      const chip = words.getByRole('button', { name: /^Market\s*, dimension$/ })
      await expect(chip).toHaveCSS('cursor', 'pointer')
      await chip.click()
      await expect(page).toHaveURL(/dock=def\.Market/)
      await expect(pane(page).getByRole('heading', { name: 'Market' })).toBeVisible()
      // The press is the pane's alone: no card is left on top of it.
      await expect(page.getByRole('dialog', { name: 'Market' })).toHaveCount(0)
    })

    test("a press on a value's chip opens its dimension's definition", async ({ page }) => {
      const words = await answer(page, 'loop-checked')
      await words.getByRole('button', { name: /^Germany\s*, value$/ }).click()
      await expect(page).toHaveURL(/dock=def\.Market/)
      await expect(pane(page).getByRole('heading', { name: 'Market' })).toBeVisible()
    })

    if (name === '1440')
      test("each chip's card offers its definition, pointed at", async ({ page }) => {
        const words = await answer(page, 'loop-checked')
        await words.getByRole('button', { name: /^Germany\s*, value$/ }).hover()
        const value = page.getByRole('dialog', { name: 'Germany' })
        await expect(value).toContainText('A value of Market')
        await value.getByRole('button', { name: 'Open Market' }).click()
        await expect(page).toHaveURL(/dock=def\.Market/)
        await expect(pane(page).getByRole('heading', { name: 'Market' })).toBeVisible()

        const defined = await answer(page, 'loop-definition-dimension')
        await defined.getByRole('button', { name: /^Market\s*, dimension$/ }).hover()
        const dimension = page.getByRole('dialog', { name: 'Market' })
        await expect(dimension).toContainText('A dimension')
        await dimension.getByRole('button', { name: 'Open the definition' }).click()
        await expect(page).toHaveURL(/dock=def\.Market/)
        await expect(pane(page).getByRole('heading', { name: 'Market' })).toBeVisible()
      })
  })
