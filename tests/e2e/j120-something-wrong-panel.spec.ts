import type { Page } from '@playwright/test'
import { expect, go, inHttpOnly, signInAs, test } from './go.ts'

// J120: Something wrong? opens in the right panel beside the answer, from Bad answer or from More,
// so the answer stays in view (FR-622). Focus goes to What's wrong?, an empty field is refused in
// the app's own words, and Escape or Close gives focus back to the button it was opened from. An
// owner gets Edit first. Someone who owns nothing can suggest the right words: they wait as a
// suggestion on the item, and the owners read them, and the link, on the Reported card, with the
// way to review the suggestion.

const question = 'How many test accounts does units sold leave out in Norway?'
const panel = (page: Page) => page.getByRole('region', { name: 'Something wrong?' })
const log = (page: Page) => page.getByRole('log')

async function ask(page: Page, n: string) {
  await go(page, `/ask?n=${n}`)
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially(question)
  await box.press('Enter')
  await expect(log(page).getByRole('button', { name: 'Bad answer' }).last()).toBeVisible()
}

test('Bad answer opens Something wrong? beside the answer, with Edit for an owner', async ({
  page,
}) => {
  await ask(page, 'j120')
  const bad = log(page).getByRole('button', { name: 'Bad answer' }).last()
  await bad.click()
  await expect(panel(page)).toBeVisible()
  // The answer stays in view beside it.
  await expect(log(page).getByText(question)).toBeInViewport()
  await expect(panel(page).getByRole('textbox', { name: "What's wrong?" })).toBeFocused()
  await expect(panel(page).getByRole('radio', { name: "The answer's wording" })).toBeVisible()
  // Jon owns Sales: he changes the item himself, or tells the other owner.
  await expect(panel(page)).toContainText('You own Sales: you can change the item yourself')
  await expect(panel(page).getByRole('button', { name: /^Edit “/ })).toBeVisible()
  await expect(panel(page).getByRole('button', { name: 'Suggest the right words' })).toHaveCount(0)

  await panel(page)
    .getByRole('button', { name: /^Send to / })
    .click()
  await expect(
    panel(page).getByText('Say what is wrong, so the owners know what to fix.'),
  ).toBeVisible()
  await expect(panel(page).getByRole('textbox', { name: "What's wrong?" })).toBeFocused()

  // Nothing typed, Escape closes it, and focus is back on Bad answer.
  await page.keyboard.press('Escape')
  await expect(panel(page)).toBeHidden()
  await expect(bad).toBeFocused()
})

test('someone who owns nothing suggests the right words, and the owners read them with the link', async ({
  page,
}) => {
  await signInAs(page, 'Ines Duarte')
  await ask(page, 'j120b')
  const more = log(page).getByRole('button', { name: 'More' }).last()
  await more.click()
  await page.getByRole('menuitem', { name: 'Something wrong?' }).click()
  const form = panel(page)
  await form
    .getByRole('textbox', { name: "What's wrong?" })
    .fill('There were 316 test accounts in October.')
  await form.getByRole('button', { name: 'Suggest the right words' }).click()
  const words = form.getByRole('textbox', { name: 'The right words (a suggestion)' })
  // It starts from the item's own words, so the change is all the owners review.
  await expect(words).toBeFocused()
  await expect(words).not.toHaveValue('')
  await words.fill(
    'Units sold in Norway leaves out the 316 accounts our teams use to test the webshop.',
  )
  await form
    .getByRole('textbox', { name: 'Link (optional)' })
    .fill('https://wiki.example/test-accounts')
  await expect(form).toContainText(
    /Goes to .+ and .+, with your name, your words and this question/,
  )
  await form.getByRole('button', { name: 'Send the report and suggestion' }).click()

  await expect(form.getByRole('heading', { name: 'Sent to the owners of Sales' })).toBeFocused()
  await expect(form).toContainText('Your words wait as a suggestion on')
  await expect(
    log(page).getByRole('status').filter({ hasText: 'You reported this just now' }),
  ).toBeVisible()
  await form.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(form).toBeHidden()
  await expect(more).toBeFocused()

  // The demo's owners hear of a report only from the service.
  await inHttpOnly('Reported card with the right words', async () => {
    await signInAs(page, 'Jon Abara')
    await go(page, '/inbox')
    await page
      .getByRole('button', {
        name: /Reported as wrong: “There were 316 test accounts in October\.”/,
      })
      .click()
    await expect(page.getByText('Ines Duarte suggests these words')).toBeVisible()
    await expect(
      page.getByText(
        'Units sold in Norway leaves out the 316 accounts our teams use to test the webshop.',
      ),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: /wiki\.example\/test-accounts/ })).toBeVisible()
    await page.getByRole('button', { name: 'Review the suggestion' }).click()
    await expect(page).toHaveURL(/\/inbox\/proposal:[0-9a-f-]+\/review/)
  })
})
