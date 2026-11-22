import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J90, what a family means (FR-142, M1): on the mock's ?demo=families, Revenue's quick view reads
// the words most of its 250 variants share, each value as what it stands for, says where those
// words come from and quotes what the three variants that say something else say. An owner writes
// the family's own words, starting from what its variants say, then writes others, then has them
// worked out again; each choice shows at once and History keeps it. A pair one rate converts, and
// a pair whose USD words say they are the EUR ones at a rate, read the words of the EUR variant,
// its currency as what it stands for. One whose variants are written apart has no meaning, and so
// nothing says something else; writing its words starts from each variant's. A family whose
// metric's name holds one of its values reads each channel, and nothing says something else. The
// same at 1440 and 390 wide, where nothing scrolls sideways.

const widths = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
] as const

const sideways = (page: Page) =>
  page.evaluate(() => document.scrollingElement!.scrollWidth - document.documentElement.clientWidth)

for (const { name, width, height } of widths) {
  test.describe(name, () => {
    test.use({ viewport: { width, height } })

    test('reads the common words, and an owner writes the family’s own from what its variants say', async ({
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
      await expect(choose.getByRole('radio')).toHaveCount(2)
      await expect(choose).toContainText('The common words of 247 of 250 variants.')
      await choose.getByRole('radio', { name: /Written for the family/ }).click()
      // Each wording once, with how many more variants write it.
      const wordings = choose.getByRole('list', { name: 'Start from what its variants say' })
      await expect(wordings.getByRole('listitem')).toHaveCount(2)
      await expect(wordings.getByRole('listitem').first()).toContainText('EUR, web and 246 more')
      await expect(
        wordings.getByRole('listitem').filter({ hasText: 'before marketplace fees' }),
      ).toContainText('and 2 more')
      const words = choose.getByRole('textbox', { name: 'What it means' })
      await words.fill('')
      await wordings.getByRole('button', { name: 'Use what EUR, web says' }).click()
      await expect(words).toBeFocused()
      await expect(words).toHaveValue(
        'Money taken for paid orders in each currency via each channel, after discounts and before tax.',
      )
      await words.press('End')
      await words.pressSequentially(' Test orders left out.')
      expect(await sideways(page)).toBe(0)
      await choose.getByRole('button', { name: 'Save' }).click()
      await expect(choose).toHaveCount(0)
      await expect(dock).toContainText(
        'Money taken for paid orders in each currency via each channel, after discounts and before tax. Test orders left out.',
      )
      await expect(dock).toContainText('Written for the family by')

      await dock.getByRole('button', { name: 'Change what Revenue means' }).click()
      await expect(words).toHaveValue(/Test orders left out\.$/)
      await words.fill('Money taken for orders.')
      await choose.getByRole('button', { name: 'Save' }).click()
      await expect(dock).toContainText('Money taken for orders.')

      // Worked out again: the common words come back.
      await dock.getByRole('button', { name: 'Change what Revenue means' }).click()
      await choose.getByRole('radio', { name: /Worked out from its variants/ }).click()
      await choose.getByRole('button', { name: 'Save' }).click()
      await expect(choose).toHaveCount(0)
      await expect(dock).toContainText('Common words of 247 of 250 variants, chosen automatically')

      // History keeps every choice, after its tool's reads.
      await go(page, '/definitions/Revenue')
      const main = page.getByRole('main')
      await main.getByRole('button', { name: /changes - last edited by Jon Abara/ }).click()
      await expect(main.getByRole('button', { name: /Jon edited wording/ })).toHaveCount(3)
    })

    test('a pair whose USD words say how it is converted reads the EUR words; one written apart has none', async ({
      page,
    }) => {
      await go(page, '/definitions?demo=families&dock=def.Partner%20fees')
      const dock = page.getByRole('region', { name: 'Definition' })
      await expect(dock).toContainText(
        'Fees partners report on referred customers in Currency. Not our revenue: see `commission_eur`.',
      )
      await expect(dock).toContainText(
        'Words of Partner fees (EUR), the variant the others are converted from',
      )
      await expect(dock).not.toContainText('something else')
      // With no meaning there is nothing to say something else than: no warning.
      await go(page, '/definitions?demo=families&dock=def.Partner%20payouts')
      await expect(dock).toContainText('No meaning yet: its variants say different things.')
      await expect(dock.getByRole('note')).toHaveCount(0)
      await expect(dock).not.toContainText('something else')
      expect(await sideways(page)).toBe(0)
      await dock.getByRole('button', { name: 'Change what Partner payouts means' }).click()
      const choose = page.getByRole('dialog', { name: 'What Partner payouts means' })
      await expect(choose).toContainText('Nothing yet: its variants say different things.')
      await choose.getByRole('radio', { name: /Written for the family/ }).click()
      const words = choose.getByRole('textbox', { name: 'What it means' })
      await expect(words).toHaveValue('')
      const wordings = choose.getByRole('list', { name: 'Start from what its variants say' })
      await expect(wordings.getByRole('listitem')).toHaveCount(2)
      await expect(wordings.getByRole('listitem').nth(1)).toContainText(
        'Partner payouts converted to USD at each month’s rate.',
      )
      await wordings.getByRole('button', { name: 'Use what EUR says' }).click()
      await expect(words).toHaveValue(/^Payouts we send partners in each currency/)
      expect(await sideways(page)).toBe(0)
    })

    test('a pair one rate converts reads the base variant’s words, its currency a slot', async ({
      page,
    }) => {
      await go(page, '/definitions/Accrued%20share%20front%20loaded?demo=families')
      const main = page.getByRole('main')
      await expect(main).toContainText(
        "The share of a contract's value booked in its first three months, in Currency.",
      )
      await expect(main).not.toContainText('in euros.')
      await expect(main).toContainText(
        'Words of Accrued share front loaded (EUR), the variant the others are converted from',
      )
      // The USD variant's own words say how it is converted, which the page shows: nothing else.
      await expect(main).not.toContainText('says something else')
      expect(await sideways(page)).toBe(0)
    })

    test('a family whose metric’s name holds a value reads each channel, and nothing else', async ({
      page,
    }) => {
      await go(page, '/definitions?demo=families&dock=def.Marketplace%20fees')
      const dock = page.getByRole('region', { name: 'Definition' })
      await expect(dock).toContainText('Common words of 250 of 250 variants, chosen automatically')
      await expect(dock).not.toContainText('something else')
      // The row reads the family's meaning as one line, where the Meaning column fits.
      if (width > 1000) {
        const row = page
          .getByRole('main')
          .getByRole('row')
          .filter({ hasText: /^Marketplace fees/ })
        await expect(row).toContainText('in each currency through each channel.')
        await expect(row).not.toContainText('each channel channel')
      }
    })
  })
}
