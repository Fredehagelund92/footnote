import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J140, the first minute of Write context: it opens on one box, "What happened?", instead of the
// form's six properties. What the person pastes or says fills the form by rule (Draft from text,
// no model), and the form is then what they check: a title, the words, when it happened. Write it
// yourself opens the form as it is, with the cursor in the title. Context written about a question
// opens on its form, as before.

const box = (page: Page) => page.getByRole('textbox', { name: 'What happened?' })
const title = (page: Page) => page.getByRole('textbox', { name: 'Title' })

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
})

test('Write context opens on one box, and what the person says fills the form', async ({
  page,
}) => {
  await go(page, '/context')
  await page.getByRole('button', { name: 'Write context' }).first().click()
  // One question and one place to answer it, the cursor already there; no form yet.
  await expect(box(page)).toBeFocused()
  await expect(box(page)).toHaveAccessibleDescription(
    'Paste a message, a link, or just say what happened. The fields fill in from it, and you check each one.',
  )
  await expect(title(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0)

  // Nothing to read says so at the box, and the cursor stays in it.
  await page.getByRole('button', { name: 'Fill it in' }).click()
  await expect(page.getByRole('alert')).toHaveText('Write or paste something first.')
  await expect(box(page)).toBeFocused()

  await page.keyboard.type(
    'Online sales to Norway stopped on 4 August 2026, because a new customs rule holds parcels at the border.',
  )
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+Enter')

  // The form, filled: a title, the words, and the date read from them, for the person to check.
  await expect(page.getByText('Filled from your text')).toBeVisible()
  await expect(title(page)).toHaveValue(/^Online sales to Norway stopped on 4 August 2026/)
  await expect(page.getByRole('textbox', { name: 'What agents should know' })).toContainText(
    'customs rule',
  )
  await expect(page.getByRole('button', { name: /^When/ })).toHaveAccessibleName(
    /^When .*4 Aug 2026/,
  )
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible()

  // Draft from text goes back to the box with the words kept; the form is kept as well.
  await page.getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Draft from text' }).click()
  await expect(box(page)).toHaveValue(/^Online sales to Norway stopped/)
  await page.getByRole('button', { name: 'Back to the form' }).click()
  await expect(title(page)).toHaveValue(/^Online sales to Norway stopped on 4 August 2026/)
  await expect(title(page)).toBeFocused()
})

test('Write it yourself opens the empty form, and words left in the box ask before leaving', async ({
  page,
}) => {
  await go(page, '/context/new')
  await box(page).fill('Returns in Sweden are counted on the refund day.')
  await page.getByRole('button', { name: 'Back to Context' }).click()
  const leave = page.getByRole('dialog', { name: 'Leave without saving?' })
  await expect(leave).toBeVisible()
  await leave.getByRole('button', { name: 'Keep editing' }).click()
  await expect(box(page)).toHaveValue('Returns in Sweden are counted on the refund day.')

  await page.getByRole('button', { name: 'Write it yourself' }).click()
  await expect(title(page)).toBeFocused()
  await expect(title(page)).toHaveValue('')
  await expect(page.getByRole('button', { name: /^Domain/ })).toBeVisible()
})

test('Context written about a question opens on its form', async ({ page }) => {
  await go(page, '/context/new?metric=Orders&market=Norway')
  await expect(page.getByRole('button', { name: 'Remove Orders', exact: true })).toBeVisible()
  await expect(box(page)).toHaveCount(0)
})
