import { expect, test } from '@playwright/test'
import { movedPages, sitePages } from '../lib/pages.ts'
import { repository } from '../lib/repository.ts'

/*
  The docs as a newcomer meets them, on the built site: the home says what the product is and
  holds its way in and its four doors on the first screen, search finds the page a newcomer asks
  for first, an old address forwards to where its page is now, and every page can be edited on
  GitHub and copied as Markdown.
*/

const pages = sitePages()

test('the home opens with what it is, Try the demo, and four doors, on the first screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/docs/')
  const main = page.locator('main')
  await expect(main.getByRole('link').first()).toHaveText('Try the demo')
  await expect(main.getByRole('link').first()).toHaveAttribute('href', '/docs/try-the-demo/')
  const doors = main.getByRole('navigation', { name: 'Where to start' }).getByRole('link')
  await expect(doors).toHaveText([
    /^I own numbers/,
    /^I ask questions/,
    /^I connect an agent/,
    /^I run it/,
  ])
  for (const shown of [main.locator('.footnote-lead'), ...(await doors.all())]) {
    const box = (await shown.boundingBox())!
    expect(box.y + box.height, await shown.innerText()).toBeLessThanOrEqual(900)
  }
})

for (const { words, first } of [
  { words: 'install', first: 'Try the demo' },
  { words: 'quick start', first: 'Try the demo' },
  { words: 'words', first: 'Words' },
  { words: 'glossary', first: 'Words' },
])
  test(`search for "${words}" finds ${first} first`, async ({ page }) => {
    await page.goto(`/docs/?q=${encodeURIComponent(words)}`)
    const results = page.locator('.pagefind-ui__result-link')
    await expect(results.first()).toHaveText(first)
  })

for (const [from, to] of Object.entries(movedPages))
  test(`the old address of ${to} forwards to it`, async ({ page }) => {
    await page.goto(`/docs/${from}/`)
    await expect(page).toHaveURL(new RegExp(`/docs/${to}/$`))
    await expect(page.locator('h1')).toHaveText(pages.find((p) => p.slug === to)!.title)
  })

test('every page has Edit page, which opens its Markdown on main', async ({ request }) => {
  for (const { slug, file } of pages) {
    const html = await (await request.get(`/docs/${slug}/`)).text()
    expect(html, slug).toContain(`href="${repository}/edit/main/${file}"`)
  }
})

test('Copy as Markdown copies the page as llms-full.txt gives it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/docs/try-the-demo/')
  await page.getByRole('button', { name: 'Copy as Markdown' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Copied' })).toBeVisible()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toMatch(/^# Try the demo\n\n> The quick start\./)
  expect(copied).toContain('docker compose up')
  const full = await (await page.request.get('/docs/llms-full.txt')).text()
  expect(full).toContain(copied.trim())
})

test("the landing page names Answer lines by the page's own title", async ({ page }) => {
  await page.goto('/')
  const title = pages.find((p) => p.slug === 'answer-lines')!.title
  await expect(page.locator('a[href="/docs/answer-lines/"]')).toHaveText(title)
})
