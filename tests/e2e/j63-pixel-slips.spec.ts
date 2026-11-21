import { expect, go, test } from './go.ts'

// J63: the pixel slips. The header's icons sit on whole pixels in its 48 px bar, every line icon
// draws at one weight, the page titles start at one x, a context item's sheet starts on the same
// 72 px line as every other page, and a list row is 36 px. The icons the header's right end holds,
// the sidebar's logo, Back to app and user row sit on whole pixels too, no icon in the app is a
// character the web font lacks, and the small notes keep a reading measure.

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
        [...document.querySelectorAll('svg.lucide')].map((icon) =>
          icon.getAttribute('stroke-width'),
        ),
      )
      expect(weights.length).toBeGreaterThan(0)
      expect([...new Set(weights)]).toEqual(['2'])
    }
  })

  test('the Inbox title starts at the same x as every other page title', async ({ page }) => {
    await go(page, '/observability')
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
    const height = await page
      .locator('tbody tr')
      .first()
      .evaluate((row) => row.getBoundingClientRect().height)
    expect(height).toBe(36)
  })

  test('the header actions sit on whole pixels, left and right', async ({ page }) => {
    for (const route of [
      '/ask',
      '/definitions',
      '/context',
      '/context/itm_norway_stop',
      '/context/new',
      '/inbox/sug-ines-link/review',
      '/settings/general',
    ]) {
      await go(page, route)
      await expect(page.locator('[data-header-actions] svg').first()).toBeVisible()
      const slips = await page.evaluate(() =>
        [...document.querySelectorAll('[data-header-actions] svg')]
          .map((icon) => icon.getBoundingClientRect())
          .filter((r) => !Number.isInteger(r.x) || !Number.isInteger(r.y))
          .map((r) => `${r.x}, ${r.y}`),
      )
      expect(slips, route).toEqual([])
    }
  })

  test('the sidebar header and foot keep their icons on whole pixels', async ({ page }) => {
    for (const route of ['/settings/general', '/observability', '/inbox/sug-ines-link/review']) {
      await go(page, route)
      await expect(page.locator('header').first()).toBeVisible()
      const slips = await page.evaluate(() =>
        [
          ...document.querySelectorAll(
            '[data-slot=sidebar] :is([data-slot=sidebar-header], [data-slot=sidebar-footer]) svg',
          ),
        ]
          .map((icon) => icon.getBoundingClientRect())
          .filter((r) => !Number.isInteger(r.x) || !Number.isInteger(r.y))
          .map((r) => `${r.x}, ${r.y}`),
      )
      expect(slips, route).toEqual([])
    }
  })

  test('no command key sign or triangle is left for the system font to draw', async ({ page }) => {
    for (const route of [
      '/inbox',
      '/ask',
      '/observability/alerts',
      '/inbox/sug-ines-link/review',
    ]) {
      await go(page, route)
      await expect(page.locator('main').first()).toBeVisible()
      const found = await page.evaluate(() => {
        const out: string[] = []
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        for (let n = walk.nextNode(); n; n = walk.nextNode())
          for (const c of (n as Text).data) if ('\u2318\u25bc'.includes(c)) out.push(c)
        return out
      })
      expect(found, route).toEqual([])
    }
  })

  test('the Advanced paragraphs keep a reading measure', async ({ page }) => {
    // The 60 characters of the reading width, in the font and size of the text itself.
    const overMeasure = (words: string) =>
      page.getByText(words).evaluate((el) => {
        const gauge = document.createElement('div')
        gauge.style.cssText = 'position:absolute;visibility:hidden;width:60ch'
        el.append(gauge)
        const measure = gauge.getBoundingClientRect().width
        gauge.remove()
        return el.getBoundingClientRect().width - measure
      })

    await go(page, '/settings/advanced')
    for (const words of ['Each setting is kept in the database', 'Default means the value']) {
      await expect(page.getByText(words)).toBeVisible()
      expect(await overMeasure(words)).toBeLessThanOrEqual(1)
    }
  })
})
