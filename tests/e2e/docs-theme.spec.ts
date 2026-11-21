import { DOCS_URL } from '../../src/domain/brand.ts'
import { expect, go, test } from './go.ts'

// The Docs area's theme: the app's own control, at the end of its header at 1440 and on a phone,
// by keyboard, the same choice the rest of the app keeps; each picture in the reader's theme; and
// the line above every page, the release it describes and the same page on the web.

const widths = [
  { name: '1440', viewport: { width: 1440, height: 900 } },
  { name: '390', viewport: { width: 390, height: 844 } },
] as const

for (const { name, viewport } of widths)
  test.describe(name, () => {
    test.use({ viewport })

    test('the Docs area has the theme control, and keeps the choice the app keeps', async ({
      page,
    }) => {
      await go(page, '/docs/answer-lines')
      const html = page.locator('html')
      const theme = page.getByRole('banner').getByRole('button', { name: /^Theme:/ })
      await expect(theme).toHaveAccessibleName('Theme: System')
      await theme.focus()
      await page.keyboard.press('Enter')
      const menu = page.getByRole('menu')
      await expect(menu.getByRole('menuitemradio', { name: 'System' })).toBeChecked()
      await menu.getByRole('menuitemradio', { name: 'Dark' }).focus()
      await page.keyboard.press('Enter')
      await expect(html).toHaveClass(/\bdark\b/)
      await page.keyboard.press('Escape')
      await expect(theme).toHaveAccessibleName('Theme: Dark')

      // The choice holds on the next page of the docs and in the app.
      await page.reload()
      await expect(html).toHaveClass(/\bdark\b/)
      await expect(theme).toHaveAccessibleName('Theme: Dark')
      await go(page, '/inbox')
      await expect(html).toHaveClass(/\bdark\b/)

      // And the app's choice holds in the docs, on a fresh visit.
      await page.evaluate(() => window.localStorage.setItem('footnote-theme', 'light'))
      await page.goto('/docs/answer-lines')
      await expect(html).not.toHaveClass(/\bdark\b/)
      await expect(theme).toHaveAccessibleName('Theme: Light')
    })
  })

test('a picture shows its file for the theme the reader picked', async ({ page }) => {
  await go(page, '/docs/connect-an-agent?theme=dark')
  // The page holds both files; a reader, and a screen reader, gets the one of the theme alone.
  const picture = page.getByRole('img', { name: /^Connect an agent in Agents and access/ })
  await expect(page.locator('img[alt^="Connect an agent in Agents and access"]')).toHaveCount(2)
  await expect(picture).toHaveCount(1)
  await expect(picture).toHaveAttribute('src', /agents-dark/)
  await page
    .getByRole('banner')
    .getByRole('button', { name: /^Theme:/ })
    .click()
  await page.getByRole('menuitemradio', { name: 'Light' }).click()
  await expect(picture).toHaveAttribute('src', /agents-light/)
})

test('every page names its release and links to the same page on the web', async ({ page }) => {
  for (const [address, slug] of [
    ['/docs/answer-lines', 'answer-lines/'],
    ['/docs/changelog', 'changelog/'],
    ['/docs', ''],
  ] as const) {
    await go(page, address)
    const main = page.getByRole('main')
    await expect(main.getByText(/^Version \d+\.\d+$/)).toBeVisible()
    const web = main.getByRole('link', { name: 'Read the latest on the web' })
    await expect(web).toHaveAttribute('href', `${DOCS_URL}/${slug}`)
    await expect(web).toHaveAttribute('target', '_blank')
  }
})
