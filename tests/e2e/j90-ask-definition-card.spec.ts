import { expect, go, test } from './go.ts'

// J90, the definition card (change 9 of the live test of Ask): "What is net revenue?" is
// answered with its definition as a card, as the service wrote it on the demo week
// (?example=loop-definition): the Definition mark in the state's place, then the card, which
// stands in for the words: the metric's chip and group, the source's own words at the answer's
// size, where they come from, its owners and domain, and the context items about it, which open
// in the card. Open the definition opens it beside the chat.

for (const { name, viewport } of [
  { name: '1440', viewport: { width: 1440, height: 900 } },
  { name: '390', viewport: { width: 390, height: 844 } },
] as const)
  test(`${name}: what a metric is, as its definition card`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await go(page, '/ask?example=loop-definition')
    const log = page.getByRole('log')
    await expect(log.getByRole('group', { name: 'Answer actions' })).toBeVisible({
      timeout: 20_000,
    })
    await expect(log.getByRole('button', { name: /^Definition/ })).toBeVisible()
    const card = log.getByRole('article', { name: /Net revenue/ })
    await expect(card).toBeVisible()
    // The card is the answer: the words that only gave the definition are not said twice.
    await expect(log.locator('[data-answer-words] [data-definition-card]')).toHaveCount(1)
    await expect(log.getByText(/^Net revenue is Gross sales/)).toHaveCount(0)
    await expect(card).toContainText('Metric in the Revenue group')
    const words = card.locator('blockquote')
    await expect(words).toHaveText(/^Gross sales after returns, discounts, VAT and payment fees/)
    const type = await words.evaluate((el) => {
      const style = getComputedStyle(el)
      return { size: style.fontSize, line: style.lineHeight }
    })
    expect(type).toEqual({ size: '16px', line: '26px' })
    await expect(card).toContainText(/^.*From Cube, as revenue\.net_revenue/)
    await expect(card).toContainText(/Owned by Jon Abara.* and Sofia Brandt.*, in Sales/)
    // Its context opens in the card, and closes again.
    const see = card.getByRole('button', { name: /^See the \d+ context items?$/ })
    await expect(see).toHaveAttribute('aria-expanded', 'false')
    await see.click()
    await expect(see).toHaveAttribute('aria-expanded', 'true')
    await expect(card.getByRole('listitem').first()).toBeVisible()
    await see.click()
    await expect(see).toHaveAttribute('aria-expanded', 'false')
    await expect(card.getByRole('listitem')).toHaveCount(0)
    // Nothing in the card runs past the page.
    const box = (await card.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
    await card.getByRole('button', { name: 'Open the definition' }).click()
    await expect(page).toHaveURL(/dock=def\.Net(%20|\+)revenue/)
  })
