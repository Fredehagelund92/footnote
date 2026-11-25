import { expect, go, test } from './go.ts'

// J123, Context by time: the same items as the list, along a time line. The header's View switch
// opens By time (?view=time) and goes back to the list. Groups run down the side, Domain first;
// each item is a bar that ends where its dates end, filled by its state, with a card on hover and
// the item in the side panel on a press. Grouping by a dimension of the definitions draws an item
// in each value it names; filters read as the list's sentences, OR inside a field and AND across
// fields; search narrows the bars; the zooms change what a tick of the axis is; the keys move
// between bars and groups; a group folds to its line.

const norway = 'Regulator paused price promotions in Norway on 9 May 2026'
const italy = 'Regulator paused price promotions in Italy on 18 April 2026'

test('Context by time shows, finds and opens the items along their dates', async ({ page }) => {
  await go(page, '/context')
  const view = page.getByRole('radiogroup', { name: 'View' })
  await view.getByRole('radio', { name: 'By time' }).click()
  await expect(page).toHaveURL(/[?&]view=time/)
  const time = page.getByRole('region', { name: /^Items by time/ })
  await expect(time).toBeVisible()
  await expect(view.getByRole('radio', { name: 'By time' })).toHaveAttribute('aria-checked', 'true')

  // Domain first: each group is a line with its name and how many items it holds, open.
  const marketing = time.getByRole('button', { name: /^Marketing \d+$/ })
  await expect(marketing).toHaveAttribute('aria-expanded', 'true')
  await expect(time.getByText('Today', { exact: true })).toBeVisible()
  const bar = time.getByRole('button', { name: new RegExp(`^${norway}\\. Checked\\.`) })
  await expect(bar).toBeVisible()
  // An item whose last day has passed is Ended, whatever its check.
  await expect(time.getByRole('button', { name: new RegExp(`^${italy}\\. Ended\\.`) })).toHaveCount(
    1,
  )

  // A card on hover says its state and its days; a press opens it in the side panel.
  await bar.scrollIntoViewIfNeeded()
  await bar.hover()
  const card = page.locator('.time-card')
  await expect(card).toContainText(norway)
  await expect(card).toContainText('Checked')
  await expect(card).toContainText('From 9 May 2026')
  await bar.click()
  await expect(page).toHaveURL(/[?&]dock=context\.itm_za26xpzv/)
  const panel = page.getByRole('region', { name: 'Context', exact: true })
  await expect(panel.getByRole('heading', { name: norway })).toBeVisible()
  // J steps the panel to the next item, and the view's cursor follows it to that bar.
  await page.keyboard.press('j')
  await expect(page).not.toHaveURL(/dock=context\.itm_za26xpzv/)
  const next = new URL(page.url()).searchParams.get('dock')!.replace(/^context\./, '')
  await expect(time.locator('[data-item][tabindex="0"]')).toHaveAttribute('data-item', next)
  // Escape closes it, and focus is on that bar.
  await page.keyboard.press('Escape')
  await expect(page).not.toHaveURL(/dock=/)
  await expect(page.locator(':focus')).toHaveAttribute('data-item', next)

  // Group by a dimension of the definitions: Every value first, then each market an item names.
  await page.getByRole('button', { name: 'Domain', exact: true }).click()
  const menu = page.getByRole('menu')
  await expect(menu.getByText('Dimensions from your definitions')).toBeVisible()
  await menu.getByRole('menuitemradio', { name: 'Market' }).click()
  await expect(time.getByRole('button', { name: /^Every value \d+$/ })).toBeVisible()
  await expect(time.getByRole('button', { name: /^Norway \d+$/ })).toBeVisible()
  await expect(time.getByText('Market', { exact: true })).toBeVisible()

  // Filters: two metrics are either one; a market with them is both.
  const count = page.getByText(/context items$/)
  const all = await count.innerText()
  await page.getByRole('button', { name: /^Filter/ }).click()
  await page.getByRole('menuitem', { name: 'Metric' }).click()
  await page.getByRole('menuitemcheckbox', { name: /^Return on ad spend/ }).click()
  await page.getByRole('menuitemcheckbox', { name: /^Discount cost/ }).click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.getByText('Metric is any of', { exact: false })).toBeVisible()
  await expect(count).toHaveText(/^\d+ of /)
  const two = await count.innerText()
  await expect(bar).toBeVisible()
  await expect(time.getByRole('button', { name: new RegExp(`^${italy}\\.`) })).toBeVisible()
  await page.keyboard.press('f')
  await page.getByRole('menuitem', { name: 'Market' }).click()
  await page.getByRole('menuitemcheckbox', { name: /^Norway/ }).click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.getByText('Market is Norway')).toBeVisible()
  await expect(count).not.toHaveText(two)
  await expect(bar).toBeVisible()
  await expect(time.getByRole('button', { name: new RegExp(`^${italy}\\.`) })).toHaveCount(0)
  await page.getByRole('button', { name: 'Clear all' }).click()
  await expect(count).toHaveText(all)

  // Search narrows the bars, its words in bold. It reads the text too: the Norway spring campaign
  // names the regulator.
  await page.getByRole('textbox', { name: 'Search context' }).fill('regulator norway')
  await expect(count).toHaveText(/^2 of /)
  await expect(time.getByRole('button', { name: new RegExp(`^${italy}\\.`) })).toHaveCount(0)
  await expect(bar.locator('mark')).toHaveText(['Regulator', 'Norway'])
  await page.getByRole('textbox', { name: 'Search context' }).fill('')

  // The zooms: at Months the top of the axis names months, at Years the ticks are quarters.
  await time.click({ position: { x: 600, y: 10 } })
  await page.keyboard.press('2')
  const zoom = page.getByRole('radiogroup', { name: 'Zoom' })
  await expect(zoom.getByRole('radio', { name: 'Months' })).toHaveAttribute('aria-checked', 'true')
  await expect(
    time
      .getByText(
        /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/,
      )
      .first(),
  ).toBeVisible()
  await zoom.getByRole('radio', { name: 'Years' }).click()
  await expect(time.getByText('Q2', { exact: true }).first()).toBeVisible()

  // The keys: on a group's line Left folds it and Right opens it; Down goes to its first lane,
  // and Enter opens the bar there.
  const norwayGroup = time.getByRole('button', { name: /^Norway \d+$/ })
  await norwayGroup.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(norwayGroup).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('ArrowRight')
  await expect(norwayGroup).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('ArrowDown')
  await expect(page.locator(':focus')).toHaveAttribute('data-key', /^Norway\n/)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/[?&]dock=context\./)
  await page.keyboard.press('Escape')
  await expect(page).not.toHaveURL(/dock=/)

  // A group folds to its line, and its bars go.
  const norwayBars = time.locator('[data-key^="Norway\\a "]')
  await expect(norwayBars.first()).toBeVisible()
  await norwayGroup.click()
  await expect(norwayGroup).toHaveAttribute('aria-expanded', 'false')
  await expect(norwayBars).toHaveCount(0)

  // Back to the list.
  await view.getByRole('radio', { name: 'List' }).click()
  await expect(page).not.toHaveURL(/view=time/)
  await expect(page.getByRole('columnheader', { name: 'Applies to' })).toBeVisible()
})
