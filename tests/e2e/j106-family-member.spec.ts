import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, go, moveTo, signInAs, test } from './go.ts'

// J106, a member meets a family, and one that was split (FR-142, D3): on the mock's ?demo=families
// Ines Duarte, who owns no domain, reads a family's page with no Split, told who decides whether it
// is one family: the owners of its domain, by name. Once Jon Abara, an owner of Sales, splits it,
// the Families tab lists it under Split into metrics for her too, with who may make it one family
// again and no button, and her Inbox holds no card for its item. At 390 and 1440 wide, in light and
// dark, nothing is wider than the screen and axe finds nothing.

const widths = [
  { name: '390', width: 390, height: 844 },
  { name: '1440', width: 1440, height: 900 },
] as const
const themes = ['light', 'dark'] as const

const sideways = (page: Page) =>
  page.evaluate(() => document.scrollingElement!.scrollWidth - document.documentElement.clientWidth)

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return results.violations.map(
    (violation) =>
      `${violation.impact}: ${violation.id} (${violation.nodes.map((node) => node.target.join(' ')).join(', ')})`,
  )
}

/** The families of ?demo=families, read on a fresh load, then someone else, signed in where the sidebar shows. */
async function as(page: Page, person: string) {
  const size = page.viewportSize()!
  await page.setViewportSize({ width: 1440, height: 900 })
  await go(page, '/definitions?demo=families')
  await expect(page.getByText(/^From Cube and dbt/)).toBeVisible()
  if (person !== 'Jon Abara') await signInAs(page, person)
  await page.setViewportSize(size)
}

/** Definitions' Families tab, as a person picks it: in the bar, or its menu on a phone. */
async function families(page: Page) {
  await moveTo(page, '/definitions')
  const tab = page.getByRole('radio', { name: /^Families/ })
  if (await tab.isVisible()) await tab.click()
  else {
    await page.getByRole('button', { name: /^All/ }).click()
    await page.getByRole('menuitemradio', { name: /^Families/ }).click()
    // The menu stays open on a choice; its layer takes presses until it has gone.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
  }
}
for (const { name, width, height } of widths) {
  for (const theme of themes) {
    test.describe(`${name}, ${theme}`, () => {
      test.use({ viewport: { width, height }, colorScheme: theme })

      test('a member reads who decides, and sees a split without the way back', async ({
        page,
      }) => {
        await as(page, 'Ines Duarte')
        await moveTo(page, '/definitions/Accrued%20share%20front%20loaded')
        await expect(page.getByRole('region', { name: 'How it is built' })).toContainText(
          'Found from a rate in dbt. Owners of Sales decide whether it is one family: Jon Abara and Sofia Brandt.',
        )
        await expect(page.getByRole('button', { name: /^Split into/ })).toHaveCount(0)
        expect(await sideways(page)).toBe(0)
        expect(await axe(page)).toEqual([])

        // Jon, an owner of Sales and an admin, splits it.
        const size = page.viewportSize()!
        await page.setViewportSize({ width: 1440, height: 900 })
        await signInAs(page, 'Jon Abara')
        await moveTo(page, '/definitions/Accrued%20share%20front%20loaded')
        await page.getByRole('button', { name: 'Split into 2 metrics' }).click()
        await page.getByRole('dialog').getByRole('button', { name: 'Split into 2 metrics' }).click()
        await expect(page.getByRole('region', { name: 'Split into metrics' })).toBeVisible()
        await signInAs(page, 'Ines Duarte')
        await page.setViewportSize(size)

        await families(page)
        const split = page.getByRole('region', { name: 'Split into metrics' })
        await expect(split).toContainText(
          'Accrued share front loaded (EUR) and Accrued share front loaded (USD), split by Jon Abara on',
        )
        await expect(split).toContainText('Owners of Sales decide')
        await expect(split).toContainText('1 context item is still about the family')
        await expect(split.getByRole('button')).toHaveCount(0)
        expect(await sideways(page)).toBe(0)
        expect(await axe(page)).toEqual([])
        await moveTo(page, '/inbox')
        await expect(page.getByText(/Its family Accrued share front loaded was split/)).toHaveCount(
          0,
        )
      })
    })
  }
}
