import { expect, go, signInAs, test } from './go.ts'

// J66, Tell the owner (decision 7 of the chat audit): a reader who may not write opens an answer
// of Ask's loop that found nothing, Not found, and tells the owners; Ask itself writes nothing.
// On the service the owners then find a card in their Inbox (tests/web/integration/
// ask-tell-owner.test.ts).
test('a reader tells the owner that nothing is written, once', async ({ page }) => {
  await signInAs(page, 'Ines Duarte')
  await go(page, '/ask?example=loop-missing')
  const log = page.getByRole('log')
  await expect(log.getByRole('button', { name: 'Not found', exact: true })).toBeVisible()
  // The gap card says what is not written and who can write it.
  const gap = log.getByRole('region', { name: 'Not written yet: Orders in Poland' })
  await expect(gap).toContainText('Jon Abara and Sofia Brandt, the owners of Sales, can write it.')
  // A reader may not write it, so the next step is to tell the owners.
  await expect(log.getByRole('button', { name: /^Write context/ })).toHaveCount(0)
  await log.getByRole('button', { name: 'Tell the owner' }).click()
  await expect(
    log
      .getByRole('status')
      // Who was told, by name: each a person's chip.
      .filter({
        hasText:
          /^Sent to Jon Abara.* and Sofia Brandt.*, the owners of Sales\. It waits in their Inbox\.$/,
      }),
  ).toBeVisible()
  await expect(log.getByRole('button', { name: 'Tell the owner' })).toHaveCount(0)
})
