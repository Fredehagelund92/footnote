import type { Page } from '@playwright/test'
import { card, draftFor, expect, go, inHttpOnly, signInAs, test } from './go.ts'

// J102, a draft is its writer's alone and says what is true of it (FR-230): nobody else sees a
// draft, an admin and an owner of its domain included, so it is never in their Context list and its
// page is not found for them. The line above the title says the draft was never published and what
// its button does, never "agents keep getting the context item as it is", which a member read on
// their own draft.

const SPRING_SPEND = 'Spring campaign spend was booked in week 12'
const note = (page: Page) => page.getByRole('note', { name: 'Where this stands' })
const rows = (page: Page) => page.locator('tbody [data-row-open]')

test("a draft is its writer's alone: an admin doesn't find it in Context, or open its page", async ({
  page,
}) => {
  // Ines started this draft in Marketing and never sent it. Jon is an admin.
  await go(page, '/context')
  await page.getByPlaceholder('Search context').fill('Spring campaign spend')
  // The search has answered: a live item about a campaign matches some of the words.
  await expect(rows(page).first()).toContainText('campaign')
  await expect(rows(page).filter({ hasText: SPRING_SPEND })).toHaveCount(0)
  await go(page, `/context/${card('itm_draft_spring_spend')}`)
  await expect(page.getByText('There is no context item here')).toBeVisible()

  await signInAs(page, 'Ines Duarte')
  await go(page, '/context')
  await page.getByPlaceholder('Search context').fill('Spring campaign spend')
  await expect(rows(page).filter({ hasText: SPRING_SPEND })).toHaveCount(1)
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
