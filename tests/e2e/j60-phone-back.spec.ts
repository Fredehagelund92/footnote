import { devices } from '@playwright/test'
import { card, expect, go, test } from './go.ts'

// J60, the way back on a phone (UX audit P14, design audit F13): the item, definition, review and
// conflict pages have a back arrow in their header, the title keeps room to be read, and the
// editor's toolbar shows an edge where it scrolls on.

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

test('a deep page on a phone leaves the theme to the menu, which still has it', async ({
  page,
}) => {
  await go(page, '/context/itm_norway_stop')
  await expect(page.getByRole('button', { name: /^Theme:/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Open the menu' }).click()
  await page.getByRole('button', { name: /Jon Abara/ }).click()
  await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
})
