import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J36, writing a first context item: the editor starts in a domain that exists and says by name
// everything the service needs before Publish works (where it applies, a source and a sentence
// from it). A publish the service refuses says why in its own words, with Retry only where trying
// again can help; the live items it clashes with are read as unrelated unless the panel said more.

const publish = (page: Page) => page.getByRole('button', { name: 'Publish', exact: true })

async function write(page: Page, title: string) {
  await page.getByRole('textbox', { name: 'Title' }).fill(title)
  await page.getByRole('textbox', { name: 'What agents should know' }).click()
  await page.keyboard.insertText(`${title}, as the weekly report shows it.`)
  await page.getByRole('button', { name: /Add a source/ }).click()
  await page.locator('#fact-source').fill('https://reports.example/weekly')
}

test('a new item starts in a real domain and names what it still needs', async ({ page }) => {
  await go(page, '/context/new')
  // The domain has its name, never a bare dot.
  const domain = page.getByRole('button', { name: /^Domain/ })
  await expect(domain).toHaveAccessibleName(/^Domain \S/)
  await expect(domain).not.toContainText('Choose a domain')
  await expect(publish(page)).toHaveAttribute('aria-disabled', 'true')
  await expect(publish(page)).toHaveAccessibleDescription(
    'Add a title, what agents should know, where it applies, when it happened, a source first.',
  )

  await write(page, 'Orders are counted when they ship')
  await page.keyboard.press('Escape')
  // A source needs a sentence copied from it, and the item a place it applies: the service
  // refuses one without either, so Publish says so before it is pressed.
  await expect(publish(page)).toHaveAccessibleDescription(
    'Add where it applies, when it happened, a sentence copied from the source first.',
  )
  await expect(page.getByText('Not ready: add where it applies')).toBeVisible()
  // Pressed anyway, it goes to the first thing missing.
  await publish(page).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: /^Applies to/ })).toBeFocused()
})

/** A whole item about Orders, which other live items about Orders clash with. */
async function writeComplete(page: Page) {
  await go(page, '/context/new')
  await write(page, 'Orders are counted when they ship')
  await page.locator('#fact-quote').fill('An order counts on the day it ships.')
  await page.keyboard.press('Escape')
  // An event asks when it happened: this rule of thumb holds at any date.
  await page.getByRole('button', { name: /^When/ }).click()
  await page.getByRole('radio', { name: 'Always' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: /^Applies to/ }).click()
  await page.getByRole('combobox', { name: 'Search Applies to' }).fill('Orders')
  await page
    .getByRole('listbox', { name: 'Applies to' })
    .getByRole('option', { name: /^Orders/ })
    .first()
    .click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Remove Orders', exact: true })).toBeVisible()
  await expect(publish(page)).not.toHaveAttribute('aria-disabled', 'true')
}

/** The side panel, opened from the More menu when it is not open already (it opens by itself only for an overlap). */
async function sidePanel(page: Page) {
  const panel = page.getByRole('complementary', { name: 'What agents get' })
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'More' }).click()
    await page.getByRole('menuitem', { name: 'Show what agents get' }).click()
  }
  return panel
}

test('a first paragraph over the limit is not ready: the button, the footer and the side panel agree', async ({
  page,
}) => {
  await writeComplete(page)
  const footer = page.getByText('Ready', { exact: true })
  await expect(footer).toBeVisible()
  // Lengthen the first paragraph past what agents read first.
  await page.getByRole('textbox', { name: 'What agents should know' }).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText(` ${'It counts every order that has shipped. '.repeat(8)}`)
  await expect(page.getByText(/^Summary \d{3} of 280$/)).toHaveClass(/text-destructive/)
  // Not "Ready" beside a red count: the button waits, and says why.
  await expect(page.getByText('Not ready: shorten the first paragraph')).toBeVisible()
  await expect(footer).toHaveCount(0)
  await expect(publish(page)).toHaveAttribute('aria-disabled', 'true')
  await expect(publish(page)).toHaveAccessibleDescription(
    'Shorten the first paragraph to 280 characters first.',
  )
  // The side panel says the same.
  const panel = await sidePanel(page)
  await expect(panel).toContainText('Not ready yet.')
  await expect(panel).toContainText('Shorten the first paragraph to 280 characters first.')
  await expect(panel.getByText('Ready.', { exact: true })).toHaveCount(0)
})

test('an item opened to edit and left alone is not ready, in the footer and the side panel', async ({
  page,
}) => {
  await go(page, '/context/itm_norway_stop/edit')
  await expect(page.getByText('No changes yet')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveAccessibleDescription(
    'Nothing has changed yet.',
  )
  const panel = await sidePanel(page)
  await expect(panel).toContainText('Not ready yet.')
  await expect(panel.getByText('Ready.', { exact: true })).toHaveCount(0)
})

test('an overlap the panel never listed does not refuse the publish', async ({ page }) => {
  await writeComplete(page)

  // Other live items about Orders reach the same questions. The panel reads an overlap left alone
  // as unrelated, and so does the service: Publish goes through the first time it is pressed.
  await publish(page).click()
  await expect(page).toHaveURL(/\/context\/(?!new)[^/?]+$/)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Orders are counted when they ship' }),
  ).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})
