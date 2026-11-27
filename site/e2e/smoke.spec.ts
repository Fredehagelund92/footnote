import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/*
  The site as a reader meets it, on the built pages: in light and dark, on a phone and a wide
  screen, nothing goes wrong in the console, nothing loads from another host, nothing scrolls
  sideways, and axe finds nothing serious. Then the few things that only work in a browser: the
  landing page, the docs and the 404 page are set in one design, the theme is one for the whole
  site, and search finds a page.
*/

const pages = ['/', '/404.html', '/docs/', '/docs/try-the-demo/', '/docs/configuration/']
const widths = [390, 1440]
const themes = ['light', 'dark'] as const

/** Opens a page with the theme already picked, and keeps what goes wrong while it is open. */
async function open(page: Page, path: string, theme: (typeof themes)[number]) {
  const problems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => problems.push(`page: ${error.message}`))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol !== 'data:')
      problems.push(`another host: ${request.url()}`)
  })
  await page.addInitScript((picked) => localStorage.setItem('footnote-theme', picked), theme)
  await page.goto(path, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  return problems
}

for (const width of widths)
  for (const theme of themes)
    for (const path of pages)
      test(`${path} at ${width} in ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        const problems = await open(page, path, theme)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        // Long enough for the landing page's opening to play to its end.
        await page.waitForTimeout(path === '/' ? 6000 : 300)
        const sideways = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        )
        expect(sideways, 'the page scrolls sideways').toBeLessThanOrEqual(0)
        const { violations } = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()
        const serious = violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`)
        expect(serious).toEqual([])
        expect(problems).toEqual([])
      })

test('the landing page, the docs and the 404 page are set in one design', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  /** What a reader sees of the design at the top of a page: its ground, its font, the logo and Run the demo. */
  async function look(path: string) {
    await page.goto(path)
    await page.evaluate(() => document.fonts.ready)
    return page.evaluate(() => {
      const css = (selector: string) => getComputedStyle(document.querySelector(selector)!)
      const [body, brand, run] = [css('body'), css('.brand'), css('a.btn-main')]
      return {
        ground: body.backgroundColor,
        font: body.fontFamily.split(',')[0],
        brand: [brand.fontSize, brand.fontWeight, brand.letterSpacing, brand.color],
        run: [run.height, run.borderRadius, run.fontSize, run.backgroundColor, run.color],
        header: document.querySelector('header')!.getBoundingClientRect().height,
      }
    })
  }
  const landing = await look('/')
  expect(landing.font).toContain('Inter')
  expect(await look('/docs/')).toEqual(landing)
  expect(await look('/docs/try-the-demo/')).toEqual(landing)
  expect(await look('/404.html')).toEqual(landing)
})

test('the theme a reader picks holds from the landing page to the docs and back', async ({
  page,
}) => {
  // Without a pick every page opens dark.
  await page.goto('/docs/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Docs' }).click()
  await expect(page).toHaveURL(/\/docs\/$/)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: 'Switch to dark mode' }).first().click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('search in the docs finds a page', async ({ page }) => {
  await page.goto('/docs/?q=privacy')
  const results = page.locator('.pagefind-ui__result-link')
  await expect(results.first()).toBeVisible()
  await expect(results.filter({ hasText: 'Privacy' }).first()).toBeVisible()
})
