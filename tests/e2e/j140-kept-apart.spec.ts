import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, go, moveTo, signInAs, test } from './go.ts'

// J140, metrics kept apart are made one family (FR-142, D1, D3): on the mock's ?demo=families, Jon
// Abara kept Tip amount (EUR) and Tip amount (GBP) separate when he published them. Ines Duarte, a
// member, finds them under Kept apart in Definitions' Families view, with who decides and no way
// to change it. Sofia Brandt, an owner of Sales, makes them one family there: Tip amount is a
// family of 2 metrics, found by its names, and its History names her, not the tool. A family
// published from the Names card says who published it, and Delete on it says to split it on its
// page. The source's page in Integrations lists what was kept apart. At 390 and 1440 wide, in light
// and dark, nothing is wider than the screen and axe finds nothing.

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

/** Definitions' Families view, as a person picks it: in the bar, or its menu on a phone. */
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

const kept = (page: Page) =>
  page.getByRole('region', { name: 'Kept apart' }).getByRole('listitem').filter({
    hasText: 'Tip amount (EUR) and Tip amount (GBP)',
  })

for (const { name, width, height } of widths) {
  for (const theme of themes) {
    test.describe(`${name}, ${theme}`, () => {
      test.use({ viewport: { width, height }, colorScheme: theme })

      test('a member reads what was kept apart and who decides, with no way to change it', async ({
        page,
      }) => {
        await as(page, 'Ines Duarte')
        await families(page)
        const row = kept(page)
        await expect(row).toContainText(
          'Tip amount (EUR) and Tip amount (GBP), kept separate by Jon Abara on 20 Nov 2026, when published.',
        )
        await expect(row).toContainText('Owners of Sales decide')
        await expect(row.getByRole('button')).toHaveCount(0)
        expect(await sideways(page)).toBe(0)
        expect(await axe(page)).toEqual([])
      })

      test('an owner of Sales makes them one family, and its History names her', async ({
        page,
      }) => {
        await as(page, 'Sofia Brandt')
        await families(page)
        await expect(page.getByRole('row', { name: /Tip amount/ })).toHaveCount(0)
        await kept(page).getByRole('button', { name: 'Make them one family' }).click()
        await expect(toasts(page)).toContainText('Tip amount is one family')
        await expect(kept(page)).toHaveCount(0)
        // One family in the view now, found by its names, of the two metrics.
        const row = page.getByRole('row', { name: /Tip amount/ })
        await expect(row).toContainText('Look alike, published as one')
        expect(await sideways(page)).toBe(0)
        expect(await axe(page)).toEqual([])

        await moveTo(page, '/definitions/Tip%20amount')
        await expect(
          page.getByRole('heading', { level: 2, name: 'Tip amount', exact: true }),
        ).toBeVisible()
        await expect(page.getByText('Family of metrics')).toBeVisible()
        await expect(
          page.getByText(/^1 change - last edited by Sofia Brandt, today$/),
        ).toBeVisible()
        await expect(page.getByText(/last edited by dbt/)).toHaveCount(0)
        expect(await sideways(page)).toBe(0)
        expect(await axe(page)).toEqual([])
      })

      test('a family published from the Names card names who did it, and is split, not deleted', async ({
        page,
      }) => {
        await as(page, 'Sofia Brandt')
        await moveTo(page, '/definitions/Partner%20fees')
        await expect(
          page.getByRole('heading', { level: 2, name: 'Partner fees', exact: true }),
        ).toBeVisible()
        await expect(page.getByText(/^1 change - last edited by Ravi Kapoor, /)).toBeVisible()
        await expect(page.getByText(/last edited by dbt/)).toHaveCount(0)

        // Delete on it says what to do instead: nothing in dbt is this family (S5). A list is
        // selected where it has room: a phone's has no boxes to tick.
        if (width > 390) {
          await moveTo(page, '/definitions?q=Partner%20fees')
          await page.getByRole('checkbox', { name: /^Select Partner fees/ }).click()
          await page.keyboard.press('Delete')
          const refusal =
            "A family isn't deleted: split it on its page, and each of its metrics stays."
          await expect(
            page
              .getByRole('region', { name: 'Selected definitions' })
              .getByRole('button', { name: /^Delete/ }),
          ).toHaveAccessibleDescription(refusal)
          await expect(page.getByText(refusal).first()).toBeVisible()
          await expect(page.getByRole('dialog')).toHaveCount(0)
          await expect(page.getByText(/change them in dbt/)).toHaveCount(0)
        }
        expect(await sideways(page)).toBe(0)
        expect(await axe(page)).toEqual([])
      })

      test("the source's page lists what was kept apart", async ({ page }) => {
        await as(page, 'Jon Abara')
        await moveTo(page, '/settings/integrations/dbt-metricflow')
        // On a phone a row is a block of a list (J137, P16).
        const row =
          name === '390'
            ? page
                .getByRole('listitem')
                .filter({ hasText: 'Kept separate' })
                .filter({ has: page.getByRole('link', { name: 'Tip amount' }) })
                .last()
            : page.getByRole('row', { name: /Tip amount/ })
        await expect(row).toContainText('2 metrics')
        await expect(row).toContainText('Kept separate')
        await expect(row.getByRole('link', { name: 'Tip amount' })).toHaveAttribute(
          'href',
          '/definitions?show=families',
        )
        expect(await sideways(page)).toBe(0)
        expect(await axe(page)).toEqual([])
      })
    })
  }
}
