import { expect, go, signInAs, test } from './go.ts'

// J131, values people write (values without figures): a dimension's page lists its values, and
// Jon, an admin, adds one there, which the Applies to picker finds at once; a value nobody has
// added yet is offered where an item is written. Ines, who owns no domain, pastes two values for
// Channel, which has no domain, so they wait for an admin; Ravi publishes them from the Names card.

test('people add values on a dimension’s page and where they write, and an admin publishes the rest', async ({
  page,
}) => {
  await go(page, '/definitions/Product')
  const values = page.getByRole('region', { name: /^Values/ })
  await expect(values.getByRole('listitem')).toHaveText([
    'Camping',
    'Climbing',
    'Clothing',
    'Footwear',
  ])
  await values.getByRole('button', { name: 'Add a value' }).click()
  await values.getByRole('textbox', { name: 'Name', exact: true }).fill('Running')
  await values.getByRole('textbox', { name: 'Other names' }).fill('Run, Jogging')
  await expect(values.getByText('It is published at once.')).toBeVisible()
  await values.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByText('Running is published')).toBeVisible()
  await expect(values.getByRole('listitem')).toHaveCount(5)
  await expect(values).toContainText('Runningalso Run, Jogging')

  // The picker finds it, by another name too, and offers what nobody has added yet.
  await go(page, '/context/new')
  await page.getByRole('button', { name: /^Applies to/ }).click()
  const search = page.getByRole('combobox', { name: 'Search Applies to' })
  const list = page.getByRole('listbox', { name: 'Applies to' })
  await search.fill('Jogging')
  await expect(list.getByRole('option', { name: /^Running/ })).toBeVisible()
  await search.fill('Trail shoes')
  await expect(list.getByText('Nothing called “Trail shoes”. Add it as a value of')).toBeVisible()
  await list.getByRole('option', { name: 'Add Trail shoes as a value of Product' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByTitle('Product: Trail shoes (new value)')).toBeVisible()
  // Left unsaved, the value goes nowhere: it rides only with an item that is sent.
  await go(page, '/inbox')
  await page.getByRole('button', { name: 'Leave and lose it' }).click()

  // Someone who owns no domain suggests values for a dimension of none: they wait for an admin.
  await signInAs(page, 'Ines Duarte')
  await go(page, '/definitions/Channel')
  await values.getByRole('button', { name: 'Paste a list' }).click()
  await values
    .getByRole('textbox', { name: 'Values, one per line' })
    .fill('Affiliate\nReferral, Word of mouth\n\nAffiliate')
  await expect(values.getByText('They wait for an admin, since it has no domain.')).toBeVisible()
  await values.getByRole('button', { name: 'Suggest 2 values' }).click()
  await expect(page.getByText('2 values wait for an admin, since it has no domain')).toBeVisible()
  await expect(values.getByRole('listitem')).toHaveCount(4)

  await signInAs(page, 'Ravi Kapoor')
  await go(page, '/inbox?card=names:waiting')
  const waiting = page.getByRole('region', { name: /^Values people added/ })
  await expect(waiting.getByRole('listitem')).toHaveCount(2)
  await expect(waiting.getByRole('listitem').nth(1)).toContainText(
    'Value of Channel · also Word of mouth · added by Ines Duarte',
  )
  await waiting.getByRole('button', { name: 'Publish 2 values' }).click()
  await expect(page.getByText('2 values are published')).toBeVisible()
  await go(page, '/definitions/Channel')
  await expect(values.getByRole('listitem')).toHaveCount(6)
  await expect(values).toContainText('Referralalso Word of mouth')
})

test('the Values part fits a phone, with its form open', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await go(page, '/definitions/Campaign')
  const values = page.getByRole('region', { name: /^Values/ })
  await expect(values.getByRole('listitem')).toHaveCount(12)
  await expect(values.getByRole('button', { name: 'Show all 2,400' })).toBeVisible()
  await values.getByRole('button', { name: 'Add a value' }).click()
  await expect(values.getByRole('textbox', { name: 'How the data writes it' })).toBeVisible()
  const [scroll, client] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ])
  expect(scroll).toBeLessThanOrEqual(client)
})
