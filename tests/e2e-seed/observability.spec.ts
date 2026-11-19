import { expect, test, type Page } from '@playwright/test'

/*
  Observability on a new install of the demo (db/seed/story.ts): at 7 days every page has
  something to show, at least one row and one drawn mark, so a visitor sees each page working:
  what agents asked, saved questions in all three states, what people and agents said, tool calls
  and spend, and what the rules raised.
*/

/** The page drawn, with no frame that says a load failed. */
async function drawn(page: Page, address: string, title: string) {
  await page.goto(address)
  await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible()
  await expect(page.getByText(/couldn't load|could not load|something went wrong/i)).toHaveCount(0)
  await expect(page.locator('[data-slot="obs-empty"]')).toHaveCount(0)
}

/** A mark a chart drew: a bar's part with height, or a line. */
const marks = (page: Page) =>
  page.locator(
    'figure svg rect[data-part]:not([height="0"]), figure svg [data-part] rect, figure svg path[fill="none"], figure svg circle',
  )

test.beforeEach(async ({ page }) => {
  // A first visit lands in the app as the invented administrator, Ravi Kapoor.
  await page.goto('/')
  await expect(page).toHaveURL(/\/inbox$/)
})

test('Overview: topics asked about this week, and the questions drawn by day', async ({ page }) => {
  await drawn(page, '/observability', 'Overview')
  await expect(page.getByRole('main').getByRole('row').nth(1)).toBeVisible()
  await expect(marks(page).first()).toBeAttached()
})

test('Quality: saved questions that answer the same, have changed and need a look', async ({
  page,
}) => {
  await drawn(page, '/observability/quality', 'Quality')
  // Jon's two questions answer the same; Tomas's has changed, and Jon's about the United Kingdom
  // needs a look since Sofia's item disagrees with his.
  for (const group of ['Needs a look', 'Changed', 'Same'])
    await expect(page.getByRole('region', { name: group })).toBeVisible()
  await expect(marks(page).first()).toBeAttached()
})

test('Feedback: reports from Ask and from agents, and answers marked by week', async ({ page }) => {
  await drawn(page, '/observability/feedback', 'Feedback')
  const reports = page.locator('#reports li')
  await expect(reports.filter({ hasText: 'from Ask' }).first()).toBeVisible()
  await expect(reports.filter({ hasText: 'From an agent' }).first()).toBeVisible()
  // The share of good answers is shown, from counts that are shown.
  await expect(page.locator('[data-slot="kpi"]').filter({ hasText: 'Good answers' })).toContainText(
    /\d+%/,
  )
  await expect(
    page
      .getByRole('group', { name: /^Good answers and something wrong, by week/ })
      .locator('svg rect[data-part]')
      .first(),
  ).toBeAttached()
})

test("Usage: tool calls, how fast they were answered, and this month's spend", async ({ page }) => {
  await drawn(page, '/observability/usage', 'Usage')
  await expect(
    page.getByRole('table', { name: 'Calls by tool' }).getByRole('row').nth(1),
  ).toBeVisible()
  await expect(marks(page).first()).toBeAttached()
  await expect(
    page.locator('[data-slot="kpi"]').filter({ hasText: 'AI cost this month' }),
  ).not.toContainText('$0.00')
})

test('Alerts: what the rules raised, and when each last raised', async ({ page }) => {
  await drawn(page, '/observability/alerts', 'Alerts')
  await expect(
    page.getByRole('list', { name: 'Raised lately' }).getByRole('listitem').first(),
  ).toBeVisible()
  // The rules that raised, each with when it last did rather than Never.
  for (const rule of ['Conflict', 'A saved question needs a look'])
    await expect(
      page.getByRole('listitem').filter({ has: page.getByRole('switch', { name: rule }) }),
    ).not.toContainText('Never')
})
