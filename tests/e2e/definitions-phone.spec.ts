import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// Definitions on a phone (release judge U1): at 390 wide every row shows its name, and nothing is
// drawn over anything. The rows that span the table (a group, New term) spanned all eight columns
// while a phone draws four, and the empty columns that made took the names' room in the fixed
// layout: each row showed its tile, its facts line and a flag drawn over them.

test.use({ viewport: { width: 390, height: 844 } })

/** The table's drawn header cells, which must fill it: no room goes to empty columns. */
const headerRoom = (page: Page) =>
  page.evaluate(() => {
    const table = document.querySelector('table')!
    const cells = [...table.tHead!.rows[0]!.cells].filter(
      (c) => getComputedStyle(c).display !== 'none',
    )
    return {
      table: Math.round(table.getBoundingClientRect().width),
      cells: Math.round(cells.reduce((w, c) => w + c.getBoundingClientRect().width, 0)),
    }
  })

/**
 * Each row's (and the totals') text and icons that cross another's: every text run and icon as
 * drawn, cut to the boxes that clip it, then compared pairwise. Words hidden for screen readers
 * clip to nothing and are left out.
 */
const overlaps = (page: Page) =>
  page.evaluate(() => {
    type Box = { what: string; l: number; t: number; r: number; b: number }
    const clipOf = (el: Element, row: Element, box: Box): Box | null => {
      let b = box
      for (let e: Element | null = el; e && e !== row; e = e.parentElement) {
        if (getComputedStyle(e).overflow === 'visible') continue
        const c = e.getBoundingClientRect()
        b = {
          ...b,
          l: Math.max(b.l, c.left),
          t: Math.max(b.t, c.top),
          r: Math.min(b.r, c.right),
          b: Math.min(b.b, c.bottom),
        }
      }
      return b.r - b.l > 1 && b.b - b.t > 1 ? b : null
    }
    const drawn = (row: Element) => {
      const boxes: Box[] = []
      const walk = document.createTreeWalker(row, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const el = n instanceof Element ? n : n.parentElement!
        if (n instanceof Element && !(n instanceof SVGSVGElement || n instanceof HTMLImageElement))
          continue
        if (!(n instanceof Element) && !n.textContent?.trim()) continue
        if (el.closest('svg') !== el && n instanceof Element) continue
        const range = document.createRange()
        range.selectNodeContents(n)
        const rects =
          n instanceof Element ? [n.getBoundingClientRect()] : [...range.getClientRects()]
        for (const r of rects) {
          const box = clipOf(el, row, {
            what:
              n instanceof Element ? `icon in ${el.parentElement?.textContent}` : n.textContent!,
            l: r.left,
            t: r.top,
            r: r.right,
            b: r.bottom,
          })
          if (box) boxes.push(box)
        }
      }
      return boxes
    }
    const crossed: string[] = []
    const rows = document.querySelectorAll('tbody tr:has([data-row-open]), tfoot tr')
    for (const row of rows) {
      const boxes = drawn(row)
      boxes.forEach((a, i) =>
        boxes.slice(i + 1).forEach((b) => {
          const w = Math.min(a.r, b.r) - Math.max(a.l, b.l)
          const h = Math.min(a.b, b.b) - Math.max(a.t, b.t)
          if (w > 0.5 && h > 0.5) crossed.push(`"${a.what}" and "${b.what}"`)
        }),
      )
    }
    return crossed
  })

test('every row shows its name at 390 wide', async ({ page }) => {
  await go(page, '/definitions')
  const names = page.locator('[data-row-open]')
  await expect(names.first()).toBeVisible()
  expect(await headerRoom(page)).toEqual(expect.objectContaining({ cells: 390, table: 390 }))
  const seen = await names.evaluateAll((buttons) =>
    buttons.map((b) => {
      const name = b.firstElementChild as HTMLElement
      return {
        name: b.getAttribute('data-row-open'),
        width: Math.round(b.getBoundingClientRect().width),
        whole: name.scrollWidth <= name.clientWidth + 1,
      }
    }),
  )
  expect(seen.length).toBeGreaterThan(10)
  // The demo's names are short enough to read whole on a phone.
  expect(seen.filter((s) => s.width < 40 || !s.whole)).toEqual([])
})

test('nothing in a row or the totals is drawn over anything at 390 wide', async ({ page }) => {
  await go(page, '/definitions')
  await expect(page.locator('[data-row-open]').first()).toBeAttached()
  await expect(page.locator('tfoot')).toBeVisible()
  expect(await overlaps(page)).toEqual([])
})

test('on a wide screen the columns fill the table, grouped or not by domain', async ({ page }) => {
  // Grouped by domain (the default) the Domain column is hidden, and its room once stood empty
  // beside Meaning.
  await page.setViewportSize({ width: 1440, height: 900 })
  await go(page, '/definitions')
  await expect(page.locator('[data-row-open]').first()).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Domain' })).toBeHidden()
  const grouped = await headerRoom(page)
  expect(grouped.cells).toBe(grouped.table)
  await page.getByRole('button', { name: 'Domain', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Type' }).click()
  await expect(page.getByRole('columnheader', { name: 'Domain' })).toBeVisible()
  const byType = await headerRoom(page)
  expect(byType.cells).toBe(byType.table)
})
