import { existsSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { releaseWords } from '../landing/release.ts'

/*
  The landing page's first screen, on the built site: its three states, what a reader with
  reduced motion gets, the release switch as it is built, an axe pass at WCAG AA, and screenshot
  baselines. Fonts render a little differently on each system, so each platform keeps its own
  baselines (Playwright's default path ends in the platform's name). Where a platform has none yet
  the check says so and skips; `npm run test:smoke -- e2e/landing.spec.ts --update-snapshots` on
  that platform writes them, for review by eye in a pull request.
*/

const themes = ['light', 'dark'] as const

async function open(page: Page, theme: (typeof themes)[number] = 'light') {
  await page.addInitScript((picked) => localStorage.setItem('footnote-theme', picked), theme)
  await page.goto('/')
  await page.evaluate(() => document.fonts.ready)
}

/** No violation of WCAG 2.1 A or AA, of any impact. */
async function expectAxeClean(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`),
  ).toEqual([])
}

const hero = (page: Page) => page.getByRole('region', { name: /Tell your AI agents/ })
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true })

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('opens on the finished state, with no canvas and nothing moving', async ({ page }) => {
    await open(page)
    await expect(page.locator('html')).not.toHaveClass(/\banim\b/)
    await expect(page.locator('canvas')).toHaveCount(0)
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0)
    // Everything of the opening is there at once: both readers, the note and its leaders.
    await expect(page.getByText('A person asks, in the browser')).toBeVisible()
    await expect(page.getByText('An agent asks, over MCP')).toBeVisible()
    await expect(
      hero(page).getByRole('heading', { name: 'Online sales to Norway stopped on 4 August 2026' }),
    ).toBeVisible()
    await expect(hero(page).locator('.wires path')).toHaveCount(2)
  })

  for (const width of [390, 1440])
    for (const theme of themes)
      test(`passes axe at AA in each state, at ${width} in ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        await open(page, theme)
        await expectAxeClean(page)
        for (const name of ['Conflict', 'Not found']) {
          await tab(page, name).click()
          await expectAxeClean(page)
        }
      })
})

test('the three buttons show what the demo answers, by mouse and by keyboard', async ({ page }) => {
  await open(page)
  const checked = tab(page, 'Checked')
  await expect(checked).toHaveAttribute('aria-selected', 'true')
  await expect(hero(page).getByText('"matched"')).toBeVisible()

  await tab(page, 'Conflict').click()
  await expect(tab(page, 'Conflict')).toHaveAttribute('aria-selected', 'true')
  await expect(hero(page).getByText('"conflict"')).toBeVisible()
  await expect(
    hero(page).getByRole('heading', { name: 'United Kingdom orders count store credit' }),
  ).toBeVisible()
  await expect(
    hero(page).getByRole('heading', {
      name: 'United Kingdom orders are card and cash payments only',
    }),
  ).toBeVisible()

  await page.keyboard.press('ArrowRight')
  await expect(tab(page, 'Not found')).toBeFocused()
  await expect(hero(page).getByText('"no_match"')).toBeVisible()
  await expect(hero(page).getByRole('heading', { name: 'No footnote' })).toBeVisible()

  await page.keyboard.press('Home')
  await expect(checked).toBeFocused()
  await expect(checked).toHaveAttribute('aria-selected', 'true')
})

test('the build before the release carries only its words, not the release words', async ({
  page,
}) => {
  // The page as it is served, hidden parts and all.
  const html = await (await page.request.get('/')).text()
  const before = releaseWords(false)
  const at = releaseWords(true)
  const text = (s: string) => s.replaceAll("'", '&#39;')
  for (const line of [before.heroMeta, before.installLede, before.startLine, before.endMeta])
    expect(html).toContain(text(line))
  for (const line of [at.heroMeta, at.installLede, at.startLine, at.endMeta, at.versionNote])
    expect(html).not.toContain(text(line))
  for (const words of ['0.1.0', 'two minutes', 'compose.images.yaml', 'published images'])
    expect(html).not.toContain(words)
})

const shots = [
  { name: 'first-screen-1440-light', viewport: { width: 1440, height: 900 }, theme: 'light' },
  { name: 'first-screen-1440-dark', viewport: { width: 1440, height: 900 }, theme: 'dark' },
  { name: 'first-screen-390-light', viewport: { width: 390, height: 844 }, theme: 'light' },
  {
    name: 'conflict-1440-light',
    viewport: { width: 1440, height: 900 },
    theme: 'light',
    state: 'Conflict',
  },
  {
    name: 'not-found-1440-light',
    viewport: { width: 1440, height: 900 },
    theme: 'light',
    state: 'Not found',
  },
] as const

test.describe('screenshots', () => {
  // Reduced motion draws no moving ground and plays no opening, so a screenshot is the same each time.
  test.use({ reducedMotion: 'reduce' })
  for (const shot of shots)
    test(shot.name, async ({ page }, info) => {
      const file = `${shot.name}.png`
      const update = info.config.updateSnapshots
      test.skip(
        !existsSync(info.snapshotPath(file)) && update !== 'all' && update !== 'changed',
        `No baseline of ${file} for ${process.platform} yet: write one with --update-snapshots`,
      )
      await page.setViewportSize(shot.viewport)
      await open(page, shot.theme)
      if ('state' in shot) await tab(page, shot.state).click()
      await expect(page).toHaveScreenshot(file, { caret: 'hide', maxDiffPixelRatio: 0.01 })
    })
})
