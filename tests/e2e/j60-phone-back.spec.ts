import { devices } from '@playwright/test'
import { card, expect, go, test } from './go.ts'

// J60, the way back on a phone (UX audit P14, design audit F13): the item, definition, review and
// conflict pages have a back arrow in their header, the title keeps room to be read, the rest of
// the header (Ask, the nav, search, the theme) sits in one More menu, the Inbox's switch sits under
// its introduction, and the editor's toolbar shows an edge where it scrolls on.

test.use({ ...devices['iPhone 13'], browserName: 'chromium' })

const places = [
  { name: 'an item', path: '/context/itm_norway_stop', back: 'Back to Context', to: '/context' },
  {
    name: 'a definition',
    path: '/definitions/Orders',
    back: 'Back to Definitions',
    to: '/definitions',
  },
  {
    name: 'a conflict',
    path: '/context/conflicts/itm_spain_vat_in.itm_spain_vat_out',
    back: 'Back to Context',
    to: '/context',
  },
  {
    name: 'a review',
    path: `/inbox/${card('sug-ines')}/review`,
    back: 'Back to the Inbox',
    to: '/inbox',
  },
]

for (const place of places) {
  test(`${place.name} has a back arrow that leads to its list`, async ({ page }) => {
    await go(page, place.path)
    const back = page.getByRole('button', { name: place.back })
    await expect(back).toBeVisible()
    await back.click()
    await expect(page).toHaveURL(new RegExp(`${place.to}(\\?|$)`))
  })

  test(`${place.name} keeps room for its title in the header`, async ({ page }) => {
    await go(page, place.path)
    await expect(page.locator('header h1, header [aria-current="page"]').first()).toBeVisible()
    // The title's own room: from where it starts to where the header's actions begin.
    const room = await page.evaluate(() => {
      const title = document.querySelector<HTMLElement>('header h1, header [aria-current="page"]')!
      const actions = document.querySelector<HTMLElement>('[data-header-actions]')!
      return actions.getBoundingClientRect().left - title.getBoundingClientRect().left
    })
    expect(room).toBeGreaterThanOrEqual(120)
  })
}

test('an item keeps most of the header for its title', async ({ page }) => {
  await go(page, '/context/itm_norway_stop')
  const header = page.locator('header')
  // Back, the title, the main action and More: nothing else is drawn beside them.
  await expect(header.getByRole('button', { name: 'More' })).toBeVisible()
  await expect(header.getByRole('button', { name: 'Edit' })).toBeVisible()
  await expect(header.getByRole('button', { name: 'Open the menu' })).toHaveCount(0)
  await expect(header.getByRole('button', { name: /^Ask about/ })).toHaveCount(0)
  await expect(header.getByRole('button', { name: 'Search' })).toHaveCount(0)
  // The title's own width, as it is drawn: a long title is cut by the room, not by seven buttons.
  const width = await page.evaluate(() => {
    const title = document.querySelector<HTMLElement>('header [aria-current="page"]')!
    return title.getBoundingClientRect().width
  })
  expect(width).toBeGreaterThanOrEqual(180)
})

test('a metric definition keeps Write context in its header and Open in source in More', async ({
  page,
}) => {
  await go(page, '/definitions/Orders')
  const header = page.locator('header')
  await expect(header.getByRole('button', { name: 'Back to Definitions' })).toBeVisible()
  await expect(header.getByRole('button', { name: 'Write context' })).toBeVisible()
  await expect(header.getByRole('button', { name: 'More' })).toBeVisible()
  await expect(header.getByRole('button', { name: 'Open in source' })).toBeHidden()
  await header.getByRole('button', { name: 'More' }).click()
  const source = page.getByRole('menuitem', { name: 'Open in source' })
  await expect(source).toBeVisible()
  await expect(source).toHaveAttribute('href', /.+/)
})

test('a review keeps its preview switch in the header and the queue in More', async ({ page }) => {
  await go(page, `/inbox/${card('sug-ines')}/review`)
  const header = page.locator('header')
  await expect(header.getByRole('button', { name: 'Back to the Inbox' })).toBeVisible()
  await expect(header.getByRole('button', { name: 'More' })).toBeVisible()
  await expect(header.getByRole('button', { name: 'Waiting suggestions' })).toBeHidden()
  await header.getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Waiting suggestions' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('the More menu of a deep page holds Ask, the nav, search and the theme', async ({ page }) => {
  await go(page, '/context/itm_norway_stop')
  await page.getByRole('button', { name: 'More' }).click()
  for (const name of ['Archive', 'Ask about this', 'Open the menu', 'Search']) {
    await expect(page.getByRole('menuitem', { name })).toBeVisible()
  }
  for (const name of ['Light', 'Dark', 'System'])
    await expect(page.getByRole('menuitemradio', { name })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Ask about this' }).click()
  await expect(page).toHaveURL(/dock=ask/)
})

test('the Inbox puts its switch under the introduction, not beside it in 180 px', async ({
  page,
}) => {
  await go(page, '/inbox')
  const header = page.locator('[data-slot="card-header"]').first()
  const intro = header.locator('[data-slot="card-description"]')
  await expect(intro).toBeVisible()
  const box = await intro.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return {
      width: r.width,
      lines: Math.round(r.height / parseFloat(getComputedStyle(el).lineHeight)),
    }
  })
  expect(box.lines).toBeLessThanOrEqual(2)
  expect(box.width).toBeGreaterThanOrEqual(280)
  const below = await page.evaluate(() => {
    const intro = document.querySelector('[data-slot="card-description"]')!.getBoundingClientRect()
    const tabs = document.querySelector('[data-slot="card-action"]')!.getBoundingClientRect()
    return tabs.top >= intro.bottom
  })
  expect(below).toBe(true)
})

test('the editor toolbar shows an edge where it scrolls on', async ({ page }) => {
  await go(page, '/context/new')
  const toolbar = page.locator('.rte-toolbar').first()
  await expect(toolbar).toBeVisible()
  const overflow = await toolbar.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(overflow).toBeGreaterThan(0)
  // At the start the right edge fades; scrolled to the end the left edge does.
  const fades = () =>
    toolbar.evaluate((el) => {
      const s = getComputedStyle(el)
      return {
        mask: s.maskImage,
        start: s.getPropertyValue('--rte-toolbar-fade-start'),
        end: s.getPropertyValue('--rte-toolbar-fade-end'),
      }
    })
  const before = await fades()
  expect(before.mask).not.toBe('none')
  expect(parseFloat(before.end)).toBeGreaterThan(0)
  await toolbar.evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
  await expect.poll(async () => parseFloat((await fades()).start)).toBeGreaterThan(0)
})

test('a deep page on a phone leaves the theme to the nav menu, which still has it', async ({
  page,
}) => {
  await go(page, '/context/itm_norway_stop')
  await expect(page.getByRole('button', { name: /^Theme:/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Open the menu' }).click()
  await page.getByRole('button', { name: /Jon Abara/ }).click()
  await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
})
