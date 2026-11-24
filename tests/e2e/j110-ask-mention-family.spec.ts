import { expect, go, test } from './go.ts'

// J110: an owner names a family in Ask with '@' (FR-142). On the mock's ?demo=families, Active
// buyers is a family of three metrics, one per sales line: typing its name after '@' in Ask finds
// it among the definitions, and its chip in the asked question opens the
// family's quick view. Before, the '@' list left every family out, so it found nothing. A text's
// '@' still offers no family: the service keeps a text's mention of a metric only.

test("an owner mentions a family in Ask's '@' list", async ({ page }) => {
  await go(page, '/ask?demo=families')
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially('@Active buyers')
  const list = page.getByRole('listbox', { name: 'Mention' })
  const family = list.getByRole('option', { name: /^Active buyers\b/ })
  await expect(family).toBeVisible()
  await box.press('Enter')
  await expect(list).toBeHidden()
  await box.pressSequentially(' by sales line')
  await box.press('Enter')

  // The question keeps the family as a chip that opens it, never as words no longer available.
  const asked = page.getByRole('button', { name: 'Active buyers', exact: true }).first()
  await expect(asked).toBeVisible()
  await expect(page.getByText('Active buyers, no longer available')).toHaveCount(0)
  await asked.click()
  await expect(page.getByRole('heading', { name: 'Active buyers', level: 2 })).toBeVisible()

  // A text links only to what the service keeps: the family is not offered there.
  await go(page, '/context/new')
  const body = page.getByRole('textbox', { name: 'What agents should know' })
  await body.click()
  await body.pressSequentially('@Active')
  await expect(list.getByRole('option', { name: /^Active customers\b/ })).toBeVisible()
  await expect(family).toHaveCount(0)
})
