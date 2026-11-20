import { expect, go, mode, test } from './go.ts'

// J71: the period on the read line is a menu (period slice R12). A question that names no dates is
// read at today, "Today · assumed"; choosing Any date asks it again at any date, and the new
// answer's read line says so. The service answers with Ask's loop and its scripted reader.
test.skip(mode === 'mock', "The mock's loop answers are examples, read at the dates they were")

test('choosing Any date on "Today · assumed" asks again at any date', async ({ page }) => {
  await go(page, '/ask')
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.fill('orders in Norway')
  await box.press('Enter')
  const first = page.locator('[data-turn="0"]')
  const assumed = first.getByRole('button', { name: 'Today · assumed' })
  await expect(assumed).toBeVisible({ timeout: 30_000 })

  await assumed.click()
  // Each choice is the period itself; Pick dates opens a calendar.
  for (const name of ['Today', 'Any date', 'Last month', 'Last quarter', 'Last year', 'Pick dates'])
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Any date', exact: true }).click()

  // Asked again as a new turn, with the same words, read at any date.
  const again = page.locator('[data-turn="1"]')
  await expect(again).toContainText('orders in Norway')
  const line = again.locator('p', { hasText: /^Read as/ })
  await expect(line.getByRole('button', { name: 'any date', exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await expect(line).not.toContainText('assumed')
})

test('Pick dates asks again at the days picked', async ({ page }) => {
  await go(page, '/ask')
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.fill('orders in Norway')
  await box.press('Enter')
  const assumed = page.locator('[data-turn="0"]').getByRole('button', { name: 'Today · assumed' })
  await expect(assumed).toBeVisible({ timeout: 30_000 })
  await assumed.click()
  await page.getByRole('button', { name: 'Pick dates', exact: true }).click()
  // The first day and the last, in the browser's own date fields.
  const picker = page.getByRole('dialog')
  const ask = picker.getByRole('button', { name: 'Ask at these dates' })
  await expect(ask).toBeDisabled()
  await picker.getByLabel('First day').fill('2026-10-05')
  await picker.getByLabel('Last day').fill('2026-10-11')
  await ask.click()

  const line = page.locator('[data-turn="1"]').locator('p', { hasText: /^Read as/ })
  await expect(line.getByRole('button', { name: '5-11 Oct 2026', exact: true })).toBeVisible({
    timeout: 30_000,
  })
})
