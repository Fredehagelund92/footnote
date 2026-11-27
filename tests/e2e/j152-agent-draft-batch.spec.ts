import type { Page } from '@playwright/test'
import { agentSignsIn, domainId, expect, go, mode, test } from './go.ts'

/*
  J152, draft many, send none (FR-145): the person's agent turns a wiki page into context by
  writing each item as its own draft with write_draft, and sends none. Each reply counts the
  drafts that wait and says the limits (limits.agent_drafts, 50 and 50 as installed), so the agent
  can tell the person "3 drafts wait". They wait in the person's Inbox, on the card of their own
  drafts, where the person reads them one after another and publishes them together.
*/

test.skip(mode !== 'http', 'An agent writes the drafts on the service; the mock has no agent')

const pane = (page: Page) => page.getByRole('region', { name: /drafts from your agents$/ })
const list = (page: Page) => pane(page).getByRole('list', { name: 'Your drafts' })
/** A line on the screen: the toast's, or one said to a screen reader. */
const said = (page: Page, text: string) => page.getByText(text, { exact: true }).last()

/** Three items from one wiki page about Sales, as an agent splits it. */
const page_ = [
  'Gross sales leave out gift cards until the day they are spent.',
  'Gross sales count a preorder on the day it ships, not the day it is paid.',
  'Gross sales leave out orders staff place for themselves.',
]

test('an agent writes a wiki page as three drafts, which wait in the Inbox to publish together', async ({
  page,
}) => {
  await go(page, '/inbox')
  const call = (await agentSignsIn(page))!
  const replies: { status: string; message: string; drafts: Record<string, number> }[] = []
  for (const text of page_)
    replies.push(
      (await call('write_draft', {
        text,
        kind: 'note',
        area: domainId('sales'),
        new_item: true,
        scope: { metrics: ['Gross sales'] },
        window: { from: '2026-10-01' },
        evidence: [{ url: 'https://wiki.example/sales/gross-sales', quote: text }],
      })) as (typeof replies)[number],
    )
  expect(replies.map((r) => r.status)).toEqual(['draft_saved', 'draft_saved', 'draft_saved'])
  expect(replies.map((r) => r.drafts)).toEqual(
    [1, 2, 3].map((n) => ({
      waiting: n,
      most_waiting: 50,
      new_in_24_hours: n,
      most_new_in_24_hours: 50,
    })),
  )
  expect(replies[2]!.message).toContain(
    "3 drafts from the person's agents wait for them in Your drafts, and you may save 47 more now (50 new drafts in 24 hours and 50 waiting unsent at most).",
  )

  // None was sent: they wait for the person, on the card of their own drafts.
  await page.goto('/inbox')
  await page
    .getByRole('button', { name: /^3 drafts from your agents/ })
    .first()
    .click()
  await expect(list(page).getByRole('listitem')).toHaveCount(3)
  await expect(pane(page)).toContainText('Only you can see them.')

  // The person reads the first, then publishes them together.
  await list(page).getByRole('link').first().click()
  await expect(pane(page).getByRole('heading', { level: 2 }).first()).toHaveText('1 of 3')
  await page.locator('body').click({ position: { x: 1, y: 1 } })
  await page.keyboard.press('Escape')
  await expect(list(page).getByRole('listitem')).toHaveCount(3)
  await pane(page)
    .getByRole('button', { name: /^Publish/ })
    .click()
  await expect(said(page, '3 published')).toBeVisible()
  await expect(page.getByRole('button', { name: /drafts from your agents/ })).toHaveCount(0)
})
