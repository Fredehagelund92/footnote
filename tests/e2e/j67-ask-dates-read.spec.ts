import { expect, go, test } from './go.ts'

// J67: how Ask read the dates is said under the question. "November" asked on 23 October names no
// year, so Ask read the latest November that has started and says so on the read line; the
// service wrote this turn on the demo week (tests/web/integration/ask-loop-shapes.test.ts).
test('a month asked without a year shows its days and that the year was not given', async ({
  page,
}) => {
  await go(page, '/ask?example=loop-dates-guessed')
  const line = page.locator('p', { hasText: /^Read as/ })
  await expect(line).toBeVisible()
  // The days, then how they were read: the note follows the days it is about.
  await expect(line.getByText('1-30 Nov 2025', { exact: true })).toBeVisible()
  await expect(line.getByText('year not given', { exact: true })).toBeVisible()
  expect(await line.textContent()).toMatch(/1-30 Nov 2025·year not given/)
})
