import { expect, go, test } from './go.ts'

// J63: the pixel slips. The header's icons sit on whole pixels in its 48 px bar, every line icon
// draws at one weight, the page titles start at one x, a context item's sheet starts on the same
// 72 px line as every other page, and a list row is 36 px.

test.describe('at 1440 px', () => {
  test('the header is 48 px and its icons sit on whole pixels', async ({ page }) => {
    await go(page, '/inbox')
    await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
    const header = await page.evaluate(() => {
      const bar = document.querySelector('header')!
      return {
        height: bar.getBoundingClientRect().height,
        tops: [...bar.querySelectorAll('svg')].map((icon) => icon.getBoundingClientRect().y),
      }
    })
    expect(header.height).toBe(48)
    expect(header.tops.filter((y) => !Number.isInteger(y))).toEqual([])
  })

  test('every line icon draws at the same weight', async ({ page }) => {
    for (const route of ['/inbox', '/definitions']) {
      await go(page, route)
      await expect(page.locator('[data-row-open]').first()).toBeVisible()
      const weights = await page.evaluate(() =>
        [...document.querySelectorAll('svg.lucide')].map((icon) => icon.getAttribute('stroke-width')),
      )
      expect(weights.length).toBeGreaterThan(0)
      expect([...new Set(weights)]).toEqual(['2'])
    }
  })

  test('the Inbox title starts at the same x as every other page title', async ({ page }) => {
    await go(page, '/observability/overview')
    const overview = await page
      .locator('[data-slot=page-scroll]')
      .getByRole('heading', { name: 'Overview', exact: true })
      .boundingBox()

    await go(page, '/inbox')
    const needsYou = await page.getByText('Needs you', { exact: true }).first().boundingBox()

    expect(needsYou?.x).toBe(overview?.x)
  })

  test('a context item starts on the 72 px line every page starts on', async ({ page }) => {
    await go(page, '/context/itm_norway_stop')
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    const top = await page.evaluate(() => {
      const sheet = [...document.querySelectorAll('main article, main section')].find(
        (el) => el.getBoundingClientRect().width > 300 && el.getBoundingClientRect().y > 40,
      )
      return sheet?.getBoundingClientRect().y
    })
    expect(top).toBe(72)
  })

  test('a list row is 36 px', async ({ page }) => {
    await go(page, '/context')
    await expect(page.locator('[data-row-open]').first()).toBeVisible()
    const height = await page.locator('tbody tr').first().evaluate((row) => row.getBoundingClientRect().height)
    expect(height).toBe(36)
  })
})
