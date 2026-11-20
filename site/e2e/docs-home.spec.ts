import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

/*
  The docs' home on the built site: the landing page's still dot ground behind its title, none
  behind a reading page and none with reduced motion, and screenshot baselines. As with the
  landing page (e2e/landing.spec.ts), each platform keeps its own baselines, and one with none
  skips them: `npm run test:smoke -- e2e/docs-home.spec.ts --update-snapshots` writes them.
*/

const themes = ['light', 'dark'] as const

async function open(page: Page, path: string, theme: (typeof themes)[number] = 'light') {
  await page.addInitScript((picked) => localStorage.setItem('footnote-theme', picked), theme)
  await page.goto(path)
  await page.evaluate(() => document.fonts.ready)
}

/** The dots drawn behind the page's column, or none. */
function ground(page: Page) {
  return page.evaluate(() => {
    const frame = document.querySelector('.main-frame')
    if (!frame) return 'no page'
    const before = getComputedStyle(frame, '::before')
    return before.content === 'none' ? 'none' : before.backgroundImage
  })
}

test('the home has the dot ground, and a reading page has none', async ({ page }) => {
  await open(page, '/docs/')
  expect(await ground(page)).toContain('radial-gradient')
  await open(page, '/docs/get-started/')
  expect(await ground(page)).toBe('none')
})

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the home has no dot ground', async ({ page }) => {
    await open(page, '/docs/')
    expect(await ground(page)).toBe('none')
  })
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
      // The marks that now and then land on the sidebar's dots (shared/ground.ts) are not the page.
      await page.addStyleTag({ content: '.ground { visibility: hidden; }' })
      await expect(page).toHaveScreenshot(file, { caret: 'hide', maxDiffPixelRatio: 0.01 })
    })
})
