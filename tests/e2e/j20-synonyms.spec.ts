import type { Page } from '@playwright/test'
import { expect, go, mode, test } from './go.ts'

// J20, synonyms as tags: a comma or Enter makes a tag at once, a word that means something else
// says who has it and is never saved, Backspace selects then removes, Escape keeps what was made.
// The list folds synonyms into their definition's row; a term's editor has one optional
// Other name for, and clearing it brings the meaning back. A word that was not added stays,
// marked, with one plain line that says why, and Try again when the save did not go through. On a
// definition's page the names are one line, and Add a name opens the field in place.

test('the term editor stops a taken word with who has it, and only warns of a look-alike', async ({
  page,
}) => {
  await go(page, '/definitions/new?sameAs=Gross%20sales')
  const word = page.getByRole('textbox', { name: 'The word' })
  const publish = page.getByRole('button', { name: 'Publish' })
  // Turnover already means Net revenue: an accent makes no other word of it.
  await word.fill('Túrnover')
  await expect(
    page.getByRole('note').filter({
      hasText:
        'This word is taken. “Turnover” is already another name for Net revenue, added by Sofia Brandt.',
    }),
  ).toBeVisible()
  await expect(page.getByText('Not ready: this word is taken')).toBeVisible()
  await expect(page.getByText('Ready', { exact: true })).toHaveCount(0)
  await expect(publish).toHaveAttribute('aria-disabled', 'true')
  // A look-alike can be a real second thing: it warns, and Publish stays open.
  await word.fill('Turnovers')
  await expect(
    page.getByRole('note').filter({
      hasText:
        'A similar word is in use. “Turnovers” looks like “Turnover”, which means Net revenue.',
    }),
  ).toBeVisible()
  await expect(page.getByText('Ready', { exact: true })).toBeVisible()
  await expect(publish).toHaveAttribute('aria-disabled', 'false')
  // A word nothing has says nothing.
  await word.fill('Bookings')
  await expect(page.getByRole('note')).toHaveCount(0)
})

test('a word taken after the page opened shows the refusal, and offers no Retry', async ({
  page,
}) => {
  test.skip(mode === 'mock', 'The refusal is the service answering 409 to a write.')
  await go(page, '/definitions/new?sameAs=Gross%20sales')
  await page.getByRole('textbox', { name: 'The word' }).fill('Bookings')
  await expect(page.getByText('Ready', { exact: true })).toBeVisible()
  // Someone else takes the word while this page is open.
  await page.evaluate(async () => {
    const session = (await (await fetch('/api/v1/auth/session')).json()) as { csrfToken: string }
    const made = await fetch('/api/v1/terms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Footnote-CSRF': session.csrfToken,
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({ name: 'Bookings', sameAs: 'metric:net_revenue' }),
    })
    if (!made.ok) throw new Error(`The word was not written: ${made.status}`)
  })
  await page.getByRole('button', { name: 'Publish' }).click()
  await expect(
    page
      .getByRole('note')
      .filter({ hasText: /“Bookings” is already another name for Net revenue/ }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0)
  await expect(page.getByText(/^Couldn't publish/)).toHaveCount(0)
  await expect(page.getByText('Ready', { exact: true })).toHaveCount(0)
})

/** A definition page's Add a name, opened into its field, which has the focus. */
async function nameField(page: Page, name: string) {
  await page.getByRole('main').getByRole('button', { name: 'Add a name', exact: true }).click()
  const box = page.getByRole('textbox', { name: `Add a name for ${name}` })
  await expect(box).toBeFocused()
  return box
}

test('typing words and commas makes tags; a taken word says who has it', async ({ page }) => {
  await go(page, '/definitions/Gross%20sales')
  // One line under the meaning: the names, Add a name, and what they do.
  const names = page.getByRole('region', { name: 'Also called' })
  await expect(names).toContainText('Agents read each of these as Gross sales.')
  await expect(names.getByRole('textbox')).toHaveCount(0)
  const box = await nameField(page, 'Gross sales')
  await expect(names).toContainText('A comma or Enter adds a name.')
  await box.fill('Sales Value,')
  const tags = page
    .getByRole('region', { name: 'Also called' })
    .or(page.locator('section').filter({ has: page.getByRole('heading', { name: 'Also called' }) }))
  await expect(tags.getByText('Sales Value', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('status').filter({ hasText: 'Added synonym Sales Value.' }),
  ).toBeAttached()
  await box.fill('Gross takings, turnover,')
  await expect(tags.getByText('Gross takings', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('listitem').filter({
      hasText:
        '“turnover” was not added. It is already another name for Net revenue, added by Sofia Brandt.',
    }),
  ).toBeVisible()
  // Backspace in the empty box selects the last tag, then removes it.
  await box.press('Backspace')
  await expect(
    page.getByRole('status').filter({ hasText: 'Gross takings selected.' }),
  ).toBeAttached()
  await box.press('Backspace')
  await expect(tags.getByText('Gross takings', { exact: true })).toHaveCount(0)
  // Escape lets go of what is half typed; the tags stay. Again, it closes the field.
  await box.fill('half')
  await box.press('Escape')
  await expect(box).toHaveValue('')
  await expect(tags.getByText('Sales Value', { exact: true })).toBeVisible()
  await box.press('Escape')
  await expect(box).toHaveCount(0)
  await expect(names.getByRole('button', { name: 'Add a name', exact: true })).toBeFocused()
})

/**
 * Each synonym's save waits until `release`: on the service the request is held, and the mock's
 * ?slow=1 makes every send take 1.5s.
 */
async function holdSaves(page: Page) {
  let release = () => {}
  const released = new Promise<void>((resolve) => (release = resolve))
  if (mode === 'http')
    await page.route(/\/api\/v1\/terms(\/delete)?$/, async (route) => {
      if (route.request().method() === 'POST') await released
      await route.fallback()
    })
  return release
}

/**
 * The synonym box as the next frame after `act` paints it: its text, its tags, whether it kept the
 * focus, and what was announced. Read in the page, so no retry can wait for a save to land.
 */
async function nextFrame(page: Page, event: 'keydown' | 'click', act: () => Promise<void>) {
  await page.evaluate((event) => {
    const seen = window as unknown as { frame?: unknown }
    delete seen.frame
    document.addEventListener(
      event,
      () =>
        requestAnimationFrame(() => {
          const box = document.querySelector<HTMLInputElement>('input[aria-label^="Add a name"]')!
          const section = box.closest('section')!
          seen.frame = {
            text: box.value,
            focused: document.activeElement === box,
            tags: [...section.querySelectorAll('button[aria-label^="Remove the other name "]')].map(
              (b) => b.getAttribute('aria-label')!.slice('Remove the other name '.length),
            ),
            said: section.querySelector('[role="status"]')!.textContent,
          }
        }),
      { capture: true, once: true },
    )
  }, event)
  await act()
  const frame = await page.waitForFunction(() => (window as unknown as { frame?: unknown }).frame)
  return (await frame.jsonValue()) as {
    text: string
    focused: boolean
    tags: string[]
    said: string
  }
}

test('a tag shows the moment its comma is typed, and goes the moment it is removed, while the save runs', async ({
  page,
}) => {
  const release = await holdSaves(page)
  await go(page, '/definitions/Gross%20sales?slow=1')
  const box = await nameField(page, 'Gross sales')
  await box.pressSequentially('Sales Value')
  const typed = await nextFrame(page, 'keydown', () => box.press(','))
  expect(typed).toMatchObject({ text: '', focused: true, said: '' })
  expect(typed.tags).toContain('Sales Value')
  // A second comma before the save is in makes no second tag, and nothing is sent twice.
  await box.pressSequentially('sales value,')
  await expect(page.getByText('Sales Value', { exact: true })).toHaveCount(1)
  // Removed while the save still runs: it goes now, and comes off once it is in.
  const removed = await nextFrame(page, 'click', () =>
    page.getByRole('button', { name: 'Remove the other name Sales Value' }).click(),
  )
  expect(removed.focused).toBe(true)
  expect(removed.tags).not.toContain('Sales Value')
  expect(removed.said).not.toContain('Removed')
  release()
  await expect(
    page.getByRole('status').filter({ hasText: 'Removed synonym Sales Value.' }),
  ).toBeAttached()
  await expect(page.getByText('Sales Value', { exact: true })).toHaveCount(0)
})

test('a save that fails keeps the word, marked, and says so in place; Try again saves it', async ({
  page,
}) => {
  await go(page, '/definitions/Gross%20sales?state=failed')
  // The mock fails the page's own first load too.
  if (mode === 'mock') await page.getByRole('button', { name: 'Retry' }).click()
  const box = await nameField(page, 'Gross sales')
  const tag = page.getByRole('button', { name: 'Remove the other name Sales Value' })
  await box.pressSequentially('Sales Value')
  expect((await nextFrame(page, 'keydown', () => box.press(','))).tags).toContain('Sales Value')
  const line = page.getByRole('listitem').filter({
    hasText: '“Sales Value” was not added. The save did not go through, so nothing changed.',
  })
  await expect(line).toBeVisible()
  // The word stays in the box, marked, and no toast says it again.
  await expect(page.getByRole('button', { name: 'Dismiss Sales Value' })).toBeVisible()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Sales Value' })).toHaveCount(
    0,
  )
  await expect(tag).toHaveCount(0)
  await expect(box).toBeFocused()
  await line.getByRole('button', { name: 'Try again to add Sales Value' }).click()
  await expect(tag).toBeVisible()
  await expect(line).toHaveCount(0)
  await expect(
    page.getByRole('status').filter({ hasText: 'Added synonym Sales Value.' }),
  ).toBeAttached()
  // A failed removal brings the tag back the same way.
  expect((await nextFrame(page, 'click', () => tag.click())).tags).not.toContain('Sales Value')
  await expect(
    page
      .locator('[data-sonner-toast]')
      .filter({ hasText: "Couldn't remove “Sales Value”" })
      .filter({ hasText: 'It is still another name for Gross sales.' }),
  ).toBeVisible()
  await expect(tag).toBeVisible()
})

test('a word the service turns down says why, and offers no Try again', async ({ page }) => {
  test.skip(mode === 'mock', 'The reason is the service answering a write it will not make.')
  await go(page, '/definitions/Season')
  const box = await nameField(page, 'Season')
  // Someone else deletes Season while this page is open.
  await page.evaluate(async () => {
    const session = (await (await fetch('/api/v1/auth/session')).json()) as { csrfToken: string }
    const { terms } = (await (await fetch('/api/v1/terms')).json()) as {
      terms: { id: string; name: string }[]
    }
    const deleted = await fetch('/api/v1/terms/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Footnote-CSRF': session.csrfToken,
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({ ids: terms.filter((t) => t.name === 'Season').map((t) => t.id) }),
    })
    if (!deleted.ok) throw new Error(`Season was not deleted: ${deleted.status}`)
  })
  await box.fill('test,')
  const line = page.getByRole('listitem').filter({ hasText: '“test” was not added.' })
  await expect(line).toContainText("“Season” isn't in Definitions any more.")
  await expect(line).not.toContainText('The save did not go through')
  await expect(line.getByRole('button', { name: /^Try again/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Dismiss test' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove the other name test' })).toHaveCount(0)
})

test('the list folds synonyms into their row; Terms counts only real terms', async ({ page }) => {
  await go(page, '/definitions')
  const gross = page.locator('tr').filter({ hasText: /^Gross sales/ })
  await expect(gross).toContainText('Also called')
  await expect(gross).toContainText('GMV')
  await expect(page.locator('tr').filter({ hasText: /^GMV/ })).toHaveCount(0)
  await expect(page.getByRole('radio', { name: /Terms/ })).toContainText('8')
  await page.getByPlaceholder('Search definitions').fill('turnover')
  await expect(page.locator('tr').filter({ hasText: 'Net revenue' })).toContainText(
    'matches: Turnover',
  )
  await page.getByPlaceholder('Search definitions').fill('')
  await page.getByRole('button', { name: /^Filter/ }).click()
  await page.getByRole('menuitemcheckbox', { name: /Show synonyms as rows/ }).click()
  await page.keyboard.press('Escape')
  // The list draws only the rows in view: find the synonym's own row by its word.
  await page.getByPlaceholder('Search definitions').fill('gmv')
  await expect(page.locator('tr').filter({ hasText: /^GMV/ })).toHaveCount(1)
})

test("a term's editor: Other name for folds the meaning; clearing it brings it back, with Undo", async ({
  page,
}) => {
  await go(page, '/definitions/Webshop/edit')
  await expect(page.getByRole('textbox', { name: 'What it means' })).toContainText(
    'Orders placed on larchwood.example',
  )
  await page.getByRole('button', { name: /^Other name for/ }).click()
  await page.getByRole('option', { name: 'Gross sales' }).click()
  await expect(page.getByText('Uses the meaning of')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'What it means' })).toHaveCount(0)
  await page.getByRole('button', { name: /^Other name for/ }).click()
  await page.getByRole('option', { name: 'Give it its own meaning instead' }).click()
  await expect(page.getByRole('textbox', { name: 'What it means' })).toContainText(
    'Orders placed on larchwood.example',
  )
  await page.locator('[data-sonner-toast]').getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText('Uses the meaning of')).toBeVisible()
})
