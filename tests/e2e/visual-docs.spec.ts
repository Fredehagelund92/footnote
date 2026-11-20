import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// Screenshot baselines of the Docs area, at 1440 and 390 wide, light and dark: the first screen of
// the home, of three pages and of What's new, and the parts a theme can get wrong: a picture of a
// screen, a code block, a note and a table. Fonts render a little differently on each system, so
// each platform keeps its own baselines (Playwright's default path ends in the platform's name).
// Where a platform has none yet the check says so and skips; `npx playwright test tests/e2e/visual-docs.spec.ts
// --update-snapshots` on that platform writes them, for review by eye in a pull request.

/** Each place's first screen, and its parts by a selector inside the page's body. */
const places: { name: string; address: string; parts?: Record<string, string> }[] = [
  { name: 'home', address: '/docs' },
  {
    name: 'connect',
    address: '/docs/connect-an-agent',
    parts: { picture: 'figure:has(img)', code: 'figure:has(pre)', note: 'aside' },
  },
  // The six answer lines, drawn from the app's own list.
  { name: 'answer-lines', address: '/docs/answer-lines' },
  { name: 'tools', address: '/docs/tools', parts: { table: 'div:has(> table)' } },
  { name: 'changelog', address: '/docs/changelog' },
]
const widths = [
  { name: '1440', viewport: { width: 1440, height: 900 } },
  { name: '390', viewport: { width: 390, height: 844 } },
] as const

for (const { name: width, viewport } of widths)
  for (const theme of ['light', 'dark'] as const)
    test.describe(`${width}, ${theme}`, () => {
      test.use({ viewport, colorScheme: theme })
      for (const { name, address, parts = {} } of places)
        test(name, async ({ page }, info) => {
          const shot = (part: string) => `${name}${part}-${width}-${theme}.png`
          const update = info.config.updateSnapshots
          test.skip(
            !existsSync(info.snapshotPath(shot(''))) && update !== 'all' && update !== 'changed',
            `No baseline of ${shot('')} for ${process.platform} yet: write one with --update-snapshots`,
          )
          const look = { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 } as const
          await page.goto(`${address}?theme=${theme}`)
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
          // Every picture of the page, loaded: they load lazily, as the reader scrolls.
          await page.evaluate(async () => {
            const pictures = [...document.querySelectorAll('img')]
            for (const img of pictures) img.loading = 'eager'
            await Promise.all(pictures.map((img) => img.decode().catch(() => undefined)))
            await document.fonts.ready
          })
          await expect(page).toHaveScreenshot(shot(''), look)
          // A part taller than the screen is taken in pieces, so the header that stays on top
          // would land on it.
          await page.addStyleTag({ content: 'header { visibility: hidden }' })
          const body = page.locator('[data-docs="body"]')
          for (const [part, selector] of Object.entries(parts))
            await expect(body.locator(selector).first()).toHaveScreenshot(shot(`-${part}`), look)
        })
    })
