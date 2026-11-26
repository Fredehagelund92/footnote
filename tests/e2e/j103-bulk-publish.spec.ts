import { expect, go, mode, signInAs, test } from './go.ts'
import type { Page } from '@playwright/test'

// J103: drafts are published from the Context list's bar, as one is from the editor. A draft is
// its writer's alone (FR-230), so the list holds only the person's own. In a domain they own, or for
// an admin, they publish at once; a writer sends their own draft for another domain to its owners;
// a draft the editor's checks keep back stays ticked with why. More than a handful is asked first,
// saying agents get them, and Undo takes the publish back. A draft opened as it is publishes from
// its own page by the same rule, without an edit.

const bar = (page: Page) => page.getByRole('region', { name: 'Selected context' })
const titles = (page: Page) => page.locator('tbody [data-row-open]')
/** A line on the screen: the toast's, or the one above the bar, each also said to a screen reader. */
const said = (page: Page, text: string) => page.getByText(text, { exact: true }).last()
const publish = (page: Page, name: RegExp | string = /^Publish/) =>
  bar(page).getByRole('button', { name })

async function allDrafts(page: Page) {
  await page.getByRole('button', { name: /^Filter/ }).click()
  await page.getByRole('menuitemcheckbox', { name: /^Draft/ }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('checkbox', { name: 'Select all context shown' }).click()
}

test('An owner publishes their own drafts at once; a draft without a source stays a draft', async ({
  page,
}) => {
  await signInAs(page, 'Jon Abara')
  await go(page, '/context')
  // A published item has nothing to publish: the button stays in reach and says why.
  await page
    .getByRole('checkbox', { name: /^Select (?!all)/ })
    .first()
    .click()
  await expect(publish(page)).toHaveAttribute('aria-disabled', 'true')
  await expect(publish(page)).toHaveAccessibleDescription('It is published already.')
  await page.keyboard.press('Escape')
  await allDrafts(page)
  await publish(page).click()
  await expect(said(page, '1 published')).toBeVisible()
  // What was left alone stays ticked, and the line says at once what it needs, with why a hover away.
  await expect(said(page, 'Nothing to publish: add a source first.')).toBeVisible()
  await expect(titles(page)).toHaveText(['Store returns in Spain count on the day they are booked'])
  await expect(bar(page)).toContainText('1 selected')
  await page.getByRole('button', { name: 'Why they were skipped' }).hover()
  await expect(page.locator('li', { hasText: 'Add a source first.' })).toBeVisible()
  // Undo takes it from agents, and it is a draft again.
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(titles(page)).toHaveCount(2)
})

test("A member sends their own draft to the domain's owners, and can't publish what is live", async ({
  page,
}) => {
  await signInAs(page, 'Ines Duarte')
  await go(page, '/context')
  await page
    .getByRole('checkbox', { name: /^Select (?!all)/ })
    .first()
    .click()
  await expect(publish(page)).toHaveAttribute('aria-disabled', 'true')
  await expect(publish(page)).toHaveAccessibleDescription(
    /^Only owners of .+ and admins can change it\.$/,
  )
  // The line above the bar says it at once, not only on a hover.
  await expect(page.getByText(/^Nothing to publish: it is owned by .+\.$/).last()).toBeVisible()
  await page.keyboard.press('Escape')
  await allDrafts(page)
  // The button says it suggests, not publishes, and to whom; it works from the keyboard.
  const suggest = publish(page, 'Suggest')
  await expect(suggest).toHaveAccessibleDescription('Sends 1 draft to the owners of Marketing.')
  await suggest.focus()
  await page.keyboard.press('Enter')
  await expect(said(page, '1 sent to the owners of Marketing')).toBeVisible()
  await expect(said(page, 'Agents get it once an owner publishes it.')).toBeVisible()
  // Sent, it waits for the owners and is no draft of hers any more.
  await expect(titles(page).filter({ hasText: 'Spring campaign spend' })).toHaveCount(0)
})

test('A draft opened as it is publishes from its own page, the same way', async ({ page }) => {
  await signInAs(page, 'Jon Abara')
  await go(page, '/context')
  await titles(page).filter({ hasText: 'Black Friday 2026 orders' }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  // Nothing was changed, and still it can go: publishing its words is the change.
  const button = page.getByRole('button', { name: 'Publish', exact: true })
  await expect(button).not.toHaveAttribute('aria-disabled', 'true')
  await button.click()
  await expect(said(page, 'Published')).toBeVisible()
  await expect(said(page, 'Agents get it from the next question.')).toBeVisible()
  await allDrafts(page)
  await expect(titles(page).filter({ hasText: 'Black Friday 2026 orders' })).toHaveCount(0)
})

test('Publishing many asks once, says agents get them, and names what it leaves', async ({
  page,
}) => {
  test.skip(mode === 'http', 'The 21 imported drafts are the mock demo’s (?demo=imported).')
  await go(page, '/context?demo=imported')
  await allDrafts(page)
  await publish(page).click()
  // Jon's own 2 drafts beside the 21 he imported; 3 of them have no source.
  const confirm = page.getByRole('dialog', { name: 'Publish 20 drafts?' })
  await expect(confirm).toContainText('Agents get them from the next question.')
  // Cancel has the focus: a slip of Enter publishes nothing.
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
  // A few titles, the rest one click away; what it leaves, by reason, as information.
  const titlesIn = confirm.getByRole('list', { name: 'To publish' }).getByRole('listitem')
  await expect(titlesIn).toHaveCount(4)
  await confirm.getByRole('button', { name: 'Show all 20' }).click()
  await expect(titlesIn).toHaveCount(20)
  await expect(confirm).toContainText('3 you ticked are not in this Publish: 3 need a fix first.')
  await confirm.getByRole('button', { name: 'Publish 20 drafts' }).click()
  await expect(said(page, '20 published')).toBeVisible()
  await expect(
    said(page, 'Nothing to publish: 3 need a fix first. Open one to fix it.'),
  ).toBeVisible()
  await expect(titles(page)).toHaveCount(3)
})
