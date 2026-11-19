import { expect, go, test } from './go.ts'

// J74: the numbers and rows of Usage, Quality and Feedback lead to what they count. A kind of agent
// on Usage opens Overview filtered to it, and a tool's Not found count opens Overview's Not found
// answers, over the same days; Quality's cells go to their groups, and Feedback's From agents to
// the reports.

test('Usage: a kind of agent and a Not found count open Overview filtered to them', async ({
  page,
}) => {
  await go(page, '/observability/usage?range=30')
  const agents = page.getByRole('table', { name: 'Calls by kind of agent' })
  await agents.getByRole('link', { name: 'Claude Code', exact: true }).click()
  await expect(page).toHaveURL(/\/observability\?/)
  await expect(page).toHaveURL(/[?&]range=30(&|$)/)
  await expect(
    page.getByRole('button', { name: /^Agent kind is Claude Code\. Enter to change/ }),
  ).toBeVisible()

  await go(page, '/observability/usage')
  await page
    .getByRole('table', { name: 'Calls by tool' })
    .getByRole('link', { name: /not found: look at the Not found answers on Overview$/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/observability\?answer=missing$/)
  await expect(
    page.getByRole('button', { name: /^Answer is Not found\. Enter to change/ }),
  ).toBeVisible()
})

test("Quality's cells go to their groups, and Feedback's From agents to the reports", async ({
  page,
}) => {
  await go(page, '/observability/quality')
  for (const [label, group] of [
    ['Needs a look', 'Needs a look'],
    ['Changed', 'Changed'],
    ['Same', 'Same'],
  ] as const) {
    await page.locator('a[data-slot=kpi]').filter({ hasText: label }).first().click()
    await expect(page).toHaveURL(new RegExp(`#saved-`))
    await expect(page.getByRole('region', { name: group })).toBeInViewport()
  }

  await go(page, '/observability/feedback')
  await page.locator('a[data-slot=kpi]').filter({ hasText: 'From agents' }).click()
  await expect(page).toHaveURL(/#reports$/)
  await expect(
    page.getByRole('tabpanel').getByRole('listitem').filter({ hasText: 'From an agent' }).first(),
  ).toBeInViewport()
})
