import { expect, go, test } from './go.ts'

// J107: About our business says what the company does; the words people use and what they mean
// are terms in Definitions (FR-816). A "Word: meaning" line for a word Definitions already has is
// said under the field as it is typed, with a link to that definition, and New term opens a new
// term in Definitions.
test('a word the text defines again links to its definition, and New term opens a new one', async ({
  page,
}) => {
  await go(page, '/settings/general')
  const about = page.getByRole('textbox', { name: 'About our business' })
  await about.click()
  await page.keyboard.press('ControlOrMeta+a')
  // Typed as one input each, as a paste would be: key by key, a loaded machine ran past the time
  // limit.
  await page.keyboard.insertText('We are an outdoor-gear retailer.')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('Orders: a purchase a customer paid for.')
  const said = page.getByRole('listitem').filter({ hasText: /^Orders already has a definition/ })
  await expect(said).toBeVisible()
  await said.getByRole('link', { name: 'Orders', exact: true }).click()
  await expect(page).toHaveURL(/\/definitions\/Orders$/)
  await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible()

  await go(page, '/settings/general')
  await page.getByRole('link', { name: 'New term', exact: true }).click()
  await expect(page).toHaveURL(/\/definitions\/new$/)
})
