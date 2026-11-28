import { expect, go, openRow, test } from './go.ts'

// J86, families of metrics (FR-142): a dbt model with a metric per currency and channel, which a
// read found as twenty families (the mock's ?demo=families), dbt the one definitions tool on. Definitions lists one entry per family and
// never a variant, a row at a metric row's height marked as a family by its stack alone, which says
// what tells the variants apart on hover, the same at 1440 and 390 wide; a search for a variant
// finds its family by the family's name, never the variant; the
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
      // The stack alone marks it, saying what tells its variants apart; the row says no more.
      const stack = row.getByRole('img', {
        name: 'Family of 250 metrics, by Currency and Channel',
        exact: true,
      })
      await expect(stack).toBeVisible()
      await expect(row).not.toContainText('variants')
      await expect(row).not.toContainText('by Currency')
      if (width > 1000) {
        await stack.hover()
        await expect(page.locator('[data-slot=tooltip-content]')).toHaveText(
          'Family of 250 metrics, by Currency and Channel',
        )
      }
      // No variant is ever a row.
      await expect(main.locator('tbody tr').filter({ hasText: /\(EUR\)/ })).toHaveCount(0)
      // The families come from dbt, the one definitions tool on, which reads the demo's model: the
      // line above the table says so once, and no row says it again (CON-120).
      await expect(main.getByText(/^From dbt - change them there\./)).toBeVisible()
      await expect(main.locator('tbody').getByRole('img', { name: /^From / })).toHaveCount(0)
      await search.fill('')
      await expect(page.getByText(/\(5,011 variants\)/).first()).toBeVisible()
    })

    test('keeps a family’s row at a metric row’s height and its name whole, the panel open or not, and counts what the search shows', async ({
      page,
    }) => {
      await go(page, '/definitions?demo=families')
      const main = page.getByRole('main')
      const search = main.getByPlaceholder('Search definitions')
      const height = async (name: string) => {
        const box = await main
          .getByRole('button', { name, exact: true })
          .locator('xpath=ancestor::tr')
          .boundingBox()
        return box!.height
      }
      await search.fill('net revenue')
      const metric = await height('Net revenue')
      await search.fill('accrued')
      const name = main.getByRole('button', {
        name: 'Accrued share front loaded, family of 2 variants',
        exact: true,
      })
      // The row is a metric's, and the name is never cut to tell it from another (F6).
      const whole = async () => {
        expect(await height('Accrued share front loaded, family of 2 variants')).toBe(metric)
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
      await search.fill('partner payouts')
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
      // A closed row says how many, and what tells them apart; past ten, opened, a table.
      await expect(
        main.getByRole('button', { name: 'Variants', exact: true }),
      ).toHaveAccessibleDescription('250 - by Currency and Channel')
      await openRow(page, 'Variants')
      await expect(main).toContainText('Its 250 variants differ only by Currency and Channel.')
      const variants = main.getByRole('region', { name: 'Variants' })
      await expect(variants.locator('tbody tr').first()).toContainText('Revenue (EUR) web')
      await variants.getByRole('button', { name: 'Currency: any' }).click()
      await page.getByRole('menuitemradio', { name: 'EUR' }).click()
      await expect(variants).toContainText('5 of 250')
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
  // Its stack says how, as its quick view does.
  const stack = rows.getByRole('img', {
    name: 'Family of 2 metrics, by Currency. USD is converted from EUR',
    exact: true,
  })
  await stack.hover()
  await expect(page.locator('[data-slot=tooltip-content]')).toHaveText(
    'Family of 2 metrics, by CurrencyUSD is converted from EUR',
  )
  await expect(main.locator('tbody')).not.toContainText('(USD)')
  // Its page reads the currency as the values it holds, and lists the two, each saying how.
  await go(page, '/definitions/Accrued%20share%20front%20loaded?demo=families')
  const own = page.getByRole('main')
  await expect(own).toContainText(
    "The share of a contract's value booked in its first three months, in EUR or USD.",
  )
  await openRow(page, 'Variants')
  await expect(own.getByRole('list', { name: 'Variants' }).getByRole('listitem')).toHaveText([
    "EURThe share of a contract's value booked in its first three months, in euros.",
    "USDConverted from EUR by the column exchange_rate_usd.The EUR amount multiplied by the row's exchange rate.",
  ])
})

test('the Names card offers a family as one name, and one press publishes it', async ({ page }) => {
  await go(page, '/inbox?demo=families')
  const main = page.getByRole('main')
  await main
    .getByText(/families and \d+ names from dbt/)
    .first()
    .click()
  const ready = main.getByRole('region', { name: /^Ready/ })
  const family = ready.getByRole('listitem').filter({ hasText: /^Packaging costs/ })
  await expect(family).toContainText('8 variants by Currency and Channel')
  // Its variants are never names of their own on the card.
  await expect(main).not.toContainText('Packaging costs (EUR) web')
  await family.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByText('Packaging costs is published')).toBeVisible()
  await expect(ready.getByRole('listitem').filter({ hasText: /^Packaging costs/ })).toHaveCount(0)
})
