import type { Locator, Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J101, words a source wrote in Markdown (the captain's quote: asterisks and backticks drawn as
// characters inside the quote block). An item's quote copied from a wiki, opened under Details in
// the quick view, and Cost per acquisition's description, which Cube holds in Markdown, in Ask's
// definition card (?example=loop-definition-markdown) and in its quick view: each draws bold,
// italic, code and its link, never the marks, and nothing runs past its box or the page.

const widths = [
  { name: '1440', viewport: { width: 1440, height: 900 } },
  { name: '390', viewport: { width: 390, height: 844 } },
] as const

/** No Markdown mark left as a character, and the box inside the page. */
async function drawn(page: Page, box: Locator, width: number) {
  await expect(box).not.toContainText(/\*\*|`|\]\(|(^|\s)_\S/)
  const fits = await box.evaluate((el) => ({
    inside: el.scrollWidth <= el.clientWidth + 1,
    right: el.getBoundingClientRect().right,
  }))
  expect(fits.inside).toBe(true)
  expect(fits.right).toBeLessThanOrEqual(width)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
}

for (const { name, viewport } of widths)
  for (const theme of ['light', 'dark'] as const)
    test(`${name}, ${theme}: an item's quote and a definition's words are drawn, never their marks`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)

      // The quote under Details, with where it was copied from under it.
      await go(page, `/context?dock=context.itm_lag_two_days&theme=${theme}`)
      const dock = page.getByRole('region', { name: 'Context' })
      await dock.getByRole('button', { name: 'Details', exact: true }).click()
      const quote = dock.locator('figure blockquote')
      await expect(quote.locator('strong')).toHaveText('Germany payment files')
      await expect(quote.locator('code')).toHaveText('payments_daily_by_market_and_provider')
      await expect(quote.locator('em')).toHaveText('both')
      const link = quote.getByRole('link', { name: 'freshness notes (opens in a new tab)' })
      await expect(link).toHaveAttribute('href', 'https://wiki.example/data/freshness')
      await expect(link).toHaveAttribute('target', '_blank')
      await expect(dock.locator('figcaption')).toHaveText(/^Copied from wiki\.example/)
      await drawn(page, quote, viewport.width)

      // The definition card: the source's words at the answer's size, drawn.
      await go(page, `/ask?example=loop-definition-markdown&theme=${theme}`)
      const log = page.getByRole('log')
      const card = log.getByRole('article', { name: /Cost per acquisition/ })
      await expect(card).toBeVisible({ timeout: 20_000 })
      const words = card.locator('blockquote')
      await expect(words.locator('strong')).toHaveText('Marketing spend')
      await expect(words.locator('code')).toHaveText('marketing_spend_eur / first_time_buyers')
      await expect(words.locator('em')).toHaveText('never')
      await expect(
        words.getByRole('link', { name: 'attribution notes (opens in a new tab)' }),
      ).toHaveAttribute('href', 'https://wiki.example/marketing/attribution')
      expect(await words.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px')
      await drawn(page, words, viewport.width)

      // The same words in the definition's quick view.
      await card.getByRole('button', { name: 'Open the definition' }).click()
      const def = page.getByRole('region', { name: 'Definition' })
      await expect(def.locator('strong').first()).toHaveText('Marketing spend')
      await expect(def.getByRole('link', { name: /^attribution notes/ })).toBeVisible()
      await expect(def).not.toContainText(/\*\*|`/)
    })
