import { expect, go, onMockOnly, test } from './go.ts'

// J82, History compares two versions as review compares a change (K5): a version opened from an
// item's history shows the same Fields table and text, the earlier version as before, each column
// named for its version, and Compared with picks any other version agents got. The first version
// opens compared with the next one.

test('a version opens compared with the one before it, and with any other', async ({ page }) => {
  await go(page, '/context/itm_norway_stop')
  await page.getByRole('button', { name: /^\d+ changes?/ }).click()
  const rows = page.getByRole('region', { name: /\w+ \d{4}$/ }).getByRole('button')
  await rows.first().click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('region', { name: 'Fields' })).toBeVisible()
  await expect(sheet.getByRole('region', { name: 'Text' })).toBeVisible()

  await onMockOnly('the demo history of the Norway item', async () => {
    await page.keyboard.press('Escape')
    // Version 5 published Ella's suggestion, which ended the first sentence with a full stop.
    await rows.nth(2).click()
    await expect(sheet.getByRole('heading', { name: /^Version 5/ })).toBeVisible()
    const picker = sheet.getByRole('combobox', { name: 'Compared with' })
    await expect(picker).toHaveText(/^Version 4,/)
    const text = sheet.getByRole('region', { name: 'Text' })
    await expect(text.getByText('Version 4', { exact: true }).first()).toBeAttached()
    await expect(text.locator('ins:not([aria-hidden])')).toHaveText(['[added: .]'])
    await expect(text.locator('del:not([aria-hidden])')).toHaveCount(0)
    await expect(text).toContainText('1 passage changed')

    // Any other version: the earlier one stays on the left, whichever was opened.
    await picker.click()
    await page.getByRole('option', { name: /^Version 7,/ }).click()
    await expect(picker).toHaveText(/^Version 7,/)
    const fields = sheet.getByRole('region', { name: 'Fields' })
    await fields.getByRole('switch', { name: 'Only what changed' }).click()
    await expect(fields.locator('thead th')).toHaveText(['Field', 'Version 5', 'Version 7'])

    // The first version opens compared with the next one.
    await page.keyboard.press('Escape')
    await rows.last().click()
    await expect(sheet.getByRole('combobox', { name: 'Compared with' })).toHaveText(/^Version 2,/)
  })
})
