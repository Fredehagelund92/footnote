import { expect, go, test } from './go.ts'

// J80: one empty state on every Observability page. On a new install each page draws its number
// cells with a dash, its chart faded, one sentence on why it is empty, and the next step; and a
// list of Feedback's reports with nothing in it says why.

const pages = [
  { page: 'Overview', address: '/observability', step: /^Connect an agent$/ },
  { page: 'Quality', address: '/observability/quality', step: /^Ask a question$/ },
  { page: 'Feedback', address: '/observability/feedback', step: /^Ask a question$/ },
  { page: 'Usage', address: '/observability/usage', step: /^Connect an agent$/ },
  { page: 'Alerts', address: '/observability/alerts', step: /^Connect an agent$/ },
]

for (const p of pages)
  test(`${p.page}: on the empty install, why it is empty and the next step`, async ({ page }) => {
    await go(page, `${p.address}?state=empty`)
    const empty = page.locator('[data-slot="obs-empty"]')
    await expect(empty).toBeVisible()
    await expect(empty.getByRole('heading')).toBeVisible()
    const step = empty.locator('[data-slot="next-step"]')
    await expect(
      step.getByRole('link', { name: p.step }).or(step.getByRole('button', { name: p.step })),
    ).toBeVisible()
    // Every number cell is a dash, never a 0 that reads as counted.
    for (const cell of await empty.locator('[data-slot="kpi"]').all())
      await expect(cell).toContainText('Nothing yet')
  })

test('Feedback: a list with nothing in it says why it is empty', async ({ page }) => {
  await go(page, '/observability/feedback')
  await page.getByRole('button', { name: /^Domain: / }).click()
  await page.getByRole('menuitemradio', { name: 'Customer value' }).click()
  await page.getByRole('tab', { name: /^In the Inbox 0/ }).click()
  await expect(page.locator('[data-slot="list-empty"]')).toHaveText(
    'No report in Customer value waits in the Inbox: every one this week has been looked at.',
  )
})
