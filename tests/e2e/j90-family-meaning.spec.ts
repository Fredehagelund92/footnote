import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J90, what a family means (FR-142, M1): on the mock's ?demo=families, Revenue's quick view reads
// the words most of its 250 variants share, each value as what it stands for, says where those
// words come from and quotes what the three variants that say something else say. An owner chooses one
// variant's words, found by typing, then writes the family's own; each choice shows at once and
// History keeps it. A pair one rate converts reads the base variant's words. The same at 1440 and
// 390 wide, where nothing scrolls sideways.

const widths = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
] as const

const sideways = (page: Page) =>
  page.evaluate(() => document.scrollingElement!.scrollWidth - document.documentElement.clientWidth)

for (const { name, width, height } of widths) {
  test.describe(name, () => {
    test.use({ viewport: { width, height } })

    test('reads the common words, and an owner chooses a variant’s words, then writes its own', async ({
      page,
    }) => {
      await go(page, '/definitions?demo=families&dock=def.Revenue')
      const dock = page.getByRole('region', { name: 'Definition' })
      await expect(dock).toContainText(
        'Money taken for paid orders in Currency via Channel, after discounts and before tax.',
      )
      await expect(dock).toContainText('Common words of 247 of 250 variants, chosen automatically')
      // The words they say otherwise, quoted: the quick view compares them on the family's page.
      await expect(dock.getByRole('note')).toContainText(
        '3 variants say something else: “before marketplace fees”.',
      )
      expect(await sideways(page)).toBe(0)

      await dock.getByRole('button', { name: 'Change what Revenue means' }).click()
      const choose = page.getByRole('dialog', { name: 'What Revenue means' })
      await choose.getByRole('radio', { name: /One variant’s words/ }).click()
      await choose.getByRole('combobox', { name: 'Variants' }).fill('brl marketplace')
      await choose.getByRole('option', { name: 'Revenue (BRL) marketplace' }).click()
      await expect(choose).toContainText('before marketplace fees and before tax.')
      await choose.getByRole('button', { name: 'Save' }).click()
      await expect(choose).toHaveCount(0)
      await expect(dock).toContainText(
        'Money taken for paid orders in BRL via marketplace, before marketplace fees and before tax.',
      )
      await expect(dock).toContainText('Words of Revenue (BRL) marketplace, chosen by')
      await expect(dock.getByRole('note')).toContainText('247 variants say something else')

      await dock.getByRole('button', { name: 'Change what Revenue means' }).click()
      await choose.getByRole('radio', { name: /Words written for the family/ }).click()
      await choose.getByRole('textbox', { name: 'What it means' }).fill('Money taken for orders.')
      await choose.getByRole('button', { name: 'Save' }).click()
      await expect(dock).toContainText('Money taken for orders.')
      await expect(dock).toContainText('Written for the family by')

      // History keeps both choices, after its tool's reads.
      await go(page, '/definitions/Revenue')
      const main = page.getByRole('main')
      await main.getByRole('button', { name: /changes - last edited by Jon Abara/ }).click()
      await expect(main.getByRole('button', { name: /Jon edited wording/ })).toHaveCount(2)
    })

    test('a pair one rate converts reads the base variant’s words', async ({ page }) => {
      await go(page, '/definitions/Accrued%20share%20front%20loaded?demo=families')
      const main = page.getByRole('main')
      await expect(main).toContainText(
        "The share of a contract's value booked in its first three months, in euros.",
      )
      await expect(main).toContainText(
        'Words of Accrued share front loaded (EUR), the variant the others are converted from',
      )
      // The USD variant's own words say how it is converted, which the page shows: nothing else.
      await expect(main).not.toContainText('says something else')
      expect(await sideways(page)).toBe(0)
    })
  })
}
