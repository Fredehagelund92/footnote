import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J89, families in the order of trust (FR-142, D1, D2, D6): on the mock's ?demo=families Names card
// the Families part counts the families by how each was found, and groups the ready ones that way:
// one its tool declares, one found from the calculation and two found from a rate, each one name
// ready to publish. Metrics whose names alone look alike wait apart, under Look alike, for the
// owner to publish as one family or apart. A family's page says how it was found and which variant
// is converted from which, by the column. The same at 1440 and 390 wide, where nothing scrolls
// sideways.

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
        .getByText(/families and \d+ names from dbt/)
        .first()
        .click()
      await expect(main.getByRole('radio', { name: /^Families/ })).toBeChecked()
      await expect(
        main.getByRole('list', { name: 'Families by how they were found' }).getByRole('listitem'),
      ).toHaveText(['1 declared in dbt', '1 from the calculation', '2 from a rate', '1 look alike'])
      const ready = main.getByRole('region', { name: /^Ready/ })
      const declared = ready.getByRole('listitem').filter({ hasText: 'Declared in dbt' })
      await expect(declared.getByRole('listitem').filter({ hasText: 'Gift wrap' })).toContainText(
        '2 variants by Sales line',
      )
      const rate = ready.getByRole('listitem').filter({ hasText: 'From a rate' })
      await expect(rate.getByRole('listitem')).toHaveText([
        /^Accrued share2 variants by Currency/,
        /^Commission2 variants by Currency/,
      ])
      // Folded, a kind says how many and names them.
      await rate.getByRole('button', { name: /^From a rate/ }).click()
      await expect(rate.getByRole('button', { name: /^From a rate/ })).toHaveAccessibleDescription(
        '2 families by Currency: Accrued share, Commission',
      )
      await expect(rate.getByRole('listitem')).toHaveCount(0)
      // Names alone never make a family: Publish 4 families leaves them where they are.
      const alike = main.getByRole('region', { name: 'Look alike' })
      const fee = alike.getByRole('listitem')
      await expect(fee).toHaveCount(1)
      await expect(fee).toContainText('Shipping fee (EUR), Shipping fee (USD)')
      await expect(fee).toContainText('Their names differ only by EUR and USD.')
      await expect(ready).not.toContainText('Shipping fee')
      expect(await sideways(page)).toBe(0)

      await fee.getByRole('button', { name: 'Leave out' }).click()
      await expect(alike).toHaveCount(0)
      // The toast that says so sits over the card's last row on a phone: close it, as a person does.
      await page
        .getByRole('region', { name: /^Notifications/ })
        .getByRole('button', { name: 'Close' })
        .click()
      await main.getByText('Left out').click()
      const left = main.getByRole('listitem').filter({ hasText: 'Shipping fee (EUR)' })
      await expect(left.getByRole('button', { name: 'Publish as a family' })).toBeVisible()
      await expect(left.getByRole('button', { name: 'Leave out' })).toHaveCount(0)
      await left.getByRole('button', { name: 'Keep them separate' }).click()
      await expect(page.getByText('2 metrics are published separately')).toBeVisible()
    })

    test('a family’s page says how it was found, and which variant is converted from which', async ({
      page,
    }) => {
      await go(page, '/definitions/Accrued%20share%20front%20loaded?demo=families')
      const built = page.getByRole('main').getByRole('region', { name: 'How it is built' })
      await expect(built).toContainText(
        /^FamilyFound from a rate in \w+\.Split into 2 metricsConverted/,
      )
      await expect(built).toContainText('ConvertedUSDfromEURby the column exchange_rate_usd')
      expect(await sideways(page)).toBe(0)
    })
  })
}
