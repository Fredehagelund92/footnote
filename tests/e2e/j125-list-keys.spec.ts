import type { Page } from '@playwright/test'
import { card, expect, go, mode, test } from './go.ts'

// J125: one keyboard model for every list. J and K work from page load on Context, Definitions and
// the Inbox, and the focus follows the cursor's row. In a side panel J opens row after row while the
// panel keeps the focus, and Esc closes it from anywhere, giving the focus back to the row last open
// in it. After a click on an Inbox card, one Enter opens it. G then a letter goes to the Inbox, Ask,
// Context, Definitions or Settings, as the ? sheet and the command menu say.

/** The rows of the list on the page, in the order shown. */
const rows = (page: Page) => page.locator('main [data-row-open]')
const idsOf = (page: Page) =>
  rows(page).evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.rowOpen!))
const row = (page: Page, id: string) => page.locator(`main [data-row-open="${id}"]`)
/** The side panel's title, which takes the focus when the panel opens from a row. */
const panelTitle = (page: Page) =>
  page.locator('[data-slot=dock]').getByRole('heading', { level: 2 }).first()
/** What the address says the side panel shows: `context.<id>`, or nothing. */
const dock = (page: Page) => new URL(page.url()).searchParams.get('dock')
/** The side panel shows this, as the address says. */
const expectDock = (page: Page, shows: string | null) => expect.poll(() => dock(page)).toBe(shows)

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
})

test('On Context, J works from page load, five panels in a row keep the focus, and Esc closes the panel', async ({
  page,
}) => {
  // Seven panels open on the way: a long journey.
  test.slow()
  await go(page, '/context')
  await expect(rows(page).nth(6)).toBeVisible()
  const ids = await idsOf(page)

  // From page load, with nothing focused: J goes to the first row, then on; K comes back.
  await expect(page.locator('body')).toBeFocused()
  await page.keyboard.press('j')
  await expect(row(page, ids[0]!)).toBeFocused()
  await page.keyboard.press('j')
  await expect(row(page, ids[1]!)).toBeFocused()
  await page.keyboard.press('k')
  await expect(row(page, ids[0]!)).toBeFocused()

  // Enter opens the row in the side panel, which takes the focus.
  await page.keyboard.press('Enter')
  await expectDock(page, `context.${ids[0]!}`)
  await expect(panelTitle(page)).toBeFocused()

  // J from inside the panel opens the next row there, five in a row, and the panel keeps the focus.
  for (const id of ids.slice(1, 6)) {
    await page.keyboard.press('j')
    await expectDock(page, `context.${id}`)
    await expect(panelTitle(page)).toBeFocused()
  }
  await page.keyboard.press('k')
  await expectDock(page, `context.${ids[4]!}`)

  // Esc closes the panel, and the row last open in it has the focus.
  await page.keyboard.press('Escape')
  await expectDock(page, null)
  await expect(row(page, ids[4]!)).toBeFocused()

  // With the cursor on a row and the panel open, J opens the next row while the row keeps the focus.
  await row(page, ids[2]!).click()
  await expectDock(page, `context.${ids[2]!}`)
  await row(page, ids[2]!).focus()
  await page.keyboard.press('j')
  await expectDock(page, `context.${ids[3]!}`)
  await expect(row(page, ids[3]!)).toBeFocused()

  // Esc closes it from anywhere on the page, the page's own heading too.
  await page.getByRole('heading', { level: 1, name: 'Context' }).click()
  await page.keyboard.press('Escape')
  await expectDock(page, null)
})

test('On Definitions, J works from page load and steps the panel', async ({ page }) => {
  await go(page, '/definitions')
  await expect(rows(page).nth(3)).toBeVisible()
  const ids = await idsOf(page)

  await page.keyboard.press('j')
  await expect(row(page, ids[0]!)).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(row(page, ids[1]!)).toBeFocused()
  await page.keyboard.press('Enter')
  await expectDock(page, `def.${ids[1]!}`)
  await expect(panelTitle(page)).toBeFocused()
  await page.keyboard.press('j')
  await page.keyboard.press('j')
  await expectDock(page, `def.${ids[3]!}`)
  await expect(panelTitle(page)).toBeFocused()
  await page.keyboard.press('Escape')
  await expectDock(page, null)
  await expect(row(page, ids[3]!)).toBeFocused()
})

test('In the Inbox, J works from page load, one Enter opens a clicked card, and Esc keeps the place', async ({
  page,
}) => {
  await go(page, '/inbox')
  await expect(rows(page).nth(3)).toBeVisible()
  const ids = await idsOf(page)

  // The first card is on show; J goes to the next, and its row has the focus.
  await page.keyboard.press('j')
  await expect(page).toHaveURL(new RegExp(`[?&]card=${encodeURIComponent(ids[1]!)}`))
  await expect(row(page, ids[1]!)).toBeFocused()

  // Esc puts the card away and keeps the focus on its row; J goes on from there.
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/[?&]card=none/)
  await expect(row(page, ids[1]!)).toBeFocused()
  await page.keyboard.press('j')
  await expect(row(page, ids[2]!)).toBeFocused()

  // A click on a card, then one Enter: its review opens.
  const suggestion = card('sug-ines')
  await row(page, suggestion).click()
  await expect(page).toHaveURL(new RegExp(`[?&]card=${suggestion}`))
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/inbox/${suggestion}/review`))
})

test('In a drafts card the arrows and J move through its drafts while one has the focus', async ({
  page,
}) => {
  test.skip(mode === 'http', 'The 21 imported drafts are the mock demo’s (?demo=imported).')
  await go(page, '/inbox?demo=imported&card=drafts%3Ayours')
  const drafts = page.getByRole('list', { name: 'Your drafts' }).getByRole('link')
  await expect(drafts).toHaveCount(21)
  await drafts.first().focus()
  await page.keyboard.press('ArrowDown')
  await expect(drafts.nth(1)).toBeFocused()
  await page.keyboard.press('j')
  await expect(drafts.nth(2)).toBeFocused()
  await page.keyboard.press('k')
  await expect(drafts.nth(1)).toBeFocused()
  // The card stays the one on show.
  await expect(page).toHaveURL(/card=drafts/)
})

test('G then a letter goes to the Inbox, Ask, Context, Definitions or Settings', async ({
  page,
}) => {
  await go(page, '/inbox')
  await expect(rows(page).first()).toBeVisible()

  // The ? sheet lists the five, and the command menu shows them on its Go to rows.
  await page.keyboard.press('?')
  const sheet = page.getByTestId('shortcuts')
  const goTo = sheet
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Go to' }) })
  await expect(goTo.getByRole('listitem')).toHaveText([
    /^Inbox\s*G\s*then\s*I$/,
    /^Ask\s*G\s*then\s*A$/,
    /^Context\s*G\s*then\s*C$/,
    /^Definitions\s*G\s*then\s*D$/,
    /^Settings\s*G\s*then\s*S$/,
  ])
  await page.keyboard.press('Escape')
  await page.keyboard.press('ControlOrMeta+k')
  const menu = page.getByRole('dialog', { name: 'Search' })
  await expect(menu.getByRole('option', { name: 'Context, G then C', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()

  // A letter alone is not a way to go anywhere.
  await page.keyboard.press('c')
  await expect(page).toHaveURL(/\/inbox/)

  const goBy = async (letter: string, to: RegExp) => {
    await page.keyboard.press('g')
    await page.keyboard.press(letter)
    await expect(page).toHaveURL(to)
    await expect(page.locator('h1').first()).toBeVisible()
  }
  await goBy('c', /\/context$/)
  await goBy('d', /\/definitions$/)
  await goBy('i', /\/inbox$/)
  await goBy('s', /\/settings(\/general)?$/)
  await goBy('a', /\/ask$/)
})
