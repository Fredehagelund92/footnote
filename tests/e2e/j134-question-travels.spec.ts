import { expect, go, test } from './go.ts'

// J134: the question travels both ways (FR-816, ask first). Not found's Write context opens the
// editor on what the question named, its days in When and the question itself (J99 checks the
// address the answer gives); published, the item's page offers Ask again, which opens Ask with the
// same question typed in, not yet sent.
test('the editor takes the question’s days, and the published item asks it again', async ({
  page,
}) => {
  const question = 'Why did orders in Norway fall in September 2026?'
  await go(
    page,
    `/context/new?${new URLSearchParams({
      about: 'Orders|Norway',
      kind: 'event',
      period: '1-30 Sep 2026',
      q: question,
    })}`,
  )
  await expect(page.getByRole('heading', { name: 'New context', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: /^When/ })).toContainText(/^1 to 30 Sept? 2026$/)
  await expect(page.getByRole('button', { name: 'Kind Event' })).toBeVisible()

  await page.getByRole('textbox', { name: 'Title' }).fill('Orders in Norway fell in September')
  const text = page.getByRole('textbox', { name: 'What agents should know' })
  await text.click()
  await page.keyboard.insertText(
    'Orders in Norway fell in September 2026 because a customs rule stopped online sales.',
  )
  await page.getByRole('button', { name: /Add a source/ }).click()
  await page.locator('#fact-source').fill('https://customs.example/norway')
  await page.locator('#fact-quote').fill('Online sales to Norway stopped in September 2026.')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Publish', exact: true }).click()

  const again = page.getByRole('button', { name: 'Ask again', exact: true })
  await expect(again).toHaveAttribute('href', `/ask?${new URLSearchParams({ q: question })}`)
  await again.click()
  await expect(page.getByRole('textbox', { name: 'Ask a question' })).toContainText(question)
})
