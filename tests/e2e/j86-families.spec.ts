import { expect, go, test } from './go.ts'

// J86, families of metrics (FR-142): a dbt model with a metric per currency and channel, which a
// read found as twenty families (the mock's ?demo=families), beside the demo's Cube. Definitions lists one entry per family and
// never a variant, marked as a family a person can read without opening it, the same at 1440 and
// 390 wide; a search for a variant finds its family by the family's name, never the variant; the
// family's own page is the one place its variants are listed, by Currency and Channel. On the Names
// card a family is one name, and one press publishes it with its variants.

const widths = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
] as const

for (const { name, width, height } of widths) {
  test.describe(name, () => {
    test.use({ viewport: { width, height } })

    test('lists one entry per family, marked as a family, and no variant', async ({ page }) => {
      await go(page, '/definitions?demo=families')
      const main = page.getByRole('main')
      const search = main.getByPlaceholder('Search definitions')
      await search.fill('revenue')
      // The family's name, read as a family: what a screen reader says of its row.
      const revenue = main.getByRole('button', {
        name: 'Revenue, family of 250 variants',
        exact: true,
      })
      await expect(revenue).toBeVisible()
      const row = revenue.locator('xpath=ancestor::tr')
      await expect(row.getByRole('img', { name: 'Family of metrics' })).toBeVisible()
      await expect(row.getByText('Family · 250 variants', { exact: true })).toBeVisible()
      await expect(row).toContainText('by Currency and Channel')
      // No variant is ever a row.
      await expect(main.locator('tbody tr').filter({ hasText: /\(EUR\)/ })).toHaveCount(0)
      // The families come from dbt, beside the demo's Cube: each row says which tool (F8).
      await expect(main.getByText(/^From Cube and dbt - change them there\./)).toBeVisible()
      await expect(row.getByRole('img', { name: 'From dbt' })).toBeVisible()
      await expect(
        main
          .locator('tbody tr')
          .filter({ hasText: 'Customer lifetime value' })
          .getByRole('img', { name: 'From Cube' }),
      ).toBeVisible()
      await search.fill('')
      await expect(page.getByText(/\(5,002 variants\)/).first()).toBeVisible()
    })

    test('gives a family’s name a line of its own, the panel open or not, and counts what the search shows', async ({
      page,
    }) => {
      await go(page, '/definitions?demo=families')
      const main = page.getByRole('main')
      await main.getByPlaceholder('Search definitions').fill('accrued')
      const name = main.getByRole('button', {
        name: 'Accrued share front loaded, family of 2 variants',
        exact: true,
      })
      const chip = name
        .locator('xpath=ancestor::tr')
        .getByText('Family · 2 variants', { exact: true })
      // The chip sits under the name, and the name is never cut to tell it from another (F6).
      const whole = async () => {
        const [at, under] = await Promise.all([name.boundingBox(), chip.boundingBox()])
        expect(under!.y).toBeGreaterThanOrEqual(at!.y + at!.height - 1)
        expect(
          await name.evaluate((el) => {
            const shown = el.firstElementChild as HTMLElement
            return shown.scrollWidth <= shown.clientWidth + 1
          }),
        ).toBe(true)
      }
      await whole()
      if (width > 1000) {
        await name.click()
        await expect(
          page.getByRole('heading', { name: 'Accrued share front loaded' }),
        ).toBeVisible()
        await whole()
      }
      // The coverage line counts the rows the search shows, not every definition (F9).
      await expect(main.getByText('1 of 1 have no context yet.')).toBeVisible()
    })

    test('finds a family by a variant’s words, and never names the variant', async ({ page }) => {
      await go(page, '/definitions?demo=families')
      const main = page.getByRole('main')
      await main.getByPlaceholder('Search definitions').fill('revenue eur web')
      const rows = main.locator('tbody tr:has([data-row-open])')
      await expect(rows.first()).toContainText('Revenue')
      await expect(rows.first().getByRole('button', { name: /^Revenue, family of/ })).toBeVisible()
      // At most how many variants match, to say why the family is there: never which.
      await expect(rows.first()).toContainText('1 variant matches')
      await expect(main.locator('tbody')).not.toContainText('Revenue (EUR) web')
      await expect(main.locator('tbody')).not.toContainText('(EUR)')
    })

    test('lists the variants on the family’s own page, by Currency and Channel', async ({
      page,
    }) => {
      await go(page, '/definitions/Revenue?demo=families')
      const main = page.getByRole('main')
      await expect(main.getByRole('heading', { name: 'Revenue', level: 2 })).toBeVisible()
      await expect(main.getByText('Family of metrics')).toBeVisible()
      const variants = main.getByRole('region', { name: /^Variants/ })
      await expect(variants).toContainText('250')
      await expect(variants.locator('tbody tr').first()).toContainText('Revenue (EUR) web')
      await variants.getByRole('button', { name: 'Currency: any' }).click()
      await page.getByRole('menuitemradio', { name: 'EUR' }).click()
      await expect(variants.getByRole('heading')).toContainText('5 of 250')
      await variants.getByRole('button', { name: 'Channel: any' }).click()
      await page.getByRole('menuitemradio', { name: 'web' }).click()
      await expect(variants.locator('tbody tr')).toHaveCount(1)
      await expect(variants.locator('tbody tr')).toContainText('Revenue (EUR) web')
    })
  })
}

test('groups a metric in EUR with one in USD worked out from it, and says how', async ({
  page,
}) => {
  await go(page, '/definitions?demo=families')
  const main = page.getByRole('main')
  await main.getByPlaceholder('Search definitions').fill('accrued share usd')
  const rows = main.locator('tbody tr:has([data-row-open])')
  await expect(rows).toHaveCount(1)
  await expect(
    rows.getByRole('button', { name: 'Accrued share front loaded, family of 2 variants' }),
  ).toBeVisible()
  await expect(rows).toContainText('by Currency')
  await expect(main.locator('tbody')).not.toContainText('(USD)')
  await go(page, '/definitions/Accrued%20share%20front%20loaded?demo=families')
  await expect(page.getByRole('main')).toContainText(
    "Accrued share front loaded (USD): The EUR amount multiplied by the row's exchange rate.",
  )
})

test('the Names card offers a family as one name, and one press publishes it', async ({ page }) => {
  await go(page, '/inbox?demo=families')
  const main = page.getByRole('main')
  await main
    .getByText(/new metrics and dimensions from dbt/)
    .first()
    .click()
  const ready = main.getByRole('region', { name: 'Ready to publish' })
  const family = ready.getByRole('listitem').filter({ hasText: 'Packaging costs' })
  await expect(family).toContainText('Family · 8 variants by Currency and Channel')
  // Its variants are never names of their own on the card.
  await expect(main).not.toContainText('Packaging costs (EUR) web')
  await family.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByText('Packaging costs is published')).toBeVisible()
  await expect(ready.getByRole('listitem').filter({ hasText: 'Packaging costs' })).toHaveCount(0)
})
