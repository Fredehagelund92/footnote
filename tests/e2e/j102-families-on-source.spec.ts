import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, go, moveTo, test } from './go.ts'

// J102, families where an admin connects a source (FR-142, D1, D5, D6): on the mock's
// ?demo=families dbt project, connected again as new, Test connection leads with the families the first read would find,
// counted by how each is found, a rate its own kind, and says they are confirmed in the Inbox,
// under Families, with the advice on dimensions as one line. Once connected, the source's page
// counts its families, lists each with how it stands, and Review families opens the Names card on
// its Families part, apart from its Names. A family opened from the card closes on Escape back to
// the card. At 390 and 1440 wide, in light and dark, nothing is wider than the screen and axe
// finds nothing.

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

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

/**
 * dbt's Connect step, with the shop of ?demo=families, tested. The shop reads dbt already, the one
 * definitions tool on, so it is disconnected first and connected again as a new source.
 */
async function testDbt(page: Page) {
  await go(page, '/inbox?demo=families')
  await expect(page.getByText(/families and \d+ names from dbt/).first()).toBeVisible()
  await moveTo(page, '/settings/integrations/dbt-metricflow')
  await page.getByRole('button', { name: 'More for dbt' }).click()
  await page.getByRole('menuitem', { name: 'Disconnect' }).click()
  await page
    .getByRole('dialog', { name: 'Disconnect dbt?' })
    .getByRole('button', { name: 'Disconnect' })
    .click()
  await expect(page).toHaveURL(/\/settings\/integrations$/)
  await moveTo(page, '/settings/integrations/dbt-metricflow/connect?step=2')
  await page.getByLabel('File address').fill('https://files.example.com/dbt/semantic_manifest.json')
  await button(page, 'Test connection').click()
  await expect(page.getByText('Testing the connection…')).toBeHidden({ timeout: 30_000 })
}

for (const { name, width, height } of widths) {
  for (const theme of themes) {
    test.describe(`${name}, ${theme}`, () => {
      test.use({ viewport: { width, height }, colorScheme: theme })

      test('Test connection leads with the families, and where they are confirmed', async ({
        page,
      }) => {
        await testDbt(page)
        const families = page.getByRole('region', { name: /of them are variants/ })
        await expect(families.getByRole('heading')).toHaveText(
          '16 of them are variants: 5 families',
        )
        await expect(
          families
            .getByRole('list', { name: 'Families by how they were found' })
            .getByRole('listitem'),
        ).toHaveText([
          /^1declared in dbt$/,
          /^1from the calculation$/,
          /^2from a rate$/,
          /^1look alike, never a family until someone says so$/,
        ])
        await expect(families).toContainText(
          'After the first read, an owner of its domain, or an admin, confirms each one in the Inbox, under Families. Nothing is published before.',
        )
        await expect(families).toContainText(
          'A currency or a channel kept as a dimension needs no family at all.',
        )
        // The families come first, before the read's warnings, and agents are never said to
        // find a variant only by its exact name.
        await expect(page.getByText(/exact name/)).toHaveCount(0)
        await expect(page.getByText('Many metrics look like variants of a few')).toHaveCount(0)
        expect(await sideways(page)).toBe(0)
        expect(await axe(page)).toEqual([])
      })

      test("the source's page counts its families, and Review families opens them", async ({
        page,
      }) => {
        await testDbt(page)
        await button(page, 'Continue').click()
        await button(page, 'Continue').click()
        while (await button(page, 'Choose').count()) {
          await button(page, 'Choose').first().click()
          await page.getByRole('menuitemradio', { name: 'Sales' }).click()
          await page.keyboard.press('Escape')
          await expect(page.getByRole('menu')).toHaveCount(0)
        }
        await button(page, 'Continue').click()
        await button(page, 'Add dbt').click()
        await expect(page).toHaveURL(/\/settings\/integrations\/dbt-metricflow$/)

        // The page's sections are hairline cells, named by their heading.
        const block = page
          .locator('section')
          .filter({ has: page.getByRole('heading', { name: 'Families', exact: true }) })
          .last()
        await expect(
          block.getByRole('list', { name: 'Families by how they were found' }),
        ).toBeVisible()
        await expect(block).toContainText(
          '5 families wait in the Inbox for an owner of Sales. Nothing is published before. 1 looks alike; 4 are ready.',
        )
        // Each family is a row: how it was found, its variants and how it stands.
        const rows = block.getByRole('table')
        await expect(rows).toContainText('Published')
        await expect(rows).toContainText('Waits in the Inbox')
        await expect(rows).toContainText('Look alike: waits for a yes')
        await expect(block.getByRole('button', { name: 'See them in Definitions' })).toBeVisible()
        // The first read is read, not added: nothing is published until an owner says so.
        await expect(page.getByText(/definitions added/)).toHaveCount(0)
        expect(await sideways(page)).toBe(0)
        expect(await axe(page)).toEqual([])

        await block.getByRole('button', { name: 'Review families' }).click()
        await expect(page).toHaveURL(/\/inbox\?.*card=names(?::|%3A)waiting/)
        await expect(page).toHaveURL(/show=families/)
        const main = page.getByRole('main')
        await expect(main.getByRole('radio', { name: /^Families/ })).toBeChecked()
        await expect(main.getByRole('region', { name: /^Look alike/ })).toContainText(
          'Shipping fee (EUR), Shipping fee (USD)',
        )
        await expect(button(page, 'Publish 4 families')).toBeVisible()
        expect(await sideways(page)).toBe(0)
        expect(await axe(page)).toEqual([])

        // Names holds the single metrics and dimensions, published apart from the families.
        await main.getByRole('radio', { name: /^Names/ }).click()
        await expect(page).toHaveURL(/show=names/)
        await expect(main.getByRole('region', { name: /^Look at these first/ })).toContainText(
          'Basket value',
        )
        await expect(main).not.toContainText('Gift wrap')
        await expect(page.getByRole('button', { name: /^Publish \d+ names/ })).toBeVisible()
        expect(await axe(page)).toEqual([])
      })
    })
  }
}

test('a family opened from the Names card closes on Escape back to the card', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await go(page, '/inbox?demo=families')
  const main = page.getByRole('main')
  await main
    .getByText(/families and \d+ names from dbt/)
    .first()
    .click()
  await main.getByRole('button', { name: 'Look at the family Gift wrap' }).click()
  const dock = page.getByRole('region', { name: 'Suggested family' })
  await expect(dock).toBeVisible()
  // Opened from its row, the panel takes the focus, so Escape is the panel's.
  await expect
    .poll(() => dock.evaluate((panel) => panel.contains(document.activeElement)))
    .toBe(true)
  await page.keyboard.press('Escape')
  await expect(dock).toHaveCount(0)
  await expect(page).toHaveURL(/card=names(?::|%3A)waiting/)
  await expect(main.getByRole('radio', { name: /^Families/ })).toBeVisible()
  await expect(main.getByRole('button', { name: 'Look at the family Gift wrap' })).toBeFocused()
})
