import type { Page } from '@playwright/test'
import { expect, go, inHttpOnly, test } from './go.ts'

// J119: About our business says what to write and what to leave out, and Write a first version for
// me drafts the text from the install's domains, metrics and definitions. The draft is shown to
// change and saved only when it is kept: until then the page says Not saved yet, the service still
// stores what it stored before, and Discard puts back what was stored. Start from the guide puts
// the shape of the text on the sheet, a part in brackets for each thing to say, and never another
// company's words: it is kept only once every part is filled in.

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

test('the guide is a shape to fill in, kept only once every part has your own words', async ({
  page,
}) => {
  await go(page, '/settings/general')
  await about(page).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await expect(status(page)).toHaveText('Saved')
  await inHttpOnly('stored text', () => expect.poll(() => storedAbout(page)).toBe(''))

  // The shape, with no company's words in it, and nothing saved: its first part is selected.
  await page.getByRole('button', { name: 'Start from the guide' }).click()
  const guide = page.getByRole('group', { name: 'Guide' })
  const keep = guide.getByRole('button', { name: 'Keep it' })
  await expect(about(page)).toHaveText(
    'We sell [what] to [whom], in [where], through [which channels].',
  )
  await expect(guide).toContainText('Not saved until you keep it')
  await expect(status(page)).toHaveText('Not saved yet')
  await expect(keep).toBeDisabled()
  const selected = () => page.evaluate(() => window.getSelection()?.toString())
  expect(await selected()).toBe('[what]')

  // Typed over, part by part: Tab goes to the next part that is left.
  await page.keyboard.type('invoicing software')
  await page.keyboard.press('Tab')
  expect(await selected()).toBe('[whom]')
  await page.keyboard.type('small firms')
  // A click on a part selects it whole, brackets and all.
  const where = await about(page).evaluate((sheet) => {
    const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent?.indexOf('[where]') ?? -1
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(node, at + 2)
      range.setEnd(node, at + 4)
      const box = range.getBoundingClientRect()
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    return null
  })
  await page.mouse.click(where!.x, where!.y)
  expect(await selected()).toBe('[where]')
  await page.keyboard.type('the Nordic countries')
  // With a part left, it cannot be kept, and it is still not saved.
  await page.waitForTimeout(1200)
  await expect(keep).toBeDisabled()
  await expect(status(page)).toHaveText('Not saved yet')
  await inHttpOnly('stored text', async () => expect(await storedAbout(page)).toBe(''))
  await page.keyboard.press('Tab')
  expect(await selected()).toBe('[which channels]')
  await page.keyboard.type('our website and partners')

  // Every part filled in: kept, it is saved as it is shown.
  const text =
    'We sell invoicing software to small firms, in the Nordic countries, through our website and partners.'
  await expect(about(page)).toHaveText(text)
  await keep.click()
  await expect(guide).toBeHidden()
  await expect(status(page)).toHaveText('Saved')
  await inHttpOnly('stored text', () => expect.poll(() => storedAbout(page)).toBe(text))
})
