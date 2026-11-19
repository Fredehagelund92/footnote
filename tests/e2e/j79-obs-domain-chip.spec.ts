import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J79: one domain chip on Quality, Feedback and Alerts, kept in the address. Choosing a domain
// narrows the page's numbers and its list, a reload keeps it, and the trigger keeps one width
// whatever the name, so the header never shifts.

const chip = (page: Page) => page.getByRole('button', { name: /^Domain: / })

test('as admin, choosing Sales on Feedback narrows the cells and the list, and a reload keeps it', async ({
  page,
}) => {
  await go(page, '/observability/feedback')
  const good = page.locator('[data-slot="kpi"]').filter({ hasText: 'Good answers' })
  await expect(good).toContainText('38 of 45 marked in Ask')
  const reports = page.locator('#reports li')
  const all = await reports.count()
  const width = (await chip(page).boundingBox())!.width

  await chip(page).click()
  await page.getByRole('menuitemradio', { name: 'Sales' }).click()
  await expect(page).toHaveURL(/[?&]domain=[a-z_]*sales(&|$)/)
  await expect(chip(page)).toHaveAccessibleName('Domain: Sales')
  // The same width with a name as with All domains.
  expect((await chip(page).boundingBox())!.width).toBeCloseTo(width, 0)
  await expect(good).toContainText('27 of 34 marked in Ask')
  await expect.poll(() => reports.count()).toBeLessThan(all)
  for (const r of await reports.all()) await expect(r).toContainText('Sales')

  await page.reload()
  await expect(chip(page)).toHaveAccessibleName('Domain: Sales')
  await expect(good).toContainText('27 of 34 marked in Ask')
  for (const r of await reports.all()) await expect(r).toContainText('Sales')
})

test('Quality and Alerts take the same chip from the address', async ({ page }) => {
  await go(page, '/observability/alerts')
  const list = page.getByRole('list', { name: 'Raised lately' })
  await expect(list.locator('li').first()).toBeVisible()
  // How many raises the list counts: "20 of 198" or "All 9".
  const counted = async () => {
    const words = await page.getByText(/newest first\./).innerText()
    return Number(/(?:of|All) (\d+)/.exec(words)![1])
  }
  const all = await counted()
  await chip(page).click()
  await page.getByRole('menuitemradio', { name: 'Marketing' }).click()
  await expect(chip(page)).toHaveAccessibleName('Domain: Marketing')
  await expect.poll(counted).toBeLessThan(all)
  // A raise about one domain is about Marketing; one about every domain names none.
  for (const r of await list.locator('li:has(a)').all())
    for (const other of ['Sales', 'Customer value', 'Paid media'])
      await expect(r.locator('p').first()).not.toContainText(`${other} -`)

  // The chip is in the address, so Quality opens on the same domain.
  const domain = new URL(page.url()).searchParams.get('domain')!
  await go(page, `/observability/quality?domain=${domain}`)
  await expect(chip(page)).toHaveAccessibleName('Domain: Marketing')
})
