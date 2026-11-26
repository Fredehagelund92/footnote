import { expect, go, mode, test } from './go.ts'

// J113: a pick in the Context list's Filter menu moves the rows to their new places in a view
// transition, with the menu still open over them. A moving row takes a picture of its own, drawn
// over the page's, so the menu takes one too, after the rows: it stays whole on top while they
// move, never seeming to sit under the table.

type Frame = { menu: string; after: boolean; rows: number }

test('the Filter menu stays over the rows while a pick moves them', async ({ page }) => {
  test.skip(mode === 'http', 'The drafts are the mock demo’s.')
  await go(page, '/context')
  const count = page.getByText(/ of \d+ context items$/)
  await expect(count).toBeVisible()
  // The count is drawn with the page's frame; the rows come a frame later (a deferred value). A pick
  // made before them has no row to move, and no transition of rows to look at.
  await expect(page.locator('[data-vt-move]').first()).toBeVisible()
  const before = await count.innerText()
  await page.getByRole('button', { name: /^Filter/ }).click()
  const draft = page.getByRole('menuitemcheckbox', { name: /^Draft/ })
  await expect(draft).toBeVisible()
  // Each frame of the move: the menu's picture, and whether it is drawn after every moving row.
  await page.evaluate(() => {
    const w = window as unknown as { frames: Frame[] }
    w.frames = []
    const look = () => {
      const menu = document.querySelector('[data-slot=dropdown-menu-content]')
      if (document.documentElement.dataset.vt === 'filters' && menu) {
        const rows = [...document.querySelectorAll('[data-vt-move]')].filter(
          (el) => getComputedStyle(el).viewTransitionName !== 'none',
        )
        w.frames.push({
          menu: getComputedStyle(menu).viewTransitionName,
          after: rows.every(
            (r) => !!(r.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING),
          ),
          rows: rows.length,
        })
      }
      requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  })
  await draft.click()
  await expect(count).not.toHaveText(before)
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { frames: Frame[] }).frames.some((f) => f.rows > 0),
      ),
    )
    .toBe(true)
  const frames = await page.evaluate(() => (window as unknown as { frames: Frame[] }).frames)
  for (const f of frames) expect(f).toEqual({ menu: 'match-element', after: true, rows: f.rows })
  // The menu is still open, ticked, once the rows are in place.
  await expect(draft).toHaveAttribute('aria-checked', 'true')
})
