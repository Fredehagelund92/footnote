import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J140, the first minute of Write context: the editor is the page from the first second, with
// writing help beside it and the cursor in its box, until the person closes it; then new items
// open without it in that browser, the cursor in the title, until they open it again. Under
// 1100 px it would cover the draft, so the editor opens on its own there. Draft from text, in More,
// fills the form by rule (no model) from what the person pastes or says, and the form is then what
// they check. Context written about a question opens on its form, as before.

const title = (page: Page) => page.getByRole('textbox', { name: 'Title' })
const dock = (page: Page) => page.getByRole('region', { name: 'Writing help' })
const fromText = (page: Page) => page.getByRole('dialog', { name: 'Draft from text' })

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
})

test('Write context opens the editor with writing help beside it, until the person closes it', async ({
  page,
}) => {
  await go(page, '/context')
  await page.getByRole('button', { name: 'Write context' }).first().click()
  // No page before the editor: the form, the header's Publish, and the dock in the address.
  await expect(title(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/context\/new\?dock=write$/)
  await expect(dock(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Writing help', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('textbox', { name: 'What happened?' })).toHaveCount(0)

  // Closed, it stays closed for the next new item, whose cursor is in the title.
  await dock(page).getByRole('button', { name: 'Close the panel' }).click()
  await expect(dock(page)).toBeHidden()
  await go(page, '/context')
  await page.getByRole('button', { name: 'Write context' }).first().click()
  await expect(title(page)).toBeFocused()
  await expect(dock(page)).toBeHidden()
  await expect(page).toHaveURL(/\/context\/new$/)

  // Opened again with the header's toggle, it opens beside the next new item again.
  await page.getByRole('button', { name: 'Writing help', exact: true }).click()
  await expect(dock(page)).toBeVisible()
  await go(page, '/context')
  await page.getByRole('button', { name: 'Write context' }).first().click()
  await expect(dock(page)).toBeVisible()
})

test('Under 1100 px the editor opens on its own, and the toggle opens writing help as a sheet', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  await go(page, '/context/new')
  await expect(title(page)).toBeFocused()
  await expect(dock(page)).toBeHidden()
  await page.getByRole('button', { name: 'Writing help', exact: true }).click()
  await expect(dock(page)).toBeVisible()
})

test('Draft from text fills the form by rule from what the person says', async ({ page }) => {
  await go(page, '/context/new')
  await expect(dock(page)).toBeVisible()
  await page.getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Draft from text' }).click()
  // One place to answer, the cursor already there.
  const box = fromText(page).getByRole('textbox', { name: 'Draft from text' })
  await expect(box).toBeFocused()
  await expect(box).toHaveAccessibleDescription(
    'Paste a message or a link, or say what happened. The fields fill in from it, with no AI model, and you check each one.',
  )

  // Nothing to read says so at the box, and the cursor stays in it.
  await fromText(page).getByRole('button', { name: 'Fill it in' }).click()
  await expect(fromText(page).getByRole('alert')).toHaveText('Write or paste something first.')
  await expect(box).toBeFocused()

  await page.keyboard.type(
    'Online sales to Norway stopped on 4 August 2026, because a new customs rule holds parcels at the border.',
  )
  await expect(fromText(page).getByRole('alert')).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+Enter')

  // The form, filled: a title, the words, and the date read from them, for the person to check.
  await expect(fromText(page)).toBeHidden()
  await expect(page.getByText('Filled from your text')).toBeVisible()
  await expect(title(page)).toHaveValue(/^Online sales to Norway stopped on 4 August 2026/)
  await expect(page.getByRole('textbox', { name: 'What agents should know' })).toContainText(
    'customs rule',
  )
  await expect(page.getByRole('button', { name: /^When/ })).toHaveAccessibleName(
    /^When .*4 Aug 2026/,
  )

  // Opened again, it keeps the words; Cancel leaves the form as it is.
  await page.getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Draft from text' }).click()
  await expect(box).toHaveValue(/^Online sales to Norway stopped/)
  await fromText(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(title(page)).toHaveValue(/^Online sales to Norway stopped on 4 August 2026/)
})

test('Context written about a question opens on its form', async ({ page }) => {
  await go(page, '/context/new?metric=Orders&about=Norway')
  await expect(page.getByRole('button', { name: 'Remove Orders', exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Remove Market: Norway', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'What happened?' })).toHaveCount(0)
})

test('A link from before about= still opens on what it named', async ({ page }) => {
  await go(page, '/context/new?metric=Orders&market=Norway')
  await expect(page.getByRole('button', { name: 'Remove Orders', exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Remove Market: Norway', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'What happened?' })).toHaveCount(0)
})
