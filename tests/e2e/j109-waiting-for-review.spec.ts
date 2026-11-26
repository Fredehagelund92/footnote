import type { Page } from '@playwright/test'
import { expect, go, inHttpOnly, signInAs, test } from './go.ts'

// J109, Waiting for review: a new item someone sent shows in Context, chipped Waiting, to the
// people who may open it, with who sent it, how long ago and who decides; the Status filter has
// it. Its page gives an owner Publish, Edit, Send back with a note and Don't publish. Don't publish
// takes a reason, and the sender reads it in their Inbox: "Closed by Jon Abara". An owner may edit
// it and publish it as it now reads, with its sender still its writer.

const CLASH = 'Norway orders leave out store credit from 1 November 2026'
const AGENT = 'Payment provider delays order data in Poland'
const rows = (page: Page) => page.locator('tbody tr:has([data-row-open])')
const row = (page: Page, title: string) => rows(page).filter({ hasText: title })

test('an owner sees what waits for review in Context, filters it and closes one with a reason', async ({
  page,
}) => {
  await go(page, '/context')
  await page.getByPlaceholder('Search context').fill(CLASH)
  await expect(row(page, CLASH)).toContainText(
    /Sofia Brandt sent it (today|yesterday|\d+ days ago)\. You decide\./,
  )
  await expect(
    row(page, CLASH).getByRole('img', { name: /^Waiting\. Waiting for review/ }),
  ).toBeVisible()
  await expect(page.getByText(/\d+ waiting for review/)).toBeVisible()

  // Status is Waiting leaves only what waits for review.
  await page.getByPlaceholder('Search context').fill('')
  await page.getByRole('button', { name: /^Filter/ }).click()
  await page.getByRole('menuitemcheckbox', { name: /^Waiting for review/ }).click()
  await page.keyboard.press('Escape')
  await expect(row(page, CLASH)).toBeVisible()
  await expect(
    rows(page).getByRole('img', { name: /^(Live|Draft|Due for a check|Archived)\./ }),
  ).toHaveCount(0)

  await go(page, '/context/sug-sofia-clash')
  await expect(page.getByRole('heading', { level: 1, name: CLASH })).toBeVisible()
  await expect(page.getByRole('note', { name: 'Waiting for review' })).toContainText(
    'Sofia Brandt sent it',
  )
  for (const name of ['Publish', 'Edit', 'Send back with a note', "Don't publish"])
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()

  await page.getByRole('button', { name: "Don't publish", exact: true }).click()
  const dialog = page.getByRole('dialog', { name: "Don't publish it?" })
  await expect(dialog).toContainText('Sofia Brandt reads the reason in their Inbox.')
  // No reason, no close.
  await expect(dialog.getByRole('button', { name: "Don't publish" })).toBeDisabled()
  await dialog
    .getByRole('textbox', { name: "Why you don't publish it" })
    .fill('Store credit is counted from 1 December, as the finance note says.')
  await dialog.getByRole('button', { name: "Don't publish" }).click()
  await expect(page).toHaveURL(/\/context$/)
  await expect(
    page.getByText("It won't be published. Sofia reads why in their Inbox."),
  ).toBeVisible()
  await page.getByPlaceholder('Search context').fill(CLASH)
  await expect(row(page, CLASH)).toHaveCount(0)

  // The mock starts over at each sign-in, so only the service carries the close to Sofia.
  await inHttpOnly('one person closes it and its sender signs in to read why', async () => {
    await signInAs(page, 'Sofia Brandt')
    await go(page, '/inbox')
    const closed = page.getByRole('button', {
      name: new RegExp(`${CLASH}.*Closed by Jon Abara`),
    })
    await expect(closed).toBeVisible()
    await closed.click()
    const pane = page.getByRole('main')
    await expect(pane.getByRole('heading', { name: 'Closed by Jon Abara' })).toBeVisible()
    await expect(pane.getByText('Store credit is counted from 1 December')).toBeVisible()
    // Read once, it leaves Needs me and stays under All.
    await pane.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(closed).toHaveCount(0)
    await go(page, '/inbox?tab=all')
    await expect(closed).toBeVisible()
  })
})

test('an owner edits a waiting item and publishes it as it now reads', async ({ page }) => {
  await go(page, '/context/sug-agent')
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page).toHaveURL(/\/edit$/)
  await expect(page.getByRole('note', { name: 'Where this stands' })).toHaveText(
    "Kofi Mensah sent this for review. Agents don't have it yet. Publish makes it live with your changes, with Kofi Mensah as its writer.",
  )
  const title = page.getByRole('textbox', { name: 'Title' })
  await title.fill(`${AGENT} for two days`)
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page).toHaveURL(/\/context\/itm_/)
  await expect(page.getByRole('heading', { level: 1, name: `${AGENT} for two days` })).toBeVisible()
  await go(page, '/context')
  await page.getByPlaceholder('Search context').fill(AGENT)
  await expect(row(page, AGENT)).toHaveCount(1)
  await expect(row(page, AGENT).getByRole('img', { name: /^Live\./ })).toBeVisible()
})

test('a member sees nothing that waits for review in a domain they do not own', async ({
  page,
}) => {
  await signInAs(page, 'Ines Duarte')
  await go(page, '/context')
  await page.getByPlaceholder('Search context').fill(CLASH)
  await expect(row(page, CLASH)).toHaveCount(0)
  await expect(page.getByText(/waiting for review/)).toHaveCount(0)
})

test("the review offers Don't publish beside Send back, and asks for the reason first", async ({
  page,
}) => {
  await go(page, '/inbox/sug-agent/review')
  const decide = page.getByRole('complementary', { name: 'Try it and decide' })
  await decide.getByRole('button', { name: "Don't publish", exact: true }).click()
  const dialog = page.getByRole('dialog', { name: "Don't publish it?" })
  await expect(dialog).toContainText('Kofi Mensah reads the reason in their Inbox.')
  await dialog
    .getByRole('textbox', { name: "Why you don't publish it" })
    .fill('The provider fixed the files on 16 October.')
  await dialog.getByRole('button', { name: "Don't publish" }).click()
  // The review moves on, and a toast says what it did.
  const said = page.locator('[data-sonner-toast]').filter({ hasText: /^Closed “/ })
  await expect(said).toContainText("It won't be published. Kofi reads why in their Inbox.")
})

test('its sender withdraws it and it leaves Context', async ({ page }) => {
  await signInAs(page, 'Sofia Brandt')
  await go(page, '/context')
  await page.getByPlaceholder('Search context').fill(CLASH)
  await expect(row(page, CLASH)).toHaveCount(1)

  await go(page, '/context/sug-sofia-clash')
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click()
  await expect(page.getByText('The owners no longer see it.')).toBeVisible()

  await go(page, '/context')
  await page.getByPlaceholder('Search context').fill(CLASH)
  await expect(row(page, CLASH)).toHaveCount(0)
})
