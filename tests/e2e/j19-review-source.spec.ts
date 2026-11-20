import { expect, go, test } from './go.ts'

// J19, the Source review as "the comparison": the source is the review. A bar says what is
// compared, now and suggested, and how many parts change; the Fields table shows each field now
// and suggested, opening with only what changed, and its switch, remembered for the person, shows
// every field. The text reads as it will, now beside suggested, with only the changed words marked
// inside the sentences. S shows the stored text line by line instead, with its numbers, removed
// lines before added ones, and only the changed words marked, even when a paragraph is split in
// two. N and P step through the changes. Preview is a quiet toggle for the item as its page will
// show it, and no view hides what must be decided: the clash gate and the claim check stay in both.

test('the comparison: the bar, the changed fields, then the text with only the changed words marked', async ({
  page,
}) => {
  await go(page, '/inbox/sug-ines/review')
  const source = page.getByRole('region', { name: 'The source' })
  await expect(source).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show the preview' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )

  // The bar: what is compared, and the parts that change (the source page and the text).
  const bar = source.getByRole('region', { name: 'What is compared' })
  await expect(bar).toContainText('Now')
  // Who and when, as the review says it (the day is the demo's own).
  await expect(bar.getByText(/^by Ines Duarte, from a chat, \d+ Oct 2026$/)).toBeVisible()
  await expect(bar).toContainText('2 changed')
  await expect(bar).toContainText('8 the same')

  // The Fields table opens with only what changed, and names the eight it hides.
  const fields = source.getByRole('region', { name: 'Fields' })
  await expect(fields.getByRole('row', { name: 'Source, changed' })).toContainText('-october')
  const only = fields.getByRole('switch', { name: 'Only what changed' })
  await expect(only).toBeChecked()
  await expect(fields).toContainText(
    "8 fields that stay the same are hidden: Title, Kind, Domain, Owner, Applies to, When, Check date, Don't conclude.",
  )
  await expect(fields.getByRole('rowheader', { name: 'Owner' })).toHaveCount(0)

  // The text, now beside suggested: the number that changed, not the sentence, and the new
  // sentence with its link, underlined on the right only.
  const text = source.getByRole('region', { name: 'Text' })
  await expect(text.locator('del:not([aria-hidden])')).toHaveText(['[removed: 312]'])
  await expect(text.locator('ins:not([aria-hidden])').first()).toHaveText('[added: 340]')
  await expect(text.locator('ins:not([aria-hidden])').filter({ hasText: 'accounts' })).toHaveCount(
    1,
  )
  await expect(text.getByText('[@')).toHaveCount(0)
  await expect(text).toContainText('1 passage changed')

  // N steps to each change, field first, then the text.
  await page.keyboard.press('n')
  await expect(source.getByText('Change 1 of 2')).toBeVisible()
  await expect(fields.getByRole('row', { name: 'Source, changed' })).toBeFocused()
  await page.keyboard.press('n')
  await expect(text.getByRole('group', { name: 'Change 1 of 1 in the text' })).toBeFocused()
  await page.keyboard.press('p')
  await expect(source.getByText('Change 1 of 2')).toBeVisible()

  // S shows the same lines as before the comparison, and S again the text as it reads.
  await page.keyboard.press('s')
  const lines = source.getByRole('button', { name: 'Show the lines' })
  await expect(lines).toHaveAttribute('aria-pressed', 'true')
  await expect(text.getByText('2 sentences changed in 1 place')).toBeVisible()
  const signs = await text
    .locator('[aria-label=added], [aria-label=removed]')
    .evaluateAll((els: { getAttribute(n: string): string | null }[]) =>
      els.map((e) => e.getAttribute('aria-label')),
    )
  expect(signs).toEqual(['removed', 'added'])
  await page.keyboard.press('s')
  await expect(lines).toHaveAttribute('aria-pressed', 'false')
  await expect(text).toContainText('1 passage changed')
})

test('the switch shows every field, and stays as the person left it', async ({ page }) => {
  await go(page, '/inbox/sug-ines/review')
  const fields = page.getByRole('region', { name: 'Fields' })
  const only = fields.getByRole('switch', { name: 'Only what changed' })
  await only.click()
  await expect(only).not.toBeChecked()
  await expect(fields.getByRole('row')).toHaveCount(10)
  // A field that stays the same is quiet: no tint, no mark, and nothing is said hidden.
  const owner = fields
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: 'Owner' }) })
  await expect(owner.locator('del, ins')).toHaveCount(0)
  await expect(fields.getByText(/are hidden/)).toHaveCount(0)

  // The next suggestion, and a reload, keep it.
  await page.keyboard.press('j')
  await expect(page).not.toHaveURL(/sug-ines\/review/)
  await expect(page.getByRole('switch', { name: 'Only what changed' })).not.toBeChecked()
  await page.reload()
  await expect(page.getByRole('switch', { name: 'Only what changed' })).not.toBeChecked()
})

test('in the lines, a paragraph split in two and reworded marks only the words that changed', async ({
  page,
}) => {
  await go(page, '/inbox/sug-ines-long/review')
  const text = page
    .getByRole('region', { name: 'The source' })
    .getByRole('region', { name: 'Text' })
  await expect(text).toContainText('passages changed')
  await page.keyboard.press('s')
  await expect(text.getByText('3 sentences changed in 1 place')).toBeVisible()

  // The first sentence moved to a line of its own: it stays plain on both sides.
  await expect(text.locator('del, ins').filter({ hasText: 'check the file dates' })).toHaveCount(0)
  await expect(text.locator('del').first()).toHaveText(/weekend files together/)
  await expect(text.locator('ins').filter({ hasText: 'Then check refunds' })).toHaveCount(1)

  // The blank line between the two paragraphs is a paragraph break, not an added line.
  const signs = await text
    .locator('[aria-label=added], [aria-label=removed]')
    .evaluateAll((els: { getAttribute(n: string): string | null }[]) =>
      els.map((e) => e.getAttribute('aria-label')),
    )
  expect(signs).toEqual(['removed', 'added', 'added'])
  await expect(text.getByText('New paragraph')).toHaveCount(1)

  await page.keyboard.press('n')
  await expect(text.getByRole('group', { name: 'Change 1 of 1 in the text' })).toBeFocused()
})

test('Preview shows the item, and the clash gate stays in both views', async ({ page }) => {
  await go(page, '/inbox/sug-sofia-clash/review')
  const decide = page.getByRole('complementary', { name: 'Try it and decide' })
  const gate = page.getByRole('button', { name: /^How this relates to / })
  await expect(gate.first()).toBeVisible()
  const relations = await gate.count()
  expect(relations).toBeGreaterThan(0)
  await expect(page.getByText('Marked unrelated')).toBeVisible()
  await expect(decide.getByRole('button', { name: 'Publish' })).toBeEnabled()

  const preview = page.getByRole('button', { name: 'Show the preview' })
  await preview.click()
  await expect(preview).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: 'Preview' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'The source' })).toHaveCount(0)
  await expect(gate).toHaveCount(relations)
  await preview.click()
  await expect(page.getByRole('region', { name: 'The source' })).toBeVisible()
  await expect(gate).toHaveCount(relations)
})

test('an agent’s claim check stays in both views', async ({ page }) => {
  await go(page, '/inbox/sug-agent/review')
  const claims = page.getByRole('table').filter({ hasText: 'In the copied sentence' })
  await expect(claims).toBeVisible()
  await page.getByRole('button', { name: 'Show the preview' }).click()
  await expect(claims).toBeVisible()
})
