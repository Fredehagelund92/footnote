import type { Page } from '@playwright/test'
import { card, expect, go, moveTo, onMockOnly, signInAs, signOut, test } from './go.ts'

// J122: Ask someone who knows. On a Nothing written yet card and a Due for a check card the owner
// copies a link; Footnote sends nothing, and the card keeps only the day it was copied. The link
// opens one page with one question, outside the app's shell: a person who is not signed in signs
// in there, and is told who to ask when they can't. They answer as themselves, and the owner reads
// it: a suggestion for Nothing written yet, an answer on the card for Due for a check.

/** Presses Ask someone who knows on the open card, and reads the link it copied. */
async function copyLink(page: Page) {
  await page.getByRole('button', { name: 'Ask someone who knows' }).click()
  await expect(page.getByText('Paste it to the person who knows.').last()).toBeVisible()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(link).toMatch(/\/question\/[\w-]+$/)
  return new URL(link).pathname
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
})

test('a Nothing written yet card passes its question on, and the answer goes to its owners', async ({
  page,
}) => {
  // The service's demo week has no open card without a draft: the mock's Germany card is it.
  await onMockOnly('a Nothing written yet card without a draft', async () => {
    await go(page, '/inbox?card=gap-germany')
    const pane = page.getByRole('region', { name: /Orders in Germany/ })
    await expect(pane.getByRole('button', { name: 'Ask someone who knows' })).toBeVisible()
    const path = await copyLink(page)
    await expect(pane.getByText(/^Link copied on \d+ \w+\. No answer yet\.$/)).toBeVisible()

    // Signed out, the page asks for a sign-in, and says who to ask when that does not work.
    await signOut(page)
    await moveTo(page, path)
    await expect(page.getByRole('heading', { name: 'Sign in to see the question' })).toBeVisible()
    await expect(
      page.getByText(/Can't sign in\? Ask the person who sent you this link/),
    ).toBeVisible()
    await expect(page.getByText('Orders in Germany')).toHaveCount(0)
    await page.getByRole('button', { name: /Ines Duarte/ }).click()

    // One question: the topic and its days in large letters, never the words of a question.
    const topic = page.getByRole('heading', { level: 1 })
    await expect(topic).toHaveText('Orders in Germany30 October to 1 November 2026')
    await expect(page.getByRole('navigation')).toHaveCount(0)
    await expect(page.getByText('People asked about this 6 times this week')).toBeVisible()
    const send = page.getByRole('button', { name: 'Send to the owners of Sales' })
    await send.click()
    await expect(page.getByRole('alert')).toHaveText(
      'Write what happened first, in a sentence or two.',
    )

    const words = page.getByRole('textbox', { name: 'Do you know what happened?' })
    await words.fill(
      'A strike at the carrier stopped deliveries for three days. Orders waited in the warehouse.',
    )
    await expect(page.getByRole('alert')).toHaveCount(0)
    // A link is not needed; one that is not a link is said so.
    const link = page.getByRole('textbox', { name: /A link to where this is written/ })
    await link.fill('the carrier notice')
    await send.click()
    await expect(page.getByRole('alert')).toContainText('starting with https://')
    await link.fill('')
    await expect(
      page.getByText('Jon or Sofia checks it before any AI agent gets it.'),
    ).toBeVisible()
    await send.click()
    await expect(page.getByRole('status')).toHaveText('Sent. It waits for the owners of Sales.')
    await expect(words).toHaveCount(0)
  })
})

test('a Due for a check card gets an answer on the card, and the owner still checks it', async ({
  page,
}) => {
  await go(page, `/inbox?card=${card('check-returns')}`)
  const path = await copyLink(page)
  // Copied again, it is the same link.
  expect(await copyLink(page)).toBe(path)

  await signInAs(page, 'Ines Duarte')
  await moveTo(page, path)
  await expect(page).toHaveURL(new RegExp(`${path}$`))
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Returns changed definition on 28 April 2026',
  )
  const answers = page.getByRole('radiogroup')
  await expect(answers.getByRole('radio')).toHaveCount(3)
  const send = page.getByRole('button', { name: /^Send to / })
  await send.click()
  await expect(page.getByRole('alert')).toHaveText('Choose an answer first.')
  await page.getByText('It ended on a day').click()
  await send.click()
  await expect(page.getByRole('alert')).toHaveText('Pick the day it ended.')
  await page.getByText('Yes, still true').click()
  await page
    .getByRole('textbox', { name: /Anything the owner should know/ })
    .fill('Finance still counts returns this way.')
  await send.click()
  await expect(page.getByRole('status')).toContainText('Sent. It waits for')

  // The owner reads it on the card, under Ines's name, and the check is still theirs.
  await signInAs(page, 'Jon Abara')
  await go(page, `/inbox?card=${card('check-returns')}`)
  const asked = page.getByRole('region', { name: 'Asked someone who knows' })
  await expect(asked).toContainText(
    /Ines Duarte answered (just now|today, \d+:\d+): Yes, still true/,
  )
  await expect(asked).toContainText('Finance still counts returns this way.')
  await expect(asked).toContainText("Agents don't get answers.")
  await expect(page.getByRole('button', { name: /^Still true/ })).toBeEnabled()
})
