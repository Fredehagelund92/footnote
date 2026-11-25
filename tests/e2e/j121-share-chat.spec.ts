import type { Page } from '@playwright/test'
import { expect, go, moveTo, signInAs, test } from './go.ts'

// J121: sharing a chat (FR-721). Share chat, in Ask's header, opens the right panel and makes one
// link to a copy of the whole chat under the sender's name. Another member opens it with each
// source as they may read it, and the sender stops it from History, after which it opens nothing.

// Two questions of one chat, each answered from items on the demo week (an example's question
// would open the example, which is no chat of the person's own to share).
const first = 'Why did orders in Norway drop in August?'
const second = 'Why did Norway returns drop at the end of April?'

/** The six state words, as a line says one. */
const STATE = /^(Checked|Partial|Not found|Conflict|Outdated|Not looked up)$/

/** Asks a question in the chat on show, and waits for its answer. */
async function ask(page: Page, question: string, answers: number) {
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially(question)
  await box.press('Enter')
  // An answer is read and written out at reading pace: its row of actions shows once it is done.
  await expect(page.getByRole('group', { name: 'Answer actions' })).toHaveCount(answers, {
    timeout: 20_000,
  })
}

test('Share chat makes one link to the whole chat; a member opens it; the sender stops it in History', async ({
  page,
}) => {
  // Two answers and two sign-ins: a long journey.
  test.slow()
  await go(page, `/ask?n=${Date.now()}`)
  // Nothing to share before the first answer.
  await expect(page.getByRole('button', { name: 'Share chat' })).toHaveCount(0)
  await ask(page, first, 1)
  await ask(page, second, 2)
  // An answer has no Share of its own: the chat is shared whole.
  await page.getByRole('button', { name: 'More' }).last().click()
  await expect(page.getByRole('menuitem', { name: /Share/ })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Share chat' }).click()
  await expect(page).toHaveURL(/dock=share\.chat-/)
  const panel = page.getByRole('region', { name: 'Share chat' })
  await expect(panel).toContainText('It keeps 2 answers')
  await expect(panel).toContainText('No figures are kept.')
  const field = panel.getByRole('textbox', { name: 'Link to the chat' })
  await expect(field).toHaveValue(/\/shared\/[0-9a-f-]{36}$/)
  const address = await field.inputValue()
  await expect(panel.getByRole('button', { name: 'Copy link' })).toBeFocused()
  await panel.getByRole('button', { name: 'Copy link' }).click()
  await expect(page.getByText('Link copied')).toBeVisible()

  // Opening it again makes no second link: the chat has not changed.
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await page.getByRole('button', { name: 'Share chat' }).click()
  await expect(panel.getByRole('textbox', { name: 'Link to the chat' })).toHaveValue(address)

  // History says the chat is shared, and until when.
  const chats = page.getByRole('navigation', { name: 'Chats' })
  await expect(chats).toContainText('Shared until')

  // Another member opens it: the sender's name, one block a turn, each source as it is today.
  const path = new URL(address).pathname
  await signInAs(page, 'Ines Duarte')
  await moveTo(page, path)
  await expect(page.getByRole('heading', { name: 'Shared chat' })).toBeVisible()
  await expect(page.getByText(/^Shared by Jon Abara on /)).toBeVisible()
  const turns = page.getByRole('article')
  await expect(turns).toHaveCount(2)
  for (const [i, question] of [first, second].entries()) {
    const turn = turns.nth(i)
    await expect(turn.getByText(question, { exact: true })).toBeVisible()
    await expect(turn.getByText(STATE)).toBeVisible()
    await expect(turn.getByRole('list', { name: 'Sources' }).getByRole('listitem')).not.toHaveCount(
      0,
    )
  }
  // A source opens as it is today, beside the page.
  await turns.first().getByRole('list', { name: 'Sources' }).getByRole('button').first().click()
  await expect(page).toHaveURL(/dock=context\.itm_/)
  await expect(page.getByRole('button', { name: 'Stop sharing' })).toHaveCount(0)
  // Asking it again is the reader's own question, typed into Ask beside the page.
  await turns.first().getByRole('button', { name: 'Ask it yourself' }).click()
  await expect(page.getByRole('textbox', { name: 'Ask a question' }).last()).toContainText(first)

  // The sender stops it from History; the link then opens nothing.
  await signInAs(page, 'Jon Abara')
  await go(page, '/ask')
  const stop = page.getByRole('button', { name: `Stop sharing ${first}` })
  // The chat is in this browser (the mock), or listed under Shared links once signing out took it.
  await page
    .getByRole('navigation', { name: 'Chats' })
    .getByText(first, { exact: true })
    .first()
    .hover()
  await stop.click()
  await expect(page.getByText('Stopped sharing')).toBeVisible()
  await moveTo(page, path)
  await expect(page.getByText('This link opens nothing')).toBeVisible()
})
