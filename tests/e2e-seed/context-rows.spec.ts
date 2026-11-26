import { expect, test, type Page } from '@playwright/test'

/*
  Context on the demo's 1,500 items (playwright.seed.config.ts), the list the mock's 25 never
  shows the cost of: a click on Context from the Inbox draws its first rows at once, the page holds
  no task long enough to freeze it, and it reads the library the shell already holds instead of
  reading its 1.4 MB again. Only the rows in view are drawn; the keys and Select all still reach
  every row.
*/

/** Watches, in the page, for the first row of the list and for long tasks, from the next click. */
async function watchFromNextClick(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      tasks: { start: number; duration: number }[]
      clickedAt?: number
      rowsAt?: number
    }
    w.tasks = []
    new PerformanceObserver((list) => {
      for (const t of list.getEntries()) w.tasks.push({ start: t.startTime, duration: t.duration })
    }).observe({ type: 'longtask' })
    // The frame after the row is in the document is the one that shows it.
    const seen = () => {
      if (w.rowsAt === undefined && document.querySelector('main tbody [data-row-open]'))
        requestAnimationFrame(() => (w.rowsAt ??= performance.now()))
    }
    new MutationObserver(seen).observe(document.body, { childList: true, subtree: true })
    addEventListener('click', () => (w.clickedAt ??= performance.now()), {
      capture: true,
      once: true,
    })
  })
}

/** How long after the click the first row showed, and every long task since the click. */
const measured = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as {
      tasks: { start: number; duration: number }[]
      clickedAt: number
      rowsAt?: number
    }
    return {
      rows: w.rowsAt === undefined ? Infinity : w.rowsAt - w.clickedAt,
      tasks: w.tasks.filter((t) => t.start >= w.clickedAt).map((t) => Math.round(t.duration)),
    }
  })

const list = (page: Page) => page.getByRole('main').locator('tbody')
const rowStops = (page: Page) => list(page).locator('[data-row-open]')

test('Context draws its rows within half a second of the click and never freezes', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/inbox$/)
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
  // The Inbox's own reads settle first, so what follows is Context's alone.
  await page.waitForLoadState('networkidle')
  const library: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/library') library.push(request.method())
  })
  await watchFromNextClick(page)
  await page.getByRole('link', { name: 'Context', exact: true }).click()
  await expect(rowStops(page).first()).toBeVisible()
  await expect(page.getByText(/of 1,\d{3} context items/)).toBeVisible()
  // Five seconds of the page as it settles: its other reads (conflicts) land in them.
  await page.waitForTimeout(5000)
  const { rows, tasks } = await measured(page)
  console.log(
    `Context: rows ${Math.round(rows)} ms after the click; long tasks ${tasks.join(', ')}`,
  )
  expect(rows).toBeLessThan(500)
  expect(tasks.filter((t) => t > 200)).toEqual([])
  // The shell read the library a moment ago: the page uses that answer.
  expect(library).toEqual([])
})

test('only the rows in view are drawn, and the keys and Select all reach every row', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/inbox$/)
  await page.goto('/context')
  await expect(rowStops(page).first()).toBeVisible()
  const total = Number(
    (await page.getByText(/of 1,\d{3} context items/).textContent())!
      .match(/of ([\d,]+)/)![1]!
      .replace(',', ''),
  )
  // The footer counts every row the filters let through, drawn or not: published, then waiting
  // for review and drafts.
  const foot = await page
    .locator('main tfoot')
    .getByText(/published/)
    .textContent()
  const shown = [...foot!.matchAll(/([\d,]+) [a-z]/g)].reduce(
    (sum, m) => sum + Number(m[1]!.replace(',', '')),
    0,
  )
  expect(shown).toBeGreaterThan(1000)
  expect(shown).toBeLessThanOrEqual(total)
  expect(await rowStops(page).count()).toBeLessThan(100)

  // End goes to the last row of the whole list, which is drawn when it is reached; Home comes back.
  const first = await rowStops(page).first().getAttribute('data-row-open')
  await rowStops(page).first().focus()
  await page.keyboard.press('End')
  const last = page.locator(':focus')
  await expect(last).toHaveAttribute('data-row-open', /.+/)
  await expect(last).toBeInViewport()
  const lastId = await last.getAttribute('data-row-open')
  expect(lastId).not.toBe(first)
  // Up from the last row goes to the one before it, drawn already.
  await page.keyboard.press('ArrowUp')
  await expect(page.locator(':focus')).not.toHaveAttribute('data-row-open', lastId!)
  await page.keyboard.press('Home')
  await expect(page.locator(':focus')).toHaveAttribute('data-row-open', first!)
  expect(await rowStops(page).count()).toBeLessThan(100)

  // Down, one row at a time past the rows first drawn, keeps the cursor on a row in view.
  for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowDown')
  await expect(page.locator(':focus')).toHaveAttribute('data-row-open', /.+/)
  await expect(page.locator(':focus')).toBeInViewport()

  // Select all ticks every row shown, not only the drawn ones.
  await page.getByRole('checkbox', { name: 'Select all context shown' }).click()
  await expect(page.getByRole('region', { name: 'Selected context' })).toContainText(
    `${shown.toLocaleString('en-GB')} selected`,
  )
  await page.keyboard.press('Escape')

  // Scrolled to the bottom, the last rows are drawn and the add row closes the list.
  await page.getByRole('main').locator('tbody').hover()
  await page.mouse.wheel(0, 200_000)
  await expect(
    page.getByRole('table').getByRole('button', { name: 'Write context' }),
  ).toBeInViewport()
  await expect(rowStops(page).last()).toHaveAttribute('data-row-open', lastId!)
})
