import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, go, moveTo, openRow, signInAs, test } from './go.ts'

// J105, an admin reviews the families in Definitions (FR-142, D1, D3): Ravi Kapoor, an admin, opens
// the Families tab on the mock's ?demo=families and reads each family with how it was found, how
// many variants it has and by what, what it means or that it means nothing yet, and what needs a
// look; a row opens the family's quick view. From the page of a family whose names look alike he
// splits it, and Undo in the toast makes it one family again, its page as it was. At 390 and 1440
// wide, in light and dark, nothing is wider than the screen and axe finds nothing.

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

const toasts = (page: Page) => page.getByRole('region', { name: /^Notifications/ })

/** The families of ?demo=families, read on a fresh load, then someone else, signed in where the sidebar shows. */
async function as(page: Page, person: string) {
  const size = page.viewportSize()!
  await page.setViewportSize({ width: 1440, height: 900 })
  await go(page, '/definitions?demo=families')
  await expect(page.getByText(/^From dbt - change them there/)).toBeVisible()
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

      test('the Families tab says how each was found, what it means and what needs a look', async ({
        page,
      }) => {
        await as(page, 'Ravi Kapoor')
        await families(page)
        const declared = page.getByRole('row', { name: /Active buyers/ })
        await expect(declared).toContainText('Declared in dbt')
        await expect(declared).toContainText('3 by Sales line')
        const payouts = page.getByRole('row', { name: /Partner payouts/ })
        await expect(payouts).toContainText('Look alike, published as one')
        await expect(page.getByRole('row', { name: /Partner forecasts/ })).toContainText(
          'No meaning yet',
        )
        await expect(page.getByRole('row', { name: /Accrued share front loaded/ })).toContainText(
          'From a rate',
        )
        expect(await sideways(page)).toBe(0)
        expect(await axe(page)).toEqual([])
        await payouts.getByRole('button', { name: 'Partner payouts' }).click()
        const dock = page.getByRole('region', { name: 'Definition' })
        await expect(dock).toContainText('Family of 2 metrics, by Currency')
      })

      test('an admin splits a family whose names look alike, and Undo joins it again', async ({
        page,
      }) => {
        await as(page, 'Ravi Kapoor')
        await moveTo(page, '/definitions/Partner%20payouts')
        await openRow(page, 'How it is built')
        await expect(page.getByRole('region', { name: 'How it is built' })).toContainText(
          'Its names look alike, and an owner published them as one family.',
        )
        await page.getByRole('button', { name: 'Split into 2 metrics' }).click()
        const dialog = page.getByRole('dialog', { name: 'Split Partner payouts into 2 metrics?' })
        await expect(dialog).toContainText(
          'No context item is about Partner payouts itself, so none needs a check.',
        )
        await dialog.getByRole('button', { name: 'Split into 2 metrics' }).click()
        await expect(page).toHaveURL(/\/definitions\?show=families$/)
        await expect(page.getByRole('region', { name: 'Kept apart' })).toContainText(
          'Partner payouts (EUR) and Partner payouts (USD), split by you on',
        )
        // The toast's time stands still while the pointer is over it, so the checks below, slow
        // on a busy runner, don't take Undo away.
        await toasts(page).getByRole('button', { name: 'Undo' }).hover()
        expect(await sideways(page)).toBe(0)
        expect(await axe(page)).toEqual([])
        await toasts(page).getByRole('button', { name: 'Undo' }).click()
        await expect(toasts(page)).toContainText('Partner payouts is one family again')
        await expect(page).toHaveURL(/\/definitions\/Partner%20payouts$/)
        await openRow(page, 'How it is built')
        await expect(page.getByRole('button', { name: 'Split into 2 metrics' })).toBeVisible()
      })
    })
  }
}
