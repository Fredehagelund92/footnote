import { card, expect, go, inHttpOnly, mode, signInAs, test } from './go.ts'

// J62, two dead ends: a sender who opens the review of their own waiting suggestion is told who
// can review it, and Cube's Connect page, where the server sets everything, says where that
// setting lives and goes back to Cube.

test("a sender who opens their waiting suggestion's review is told who can review it", async ({
  page,
}) => {
  // The mock shows every review to everyone, so there Jon opens his own; on the service Ines does.
  const [sender, mine, title, owner] =
    mode === 'http'
      ? [
          'Ines Duarte',
          'sug-ines',
          'Units sold excludes test accounts',
          'Jon Abara or Sofia Brandt, owners of Sales',
        ]
      : [
          'Jon Abara',
          'sug-jon',
          'Norway launch campaign started on 24 March 2026',
          'Tomas Eriksen, owner of Marketing',
        ]
  if (sender !== 'Jon Abara') await signInAs(page, sender)
  await go(page, `/inbox/${card(mine)}/review`)
  const main = page.getByRole('main')
  await expect(main.getByText(`${title} is waiting for ${owner}, who can review it.`)).toBeVisible()
  await expect(main.getByText(/probably/)).toHaveCount(0)
  await main.getByRole('button', { name: 'Back to the Inbox' }).click()
  await expect(page).toHaveURL(/\/inbox/)
})

test('a link to a suggestion that is nowhere says so, without guessing', async ({ page }) => {
  await go(page, '/inbox/sug-nowhere/review')
  const main = page.getByRole('main')
  await expect(main.getByText('Nothing to review here')).toBeVisible()
  await expect(main.getByText(/probably/)).toHaveCount(0)
})

test("Cube's Connect page says where the setting lives and goes back to Cube", async ({ page }) => {
  // The mock draws Cube's form; only the service has Cube set where the server runs.
  await inHttpOnly("Cube's model folder, which the server sets", async () => {
    await go(page, '/settings/integrations/cube/connect')
    const main = page.getByRole('main')
    await expect(main.getByText('CUBE_MODEL_DIR')).toBeVisible()
    await main.getByRole('link', { name: 'Back to Cube' }).click()
    await expect(page).toHaveURL(/\/settings\/integrations\/cube$/)
  })
})
