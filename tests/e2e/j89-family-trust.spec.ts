import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J89, families in the order of trust (FR-142, D1, D2): on the mock's ?demo=families Names card a
// family its tool declares and one found from the calculation are each one name, marked how they
// were found, ready to publish; metrics whose names alone look alike wait apart, under Look alike,
// for the owner to publish as one family or apart. A family's page says how it was found and which
// variant is converted from which, by the column. The same at 1440 and 390 wide, where nothing
// scrolls sideways.

const widths = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
] as const

const sideways = (page: Page) =>
  page.evaluate(() => document.scrollingElement!.scrollWidth - document.documentElement.clientWidth)

for (const { name, width, height } of widths) {
  test.describe(name, () => {
    test.use({ viewport: { width, height } })

    test('marks how each family was found, and holds names that only look alike', async ({
      page,
    }) => {
      await go(page, '/inbox?demo=families')
      const main = page.getByRole('main')
      await main
        .getByText(/new metrics and dimensions from dbt/)
        .first()
        .click()
      const ready = main.getByRole('region', { name: 'Ready to publish' })
      await expect(ready.getByRole('listitem').filter({ hasText: 'Gift wrap' })).toContainText(
        'Family · 2 variants by Sales line · declared in dbt',
      )
      await expect(ready.getByRole('listitem').filter({ hasText: /^Accrued share/ })).toContainText(
        'Family · 2 variants by Currency · found from the calculation in dbt',
      )
      // Names alone never make a family: Publish all leaves them where they are.
      const alike = main.getByRole('region', { name: 'Look alike' })
      const fee = alike.getByRole('listitem')
      await expect(fee).toHaveCount(1)
      await expect(fee).toContainText('Shipping fee (EUR), Shipping fee (USD)')
      await expect(fee).toContainText('Their names differ only by EUR and USD.')
      await expect(ready).not.toContainText('Shipping fee')
      expect(await sideways(page)).toBe(0)

      await fee.getByRole('button', { name: 'Leave out' }).click()
      await expect(alike).toHaveCount(0)
      await main.getByText('Left out').click()
      const left = main.getByRole('listitem').filter({ hasText: 'Shipping fee (EUR)' })
      await expect(left.getByRole('button', { name: 'Publish as a family' })).toBeVisible()
      await expect(left.getByRole('button', { name: 'Leave out' })).toHaveCount(0)
      await left.getByRole('button', { name: 'Publish apart' }).click()
      await expect(page.getByText('2 metrics are published apart')).toBeVisible()
    })

    test('a family’s page says how it was found, and which variant is converted from which', async ({
      page,
    }) => {
      await go(page, '/definitions/Accrued%20share%20front%20loaded?demo=families')
      const built = page.getByRole('main').getByRole('region', { name: 'How it is built' })
      await expect(built).toContainText(/^FamilyFound from the calculation in \w+Converted/)
      await expect(built).toContainText('ConvertedUSDfromEURby the column exchange_rate_usd')
      expect(await sideways(page)).toBe(0)
    })
  })
}
