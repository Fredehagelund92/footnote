import type { Page } from '@playwright/test'
import { card, expect, go, onMockOnly, test } from './go.ts'

// J137, the pixel pass, wave 5 (Q01): beside a 480 px dock a tablet's page was left about 340 px,
// so Writing help's strip broke into a column of one or two words, the field chips were cut and
// its header button sat on the Back arrow. Under 1100 px the dock is now a sheet over the page: the
// page keeps its width behind a scrim, inert, and the sheet closes on a press on the scrim, on
// Escape or on Close, with the sidebar left as it was. From 1100 px the dock stays beside the page,
// and on a phone it is still a screen of its own. Each width in light and dark.

/** Where an element is on the screen, to the whole pixel. */
const boxOf = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect()
      const [left, right, top, bottom] = [
        Math.round(r.left),
        Math.round(r.right),
        Math.round(r.top),
        Math.round(r.bottom),
      ]
      return { left, right, top, bottom, width: right - left }
    })

/** The sheet's box once it has slid in. */
const SHEET = '[role=dialog][aria-modal]'

/** The page's own panel, beside or under the dock. */
const PAGE = '[data-slot=sidebar-inset] [data-slot=resizable-panel]'

/** The sheet over the page, by the dock's title. */
const sheet = (page: Page, title: string) => page.getByRole('dialog', { name: title, exact: true })

/** The page header's buttons whose boxes overlap, as pairs of their names. */
const overlappingInHeader = (page: Page) =>
  page.locator('[data-site-header]').evaluate((header) => {
    const boxes = [...header.querySelectorAll<HTMLElement>('button, a[href]')]
      .map((el) => ({
        name: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim(),
        box: el.getBoundingClientRect(),
      }))
      .filter((c) => c.box.width > 0)
    return boxes.flatMap((a, i) =>
      boxes
        .slice(i + 1)
        .filter(
          (b) =>
            Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left) > 0.5 &&
            Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top) > 0.5,
        )
        .map((b) => `${a.name} / ${b.name}`),
    )
  })

/** Writing help on in Settings, then its first turn on a new item, from inside the app. */
async function writeWithHelp(page: Page) {
  await go(page, '/settings/advanced/writing-help')
  const toggle = page.getByRole('switch', { name: 'Let people write with writing help' })
  await toggle.click()
  await expect(toggle).toBeChecked()
  await go(page, '/context/new')
  await page
    .getByRole('textbox')
    .first()
    .fill('From 1 March 2026, returns in Norway are counted on the day of the refund.')
  await page.getByRole('button', { name: 'Write the draft' }).click()
  await expect(sheet(page, 'Writing help').getByText('I wrote a draft')).toBeVisible()
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme}`, () => {
    test.use({ colorScheme })

    test('on a tablet the dock is a sheet over the page, which keeps its width (Q01)', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 768, height: 1024 })
      await go(page, '/context')
      await expect(page.locator('[data-row-open]').first()).toBeVisible()
      const alone = await boxOf(page, PAGE)
      await go(page, '/context?dock=context.itm_norway_stop')
      const peek = sheet(page, 'Context')
      await expect(peek).toBeVisible()
      // As wide as beside the page, at the window's right edge once it has slid in.
      await expect.poll(async () => (await boxOf(page, SHEET)).right).toBe(768)
      expect((await boxOf(page, SHEET)).width).toBe(480)
      // The page underneath is not squeezed: it was 341 px beside the dock.
      expect(await boxOf(page, PAGE)).toEqual(alone)
      await expect(page.locator(PAGE).first()).toHaveAttribute('inert', '')
      // The page waits behind the scrim dialogs have, blurred, so the sheet stands out in dark too.
      const scrim = await page
        .locator('[data-slot=sidebar-inset] > .bg-scrim')
        .evaluate((el) => getComputedStyle(el).backdropFilter)
      expect(scrim).toContain('blur')
      // A press on the page behind closes it, and the sidebar is as it was: the rail.
      await page.mouse.click(120, 600)
      await expect(peek).toBeHidden()
      await expect(page).not.toHaveURL(/dock=/)
      await expect(page.locator('[data-slot=sidebar]')).toHaveAttribute('data-state', 'collapsed')
    })

    test('on a tablet Escape closes any panel in the sheet (Q01)', async ({ page }) => {
      await page.setViewportSize({ width: 820, height: 1180 })
      // A review is 720 wide beside a page; over a tablet's page it takes the page's whole width.
      await go(page, `/inbox?dock=review.${card('sug-ines')}`)
      const review = sheet(page, 'Review')
      await expect(review).toBeVisible()
      const inset = await boxOf(page, '[data-slot=sidebar-inset]')
      expect((await boxOf(page, SHEET)).width).toBe(Math.min(720, inset.width))
      await expect(review).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(review).toBeHidden()
      await expect(page).not.toHaveURL(/dock=/)
    })

    test('at 1024 px the sheet leaves the open sidebar open (Q01)', async ({ page }) => {
      await page.setViewportSize({ width: 1024, height: 768 })
      await go(page, '/context')
      const sidebar = page.locator('[data-slot=sidebar]')
      await expect(sidebar).toHaveAttribute('data-state', 'expanded')
      await go(page, '/context?dock=context.itm_norway_stop')
      await expect(sheet(page, 'Context')).toBeVisible()
      await expect(sidebar).toHaveAttribute('data-state', 'expanded')
      await sheet(page, 'Context').getByRole('button', { name: /Close/ }).click()
      await expect(sheet(page, 'Context')).toBeHidden()
    })

    test('on a tablet Writing help is a sheet and the editor keeps its width (Q01)', async ({
      page,
    }) => {
      await onMockOnly('Writing help with a model', async () => {
        await page.setViewportSize({ width: 768, height: 1024 })
        await writeWithHelp(page)
        // The strip over the draft is one line, as it is at 1440: it was twelve lines beside the dock.
        const strip = page.getByText('Writing help filled in').first()
        await expect(strip).toBeVisible()
        expect((await strip.boundingBox())!.height).toBeLessThan(32)
        // The editor's header has the room it has without a dock: no button on another.
        expect(await overlappingInHeader(page)).toEqual([])
        await page.mouse.click(120, 600)
        await expect(sheet(page, 'Writing help')).toBeHidden()
        expect(await overlappingInHeader(page)).toEqual([])
      })
    })

    test('from 1100 px the dock stays beside the page (Q01)', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await go(page, '/context?dock=context.itm_norway_stop')
      await expect(page.locator('[data-slot=dock]')).toBeVisible()
      await expect(page.locator(SHEET)).toHaveCount(0)
      await expect.poll(async () => (await boxOf(page, '[data-slot=dock]')).right).toBe(1440)
      const dock = await boxOf(page, '[data-slot=dock]')
      const beside = await boxOf(page, PAGE)
      expect(beside.right).toBeLessThanOrEqual(dock.left)
      await expect(page.locator(PAGE).first()).not.toHaveAttribute('inert', '')
      await expect(page.locator('[data-slot=sidebar]')).toHaveAttribute('data-state', 'collapsed')
    })

    test('on a phone the dock is still a screen of its own (Q01)', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await go(page, '/context?dock=context.itm_norway_stop')
      await expect(page.locator('[data-slot=dock]')).toBeVisible()
      await expect(page.locator(SHEET)).toHaveCount(0)
      await expect.poll(async () => (await boxOf(page, '[data-slot=dock]')).left).toBe(0)
      const dock = await boxOf(page, '[data-slot=dock]')
      expect(dock.width).toBe(390)
      await expect(page.getByRole('button', { name: 'Back' }).first()).toBeVisible()
    })
  })
}
