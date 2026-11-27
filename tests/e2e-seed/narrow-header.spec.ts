import { expect, test, type Page } from '@playwright/test'

// The demo install's page header in a narrow window. Only the demo shows View as, in the corner
// of every header, and it is the widest part there: the header folds by its own width, so View as
// gives up its name, then the rest of its words, before a page's own action or its title is cut.
// Under 1024 px the sidebar starts as its icon rail, which is the room a tablet has.

const header = (page: Page) => page.locator('[data-site-header]')
const viewAs = (page: Page) => header(page).getByRole('button', { name: /^View as:/ })

/** The words in the header that are cut short: a title with an ellipsis, a box that clips. */
const cutInHeader = (page: Page) =>
  header(page).evaluate((bar) =>
    [...bar.querySelectorAll<HTMLElement>('*')]
      .filter((el) => el.clientWidth > 1 && el.scrollWidth > el.clientWidth + 1)
      .filter((el) => ['hidden', 'clip'].includes(getComputedStyle(el).overflowX))
      .map((el) => (el.textContent ?? '').trim().slice(0, 30)),
  )

/** The pairs of header buttons and links drawn over one another. */
const overlapsInHeader = (page: Page) =>
  header(page).evaluate((bar) => {
    const parts = [...bar.querySelectorAll<HTMLElement>('button, a[href], h1')]
      .map((el) => ({ el, box: el.getBoundingClientRect() }))
      .filter((p) => p.box.width > 0)
    return parts.flatMap((a, i) =>
      parts
        .slice(i + 1)
        .filter((b) => !a.el.contains(b.el) && !b.el.contains(a.el))
        .filter((b) => Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left) > 0.5)
        .map((b) => `${a.el.textContent?.trim()} / ${b.el.textContent?.trim()}`),
    )
  })

test('View as gives up its name, then its words, as the header narrows', async ({ page }) => {
  await page.goto('/context')
  await expect(viewAs(page)).toBeVisible()
  // A laptop: the switch says who.
  await expect(viewAs(page)).toContainText('View as')
  await expect(viewAs(page).getByText('Ravi Kapoor')).toBeVisible()
  // 1024 px, where the sidebar is still open: the name steps aside, the words stay.
  await page.setViewportSize({ width: 1024, height: 768 })
  await expect(viewAs(page).getByText('Ravi Kapoor')).toBeHidden()
  await expect(viewAs(page).getByText('View as')).toBeVisible()
  // A tablet: beside the rail it is its avatar alone, still named for a screen reader.
  await page.setViewportSize({ width: 768, height: 1024 })
  await expect(page.locator('[data-slot=sidebar]')).toHaveAttribute('data-state', 'collapsed')
  await expect(viewAs(page).getByText('View as')).toBeHidden()
  expect((await viewAs(page).boundingBox())!.width).toBe(28)
  await expect(viewAs(page)).toHaveAccessibleName('View as: Ravi Kapoor')
})

test('at 768 px no header of the demo draws one part over another or cuts its title', async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  for (const [route, title] of [
    ['/inbox', 'Inbox'],
    ['/context', 'Context'],
    ['/definitions', 'Definitions'],
    ['/ask', 'Ask'],
    ['/observability', 'Overview'],
    ['/settings/integrations/cube', 'Cube'],
  ] as const) {
    await page.goto(route)
    await expect(header(page).getByRole('heading', { name: title, exact: true })).toBeVisible()
    await expect(viewAs(page)).toBeVisible()
    // Write context once lay over List and By time here, and the title was gone.
    expect(await overlapsInHeader(page), route).toEqual([])
    expect(await cutInHeader(page), route).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth), route).toBe(768)
  }
  await page.goto('/context')
  await expect(header(page).getByText('Write context')).toBeVisible()
})
