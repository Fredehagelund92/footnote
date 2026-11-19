import { expect, test, type Page } from '@playwright/test'

/*
  Small untruths on the demo as `docker compose up` gives it (playwright.seed.config.ts): at 390 px
  a page's title and the sidebar keep their words, with the demo's View as in the header (U10), and
  the Cube source the server reads from its model folder never says it reads from Git (U12).
*/

/** What is cut inside `selector`: a text an ellipsis shortens (words for a screen reader alone are never drawn). */
async function cutWords(page: Page, selector: string) {
  return page.evaluate((selector) => {
    const cut: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>(`${selector} *`)) {
      if (el.children.length || !el.textContent?.trim() || el.closest('.sr-only')) continue
      if (el.scrollWidth > el.clientWidth + 1) cut.push(el.textContent.trim())
    }
    return cut
  }, selector)
}

test.describe('at 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('no page title and nothing in the sidebar is cut', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/inbox$/)
    await expect(page.getByRole('button', { name: /^View as:/ })).toBeVisible()
    for (const [path, title] of [
      ['/inbox', 'Inbox'],
      ['/ask', 'Ask'],
      ['/context', 'Context'],
      ['/definitions', 'Definitions'],
      ['/observability', 'Overview'],
    ] as const) {
      await page.goto(path)
      await expect(page.locator('header h1').filter({ hasText: title })).toBeVisible()
      expect(await cutWords(page, 'header h1'), path).toEqual([])
    }
    // The sidebar is a sheet on a phone: who is signed in and what they own wrap, never cut.
    await page.getByRole('button', { name: 'Open the menu' }).click()
    const sidebar = page.locator('[data-sidebar=sidebar]').first()
    await expect(sidebar).toBeVisible()
    await expect(sidebar.getByText('Ravi Kapoor', { exact: true })).toBeVisible()
    expect(await cutWords(page, '[data-sidebar=sidebar]')).toEqual([])
  })
})

test('the Cube source read from a folder on the server never says it reads from Git', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/inbox$/)
  await page.goto('/settings/integrations')
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Cube' })
    .getByRole('button', { name: 'Manage' })
    .click()
  await expect(page.getByRole('heading', { name: 'Cube', level: 2 })).toBeVisible()
  await expect(page.getByText(/read from a folder on the server/)).toBeVisible()
  await expect(page.getByText(/from Git/)).toHaveCount(0)
})
