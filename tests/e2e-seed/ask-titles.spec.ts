import { expect, test } from '@playwright/test'
import { vocabulary } from '../../db/seed/fixtures/reference-data.ts'

/*
  The demo's Ask lists the items the rules deliver by their titles (playwright.seed.config.ts).
  A title that names a metric must be about the metric asked, or a correct delivery reads as
  wrong: asked about Net revenue in Germany, it once listed "What explains the movement of Active
  customers in June 2026?" first, an item about Active customers and Net revenue (B3).
*/

const otherMetrics = vocabulary.metrics.filter((metric) => metric.name !== 'Net revenue')

test('asked about net revenue in Germany, Ask lists no item titled for another metric', async ({
  page,
}) => {
  // A first visit lands in the app as the invented administrator.
  await page.goto('/')
  await expect(page).toHaveURL(/\/inbox$/)
  await page.goto('/ask')
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially('Why did net revenue drop in Germany last month?')
  await box.press('Enter')
  const answer = page.getByRole('main')
  // The stop on 1 February 2026 is written for Germany and Net revenue, so it is listed.
  await expect(
    answer.getByText(/Online sales to Germany stopped on 1 February 2026/).first(),
  ).toBeVisible()
  await expect(answer.getByText(/What explains the movement of Active customers/)).toHaveCount(0)
  // Nor any other title the templates write about a metric: a movement, a change, a jump or a drop.
  const text = await answer.innerText()
  for (const metric of otherMetrics)
    expect(text, `an item titled for ${metric.name}`).not.toMatch(
      new RegExp(`\\b(movement|change|jump|drop) (of|in) ${metric.name}\\b`),
    )
})
