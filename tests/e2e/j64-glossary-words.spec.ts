import { expect, go, onMockOnly, test } from './go.ts'

// J64, glossary v2 in the app (language audit L6, C5 A): one name for one thing. A metric comes
// from a tool and is "read" (never "synced"); another name is "another name" (never "Also called"
// or "Synonyms"); the column that says where an item applies is "Applies to" (never "Scope"); the
// thing in Settings is an integration (never a connector); a long password is named by its kind;
// and "context item" is explained where a person first meets it.

test('Context says what a context item is, and names its column Applies to', async ({ page }) => {
  await go(page, '/context')
  await expect(page.getByRole('columnheader', { name: 'Applies to' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Scope' })).toHaveCount(0)
})

test('an empty Context explains what a context item is before it asks for one', async ({
  page,
}) => {
  await onMockOnly('the setup demo is the mock', async () => {
    await go(page, '/context?demo=setup')
    await expect(page.getByText('A context item is one thing your team wrote down')).toBeVisible()
  })
})

test('Definitions says where metrics come from in words that are true', async ({ page }) => {
  await go(page, '/definitions')
  const main = page.getByRole('main')
  await expect(
    main.getByText(
      'To change one, change it in the tool. Terms are words your company uses. The owner of their domain writes them here.',
    ),
  ).toBeVisible()
  await expect(main.getByText(/synced/i)).toHaveCount(0)
  await expect(main.getByText(/read today at/i)).toHaveCount(0)
  // Another name is one name, in the filter and in a row.
  await main.getByRole('button', { name: /^Filter/ }).click()
  await expect(page.getByRole('menu').getByText('Another name', { exact: true })).toBeVisible()
  await expect(page.getByRole('menu').getByText('Synonyms', { exact: true })).toHaveCount(0)
})

test('a metric peek says it is read from its tool, and calls other names another name', async ({
  page,
}) => {
  await go(page, '/definitions')
  await page.locator('tbody [data-row-open]').first().click()
  const comes = page.getByRole('region', { name: 'Where it comes from' })
  await expect(comes).toContainText('read-only, read from')
  await expect(comes).not.toContainText('synced')
  await expect(page.getByRole('region', { name: 'Another name' }).first()).toBeVisible()
  await expect(page.getByText('Also called')).toHaveCount(0)
})

test('the new names card says where they were found', async ({ page }) => {
  await go(page, '/inbox?demo=names')
  const main = page.getByRole('main')
  await expect(
    main.getByText(
      'Publish them, and people can write context about them and agents can use them.',
    ),
  ).toBeVisible()
  await expect(main.getByText('A read made these')).toHaveCount(0)
})

test('Integrations asks for an integration, not a connector', async ({ page }) => {
  await go(page, '/settings/integrations')
  await expect(page.getByRole('link', { name: 'Request an integration' })).toBeVisible()
  await expect(page.getByText(/connector/i)).toHaveCount(0)
})
