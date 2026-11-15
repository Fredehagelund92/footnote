import { expect, go, signOut, test } from './go.ts'

// J61: a screen reader gets the sidebar as navigation with the current page marked, a title and
// a heading on the conflict page and on sign-in, and every place that is not there says so in one
// design with a way on (UX audit, Q12 and Q13).

const PAIR = '/context/conflicts/itm_gift_card_only.itm_gift_store_credit'

test('the sidebar is navigation and marks the page you are on', async ({ page }) => {
  await go(page, '/inbox')
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link', { name: 'Inbox' })).toHaveAttribute('aria-current', 'page')
  await expect(nav.getByRole('link', { name: 'Context' })).not.toHaveAttribute('aria-current')
  await go(page, '/context/itm_norway_stop')
  await expect(nav.getByRole('link', { name: 'Context' })).toHaveAttribute('aria-current', 'page')
  await expect(nav.getByRole('link', { name: 'Inbox' })).not.toHaveAttribute('aria-current')
})

test('the conflict page has a title and a heading', async ({ page }) => {
  await go(page, PAIR)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Conflict')
  await expect(page).toHaveTitle(/^Conflict.* - Heed$/)
})

test('sign-in has a heading', async ({ page }) => {
  await go(page, '/inbox')
  await signOut(page)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in to Heed')
})

const missing = [
  { at: '/nowhere', title: 'There is no page at this address', way: 'Go to the Inbox' },
  { at: '/context/itm_nope', title: 'There is no context item here', way: 'Open Context' },
  { at: '/context/itm_nope/edit', title: 'There is no context item here', way: 'Open Context' },
  { at: '/definitions/Nope', title: 'There is no definition here', way: 'Open Definitions' },
  {
    at: '/settings/domains/nope',
    title: 'There is no domain here',
    way: 'Open Domains and owners',
  },
  { at: '/docs/nope', title: 'There is no documentation page here', way: 'Open the documentation' },
]

for (const { at, title, way } of missing) {
  test(`${at} says it is not there, and offers a way on`, async ({ page }) => {
    await go(page, at)
    const found = page.locator('[data-slot="empty"]')
    await expect(found.getByText(title, { exact: true })).toBeVisible()
    await expect(found.getByRole('link', { name: way, exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  })
}
