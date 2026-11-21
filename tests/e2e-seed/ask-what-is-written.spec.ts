import { expect, test, type Page } from '@playwright/test'

/*
  What Ask says is written, on the demo a new install gets, with no AI model connected: the
  scripted reader answers. In the live re-run of 21 November 2026 (section 3.3 of its report),
  items that match the words but do not apply were counted as "more not shown", so 10 items about
  orders in Poland read as 72.
*/

async function ask(page: Page, question: string) {
  await page.goto('/')
  await expect(page).toHaveURL(/\/inbox$/)
  await page.goto('/ask')
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially(question)
  await box.press('Enter')
  const turn = page.locator('[data-turn="0"]')
  // The scripted reader answers in seconds, but a busy runner can take far longer.
  await expect(turn.getByText('What Ask read')).toBeVisible({ timeout: 60_000 })
  return turn
}

test('items that match the words and do not apply are never "more not shown"', async ({ page }) => {
  const turn = await ask(page, "What's written about orders in Poland?")
  await turn.getByText('What Ask read').click()
  await expect(turn).toContainText(/\d+ of [\d,]+ published context items you can see apply/)
  await expect(turn).not.toContainText(/more items? match/)
  await expect(turn).not.toContainText(/not shown/)
})
