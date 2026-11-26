import { expect, go, signInAs, test } from './go.ts'

// J94, the gap card for a word the workspace does not know, and a stop (changes 7 and 10 of the
// live test of Ask), as the service wrote them on the demo week. "What is our EBITDA
// definition?" names no metric, value or context item: a reader who may not add it tells an admin,
// with the word alone, and the card says who was told (?example=loop-unknown); an admin may add it
// to Definitions. A turn that stopped at its step limit says Stopped and carries no state
// (?example=loop-stopped). Tell the owner for a subject the workspace knows is J66.

for (const { name, viewport } of [
  { name: '1440', viewport: { width: 1440, height: 900 } },
  { name: '390', viewport: { width: 390, height: 844 } },
] as const) {
  test(`${name}: a reader tells an admin about a word Ask could not find`, async ({ page }) => {
    await signInAs(page, 'Ines Duarte')
    await page.setViewportSize(viewport)
    await go(page, '/ask?example=loop-unknown')
    const log = page.getByRole('log')
    await expect(log.getByRole('group', { name: 'Answer actions' })).toBeVisible({
      timeout: 20_000,
    })
    // No state: nothing it read is about the question, so it is not a Not found of a subject.
    await expect(log.getByRole('button', { name: /^(Not found|Checked|Partial)$/ })).toHaveCount(0)
    const gap = log.getByRole('region', { name: 'Not written yet: “EBITDA”' })
    await expect(gap).toContainText(
      'No published metric, other name or context item uses this word yet.',
    )
    // Who can add it: the admins, by name.
    await expect(gap).toContainText(/, (an admin|the admins), can add it\./)
    await expect(gap).toContainText('Only this word is sent, never your question.')
    await gap.getByRole('button', { name: 'Tell an admin' }).click()
    await expect(
      gap.getByRole('status').filter({ hasText: /^Sent to .+ It waits in their Inbox\.$/ }),
    ).toBeVisible()
    await expect(gap.getByRole('button', { name: 'Tell an admin' })).toHaveCount(0)
  })

  test(`${name}: an admin may add the word to Definitions`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await go(page, '/ask?example=loop-unknown')
    const gap = page.getByRole('log').getByRole('region', { name: 'Not written yet: “EBITDA”' })
    await expect(gap).toContainText('It is yours to add.')
    await expect(gap.getByRole('button', { name: 'Add “EBITDA” to Definitions' })).toBeVisible()
    await expect(gap.getByRole('button', { name: /^Tell/ })).toHaveCount(0)
  })

  test(`${name}: a turn stopped at its limit says Stopped, with no state`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await go(page, '/ask?example=loop-stopped')
    const log = page.getByRole('log')
    await expect(log.getByText('Stopped', { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(log.getByText(/^Ask stopped at its limit of \d+ steps/)).toBeVisible()
    await expect(
      log.getByRole('button', { name: /^(Not found|Checked|Partial|Outdated|Conflict)$/ }),
    ).toHaveCount(0)
    await expect(log.locator('[data-gap]')).toHaveCount(0)
  })
}
