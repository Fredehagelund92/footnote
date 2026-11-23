import type { Page } from '@playwright/test'
import { card, draftFor, expect, go, inHttpOnly, signInAs, test } from './go.ts'

// J102, a draft is published as itself and says what is true of it: an owner who edits and
// publishes a draft someone else wrote publishes that draft, so Context shows the item once, Live,
// and no draft is left behind (it was published as a copy beside the draft). The line above the
// title says the draft was never published and what its button does, never "agents keep getting
// the context item as it is", which a member read on their own draft.

const SPAIN_RETURNS = 'Store returns in Spain count on the day they are booked'
const note = (page: Page) => page.getByRole('note', { name: 'Where this stands' })
const rows = (page: Page) => page.locator('tbody [data-row-open]')

/** Publish, answering "Unrelated" to every live item the service asks about first. */
async function publishAnswering(page: Page) {
  const before = page.getByRole('region', { name: 'Before it can be published' })
  const left = () => !/\/edit(\?|$)/.test(page.url())
  for (let round = 0; round < 3 && !left(); round++) {
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(async () => {
      expect(left() || (await before.getByRole('alert').isVisible())).toBe(true)
    }).toPass()
    if (left()) break
    for (const answer of await before
      .getByRole('button', { name: /^How this relates to / })
      .all()) {
      const name = (await answer.getAttribute('aria-label'))!
      await answer.click()
      await page
        .getByRole('menu', { name })
        .getByRole('menuitemradio', { name: 'Unrelated' })
        .click()
    }
  }
}

test("an owner publishes someone else's draft as itself: one Live row, no draft left", async ({
  page,
}) => {
  // Jon owns Sales; Sofia wrote this draft and never published it.
  await go(page, '/context/itm_draft_spain_returns/edit')
  await expect(note(page)).toHaveText(
    "Sofia Brandt wrote this draft. It was never published, so agents don't have it yet. Publish makes it live, with Sofia Brandt as its writer.",
  )
  await page.getByRole('textbox', { name: 'What agents should know' }).click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText(' A return booked late counts in the week it is booked.')
  await page.getByRole('button', { name: /Add a source/ }).click()
  await page.locator('#fact-source').fill('https://wiki.example.com/sales/spain-returns')
  await page.locator('#fact-quote').fill('Store returns count on the day the store books them.')
  await page.keyboard.press('Escape')
  await publishAnswering(page)
  await expect(page.getByText('Published', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/context\/itm_/)

  await go(page, '/context')
  await page.getByPlaceholder('Search context').fill('Store returns in Spain')
  await expect(rows(page).filter({ hasText: SPAIN_RETURNS })).toHaveCount(1)
  await page.getByRole('button', { name: /^Filter/ }).click()
  await page.getByRole('menuitemcheckbox', { name: /^Draft/ }).click()
  await page.keyboard.press('Escape')
  await expect(rows(page).filter({ hasText: SPAIN_RETURNS })).toHaveCount(0)
})

test("a member's own draft says agents don't have it yet, and that the owner decides once it is sent", async ({
  page,
}) => {
  await inHttpOnly('draft written by a member (the mock has none)', async () => {
    const id = await draftFor(card('itm_draft_spain_returns'), 'Maria Lindqvist')
    await signInAs(page, 'Maria Lindqvist')
    await go(page, `/context/${id}/suggest`)
    await expect(note(page)).toHaveText(
      "This draft was never published, so agents don't have it yet. Jon Abara, owner of Sales, decides whether to publish it once you send it.",
    )
    await expect(page.getByText(/agents keep getting/)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Send/ })).toBeVisible()
  })
})

test('a suggested change to a live item still says agents keep getting it as it is', async ({
  page,
}) => {
  await signInAs(page, 'Ines Duarte')
  await go(page, '/context/itm_norway_stop/suggest')
  await expect(note(page)).toContainText(
    'agents keep getting the context item as it is until then.',
  )
})
