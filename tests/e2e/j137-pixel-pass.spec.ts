import type { Locator, Page } from '@playwright/test'
import { expect, go, newContext, signInAs, test } from './go.ts'

// J137, the pixel pass: what a walk through every screen at 1440, tablet and phone widths found
// cut, covered or off, each pinned by its number. The Inbox frame keeps its gutter under it. Under
// 1024 px the sidebar starts as its icon rail, and the header folds by its own width. On a touch
// screen every page header draws its buttons 28 px with a 44 px tap area. A side panel's footer
// wraps before a button is cut, the review's compare table and the Context list keep to their
// frames, a line that is cut ends in an ellipsis, a card opened by its address shows its row, a
// mark keeps its size beside words that wrap, and an address is never broken at a hyphen.
//
// Wave 2: on a tablet an item waiting for review keeps its title and folds its other choices into
// More, and the editor's foot keeps to its bar (P10). A small avatar has its initials (P11). Ask's
// sources are one row shape (J70, P12). The documentation's header fits a tablet (P13). On a phone
// a button beside a few words goes under them (P14).
//
// Wave 3: in Context by time the today line runs under the bars and their names, and a name whose
// box starts off the screen keeps its start in view, cut with an ellipsis, never by the edge (P15).
// A table too wide for its frame stacks its rows, so Advanced and Google Drive cut nothing (P16).
//
// Wave 4: a bar that runs past the window's right edge keeps its name inside the window, cut with
// an ellipsis (Q06). A full stop after a chip in the editor stays on the chip's line (Q02). On a
// phone Context's Sort and Select fold into the Filter menu, and the box's third choice is a link
// under its two buttons on purpose (Q03). The editor's toolbar fades where it goes on, and its footer
// keeps one line (Q04). Ask's read line never ends a line with a dot (Q05).

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

/** Where a row's button sits: beside its words, on their line, or under them at their left edge. */
const placeOf = (button: Locator) =>
  button.evaluate((el) => {
    const words = el.parentElement!.previousElementSibling!.getBoundingClientRect()
    const box = el.getBoundingClientRect()
    if (box.top < words.bottom - 1) return 'beside'
    return Math.abs(box.left - words.left) < 1 ? 'under' : `under, ${box.left - words.left} px off`
  })

/** The rows of P14, each with its button: a setup step, a banner, an empty page's step. */
const ROWS_WITH_A_BUTTON = [
  ['/inbox?demo=setup', 'Write context'],
  ['/settings/integrations?state=reauth', 'Replace key'],
  ['/observability?state=empty', 'Connect an agent'],
] as const

test.describe('wave 2, at 1440 px', () => {
  test('an item waiting for review shows its choices in the header, with no More (P10)', async ({
    page,
  }) => {
    await go(page, '/context/sug-agent')
    const header = page.locator('[data-site-header]')
    await expect(header.getByRole('button', { name: "Don't publish" })).toBeVisible()
    await expect(header.getByRole('button', { name: 'Send back with a note' })).toBeVisible()
    await expect(header.getByRole('button', { name: 'More' })).toBeHidden()
  })

  test('Send to the owner is one run of words, one space between them (P10)', async ({ page }) => {
    await go(page, '/context/itm_norway_stop/suggest')
    const send = page
      .locator('[data-site-header]')
      .getByRole('button', { name: /^Send to the owner of / })
    await expect(send).toBeVisible()
    // The button's gap once stood between Send and the rest: two spaces' width.
    const gap = await send.evaluate((button) => {
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT)
      const words: DOMRect[] = []
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent ?? ''
        for (const word of ['Send', 'to']) {
          const at = text.indexOf(word)
          if (at < 0 || words.length > (word === 'Send' ? 0 : 1)) continue
          const range = document.createRange()
          range.setStart(n, at)
          range.setEnd(n, at + word.length)
          words.push(range.getBoundingClientRect())
        }
      }
      return words[1]!.left - words[0]!.right
    })
    expect(gap).toBeLessThan(6)
  })

  test('a row keeps its button beside its words where there is room (P14)', async ({ page }) => {
    // Observability's steps sit in a narrow column beside the chart, so they fold there too.
    for (const [route, name] of ROWS_WITH_A_BUTTON.slice(0, 2)) {
      // A whole load: the mock takes a page's state (a refused key) from the address it opens at.
      await page.goto(route)
      const button = page.getByRole('button', { name, exact: true }).last()
      await expect(button).toBeVisible()
      expect(await placeOf(button), route).toBe('beside')
    }
  })

  test("a term's marks are in one column, its author a face with initials (P11)", async ({
    page,
  }) => {
    await go(page, '/definitions?show=terms')
    await expect(
      page.getByRole('columnheader', { name: 'Needs a look, and who wrote it' }),
    ).toHaveCount(1)
    const faces = page.locator('main table [data-initials]')
    await expect(faces.first()).toBeVisible()
    for (const face of await faces.all()) {
      const box = (await face.boundingBox())!
      expect(box.width).toBe(20)
      expect(await face.evaluate((el) => getComputedStyle(el, '::after').content)).toMatch(
        /^"[A-Z]{2}"$/,
      )
    }
  })
})

test.describe('wave 2, on a tablet', () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true })

  test('an item waiting for review keeps its title, its other choices in More (P10)', async ({
    page,
  }) => {
    await go(page, '/context/sug-agent')
    const header = page.locator('[data-site-header]')
    await expect(header.getByRole('button', { name: 'Publish' })).toBeVisible()
    // Its three other choices once left the title four letters: "Context > P...".
    await expect(header.getByRole('button', { name: "Don't publish" })).toBeHidden()
    const title = header.locator('[aria-current=page]')
    expect((await title.boundingBox())!.width).toBeGreaterThan(160)
    expect(overlapping(await headerControls(page))).toEqual([])
    await header.getByRole('button', { name: 'More' }).click()
    const menu = page.getByRole('menu')
    for (const choice of ['Edit', 'Send back with a note', "Don't publish"])
      await expect(menu.getByRole('menuitem', { name: choice })).toBeVisible()
  })

  test("the editor's foot keeps its words to one line in its bar, its mark square (P10)", async ({
    page,
  }) => {
    await newContext(page)
    const foot = page.locator('footer').filter({ hasText: 'Not ready' })
    await expect(foot).toBeVisible()
    expect((await foot.boundingBox())!.height).toBe(48)
    const status = foot.getByText(/^Not ready/)
    // It once wrapped to three lines in the 48 px bar, cut above and below, its mark squeezed.
    expect((await status.boundingBox())!.height).toBeLessThanOrEqual(20)
    await expect(status).toHaveAttribute('title', /^Not ready: add /)
    const mark = await foot.locator('svg').last().boundingBox()
    expect(mark!.width).toBe(mark!.height)
  })

  for (const width of [768, 820, 1023])
    test(`the documentation's header fits ${width} px on one line (P13)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1024 })
      await go(page, '/docs')
      const header = page.locator('header').first()
      await expect(header.getByRole('link', { name: "What's new" })).toBeVisible()
      // It was 855 px wide, so a touch browser drew the whole page 10% small to fit it.
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
      for (const tab of ['Guides', 'Reference', "What's new"])
        expect(
          (await header.getByRole('link', { name: tab }).boundingBox())!.height,
        ).toBeLessThanOrEqual(28)
      // Search is its magnifier, as on a phone, and the app is a link away.
      expect(
        (await header.getByRole('button', { name: 'Search the docs' }).boundingBox())!.width,
      ).toBe(28)
      await expect(header.getByRole('link', { name: 'Open the app' })).toBeVisible()
    })
})

test.describe('wave 2, on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('a button beside a few words goes under them, at their left edge (P14)', async ({
    page,
  }) => {
    for (const [route, name] of ROWS_WITH_A_BUTTON) {
      // A whole load: the mock takes a page's state (a refused key) from the address it opens at.
      await page.goto(route)
      const button = page.getByRole('button', { name, exact: true }).last()
      await expect(button).toBeVisible()
      expect(await placeOf(button), route).toBe('under')
    }
    // The setup steps: Write context once left its words four short lines.
    await go(page, '/inbox?demo=setup')
    const step = page.getByRole('listitem').filter({ hasText: 'Write what you know' })
    const words = step.getByText(/^Two sentences/)
    expect((await words.boundingBox())!.height).toBeLessThanOrEqual(2 * 20)
  })
})

/** Each name in By time whose box is on screen: where it is against the box and the screen's edge. */
const timeNames = (page: Page) =>
  page.locator('.time-scroller').evaluate((scroller) => {
    const view = scroller.getBoundingClientRect()
    const gut = scroller.querySelector('.time-lane-gut')?.getBoundingClientRect().width ?? 0
    const edge = view.left + gut
    return [...scroller.querySelectorAll<HTMLElement>('.time-name')].flatMap((name) => {
      const box = name.parentElement!.getBoundingClientRect()
      if (box.right <= edge + 1 || box.left >= view.right) return []
      const r = name.getBoundingClientRect()
      return [
        {
          title: name.textContent ?? '',
          fromEdge: r.left - edge,
          pastBox: r.right - box.right,
          pastWindow: r.right - view.right,
          roomRight: view.right - r.left,
          startsOff: box.left < edge - 1,
        },
      ]
    })
  })

/** What is drawn on top where the today line crosses a name's words, for each name it crosses. */
const overTheLine = (page: Page) =>
  page.locator('.time-scroller').evaluate((scroller) => {
    const view = scroller.getBoundingClientRect()
    const line = scroller.querySelector('.time-today')!.getBoundingClientRect()
    const x = line.left + line.width / 2
    return [...scroller.querySelectorAll<HTMLElement>('.time-name > span')]
      .map((words) => words.getBoundingClientRect())
      .filter((r) => r.left < x - 2 && r.right > x + 2 && r.width > 0)
      .filter((r) => r.top >= view.top && r.bottom <= view.bottom)
      .map((r) => {
        const top = document.elementFromPoint(x, r.top + r.height / 2)
        return top?.closest('.time-today') ? 'line' : top?.closest('.time-name') ? 'name' : 'other'
      })
  })

/** A colour's opacity, as the browser resolves it. */
const alphaOf = (color: string) => Number(/\/\s*([\d.]+)\)$/.exec(color)?.[1] ?? 1)

for (const [width, height] of [
  [1440, 900],
  [768, 1024],
  [390, 844],
] as const)
  test(`by time at ${width} px, the today line runs under the names, and none is cut by the edge (P15)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height })
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await go(page, '/context?view=time')
      const scroller = page.locator('.time-scroller')
      await expect(scroller.locator('.time-today')).toBeVisible()
      await expect.poll(async () => (await timeNames(page)).length).toBeGreaterThan(3)

      // Where it opens, the words of a bar that goes on past the right edge end in an ellipsis,
      // not in the edge (Q06).
      const cutAtEdge = await scroller.evaluate((el) => {
        const view = el.getBoundingClientRect()
        return [...el.querySelectorAll<HTMLElement>('.time-name > span')]
          .filter((words) => {
            const box = words.closest('button')!.getBoundingClientRect()
            return box.right > view.right + 1 && box.left < view.right
          })
          .map((words) => words.scrollWidth > words.clientWidth + 1)
      })
      expect(cutAtEdge.some(Boolean), colorScheme).toBe(true)

      // The line once drew over the bars: "28 | April 2026", "Fra | nce".
      const crossed = await overTheLine(page)
      expect(crossed.length, colorScheme).toBeGreaterThan(0)
      expect(
        crossed.filter((top) => top !== 'name'),
        colorScheme,
      ).toEqual([])
      // A bar lets a little through, so the line still shows, faint, under its words.
      const fill = await scroller
        .locator('.time-bar[data-state=checked]')
        .first()
        .evaluate((bar) => getComputedStyle(bar).backgroundColor)
      expect(alphaOf(fill), `${colorScheme} ${fill}`).toBeGreaterThan(0.5)
      expect(alphaOf(fill), `${colorScheme} ${fill}`).toBeLessThan(1)

      // Where the view opens, and moved back and on: a name keeps its start in view while its box
      // is on screen, and ends inside its box. On a phone short bars' names were once sliced.
      for (const by of [0, -160, 320]) {
        await scroller.evaluate((el, d) => el.scrollBy({ left: d }), by)
        await page.evaluate(() => new Promise(requestAnimationFrame))
        const names = await timeNames(page)
        const where = `${colorScheme}, moved ${by}`
        expect(
          names.filter((n) => n.fromEdge < -0.5).map((n) => n.title),
          where,
        ).toEqual([])
        expect(
          names.filter((n) => n.pastBox > 0.5).map((n) => n.title),
          where,
        ).toEqual([])
        // A bar that runs on past the right edge: its name was cut there, mid-letter (Q06). One
        // that starts within 20 px of that edge has no room for words, only its padding.
        expect(
          names.filter((n) => n.pastWindow > 0.5 && n.roomRight > 20).map((n) => n.title),
          where,
        ).toEqual([])
      }
      await scroller.evaluate((el) => el.scrollBy({ left: -160 }))
      await page.evaluate(() => new Promise(requestAnimationFrame))
      expect((await timeNames(page)).some((n) => n.startsOff)).toBe(true)
    }
    if (width !== 390) return
    // The year over the months stops short of the screen's edge, as the groups' names do.
    const year = await page
      .locator('.time-tick-top > span')
      .first()
      .evaluate((label) => {
        const range = document.createRange()
        range.selectNodeContents(label)
        return range.getBoundingClientRect().left
      })
    // "2026" once sat 4 px from the edge.
    expect(year).toBeGreaterThanOrEqual(8)
  })

/** Whatever in the page slides sideways inside its box, by how much. */
const slides = (page: Page) =>
  page.locator('[data-slot=sidebar-inset]').evaluate((inset) =>
    [...inset.querySelectorAll<HTMLElement>('*')]
      .filter((el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX))
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => `${el.className.slice(0, 40)} ${el.scrollWidth - el.clientWidth}`),
  )

test.describe('wave 3, on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('Advanced stacks each setting: its key, its value, then the rest, nothing cut (P16)', async ({
    page,
  }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await go(page, '/settings/advanced')
      const settings = page.getByRole('group', { name: 'Tuning settings' })
      const setting = settings
        .getByRole('listitem')
        .filter({ hasText: 'calendar.fiscal_year_start' })
      // It was a 1,029 px table in a 356 px frame: "Not set: f", cut at the screen's edge.
      await expect(setting).toBeVisible()
      await expect(setting).toContainText('Not set: fiscal years read as calendar years')
      await expect(setting).toContainText('Default, from the install')
      await expect(page.getByRole('table', { name: 'Tuning settings' })).toHaveCount(0)
      await expect(page.getByText(/scroll sideways/)).toHaveCount(0)
      const frame = (await page
        .locator('[data-slot=sidebar-inset] .rounded-frame')
        .first()
        .boundingBox())!
      for (const block of await settings.getByRole('listitem').all()) {
        const box = (await block.boundingBox())!
        expect(box.x + box.width, colorScheme).toBeLessThanOrEqual(frame.x + frame.width + 0.5)
      }
      expect(await slides(page), colorScheme).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
    }
  })

  test("Google Drive's folders stack, each owner's name whole (P16)", async ({ page }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      // A whole load: the mock takes a page's state (a refused key) from the address it opens at.
      await page.goto('/settings/integrations/google-drive?state=reauth')
      const folder = page
        .getByRole('listitem')
        .filter({ hasText: 'Data team / Definitions' })
        .filter({ hasText: 'Owners' })
      await expect(folder).toBeVisible()
      // The Owners column was cut: "Jon Abara...".
      const owners = folder.getByText('Jon Abara and Sofia Brandt')
      await expect(owners).toBeVisible()
      expect(await owners.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
      await expect(folder.getByRole('definition').filter({ hasText: /^6$/ })).toBeVisible()
      await expect(page.getByRole('table')).toHaveCount(0)
      expect(await slides(page), colorScheme).toEqual([])
    }
  })
})

test.describe('wave 3, wider', () => {
  test('a table that fits stays a table, and one that does not stacks, never cut (P16)', async ({
    page,
  }) => {
    // At 1440 the five columns of the tuning settings fit whole.
    await go(page, '/settings/advanced')
    const table = page.getByRole('table', { name: 'Tuning settings' })
    await expect(table.getByRole('columnheader', { name: 'What it does' })).toBeInViewport()
    expect(await slides(page)).toEqual([])
    // At 1280 they did not: "The workspace's name, on th". Each setting is a block of two halves.
    await page.setViewportSize({ width: 1280, height: 900 })
    const setting = page
      .getByRole('group', { name: 'Tuning settings' })
      .getByRole('listitem')
      .filter({ hasText: 'workspace.name' })
    await expect(setting).toBeVisible()
    expect(
      await setting.evaluate((li) => getComputedStyle(li).gridTemplateColumns.split(' ').length),
    ).toBe(2)
    await expect(page.getByRole('table', { name: 'History log' })).toBeVisible()
    expect(await slides(page)).toEqual([])
    // A tablet has room for Google Drive's tables.
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto('/settings/integrations/google-drive?state=reauth')
    await expect(page.getByRole('table').first()).toBeVisible()
    await expect(page.getByRole('table')).toHaveCount(2)
    expect(await slides(page)).toEqual([])
  })
})

test.describe('wave 4, on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('a full stop after a chip in the editor stays on the chip line (Q02)', async ({ page }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await go(page, '/context/itm_norway_stop/edit')
      const chips = page.locator('.ProseMirror .mention-chip')
      await expect(chips.first()).toBeVisible()
      // Each chip with its punctuation after it: a chip as long as the line once took the line
      // whole, and the full stop sat alone under it.
      const apart = await page.locator('.ProseMirror').evaluate((doc) =>
        [...doc.querySelectorAll<HTMLElement>('.mention-chip')].flatMap((chip) => {
          const node = chip.closest<HTMLElement>('[data-node-view-wrapper]')!.parentElement!
          const next = node.nextSibling
          const mark = /^[.,;:!?)]+/.exec(next?.textContent ?? '')?.[0]
          if (!next || !mark) return []
          const range = document.createRange()
          range.setStart(next, 0)
          range.setEnd(next, mark.length)
          const box = chip.getBoundingClientRect()
          const at = range.getBoundingClientRect()
          return [{ chip: chip.textContent, below: at.top - box.top, inside: at.right <= 390 }]
        }),
      )
      expect(apart.length, colorScheme).toBeGreaterThan(1)
      for (const a of apart) {
        expect(a.below, `${colorScheme} ${a.chip}`).toBeLessThan(8)
        expect(a.inside, `${colorScheme} ${a.chip}`).toBe(true)
      }
    }
  })

  test('Context folds Sort and Select into the Filter menu (Q03)', async ({ page }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await go(page, '/context')
      await expect(page.getByRole('textbox', { name: 'Search context' })).toBeVisible()
      // No Sort or Select control of its own, alone on a row under Filter and Group.
      await expect(page.getByRole('button', { name: /^Sort/ })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Select' })).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
      await page.getByRole('button', { name: /^Filter/ }).click()
      await expect(page.getByRole('menuitemradio', { name: /^Title/ })).toBeVisible()
      await page.getByRole('menuitem', { name: 'Select' }).click()
      await expect(page.getByRole('checkbox', { name: 'Select all context shown' })).toBeVisible()
      await page.getByRole('button', { name: /^Filter/ }).click()
      await expect(page.getByRole('menuitem', { name: 'Done selecting' })).toBeVisible()
      await page.keyboard.press('Escape')
      await go(page, '/context?view=time')
      await expect(page.getByRole('radiogroup', { name: 'Zoom' })).toBeVisible()
    }
  })

  test('the "What happened?" box puts its third choice as a link under the buttons (Q03)', async ({
    page,
  }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await go(page, '/context/new')
      const fill = page.getByRole('button', { name: 'Fill it in' })
      const agent = page
        .getByRole('button', { name: /^Write with your agent|^Copy the prompt/ })
        .or(page.getByRole('link', { name: /Write with your agent/ }))
        .first()
      await expect(fill).toBeVisible()
      const first = (await fill.boundingBox())!
      const third = (await agent.boundingBox())!
      expect(third.y, colorScheme).toBeGreaterThan(first.y + first.height)
      // A link: underlined, with no button box drawn (a transparent border keeps the size only).
      const look = await agent.evaluate((el) => {
        const css = getComputedStyle(el)
        return { line: css.textDecorationLine, bg: css.backgroundColor, edge: css.borderTopColor }
      })
      expect(look.line, colorScheme).toBe('underline')
      expect(look.bg, colorScheme).toBe('rgba(0, 0, 0, 0)')
      expect(look.edge, colorScheme).toBe('rgba(0, 0, 0, 0)')
    }
  })

  test("Ask's read line never ends a line with a dot (Q05)", async ({ page }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await go(page, '/ask?example=loop-dates-anchored')
      const line = page.locator('p', { hasText: /^Read as/ })
      await expect(line).toBeVisible()
      const dots = await line.evaluate((p) => {
        const els = [...p.querySelectorAll<HTMLElement>('*')]
        // What follows a dot: the part beside it in its group, or else the next group.
        const partAfter = (dot: HTMLElement) =>
          dot.nextElementSibling ?? dot.parentElement?.nextElementSibling
        const apart: string[] = []
        let dotCount = 0
        for (const dot of els.filter(
          (el) => el.matches('span[aria-hidden]') && el.textContent === '·',
        )) {
          dotCount++
          const next = partAfter(dot)?.getBoundingClientRect()
          const at = dot.getBoundingClientRect()
          // The part after a dot starts on the dot's own line, never on the next one down.
          if (next && next.top > at.top + at.height) apart.push(String(partAfter(dot)?.textContent))
        }
        return { apart, dotCount, height: p.getBoundingClientRect().height }
      })
      // It wraps on a phone, and no dot is left behind at the end of a line.
      expect(dots.dotCount, colorScheme).toBeGreaterThan(1)
      expect(dots.apart, colorScheme).toEqual([])
      expect(dots.height, colorScheme).toBeGreaterThan(40)
    }
  })
})

test.describe('wave 4, on the narrowest phone', () => {
  test.use({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true })

  test('the editor toolbar fades where it goes on, and the footer keeps one line at 360 (Q04)', async ({
    page,
  }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await go(page, '/context/itm_norway_stop/edit')
      // The row is wider than the screen: the phone's own scroller fades 40 px at the end it goes
      // on at, and none at the end it is scrolled to. It faded 24 px, a button half in view.
      const bar = page.locator('.rte-toolbar').first()
      await expect(bar).toBeVisible()
      const fadeAt = () =>
        bar.evaluate((el) => ({
          cut: el.scrollWidth > el.clientWidth,
          end: getComputedStyle(el).getPropertyValue('--rte-toolbar-fade-end').trim(),
        }))
      await bar.evaluate((el) => el.scrollTo({ left: 0 }))
      await expect.poll(fadeAt, { message: colorScheme }).toEqual({ cut: true, end: '40px' })
      await bar.evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
      await expect.poll(fadeAt, { message: colorScheme }).toEqual({ cut: true, end: '0px' })
      const status = page.locator('footer').getByText('No changes yet')
      await expect(status).toBeVisible()
      // "No changes yet" was on two lines.
      expect((await status.boundingBox())!.height, colorScheme).toBeLessThan(24)
      expect(await page.evaluate(() => document.documentElement.scrollWidth), colorScheme).toBe(360)
    }
  })
})

test.describe('wave 4, beside a panel', () => {
  test('the editor toolbar beside a panel at 820 fades where it is cut (Q04)', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 800 })
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await go(page, '/context/itm_norway_stop/edit?dock=context.itm_kh4llvi9')
      const bar = page.locator('.rte-toolbar-scroll')
      await expect(bar).toBeVisible()
      // Cut after Insert in the old layout, with nothing to say there was more.
      expect(await bar.evaluate((el) => el.scrollWidth > el.clientWidth), colorScheme).toBe(true)
      await expect(bar).toHaveAttribute('data-more', 'end')
    }
  })
})
