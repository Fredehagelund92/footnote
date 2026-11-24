import type { Page } from '@playwright/test'
import { expect, go, mode, test } from './go.ts'

// J110: a period chosen on the read line shows in the chat (R12). Choosing Last month asks the
// question again as a new turn under the first, which keeps its own read line; the new turn says
// it was asked again at last month at once, then its read line names last month with its days and
// its answer's first sentence names it too, both kept after a reload. An answer about what a
// metric means offers no period: dates do not change it. The service answers with Ask's loop and
// its scripted reader.
test.skip(mode === 'mock', "The mock's loop answers are examples, read at the dates they were")

async function ask(page: Page, question: string) {
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.fill(question)
  await box.press('Enter')
}
const readLine = (page: Page, turn: number) =>
  page.locator(`[data-turn="${turn}"]`).locator('p', { hasText: /^Read as/ })

test('Last month asks again as a new turn that says it is for last month', async ({ page }) => {
  await go(page, '/ask')
  await ask(page, 'orders in Norway')
  const assumed = readLine(page, 0).getByRole('button', { name: 'Today · assumed' })
  await expect(assumed).toBeVisible({ timeout: 30_000 })
  await assumed.click()
  await page.getByRole('button', { name: 'Last month', exact: true }).click()

  // A new turn, the same words, said at once to be asked again at last month.
  const again = page.locator('[data-turn="1"]')
  await expect(again).toContainText('orders in Norway')
  const scope = readLine(page, 1).getByRole('button', {
    name: 'last month (1-30 Sep 2026)',
    exact: true,
  })
  await expect(again.getByText('Asked again at').or(scope)).toBeVisible()
  await expect(scope).toBeVisible({ timeout: 30_000 })
  await expect(again.locator('[data-answer-words]')).toContainText(
    /^This answer is for last month, September 2026\./,
  )
  // The first turn keeps the period it was read at: nothing was replaced.
  await expect(assumed).toBeVisible()

  // The chat opens again as it was, its periods with it.
  await expect.poll(() => new URL(page.url()).searchParams.get('chat')).not.toBeNull()
  await page.reload()
  await expect(scope).toBeVisible({ timeout: 30_000 })
  await expect(readLine(page, 0).getByRole('button', { name: 'Today · assumed' })).toBeVisible()
  await expect(page.locator('[data-turn="1"] [data-answer-words]')).toContainText(
    /^This answer is for last month, September 2026\./,
  )
})

test('an answer about what a metric means offers no period to choose', async ({ page }) => {
  await go(page, '/ask')
  await ask(page, 'What is net revenue?')
  const line = readLine(page, 0)
  await expect(line.getByRole('button', { name: /^Net revenue\b/ })).toBeVisible({
    timeout: 30_000,
  })
  await expect(line).not.toContainText(/date|assumed|Today/)
  await expect(line.getByRole('button', { name: 'Change', exact: true })).toBeVisible()
})
