import type { Page } from '@playwright/test'
import { card, expect, go, mode, test, unfold } from './go.ts'

// J21, following links: Related shows what an agent can follow with read_context in two groups,
// one clean line per link: the owners' relations labelled and an archived item marked; Settings
// has no switch for links, since they come with every read; a review shows a new link, and Try it
// says the answer follows it.

/**
 * Opens Details in the quick view once it shows the item: go moves inside the app and goes on at
 * once, and a click before the new item is in would fold the last one's Details instead.
 */
async function details(page: Page, title: string) {
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Details', exact: true }).click()
}

const campaign = 'Norway launch campaign started on 24 March 2026'

test("Related in the quick view: a definition, and the owners' relations", async ({ page }) => {
  await go(page, '/context?dock=context.itm_eprlkrz2')
  await details(page, campaign)
  const links = page.getByRole('list', { name: 'Links to' })
  await expect(links).toContainText('Orders')
  await expect(page.getByText('An agent can follow these')).toHaveCount(0)
  await go(page, '/context?dock=context.itm_0tmqp7o1')
  await details(page, 'Orders lags by one day in the source tool')
  await expect(page.getByRole('list', { name: 'Links to' })).toContainText('Replaces')
  await expect(page.getByRole('list', { name: 'Links to' })).toContainText('Archived')
  await go(page, '/context?dock=context.itm_gift_store_credit')
  await details(page, 'Norway orders count store credit')
  await expect(page.getByRole('list', { name: 'Links to' })).toContainText('Disagrees with')
})

test('the toolbar stays under Details, open or shut', async ({ page }) => {
  await go(page, '/context?dock=context.itm_0tmqp7o1')
  await expect(
    page.getByRole('heading', { name: 'Orders lags by one day in the source tool', exact: true }),
  ).toBeVisible()
  const toolbar = page.getByRole('group', { name: 'More about this context item' })
  const actions = async () => {
    await expect(toolbar.getByRole('button', { name: 'Try it', exact: true })).toBeVisible()
    await expect(toolbar.getByText(/^History/)).toBeVisible()
    await expect(toolbar.getByText(/^Comments/)).toBeVisible()
  }
  await actions()
  await page.getByRole('button', { name: 'Details', exact: true }).click()
  await actions()
  await expect(page.getByRole('region', { name: 'Context' }).getByText(/^Status$/)).toHaveCount(0)
})

test('the quiet line says due for a check when a report or an overlap takes the attention line', async ({
  page,
}) => {
  test.skip(mode !== 'mock', 'Opens a mock item with the mock report beside it')
  const region = page.getByRole('region', { name: 'Context' })
  await go(page, `/context?dock=context.itm_pfet8zj3&flag=${card('flag-germany')}`)
  await expect(region.getByText(/Reported unclear/)).toBeVisible()
  await expect(region.getByText(/, due for a check$/)).toBeVisible()
  await go(page, `/context?dock=context.itm_0tmqp7o1&flag=${card('flag-germany')}`)
  await expect(region.getByText(/Reported unclear/)).toBeVisible()
  await expect(region.getByText(/owned by .* - checked /)).toBeVisible()
  await expect(region.getByText(/due for a check/i)).toHaveCount(0)
})

test('on the service, a draft has no empty History and the Inbox counts no zero', async ({
  page,
}) => {
  test.skip(mode !== 'http', "The mock's drafts have versions, and its suggestions have questions")
  await go(page, '/context')
  await page.getByText('Store returns in Spain count on the day they are booked').first().click()
  const toolbar = page.getByRole('group', { name: 'More about this context item' })
  await expect(toolbar.getByText('History', { exact: true })).toBeVisible()
  const id = new URL(page.url()).searchParams.get('dock')!.replace('context.', '')
  await go(page, `/context/${id}`)
  await expect(
    page.getByRole('heading', { name: 'Store returns in Spain count on the day they are booked' }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toHaveCount(0)
  await expect(page.getByText('About this item', { exact: true })).toHaveCount(0)
  await go(page, '/inbox')
  await expect(page.getByText(/^Ines Duarte changed 1 link\./)).toBeVisible()
  await expect(page.getByText(/\b0 questions/)).toHaveCount(0)
})

test('Settings lists the five tools agents call, with no switch for links', async ({ page }) => {
  await go(page, '/settings/agents')
  await unfold(page, 'Tools and access keys')
  for (const tool of ['get_context', 'find_context', 'read_context', 'report', 'suggest_context'])
    await expect(page.getByRole('switch', { name: new RegExp(tool) })).toBeChecked()
  await expect(page.getByRole('switch', { name: /Let agents follow links/ })).toHaveCount(0)
  await expect(page.getByText('get_related')).toHaveCount(0)
})

test('the review shows a new link, and Try it says the answer follows it', async ({ page }) => {
  await go(page, '/inbox/sug-ines/review')
  // The source shows the new link as its words; the preview draws it as the item's page will.
  await expect(
    page.getByRole('region', { name: 'Text' }).locator('ins').getByText('accounts'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Show the preview' }).click()
  await expect(
    page.getByRole('region', { name: 'Preview' }).getByText('accounts', { exact: true }),
  ).toBeVisible()
  const decide = page.getByRole('complementary', { name: 'Try it and decide' })
  await expect(
    decide.getByText(
      'The answer would follow the new link to Test account, one step, to read what it means.',
    ),
  ).toBeVisible()
})
