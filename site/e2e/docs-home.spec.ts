import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

/*
  The docs on the built site: no dot ground on any page, the home's nor a reading page's, and
  screenshot baselines of the home. As with the landing page (e2e/landing.spec.ts), each platform
  keeps its own baselines, and one with none skips them:
  `npm run test:smoke -- e2e/docs-home.spec.ts --update-snapshots` writes them.
*/

const themes = ['light', 'dark'] as const

async function open(page: Page, path: string, theme: (typeof themes)[number] = 'light') {
  await page.addInitScript((picked) => localStorage.setItem('footnote-theme', picked), theme)
  await page.goto(path)
  await page.evaluate(() => document.fonts.ready)
}

/** What draws dots on the page: the still field behind it and the canvas of landing marks. */
function dots(page: Page) {
  return page.evaluate(() => ({
    field: getComputedStyle(document.body, '::before').backgroundImage,
    canvas: document.querySelectorAll('canvas').length,
  }))
}

for (const path of ['/docs/', '/docs/get-started/'])
  test(`${path} has no dot ground`, async ({ page }) => {
    await open(page, path)
    // Long enough for a landing mark to have started, were there one.
    await page.waitForTimeout(1500)
    expect(await dots(page)).toEqual({ field: 'none', canvas: 0 })
  })

const shots = [
  { name: 'docs-home-1440-light', viewport: { width: 1440, height: 900 }, theme: 'light' },
  { name: 'docs-home-1440-dark', viewport: { width: 1440, height: 900 }, theme: 'dark' },
  { name: 'docs-home-390-light', viewport: { width: 390, height: 844 }, theme: 'light' },
  { name: 'docs-home-390-dark', viewport: { width: 390, height: 844 }, theme: 'dark' },
] as const

test.describe('screenshots', () => {
  for (const shot of shots)
    test(shot.name, async ({ page }, info) => {
      const file = `${shot.name}.png`
      const update = info.config.updateSnapshots
      test.skip(
        !existsSync(info.snapshotPath(file)) && update !== 'all' && update !== 'changed',
        `No baseline of ${file} for ${process.platform} yet: write one with --update-snapshots`,
      )
      await page.setViewportSize(shot.viewport)
      await open(page, '/docs/', shot.theme)
      await expect(page).toHaveScreenshot(file, { caret: 'hide', maxDiffPixelRatio: 0.01 })
    })
})
