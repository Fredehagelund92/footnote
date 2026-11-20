import { expect, go, test } from './go.ts'

// J3: someone asks, gets an answer that says how sure it is, and reports a part that is wrong; an
// owner decides between two items that disagree; and nothing written gets Not found.
test('someone asks, then reports a wrong part', async ({ page }) => {
  await go(page, '/ask?n=j3')
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially('Do Norway orders include gift-card money?')
  await box.press('Enter')
  await expect(page.getByText('Conflict', { exact: true }).first()).toBeVisible()
  // Something wrong? is in More, under the answer.
  await page.getByRole('button', { name: 'More' }).last().click()
  await page.getByRole('menuitem', { name: 'Something wrong?' }).click()
  await page
    .getByRole('textbox', { name: "What's wrong?" })
    .fill('Gift cards are paid out separately since October.')
  await page.getByRole('button', { name: /^Send to the owner of/ }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'You reported this just now' }),
  ).toBeVisible()
})

test('an owner chooses which one stays among the items that disagree', async ({ page }) => {
  await go(page, '/ask?n=j3c')
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially('Do Norway orders include gift-card money?')
  await box.press('Enter')
  await expect(page.getByText('Conflict', { exact: true }).first()).toBeVisible()
  // The answer cites the customs stop too, but it disagrees with nothing: the pair shown, and the
  // comparison it opens, are the two that do (FR-220).
  const pair = page
    .getByRole('log')
    .locator('div', { has: page.getByText('These two disagree', { exact: true }) })
    .last()
  await expect(pair).toContainText('Norway orders count store credit')
  await expect(pair).toContainText('Norway orders are card and cash payments only')
  await expect(pair).not.toContainText('Online sales to Norway stopped')
  await pair.getByRole('button', { name: 'Compare the two' }).click()
  const dock = page.getByRole('region', { name: 'Conflict', exact: true })
  await expect(
    dock.getByRole('heading', { name: 'Two items say different things about Orders in Norway.' }),
  ).toBeVisible()
  // Every choice there asks why before it acts: nothing is archived by one click.
  await dock.getByRole('button', { name: 'Keep this one' }).first().click()
  await expect(page.getByRole('dialog', { name: /^Keep “/ })).toBeVisible()
})

test('a question nothing written covers gets Not found', async ({ page }) => {
  await go(page, '/ask?n=j3n')
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially('Why did conversion drop in Sweden last month?')
  await box.press('Enter')
  await expect(
    page.getByRole('log').getByRole('button', { name: 'Not found', exact: true }),
  ).toBeVisible()
})
