import { cardIn, expect, go, test } from './go.ts'

// J1: an owner reviews a suggestion and publishes it. Three steps from the Inbox: select, Review, Publish.
test('an owner reviews and publishes a suggestion', async ({ page }) => {
  await go(page, '/inbox?demo=week&card=sug-ines')
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/inbox/${cardIn('sug-ines')}/review`))
  const decision = page.locator('#decision')
  await expect(decision.getByText('Ready.', { exact: true })).toBeVisible()
  await decision.getByRole('button', { name: 'Publish', exact: true }).click()
  // The next suggestion opens at once, and a toast says Published once the service has, with Undo.
  await expect(page).not.toHaveURL(new RegExp(`${cardIn('sug-ines')}/review`))
  const said = page.locator('[data-sonner-toast]').filter({ hasText: /^Published “/ })
  await expect(said).toBeVisible()
  await expect(said.getByRole('button', { name: 'Undo' })).toBeVisible()
})
