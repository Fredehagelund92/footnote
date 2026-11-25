import { expect, go, test } from './go.ts'
import type { Page } from '@playwright/test'

// J60: keyboard focus in the Context and Definitions lists (UX audit P13). The row in focus
// shows a ring, not just the grey the pointer draws; Enter opens the side panel and focus goes
// into it; Escape closes it from inside; and focus comes back to the row it opened from. J steps
// the panel on and keeps focus in it, so a second J and Escape still work, and Escape then goes
// back to the row of the item the panel shows.

const lists = [
  { name: 'Context', path: '/context', dock: 'dock=context.', panel: 'Context' },
  { name: 'Definitions', path: '/definitions', dock: 'dock=def.', panel: 'Definition' },
]

/** The first row's open button, reached by the keyboard as a person would. */
async function focusFirstRow(page: Page) {
  const first = page.locator('[data-row-open]').first()
  await first.focus()
  await expect(first).toBeFocused()
  return first
}

for (const list of lists) {
  test.describe(list.name, () => {
    test('the focused row has a ring the pointer does not draw', async ({ page }) => {
      await go(page, list.path)
      const first = await focusFirstRow(page)
      const ringOf = (open: ReturnType<Page['locator']>) =>
        open.locator('xpath=ancestor::tr').evaluate((tr) => getComputedStyle(tr).boxShadow)
      const ring = await ringOf(first)
      expect(ring, 'a 3px ring inside the focused row').toMatch(/inset/)
      expect(ring).toMatch(/3px/)
      // Another row under the pointer gets its grey wash only.
      const other = page.locator('[data-row-open]').nth(1)
      await other.locator('xpath=ancestor::tr').hover()
      expect(await ringOf(other)).not.toMatch(/3px/)
    })

    test('Enter opens the panel with focus in it; Escape closes it and the row has focus again', async ({
      page,
    }) => {
      await go(page, list.path)
      const first = await focusFirstRow(page)
      const id = await first.getAttribute('data-row-open')
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(new RegExp(`${list.dock}`))
      const panel = page.getByRole('region', { name: list.panel, exact: true })
      await expect(panel).toBeVisible()
      // Focus is in the panel, on its title, not left on the row.
      await expect
        .poll(() => panel.evaluate((el) => el.contains(document.activeElement)))
        .toBe(true)
      await expect(first).not.toBeFocused()
      await page.keyboard.press('Escape')
      await expect(page).not.toHaveURL(new RegExp(`${list.dock}`))
      await expect(panel).toHaveCount(0)
      await expect(page.locator(`[data-row-open="${id}"]`)).toBeFocused()
    })

    test('J steps the panel on with focus kept in it; Escape goes to the row it stepped to', async ({
      page,
    }) => {
      await go(page, list.path)
      await focusFirstRow(page)
      await page.keyboard.press('Enter')
      const panel = page.getByRole('region', { name: list.panel, exact: true })
      const shown = () => new URL(page.url()).searchParams.get('dock')
      await expect(panel).toBeVisible()
      await expect.poll(() => panel.evaluate((el) => el.contains(document.activeElement))).toBe(true)
      const opened = shown()
      for (const _ of [1, 2]) {
        const before = shown()
        await page.keyboard.press('j')
        await expect.poll(shown).not.toBe(before)
        await expect
          .poll(() => panel.evaluate((el) => el.contains(document.activeElement)))
          .toBe(true)
      }
      expect(shown()).not.toBe(opened)
      const id = shown()!.slice(shown()!.indexOf('.') + 1)
      await page.keyboard.press('Escape')
      await expect(panel).toHaveCount(0)
      await expect(page.locator(`[data-row-open="${id}"]`)).toBeFocused()
    })
  })
}
