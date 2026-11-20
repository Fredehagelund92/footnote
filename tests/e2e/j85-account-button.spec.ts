import { existsSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import { expect, go, mode, test } from './go.ts'

// J85, the account button at the foot of the sidebar: it shows the avatar and the name, and no
// more. What the person owns can be a long list, so it is in the menu the button opens, where it
// wraps inside the menu. A person who owns eight domains with long names, at 1440 and 390, light
// and dark, and with the sidebar folded to its icons. The menu's baselines are the mock's, one set
// per platform: where a platform has none yet the picture is skipped, and `--update-snapshots` on
// that platform writes them.

const longNames = [
  'Customer lifetime value and retention',
  'Wholesale partner revenue and margins',
  'Subscription billing and renewals',
  'Warehouse operations and fulfilment',
  'Product catalogue and pricing rules',
  'Regional marketing attribution',
  'Support tickets and satisfaction',
]

/** Jon owns Sales; each domain he adds is his too, so he owns eight. */
async function ownEight(page: Page) {
  for (const name of longNames) {
    await go(page, '/settings/domains')
    await page
      .getByRole('list', { name: 'Domains' })
      .getByRole('listitem')
      .filter({ hasText: 'Add a domain' })
      .click()
    await page.getByRole('textbox', { name: 'Name' }).fill(name)
    await page.getByRole('button', { name: 'Add the domain' }).click()
    await expect(page).toHaveURL(/\/settings\/domains\/(?!new)/)
  }
  // Each add says so in a toast; the menu is looked at once they have gone.
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 20_000 })
}

/** The parts of `box` drawn past its edges, by their text. */
const spills = (box: Locator) =>
  box.evaluate((el) => {
    const edge = el.getBoundingClientRect()
    const out: string[] = []
    for (const child of el.querySelectorAll<HTMLElement>('*')) {
      const r = child.getBoundingClientRect()
      // Nothing drawn: a text for screen readers alone is a clipped pixel.
      if (r.width <= 1 || r.height <= 1) continue
      if (
        r.left < edge.left - 0.5 ||
        r.right > edge.right + 0.5 ||
        r.top < edge.top - 0.5 ||
        r.bottom > edge.bottom + 0.5
      )
        out.push(child.textContent?.trim() || child.tagName)
    }
    return out
  })

/** The account button, in the sidebar's sheet on a phone. */
async function accountButton(page: Page, width: number) {
  if (width < 768) await page.getByRole('button', { name: /menu/i }).first().click()
  return page
    .locator('[data-sidebar=sidebar] [data-sidebar=footer]')
    .last()
    .getByRole('button', { name: /Jon Abara Owner of / })
}

for (const { width, height } of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  for (const theme of ['light', 'dark'] as const) {
    test.describe(`${width} ${theme}`, () => {
      test.use({ viewport: { width, height }, colorScheme: theme })

      test('the account button shows the name, and the menu what they own', async ({
        page,
      }, info) => {
        await go(page, `/inbox?theme=${theme}`)
        await ownEight(page)
        await go(page, '/inbox')

        const button = await accountButton(page, width)
        await expect(button).toHaveAccessibleName(/Jon Abara Owner of .*Support tickets/)
        await expect(button.getByText('Jon Abara')).toBeVisible()
        // What they own is for screen readers there, not drawn.
        expect((await button.getByText(/Owner of/).boundingBox())!.width).toBeLessThanOrEqual(1)
        await expect(button).toHaveAttribute('title', /^Jon Abara, Owner of .*Support tickets/)
        expect(await spills(button)).toEqual([])

        await button.click()
        const menu = page.getByRole('menu')
        await expect(menu).toContainText('Owner of Sales, Customer lifetime value')
        await expect(menu).toContainText('Support tickets and satisfaction, admin')
        expect(await spills(menu)).toEqual([])
        const box = (await menu.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(width)
        expect(box.y + box.height).toBeLessThanOrEqual(height)
        const shot = `j85-menu-${width}-${theme}.png`
        const update = info.config.updateSnapshots
        if (
          mode === 'mock' &&
          (existsSync(info.snapshotPath(shot)) || update === 'all' || update === 'changed')
        )
          await expect(menu).toHaveScreenshot(shot, { maxDiffPixelRatio: 0.01 })
      })
    })
  }
}

test('folded to its icons, the account button is the avatar alone', async ({ page }) => {
  await go(page, '/inbox')
  await ownEight(page)
  await go(page, '/inbox')
  await page.getByRole('button', { name: 'Collapse the sidebar', exact: true }).click()
  const button = await accountButton(page, 1440)
  await expect(button).toHaveAttribute('title', /^Jon Abara, Owner of /)
  // Measured once the fold has stopped moving.
  await expect
    .poll(async () => {
      const box = (await button.boundingBox())!
      return [box.width, box.height]
    })
    .toEqual([32, 32])
  expect(await spills(button)).toEqual([])
})
