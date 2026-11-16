import { expect, go, test } from './go.ts'

// J64: dates follow the reader's language. A Danish browser reads Observability's months in Danish; none are the English names the code once typed.

test.use({ locale: 'da-DK' })

test('a Danish reader sees the months of the topics in Danish', async ({ page }) => {
  await go(page, '/observability?range=30')
  const chart = page.getByRole('group', { name: /^Questions per day/ })
  await expect(chart).toBeVisible()
  const text = await page.locator('main').innerText()
  expect(text).toMatch(/\b(september|oktober|november) 2026\b/)
  expect(text).not.toMatch(/\b(September|October|November) 2026\b/)
})
