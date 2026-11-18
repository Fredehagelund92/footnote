import { expect, go, test } from './go.ts'
import type { Locator, Page } from '@playwright/test'

// Offline, a page not opened before: its read waits for the connection, so the page says so in a
// sentence instead of a skeleton that never ends, and loads by itself once the connection is back.

const pages: { name: string; from: string; to: string; shown: (page: Page) => Locator }[] = [
  {
    name: 'the Inbox',
    from: '/context',
    to: '/inbox',
    shown: (page) => page.getByRole('button', { name: /^Suggestions \d+/ }),
  },
  {
    name: 'Observability',
    from: '/inbox',
    to: '/observability',
    shown: (page) => page.getByText('Saved questions').first(),
  },
  {
    name: 'a context item',
    from: '/inbox',
    to: '/context/itm_norway_stop',
    shown: (page) =>
      page.getByRole('heading', { name: 'Online sales to Norway stopped on 4 August 2026' }),
  },
]

for (const { name, from, to, shown } of pages) {
  test(`offline, ${name} not opened before says it needs the connection, and loads when back`, async ({
    page,
  }) => {
    await go(page, from)
    // The pages' code is fetched once the first page is in; only their reads are left.
    await page.waitForLoadState('networkidle')
    await page.context().setOffline(true)
    await go(page, to)
    const alert = page.getByRole('alert')
    await expect(alert).toContainText("You're offline.")
    await expect(alert).toContainText('when the connection is back')
    await expect(alert.getByRole('button', { name: 'Retry' })).toHaveCount(0)
    await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0)
    await page.context().setOffline(false)
    await expect(shown(page)).toBeVisible()
    await expect(alert).toHaveCount(0)
  })
}
