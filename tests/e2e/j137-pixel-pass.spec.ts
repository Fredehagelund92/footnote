import type { Page } from '@playwright/test'
import { expect, go, signInAs, test } from './go.ts'

// J137, the pixel pass: what a walk through every screen at 1440, tablet and phone widths found
// cut, covered or off, each pinned by its number. The Inbox frame keeps its gutter under it. Under
// 1024 px the sidebar starts as its icon rail, and the header folds by its own width. On a touch
// screen every page header draws its buttons 28 px with a 44 px tap area. A side panel's footer
// wraps before a button is cut, the review's compare table and the Context list keep to their
// frames, a line that is cut ends in an ellipsis, a card opened by its address shows its row, a
// mark keeps its size beside words that wrap, and an address is never broken at a hyphen.

/** Where an element is on the screen. */
const boxOf = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }
    })

/** The Inbox's frame: the bordered box that holds the list and the card. */
const FRAME = '[data-slot=sidebar-inset] .max-w-wide'

/** The page header's controls as drawn, with the tap area each has under a finger. */
const headerControls = (page: Page) =>
  page.locator('[data-site-header]').evaluate((header) =>
    [...header.querySelectorAll<HTMLElement>('button, a[href]')]
      .map((el) => {
        const box = el.getBoundingClientRect()
        const area = getComputedStyle(el, '::after')
        const grown = area.content !== 'none' && area.position === 'absolute'
        const width = Math.max(box.width, grown ? parseFloat(area.width) : 0)
        const height = Math.max(box.height, grown ? parseFloat(area.height) : 0)
        const x = box.left + box.width / 2
        return {
          name: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim(),
          drawn: { width: box.width, height: box.height },
          tap: { left: x - width / 2, right: x + width / 2, width, height },
        }
      })
      .filter((c) => c.drawn.width > 0),
  )

/** The pairs of header controls whose tap areas overlap: under a mouse, their boxes. */
const overlapping = (controls: Awaited<ReturnType<typeof headerControls>>) =>
  controls.flatMap((a, i) =>
    controls
      .slice(i + 1)
      .filter((b) => Math.min(a.tap.right, b.tap.right) - Math.max(a.tap.left, b.tap.left) > 0.5)
      .map((b) => `${a.name} / ${b.name}`),
  )

/** The words in the header that are cut short: a title with an ellipsis, a box that clips. */
const cutInHeader = (page: Page) =>
  page.locator('[data-site-header]').evaluate((header) =>
    [...header.querySelectorAll<HTMLElement>('*')]
      .filter((el) => el.clientWidth > 1 && el.scrollWidth > el.clientWidth + 1)
      .filter((el) => ['hidden', 'clip'].includes(getComputedStyle(el).overflowX))
      .map((el) => (el.textContent ?? '').trim().slice(0, 30)),
  )

test.describe('at 1440 px', () => {
  test('the Inbox frame keeps the same gutter under it as beside it (P01)', async ({ page }) => {
    let frameBottom = 0
    for (const route of ['/inbox', '/inbox?card=sug-ines']) {
      await go(page, route)
      await expect(page.locator('[data-row-open]').first()).toBeVisible()
      const frame = await boxOf(page, FRAME)
      // It once ran to the window's last pixel row, so the card's footer read as cut off.
      expect(900 - frame.bottom, route).toBe(24)
      expect(1440 - frame.right, route).toBe(24)
      expect(frame.top - 48, route).toBe(24)
      frameBottom = frame.bottom
    }
    // The open card's one decision, in its footer, is inside the frame.
    const action = await page.locator('[data-primary]').boundingBox()
    expect(action!.y + action!.height).toBeLessThan(frameBottom)
  })

  test('a card opened by its address shows its row whole in the list (P07)', async ({ page }) => {
    // The last cards of the list: the row is scrolled to before the two panes have their widths.
    for (const id of ['check-returns', 'flag-germany']) {
      await go(page, `/inbox?card=${id}`)
      const row = page.locator(`[data-row="${id}"]`)
      await expect(row).toBeVisible()
      await expect
        .poll(
          () =>
            row.evaluate((el) => {
              const list = el.closest('ul')!.parentElement!.getBoundingClientRect()
              const r = el.getBoundingClientRect()
              return r.top >= list.top - 0.5 && r.bottom <= list.bottom + 0.5
            }),
          { message: `${id} is whole inside the list` },
        )
        .toBe(true)
    }
  })

  test('a feedback line that is cut ends in an ellipsis (P06)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await go(page, '/observability/feedback')
    const lines = page.locator('#reports li p')
    await expect(lines.first()).toBeVisible()
    const cut = await lines.evaluateAll((ps) =>
      ps.map((p) => {
        const words = p.querySelector<HTMLElement>('span.truncate')
        return {
          // The row itself clips nothing: a flex row draws no ellipsis.
          row: getComputedStyle(p).overflowX,
          ellipsis: !!words && getComputedStyle(words).textOverflow === 'ellipsis',
          cut: !!words && words.scrollWidth > words.clientWidth,
        }
      }),
    )
    expect(cut.some((line) => line.cut)).toBe(true)
    expect(cut.filter((line) => line.row !== 'visible' || !line.ellipsis)).toEqual([])
  })

  test('the Context list fits its pane beside a side panel (P05)', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 820 })
    await go(page, '/context?dock=context.itm_norway_stop')
    const table = page.locator('[data-slot=sidebar-inset] table').first()
    await expect(table.locator('[data-row-open]').first()).toBeVisible()
    // The totals once held the title's column wide, and the row menus were pushed out of sight.
    const slides = await table.evaluate((t) => {
      const pane = t.parentElement!
      return pane.scrollWidth - pane.clientWidth
    })
    expect(slides).toBe(0)
    await expect(table.getByText(/due for a check$/)).toBeVisible()
  })

  test('a wrong address is written whole, never broken at a hyphen (P09)', async ({ page }) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 844 })
      await go(page, '/nowhere-at-all')
      const address = page.getByText('/nowhere-at-all.', { exact: true })
      await expect(address).toBeVisible()
      // One line of 14 px words, not "/nowhere-at-" and "all." on two.
      expect((await address.boundingBox())!.height, String(width)).toBeLessThan(28)
    }
  })
})

test.describe('between a phone and a laptop', () => {
  test('under 1024 px the sidebar starts as its icon rail, and opens when asked', async ({
    page,
  }) => {
    for (const width of [768, 1023]) {
      await page.setViewportSize({ width, height: 900 })
      await go(page, '/inbox')
      const sidebar = page.locator('[data-slot=sidebar]')
      await expect(sidebar).toHaveAttribute('data-state', 'collapsed')
      const header = await boxOf(page, '[data-site-header]')
      expect(header.left, String(width)).toBe(48)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    }
    // The rail is where it starts, not a lock: the toggle opens it.
    await page
      .locator('[data-site-header]')
      .getByRole('button', { name: 'Expand the sidebar' })
      .click()
    await expect(page.locator('[data-slot=sidebar]')).toHaveAttribute('data-state', 'expanded')
  })

  test('from 1024 px it starts open, and follows the window as it narrows and widens', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await go(page, '/inbox')
    const sidebar = page.locator('[data-slot=sidebar]')
    await expect(sidebar).toHaveAttribute('data-state', 'expanded')
    await page.setViewportSize({ width: 900, height: 900 })
    await expect(sidebar).toHaveAttribute('data-state', 'collapsed')
    await page.setViewportSize({ width: 1200, height: 900 })
    await expect(sidebar).toHaveAttribute('data-state', 'expanded')
  })

  test('at 768 px the Inbox has room for its list and its card, with nothing sideways', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await go(page, '/inbox?card=sug-ines')
    const decision = page.locator('[data-primary]')
    await expect(decision).toBeVisible()
    const frame = await boxOf(page, FRAME)
    expect(frame.width).toBe(768 - 48 - 2 * 24)
    expect(1024 - frame.bottom).toBe(24)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(768)
    // Beside the open sidebar the two panes had 243 px each, and the decision ran past its padding.
    const action = await decision.boundingBox()
    expect(action!.x + action!.width).toBeLessThanOrEqual(frame.right - 16)
    const list = await page.locator('[data-row-open]').first().boundingBox()
    expect(list!.width).toBeGreaterThanOrEqual(240)
  })

  test('at 768 px no header draws one part over another or cuts its title', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    for (const route of ['/inbox', '/context', '/definitions', '/ask', '/observability']) {
      await go(page, route)
      await expect(page.locator('[data-site-header] h1')).toBeVisible()
      expect(overlapping(await headerControls(page)), route).toEqual([])
      expect(await cutInHeader(page), route).toEqual([])
    }
    // The page's own action keeps its words while there is room for them.
    await go(page, '/context')
    await expect(page.locator('[data-site-header]').getByText('Write context')).toBeVisible()
  })

  test('a header folds by its own width: beside a panel an action is its icon, the title whole', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await go(page, '/context?dock=context.itm_norway_stop')
    const header = page.locator('[data-site-header]')
    const write = header.getByRole('button', { name: 'Write context' })
    await expect(write).toBeVisible()
    // 1440 beside a 480 px panel leaves the header its words.
    expect((await write.boundingBox())!.width).toBeGreaterThan(100)
    // The same window at 1100 does not: the action folds to its plus before the title is cut.
    await page.setViewportSize({ width: 1100, height: 900 })
    await expect.poll(async () => (await write.boundingBox())!.width).toBe(28)
    await expect(header.getByText('Write context')).toBeHidden()
    expect(await cutInHeader(page)).toEqual([])
  })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('every page header draws its buttons 28 px, each with a 44 px tap area of its own (P02)', async ({
    page,
  }) => {
    for (const route of [
      '/inbox',
      '/inbox/sug-ines/review',
      '/ask',
      '/context',
      '/context/itm_norway_stop',
      '/context/new?draft=norway',
      '/definitions',
      '/observability',
      '/settings/general',
    ]) {
      await go(page, route)
      await expect(page.locator('[data-site-header]')).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      await expect
        .poll(async () => (await headerControls(page)).length, { message: route })
        .toBeGreaterThan(1)
      const controls = await headerControls(page)
      // Drawn at the header's one size: the Inbox and the review once drew theirs 44 px, and
      // the Inbox's View as 28 by 44.
      expect(
        controls.filter((c) => c.drawn.height !== 28).map((c) => `${c.name} ${c.drawn.height}`),
        route,
      ).toEqual([])
      expect(
        controls
          .filter((c) => c.tap.width < 44 || c.tap.height < 44)
          .map((c) => `${c.name} ${c.tap.width}x${c.tap.height}`),
        route,
      ).toEqual([])
      expect(overlapping(controls), route).toEqual([])
    }
  })

  test('the main pages keep their title whole in the header', async ({ page }) => {
    for (const route of ['/inbox', '/ask', '/context', '/definitions']) {
      await go(page, route)
      await expect(page.locator('[data-site-header] h1')).toBeVisible()
      expect(await cutInHeader(page), route).toEqual([])
    }
  })

  test("the link in a read's band keeps to its line, with a tap area around it (P02)", async ({
    page,
  }) => {
    await go(page, '/inbox?demo=imported')
    const link = page.getByRole('link', { name: 'About this read' }).first()
    await expect(link).toBeVisible()
    const fit = await link.evaluate((a) => {
      const band = a.closest('li')!.getBoundingClientRect()
      const box = a.getBoundingClientRect()
      return {
        above: box.top - band.top,
        below: band.bottom - box.bottom,
        tap: parseFloat(getComputedStyle(a, '::after').height),
      }
    })
    // It once was a 44 px box in a 40 px band, its words against the band's top line.
    expect(fit.above).toBeGreaterThanOrEqual(8)
    expect(fit.below).toBeGreaterThanOrEqual(8)
    expect(fit.tap).toBe(44)
  })

  test("a side panel's footer keeps every button on the screen, the main one on its own row (P03)", async ({
    page,
  }) => {
    await go(page, '/observability?dock=topic.orders-spain')
    const main = page.getByRole('link', { name: 'Write context for this' })
    await expect(main).toBeVisible()
    const buttons = await main.evaluate((a) =>
      [...a.parentElement!.children].map((el) => {
        const r = el.getBoundingClientRect()
        return { left: r.left, right: r.right, top: r.top, height: r.height }
      }),
    )
    expect(buttons).toHaveLength(3)
    // It once started 41 px left of the screen: "Vrite context for this".
    for (const b of buttons) {
      expect(b.left).toBeGreaterThanOrEqual(16)
      expect(b.right).toBeLessThanOrEqual(390 - 16)
      expect(b.height).toBe(44)
    }
    expect(buttons[0]!.right - buttons[0]!.left).toBe(390 - 2 * 16)
    expect(buttons[1]!.top).toBeGreaterThan(buttons[0]!.top)
    expect(buttons[2]!.top).toBe(buttons[1]!.top)
  })

  test('a footer whose main action comes last still gives that action the row (P03)', async ({
    page,
  }) => {
    // Jon owns Sales, where the family waits: an admin makes him a member, and he signs in.
    await page.setViewportSize({ width: 1440, height: 900 })
    await go(page, '/inbox?demo=families')
    await signInAs(page, 'Ravi Kapoor')
    await go(page, '/settings/people')
    await page
      .getByRole('list', { name: 'People' })
      .getByRole('button', { name: /Jon Abara/ })
      .click()
    await page
      .getByRole('radiogroup', { name: 'Role' })
      .getByRole('radio', { name: 'Member' })
      .click()
    await expect(page.getByText('Jon Abara is a member now')).toBeVisible()
    await signInAs(page, 'Jon Abara')
    await page.setViewportSize({ width: 390, height: 844 })
    await go(page, '/inbox?card=names:waiting&dock=family.group:packaging_costs')
    const main = page
      .getByRole('region', { name: 'Suggested family' })
      .getByRole('button', { name: 'Publish as a family' })
    await expect(main).toBeVisible()
    const buttons = await main.evaluate((b) =>
      [...b.parentElement!.children].map((el) => {
        const r = el.getBoundingClientRect()
        return { left: r.left, right: r.right, top: r.top, height: r.height }
      }),
    )
    expect(buttons.length).toBeGreaterThan(1)
    const last = buttons[buttons.length - 1]!
    expect(last.right - last.left).toBe(390 - 2 * 16)
    expect(last.height).toBe(44)
    for (const b of buttons.slice(0, -1)) expect(b.top).toBeLessThan(last.top)
  })

  test('the compare table keeps its verdict inside its frame (P04)', async ({ page }) => {
    await go(page, '/inbox/gap-spain/review')
    const table = page.getByRole('table').filter({ hasText: 'In the copied sentence' })
    await expect(table).toBeVisible()
    const fit = await table.evaluate((t) => ({
      over: t.getBoundingClientRect().width - t.parentElement!.getBoundingClientRect().width,
      cut: [...t.querySelectorAll('td')].filter((td) => td.scrollWidth > td.clientWidth + 1).length,
    }))
    // "Not sure. Compare them." once lost its last letters to the frame's edge.
    expect(fit.over).toBeLessThanOrEqual(0)
    expect(fit.cut).toBe(0)
    await expect(table.getByText('Not sure. Compare them.').first()).toBeVisible()
  })

  test('the Context list gives its titles the room, and the dot its 40 px (P05)', async ({
    page,
  }) => {
    await go(page, '/context')
    const table = page.locator('[data-slot=sidebar-inset] table').first()
    await expect(table.locator('[data-row-open]').first()).toBeVisible()
    const columns = await table.evaluate((t) => {
      const row = t.querySelector('tbody [data-row-open]')!.closest('tr')!
      const widths = [...row.children]
        .map((cell) => cell.getBoundingClientRect().width)
        .filter((w) => w > 0)
      const pane = t.parentElement!
      return { widths, slides: pane.scrollWidth - pane.clientWidth }
    })
    // The totals once sat in the dot's column and held it 128 px wide: every title lost 88 px.
    expect(columns.widths.at(-1)).toBe(40)
    expect(columns.widths.at(-2)).toBe(390 - 36 - 40)
    expect(columns.slides).toBe(0)
  })

  test('a mark keeps its size, on the first line, beside words that wrap (P08)', async ({
    page,
  }) => {
    await go(page, '/settings/integrations/google-drive/connect')
    await expect(page.getByRole('heading', { name: 'What it will hold' })).toBeVisible()
    const marks = await page.locator('main ul li:has(> svg)').evaluateAll((rows) =>
      rows.map((li) => {
        const mark = li.querySelector('svg')!.getBoundingClientRect()
        const row = li.getBoundingClientRect()
        return { size: `${mark.width}x${mark.height}`, down: mark.top - row.top, rows: row.height }
      }),
    )
    // One list, one size: a tick beside two lines was once 11 px, beside one line 16.
    expect(marks.some((m) => m.rows > 20)).toBe(true)
    expect([...new Set(marks.map((m) => m.size))]).toEqual(['16x16'])
    expect([...new Set(marks.map((m) => m.down))]).toEqual([2])
  })

  test('a report card says what opens, with nothing beside anything (P09)', async ({ page }) => {
    await go(page, '/inbox?card=flag-germany')
    await expect(page.getByText('It opens with the report')).toBeVisible()
    await expect(page.getByText(/beside the list/)).toHaveCount(0)
  })
})
