import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J93, a family's quick view, meaning first (FR-142, the captain's panel A, F3, F4): on the mock's
// ?demo=families Revenue's quick view leads with what it means, then the values its variants hold,
// with the usual variant marked, which an owner picks; who owns it; and the context about the
// family apart from the context about one variant alone. A pair one rate converts marks its base
// and says how the other is converted, in one line. A search that finds a family by a variant
// names that variant in the quick view, and the Definitions row reads the family's meaning. On the
// Names card a suggested family opens the same panel, with Keep them separate. The same at 1440
// and 390 wide, where nothing scrolls sideways.

const widths = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
] as const

const sideways = (page: Page) =>
  page.evaluate(() => document.scrollingElement!.scrollWidth - document.documentElement.clientWidth)

for (const { name, width, height } of widths) {
  test.describe(name, () => {
    test.use({ viewport: { width, height } })

    test('leads with the meaning, marks the usual variant and an owner picks another', async ({
      page,
    }) => {
      await go(page, '/definitions?demo=families&dock=def.Revenue')
      const dock = page.getByRole('region', { name: 'Definition' })
      await expect(dock).toContainText('Family of 250 metrics, by Currency and Channel')
      await expect(dock).toContainText(
        'Money taken for paid orders in Currency via Channel, after discounts and before tax.',
      )
      const values = dock.getByRole('region', { name: 'Varies by' })
      await expect(values).toContainText('EUR usual')
      await expect(values).toContainText('web usual')
      await expect(values).toContainText(
        'Ask uses EUR · web when a question names no currency or channel.',
      )
      await values.getByRole('button', { name: 'Show 42 more values of Currency' }).click()
      await expect(values).toContainText('KZT')
      await expect(dock).toContainText('Owned by Jon Abara and Sofia Brandt')
      const context = dock.getByRole('region', { name: 'Context' })
      await expect(context).toContainText('2 items about Revenue, for all 250 variants')
      await expect(context).toContainText('2 items about Revenue (GBP) store alone')
      await expect(context).toContainText('2 items about Revenue (USD) app alone')
      expect(await sideways(page)).toBe(0)

      await values.getByRole('button', { name: 'Change the usual variant of Revenue' }).click()
      const pick = page.getByRole('dialog', { name: 'The usual Revenue' })
      await pick.getByRole('combobox', { name: 'Variants' }).fill('gbp store')
      await pick.getByRole('option', { name: 'Revenue (GBP) store' }).click()
      await pick.getByRole('button', { name: 'Save' }).click()
      await expect(pick).toHaveCount(0)
      await expect(values).toContainText(
        'Ask uses GBP · store when a question names no currency or channel.',
      )
      await expect(values).toContainText('GBP usual')
    })

    test('a pair one rate converts marks its base and says how the other is converted', async ({
      page,
    }) => {
      await go(page, '/definitions?demo=families&dock=def.Accrued%20share%20front%20loaded')
      const dock = page.getByRole('region', { name: 'Definition' })
      await expect(dock).toContainText(
        "The share of a contract's value booked in its first three months, in euros.",
      )
      const values = dock.getByRole('region', { name: 'Varies by' })
      await expect(values).toContainText('EUR base')
      await expect(values).toContainText(
        'USD is converted from EUR by the column exchange_rate_usd.',
      )
      // The USD variant's words say how it is converted: it says nothing else.
      await expect(dock).not.toContainText('says something else')
      expect(await sideways(page)).toBe(0)
    })

    test('names the variant a search found it by, and compares those that say otherwise', async ({
      page,
    }) => {
      await go(page, '/definitions?demo=families')
      const main = page.getByRole('main')
      await main.getByPlaceholder('Search definitions').fill('revenue usd app')
      const row = main.getByRole('row').filter({ hasText: /^Revenue/ })
      await expect(row).toContainText('1 variant matches')
      // The row reads the family's meaning, where the Meaning column fits.
      if (width > 1000)
        await expect(row).toContainText('Money taken for paid orders in each currency via each c')
      await row.getByRole('button', { name: /^Revenue, family of 250 variants/ }).click()
      const dock = page.getByRole('region', { name: 'Definition' })
      await expect(dock).toContainText('Found by its variant Revenue (USD) app')
      await expect(dock).toContainText('Same words as the family, with USD and app.')

      await dock.getByRole('button', { name: 'Compare' }).click()
      await expect(page).toHaveURL(/\/definitions\/Revenue\?variants=other/)
      const variants = page.getByRole('main').getByRole('region', { name: /^Variants/ })
      await expect(
        variants.getByRole('button', { name: 'Say something else: 3', pressed: true }),
      ).toBeVisible()
      await expect(variants.getByRole('row')).toHaveCount(4)
      await expect(variants).toContainText('before marketplace fees and before tax.')
      expect(await sideways(page)).toBe(0)
    })

    test('a suggested family opens the same panel from the Names card', async ({ page }) => {
      await go(page, '/inbox?demo=families')
      const main = page.getByRole('main')
      await main
        .getByText(/new metrics and dimensions from dbt/)
        .first()
        .click()
      await main.getByRole('button', { name: 'Look at the family Packaging costs' }).click()
      const dock = page.getByRole('region', { name: 'Suggested family' })
      await expect(dock).toContainText('Suggested family of 8 metrics, by Currency and Channel')
      await expect(dock).toContainText(
        'What boxes, fill and labels cost for orders in Currency via Channel.',
      )
      await expect(dock).toContainText('Common words of all 8 variants')
      await expect(dock).toContainText(
        'dbt has 8 metrics worked out the same way apart from Currency and Channel.',
      )
      await expect(dock.getByRole('region', { name: 'Varies by' })).toContainText('EUR')
      expect(await sideways(page)).toBe(0)

      await dock.getByRole('button', { name: 'Keep them separate' }).click()
      await expect(page.getByText('8 metrics are published separately')).toBeVisible()
      await expect(dock).toHaveCount(0)
    })
  })
}
