import { expect, go, test } from './go.ts'

// J5: an owner answers a report, and the card is done.
test('an owner answers a report', async ({ page }) => {
  await go(page, '/inbox?demo=week&card=flag-germany')
  // A named report keeps who sent it: a person sends one from Ask, while an agent's report keeps
  // nobody (docs/product.md, section 9).
  await expect(page.getByText(/Reported by Maria Lindqvist from Ask,/)).toBeVisible()
  // The owners read the words she would write, and the link she sent.
  await expect(page.getByText('Maria Lindqvist suggests these words')).toBeVisible()
  await expect(
    page.getByText(/^Every market's payment files arrive the morning after/),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: /wiki\.example\/data\/freshness/ })).toHaveAttribute(
    'href',
    'https://wiki.example/data/freshness',
  )
  await page.getByRole('button', { name: 'Not a problem' }).click()
  await expect(page.getByText('Report closed')).toBeVisible()
  await go(page, '/inbox?tab=all')
  await expect(
    page.getByRole('button', { name: /Orders lags by one day in the source tool.*Not a problem/ }),
  ).toBeVisible()
})
