import type { Page } from '@playwright/test'
import { expect, go, inHttpOnly, test } from './go.ts'

// J119: About our business says what to write and what to leave out, and Write a first version for
// me drafts the text from the install's domains, metrics and definitions. The draft is shown to
// change and saved only when it is kept: until then the page says Not saved yet, the service still
// stores what it stored before, a narrower window keeps it, and Discard puts back what was stored.

const about = (page: Page) => page.getByRole('textbox', { name: 'About our business' })
/** The header's status: the one line that says whether the words are saved. */
const status = (page: Page) => page.locator('header [aria-live=polite]')

/** About our business as the service stores it. */
async function storedAbout(page: Page) {
  const res = await page.request.get('/api/v1/settings')
  const all = (await res.json()) as { key: string; value: unknown }[]
  const value = all.find((s) => s.key === 'business.about')?.value
  return typeof value === 'string' ? value : ''
}

test('a first version is written from the install and saved only when it is kept', async ({
  page,
}) => {
  await go(page, '/settings/general')
  await expect(page.getByRole('heading', { name: 'What the company does' })).toBeVisible()
  await expect(
    page.getByText(
      'Leave out numbers, dates, deals, legal conclusions, secrets and personal data.',
    ),
  ).toBeVisible()
  // An empty text: the page offers to write a first version.
  await about(page).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await expect(status(page)).toHaveText('Saved')
  await inHttpOnly('stored text', () => expect.poll(() => storedAbout(page)).toBe(''))

  const write = page.getByRole('button', { name: 'Write a first version for me' })
  await write.click()
  const first = page.getByRole('group', { name: 'First version' })
  await expect(first).toContainText('Not saved until you keep it')
  await expect(about(page)).toHaveText(/^(We follow|Our work is organised in) /)
  await expect(status(page)).toHaveText('Not saved yet')
  // The page is drawn again when the window crosses the narrow layout: the draft stays.
  const wide = page.viewportSize()!
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(first).toBeVisible()
  await page.setViewportSize(wide)
  await expect(first).toBeVisible()
  await expect(about(page)).toHaveText(/^(We follow|Our work is organised in) /)
  // Changed, and still not saved.
  await about(page).locator('p').last().click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Draft.')
  await page.waitForTimeout(1200)
  await expect(status(page)).toHaveText('Not saved yet')
  await inHttpOnly('stored text', async () => expect(await storedAbout(page)).toBe(''))

  // Discard puts back what was stored: nothing.
  await first.getByRole('button', { name: 'Discard' }).click()
  await expect(first).toBeHidden()
  await expect(about(page)).toHaveText('')
  await expect(write).toBeVisible()

  // Kept, it is saved as it is shown.
  await write.click()
  await expect(about(page)).toHaveText(/^(We follow|Our work is organised in) /)
  const drafted = (await about(page).innerText()).trim()
  await first.getByRole('button', { name: 'Keep it' }).click()
  await expect(first).toBeHidden()
  await expect(status(page)).toHaveText('Saved')
  await inHttpOnly('stored text', () => expect.poll(() => storedAbout(page)).toBe(drafted))
})
