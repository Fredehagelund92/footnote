import type { Locator, Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J92, the Definitions list as a local install with Cube and dbt met it (the mock's ?demo=dbt): a
// name with brackets of its own is drawn whole while its row has room; a twin name a second view
// shares keeps its whole start and gives way at its view's name first, with the panel open too; a
// description cut at 500 characters ends on a word with an ellipsis; and on a phone the install's
// label beside the page's action keeps its words.

const TWIN = 'Search clicks (reported) (search_console_keyword_rankings_joined)'
const LONG = 'Net revenue after refunds'

/** What a row's name draws: its start and its bracketed end, each with whether it is cut. */
const drawn = (name: Locator) =>
  name.evaluate((button) => {
    const cut = (el: Element) => el.scrollWidth > el.clientWidth + 1
    // The end is the last of its two parts, under the hidden copy that holds its first letters.
    const parts = button.querySelector(':scope > span')!
    const start = parts.firstElementChild!
    const end = parts.lastElementChild!.lastElementChild ?? parts.lastElementChild!
    const cell = button.closest('td')!.getBoundingClientRect()
    return {
      start: { text: start.textContent, cut: cut(start) },
      end: { text: end.textContent, cut: cut(end), width: end.clientWidth },
      inCell: button.getBoundingClientRect().right <= cell.right,
    }
  })

const dbtList = async (page: Page, search: string) => {
  await go(page, '/definitions?demo=dbt')
  const main = page.getByRole('main')
  await main.getByPlaceholder('Search definitions').fill(search)
  return main
}

const row = (main: Locator, name: string) => main.getByRole('button', { name, exact: true })

test('a name with brackets of its own is drawn whole while its row has room', async ({ page }) => {
  // It once stopped at "Clicks (partner platf…" in a cell more than twice as wide (N2).
  const main = await dbtList(page, 'clicks')
  expect(await drawn(row(main, 'Clicks (partner platform)'))).toMatchObject({
    start: { text: 'Clicks', cut: false },
    end: { text: ' (partner platform)', cut: false },
  })
})

test('a twin name keeps its start and gives way at its view first', async ({ page }) => {
  const main = await dbtList(page, 'search')
  const twin = await drawn(row(main, TWIN))
  expect(twin).toMatchObject({
    start: { text: 'Search clicks (reported)', cut: false },
    end: { cut: true },
    inCell: true,
  })
  // With the panel open the rows narrow, and still the names are whole and the views cut (N3).
  await row(main, TWIN).click()
  await expect(page.getByRole('region', { name: 'Definition' })).toBeVisible()
  for (const [name, start] of [
    [TWIN, 'Search clicks (reported)'],
    ['Keyword count (search_console_keyword_rankings_joined)', 'Keyword count'],
  ] as const) {
    await expect
      .poll(async () => drawn(row(main, name)))
      .toMatchObject({ start: { text: start, cut: false }, end: { cut: true }, inCell: true })
  }
})

test('a description cut at 500 characters ends on a word with an ellipsis', async ({ page }) => {
  // It once ended "… still h" (N6).
  const main = await dbtList(page, 'refunds')
  const meaning = /^What the shop keeps .* a payment provider still…$/
  await expect(main.getByRole('row', { name: new RegExp(`^Select ${LONG}`) })).toContainText(
    'a payment provider still…',
  )
  await row(main, LONG).click()
  const panel = page.getByRole('region', { name: 'Definition' })
  await expect(panel.getByText(meaning)).toBeVisible()
  await go(page, `/definitions/${encodeURIComponent(LONG)}`)
  await expect(page.getByRole('heading', { level: 1, name: LONG, exact: true })).toBeVisible()
  await expect(page.getByTestId('page').getByText(meaning)).toBeVisible()
})

test.describe('390', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('a twin name keeps its start on a phone', async ({ page }) => {
    const main = await dbtList(page, 'search')
    const twin = await drawn(row(main, TWIN))
    expect(twin).toMatchObject({
      start: { text: 'Search clicks (reported)', cut: false },
      end: { cut: true },
      inCell: true,
    })
    // The view gives way down to its first letters, never to nothing.
    expect(twin.end.width).toBeGreaterThanOrEqual(60)
  })

  for (const scheme of ['light', 'dark'] as const)
    test(`the install's label keeps its words beside the page's action (${scheme})`, async ({
      page,
    }) => {
      // It once shrank to "No…" beside New term (N8).
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto('/definitions?label=Northwind%20Cube%2C%20local')
      const header = page.locator('header').first()
      const label = header.locator('[data-profile-label]')
      await expect(label).toContainText('Northwind Cube, local')
      const shown = await label.evaluate((badge) => {
        const words = badge.querySelector('.truncate')!
        return { visible: words.clientWidth, whole: words.scrollWidth }
      })
      // Its words are drawn, all but the end of a long one: never a letter or two.
      expect(shown.visible).toBeGreaterThanOrEqual(Math.min(shown.whole, 110))
      // The title is whole, and New term is its plus alone, still named for a screen reader.
      const title = header.locator('h1')
      expect(await title.evaluate((h1) => h1.scrollWidth <= h1.clientWidth + 1)).toBe(true)
      const add = header.getByRole('button', { name: 'New term', exact: true })
      await expect(add).toBeVisible()
      expect((await add.boundingBox())!.width).toBe(28)
      await add.click()
      await expect(page).toHaveURL(/\/definitions\/new$/)
    })
})
