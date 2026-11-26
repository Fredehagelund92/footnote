import type { Page } from '@playwright/test'
import { card, expect, go, mode, signInAs, test } from './go.ts'

// J110, drafts are personal (FR-230): the editor's Save as draft keeps the words as the writer's
// own draft, which only they see in Context; its page sends it to the domain's owners as it is;
// and the drafts someone imported wait on one card in their Inbox, whose one button publishes
// what they may and leaves what needs a fix, with why.

const rows = (page: Page) => page.locator('tbody [data-row-open]')
/** A line on the screen: the toast's, or one said to a screen reader. */
const said = (page: Page, text: string) => page.getByText(text, { exact: true }).last()

test('Save as draft keeps the words where only their writer sees them', async ({ page }) => {
  const title = 'Store visits in Italy are counted at the door'
  await signInAs(page, 'Ines Duarte')
  await go(page, '/context/new')
  await page.getByRole('textbox', { name: 'Title' }).fill(title)
  await page.getByRole('textbox', { name: 'What agents should know' }).click()
  await page.keyboard.insertText('A visit counts when someone walks in, whether they buy or not.')
  await page.getByRole('button', { name: 'Save as draft' }).click()
  await expect(said(page, 'Saved as a draft')).toBeVisible()
  await expect(page.getByText(/your draft, only you can see it/)).toBeVisible()

  await go(page, '/context')
  await page.getByPlaceholder('Search context').fill('Store visits in Italy')
  await expect(rows(page).filter({ hasText: title })).toHaveCount(1)

  // Nobody else sees it, an admin included.
  await signInAs(page, 'Jon Abara')
  await go(page, '/context')
  await page.getByPlaceholder('Search context').fill('Store visits in Italy')
  await expect(page.getByText(/^No context matches/)).toBeVisible()
})

test("A writer sends their draft from its page, as it is, to the domain's owners", async ({
  page,
}) => {
  await signInAs(page, 'Ines Duarte')
  await go(page, `/context/${card('itm_draft_spring_spend')}`)
  await page.getByRole('button', { name: /^Send/ }).click()
  await expect(said(page, 'Sent to the owners of Marketing')).toBeVisible()
  await expect(said(page, 'Agents get it once an owner publishes it.')).toBeVisible()
  await expect(page).toHaveURL(/\/context$/)
})

test('The drafts someone imported wait on one card, which publishes what it may', async ({
  page,
}) => {
  test.skip(mode === 'http', 'The 21 imported drafts are the mock demo’s (?demo=imported).')
  await go(page, '/inbox?demo=imported')
  await page
    .getByRole('button', { name: /21 drafts from your import/ })
    .first()
    .click()
  const pane = page.getByRole('region', { name: '21 drafts from your import' })
  await expect(pane.getByRole('list', { name: 'Your drafts' }).getByRole('listitem')).toHaveCount(
    21,
  )
  await expect(pane).toContainText('2 drafts need a fix first')
  // Two came without a source: the button says how many it takes, and asks first.
  await pane.getByRole('button', { name: /^Publish 19/ }).click()
  const confirm = page.getByRole('dialog', { name: 'Publish 19 drafts?' })
  await expect(confirm).toContainText('2 on the card are not in this Publish: 2 need a fix first.')
  await confirm.getByRole('button', { name: 'Publish 19 drafts' }).click()
  await expect(said(page, '19 published')).toBeVisible()
  // What needs a fix stays on the card, with why.
  await expect(page.getByRole('region', { name: '2 drafts from your import' })).toContainText(
    'missing a source',
  )
})
