import { expect, go, inHttpOnly, inMockUntil, test } from './go.ts'

// J7: a new workspace runs the loop once, ask first (FR-816): it publishes its names under a
// domain, asks about a number and hears Not found, writes what it knows and asks the same question
// again, the checklist counting each step. The way from a tool the person connects to their own
// names, and a domain made with them, is the own-data journey (tests/e2e-own).
test('a new workspace publishes its names, asks, writes and asks again', async ({ page }) => {
  // The whole loop once, two questions answered on the way.
  test.slow()
  await go(page, '/inbox?demo=setup')
  await expect(page.getByText('0 of 4 done')).toBeVisible()
  const steps = page.getByRole('main').getByRole('listitem')
  await expect(steps).toHaveText([
    /^1Publish your names/,
    /^2Ask about a number you know/,
    /^3Write what you know, and ask again/,
    /^4Ask your own agent/,
  ])
  // About our business left the steps: the card's foot links to it until it is written.
  await expect(page.getByRole('link', { name: 'About our business' })).toHaveAttribute(
    'href',
    '/settings/general?setup=1',
  )
  // The service's new install reads no definitions until a tool is connected.
  await inHttpOnly('new install with no definitions yet', async () => {
    await expect(steps.first().getByRole('button', { name: 'Connect', exact: true })).toBeVisible()
    await expect(
      page.getByText(/Context goes to the domain your names are published under\./),
    ).toBeVisible()
  })
  await inMockUntil('a follow-up to this journey', 'the definitions connected first', async () => {
    // The names have no domain: they go under the one Jon owns, said on the step and in the card.
    await expect(steps.first()).toContainText('They go under Sales.')
    await page.getByRole('button', { name: 'Publish 5 names' }).click()
    const review = page.getByRole('dialog', { name: 'The names from your definitions' })
    await expect(review.getByRole('textbox', { name: 'Domain' })).toHaveValue('Sales')
    await expect(review.getByText('Sales is a domain already.')).toBeVisible()
    await review.getByRole('button', { name: 'Publish all' }).click()
    await expect(page.getByText('2 names are published under Sales')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByText('1 of 4 done')).toBeVisible()

    // A question in Jon's own words, before anything is written.
    await page.getByRole('button', { name: 'Ask', exact: true }).click()
    const box = page.getByRole('textbox', { name: 'Ask a question' })
    await box.click()
    await page.keyboard.insertText('Why did orders in Norway fall in August 2026?')
    await box.press('Enter')
    await expect(page.getByRole('log').getByRole('group', { name: 'Answer actions' })).toBeVisible()
    await expect(page.getByText('Your question is answered')).toBeVisible()
    await page.getByRole('button', { name: 'Back to setup' }).click()
    await expect(page.getByText('2 of 4 done')).toBeVisible()

    // What Jon knows, complete as the service needs it: where it applies, and a source with a
    // sentence copied from it, published in one step in his domain.
    await page.getByRole('button', { name: 'Write context', exact: true }).click()
    await page
      .getByRole('textbox', { name: 'Title' })
      .fill('Orders in Norway fell after the customs stop')
    const text = page.getByRole('textbox', { name: 'What agents should know' })
    await text.click()
    await page.keyboard.insertText(
      'Orders in Norway fell to almost nothing after a customs rule stopped online sales on 4 August 2026.',
    )
    await page.getByRole('button', { name: /^Applies to/ }).click()
    await page.getByRole('combobox', { name: 'Search Applies to' }).fill('Orders')
    await page
      .getByRole('listbox', { name: 'Applies to' })
      .getByRole('option', { name: /^Orders/ })
      .first()
      .click()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /^When/ }).click()
    await page.getByRole('radio', { name: 'Always' }).click()
    await page.getByRole('button', { name: 'Done' }).click()
    await page.getByRole('button', { name: /Add a source/ }).click()
    await page.locator('#fact-source').fill('https://customs.example/norway')
    await page.locator('#fact-quote').fill('Online sales to Norway stopped on 4 August 2026.')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    // Written, the step is done only once the same question is asked again: its button asks it.
    await expect(page.getByText('2 of 4 done')).toBeVisible()
    await page.getByRole('button', { name: 'Ask again', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Ask a question' })).toContainText(
      'What should I know about Orders',
    )
    const again = page.getByRole('textbox', { name: 'Ask a question' })
    await again.click()
    await again.press('End')
    await again.press('Enter')
    await expect(page.getByText('Your question is answered')).toBeVisible()
    await page.getByRole('button', { name: 'Back to setup' }).click()
    await expect(page.getByText('3 of 4 done')).toBeVisible()
  })
})
