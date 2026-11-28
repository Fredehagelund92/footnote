import { expect, go, onMockOnly, test } from './go.ts'

// J64, glossary v2 in the app (language audit L6, C5 A): one name for one thing. A metric comes
// from a tool and is "read" (never "synced"); a definition's other names are "Also called" (never
// "Another name" or "Synonyms"); the column that says where an item applies is "Applies to"
// (never "Scope"); the thing in Settings is an integration (never a connector); a long password is
// named by its kind; and "context item" is explained where a person first meets it.

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
    main.getByText('change them there. Terms are written here by their domain owner.'),
  ).toBeVisible()
  // Nobody is named for a wrong figure: Footnote reads no figures.
  await expect(main.getByText(/looks wrong|data contact/i)).toHaveCount(0)
  await expect(main.getByText(/synced/i)).toHaveCount(0)
  await expect(main.getByText(/read today at/i)).toHaveCount(0)
  // Also called is one name, in the filter and in a row.
  await main.getByRole('button', { name: /^Filter/ }).click()
  await expect(page.getByRole('menu').getByText('Also called', { exact: true })).toBeVisible()
  await expect(page.getByRole('menu').getByText('Another name', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('menu').getByText('Synonyms', { exact: true })).toHaveCount(0)
})

test('a metric peek says it is read from its tool, and lists other names under Also called', async ({
  page,
}) => {
  await go(page, '/definitions')
  await page
    .locator('tbody [data-row-open]')
    .filter({ hasText: /^Net revenue$/ })
    .click()
  const comes = page.getByRole('region', { name: 'Where it comes from' })
  await expect(comes).toContainText('read-only, read from')
  await expect(comes).not.toContainText('synced')
  await expect(page.getByRole('region', { name: 'Also called' }).first()).toBeVisible()
  await expect(page.getByText('Another name', { exact: true })).toHaveCount(0)
})

test('the new names card says where they were found', async ({ page }) => {
  await onMockOnly('?demo=names has no http meaning yet', async () => {
    await go(page, '/inbox?demo=names')
    const main = page.getByRole('main')
    await expect(
      main.getByText(
        'Publish them, and people can write context about them and agents can use them.',
      ),
    ).toBeVisible()
    await expect(main.getByText('A read made these')).toHaveCount(0)
  })
})

test('Integrations asks for an integration, not a connector', async ({ page }) => {
  await go(page, '/settings/integrations')
  await expect(page.getByRole('link', { name: 'Request an integration' })).toBeVisible()
  await expect(page.getByText(/connector/i)).toHaveCount(0)
})
