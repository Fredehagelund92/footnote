import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J114, Ask's card of a family (C1 of the family meaning analysis): asked what a family is, the
// answer gives its definition as a card. A family no words speak for says its variants say what
// it is, in their own words, as large as a meaning, under the answer's own sentence, which it
// never stands in for; its owners are offered Write what it means, which opens its quick view
// writing it. With a meaning, the card says where the words come from: the words of the variant
// the others are converted from, or words an owner wrote, by whom and when. The demo's partner
// families (?demo=families), at 1440 and 390, light and dark.

for (const { name, viewport } of [
  { name: '1440', viewport: { width: 1440, height: 900 } },
  { name: '390', viewport: { width: 390, height: 844 } },
] as const)
  for (const theme of ['light', 'dark'] as const)
    test.describe(`${name}, ${theme}`, () => {
      test.use({ viewport, colorScheme: theme })

      const open = async (page: Page, example: string) => {
        await go(page, `/ask?example=loop-family-${example}&demo=families&theme=${theme}`)
        const log = page.getByRole('log')
        await expect(log.getByRole('group', { name: 'Answer actions' })).toBeVisible({
          timeout: 20_000,
        })
        const card = log.getByRole('article', { name: /Partner/ })
        await expect(card).toBeVisible()
        // Nothing in the card runs past the page, and the page never scrolls sideways.
        const box = (await card.boundingBox())!
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width)
        return { log, card }
      }

      test('no meaning: its variants in their own words, under the answer, and Write what it means', async ({
        page,
      }) => {
        const { log, card } = await open(page, 'none')
        // The answer's sentence stays: the card does not stand in for it.
        await expect(log.getByText(/is a family of two metrics, one per currency/)).toBeVisible()
        await expect(log.locator('[data-answer-words] [data-definition-card]')).toHaveCount(0)
        await expect(card).toContainText('Family of 2 metrics, by Currency in the Partners group')
        await expect(card).not.toContainText('No meaning yet')
        await expect(card).toContainText('Its 2 variants say what it is in their own words:')
        const own = card.getByRole('list', { name: 'In its variants’ own words' })
        await expect(own.getByRole('listitem')).toHaveText([
          'EUR: Payouts we send partners in EUR, booked on the day they are sent.',
          'USD: Partner payouts converted to USD at each month’s rate.',
        ])
        // At the answer's size, as a meaning is.
        expect(await own.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px')
        await expect(card).toContainText(/From dbt\s*Owned by/)
        await card.getByRole('button', { name: 'Write what it means' }).click()
        await expect(page).toHaveURL(/dock=def\.Partner(%20|\+)payouts.*meaning=write/)
        const dialog = page.getByRole('dialog', { name: 'What Partner payouts means' })
        await expect(dialog.getByRole('radio', { name: /^Written for the family/ })).toBeChecked()
        await expect(dialog.getByRole('textbox', { name: 'What it means' })).toBeFocused()
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
        await expect(page).not.toHaveURL(/meaning=write/)
        // The quick view says the same as the card, with Change for its owner.
        const peek = page.getByRole('region', { name: 'Definition' })
        await expect(peek).toContainText('Its 2 variants say what it is in their own words:')
        await expect(
          peek.getByRole('button', { name: 'Change what Partner payouts means' }),
        ).toBeVisible()
      })

      test('with a base: the family’s words, and whose they are', async ({ page }) => {
        const { card } = await open(page, 'base')
        await expect(card.locator('blockquote p').first()).toHaveText(
          'Fees partners report on referred customers in each currency. Not our revenue: see commission_eur.',
        )
        await expect(card).toContainText(
          'From dbt: the words of EUR, the variant USD is converted from',
        )
        await expect(card.getByRole('button', { name: 'Write what it means' })).toHaveCount(0)
      })

      test('written: the owner’s words, by whom and when', async ({ page }) => {
        const { log, card } = await open(page, 'written')
        await expect(log.getByText(/are the payouts we send partners/)).toBeVisible()
        await expect(card).toContainText('Written for the family by Jon Abara on 20 Oct 2026')
        await expect(card).not.toContainText('say something else')
        await expect(card.getByRole('button', { name: 'Write what it means' })).toHaveCount(0)
      })
    })
