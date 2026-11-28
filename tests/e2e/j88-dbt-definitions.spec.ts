import type { Page } from '@playwright/test'
import { expect, go, openRow, signInAs, test } from './go.ts'

// J88, a dbt project in a folder on the server, the one definitions tool on in the demo's Cube's
// place (the mock's ?demo=dbt), as a local install met it (N1-N3, N5, N6). A dbt definition's page names its real
// dbt ref and links nowhere, since a dbt file names no model file, while a Cube one links to its
// view's file; a description's backticks read as code, never as backticks; at 390 wide a name a
// second semantic model shares keeps its model in view; and context written from a definition
// starts in the definition's domain when the writer publishes there.

const SPEND = 'Campaign spend (local currency)'
const definition = (name: string) => `/definitions/${encodeURIComponent(name)}`

/** The definitions list with the dbt folder's definitions, dbt reading the demo's model too. */
const dbtList = async (page: Page) => {
  await go(page, '/definitions?demo=dbt')
  await expect(
    page.getByRole('main').getByRole('button', { name: SPEND, exact: true }),
  ).toBeVisible()
}

test('a dbt definition names its dbt ref and links to no file', async ({ page }) => {
  await dbtList(page)
  await go(page, definition(SPEND))
  const main = page.getByRole('main')
  await expect(main).toContainText('Read from dbt. Change it there.')
  await expect(
    main.getByRole('button', { name: 'Where it comes from', exact: true }),
  ).toHaveAccessibleDescription('Marketing, read from dbt')
  await openRow(page, 'Where it comes from')
  await expect(main.getByRole('definition').filter({ hasText: /^dbt:/ })).toHaveText(
    'dbt:campaign_spend.campaign_spend_local',
  )
  await expect(main).not.toContainText('cube:')
  // No address to open: neither the header nor the line under the meaning offers one.
  await expect(page.getByRole('link', { name: /Open in source/ })).toHaveCount(0)
})

test('a Cube definition links to its view’s model file', async ({ page }) => {
  await go(page, definition('Average order value'))
  await openRow(page, 'Where it comes from')
  await expect(page.getByRole('main')).toContainText('cube:basket.average_order_value')
  await expect(page.getByRole('link', { name: 'Open in source' }).first()).toHaveAttribute(
    'href',
    'https://github.com/Fredehagelund92/footnote/blob/main/db/seed/cube/basket.yml',
  )
})

test('backticks in a description read as code, in the list, the panel and the page', async ({
  page,
}) => {
  await dbtList(page)
  const main = page.getByRole('main')
  const row = main.getByRole('row', {
    name: new RegExp(`^Select ${SPEND.replace(/[\\()]/g, '\\$&')}`),
  })
  await expect(row.locator('code')).toHaveText(['spend_local', 'TEST'])
  await expect(row).not.toContainText('`')
  await main.getByRole('button', { name: SPEND, exact: true }).click()
  const panel = page.getByRole('region', { name: 'Definition' })
  await expect(panel.locator('code')).toHaveText(['spend_local', 'TEST'])
  await expect(panel).not.toContainText('`')
  await go(page, definition(SPEND))
  await expect(main.locator('code')).toHaveText(['spend_local', 'TEST'])
  await expect(main).toContainText(
    'What a campaign cost in the market’s own currency, as spend_local',
  )
  await expect(main).not.toContainText('`')
})

test.describe('390', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('a name two semantic models share keeps its model in view', async ({ page }) => {
    await dbtList(page)
    const main = page.getByRole('main')
    await main.getByPlaceholder('Search definitions').fill('first touch')
    const second = main.getByRole('button', {
      name: 'Acquisition channel first touch (orders)',
      exact: true,
    })
    await expect(second).toBeVisible()
    // The start of the name is cut, never its model: "(orders)" is drawn whole.
    const drawn = await second.evaluate((button) => {
      const cut = (el: Element) => el.scrollWidth > el.clientWidth + 1
      const spans = [...button.querySelectorAll(':scope > span > span')]
      return spans.map((span) => ({ text: span.textContent, cut: cut(span) }))
    })
    expect(drawn).toEqual([
      { text: 'Acquisition channel first touch', cut: true },
      { text: ' (orders)', cut: false },
    ])
    const box = (await second.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(390)
  })
})

test('context written from a definition starts in its domain when the writer publishes there', async ({
  page,
}) => {
  // Ravi, an administrator, publishes in every domain: it starts in the definition's own, not in
  // the first domain by name.
  await dbtList(page)
  await signInAs(page, 'Ravi Kapoor')
  await go(page, definition(SPEND))
  await page.getByRole('button', { name: 'Write context', exact: true }).click()
  await expect(page).toHaveURL(/\/context\/new\?/)
  await expect(page.getByRole('button', { name: /^Domain/ })).toContainText('Marketing')
})
