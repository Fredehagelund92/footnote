import type { Page } from '@playwright/test'
import { expect, go, inHttpOnly, mode, onMockOnly, test } from './go.ts'

// J11, figures in Ask's loop answers: off by default, an answer whose subject was read for named
// dates links into the tool; an admin switches figures on for Cube and the answer shows one figure
// with its source, freshness and query in words; a figure that doesn't fit a context item shows
// both, with both routes; a metric nobody defines gets no figure. Figures are no integration of
// their own: Cube's page shows them as its second connection, where an admin tries a figure, and
// keeps them while Cube is paused, when an answer gets no figure from it until it is resumed.

/** Asked in a chat of its own, by typing, as both modes answer it; waits for the whole answer. */
async function ask(page: Page, question: string, flags = '') {
  await go(page, `/ask?n=${Date.now()}${flags}`)
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially(question)
  await box.press('Enter')
  await expect(page.getByRole('log').getByRole('group', { name: 'Answer actions' })).toBeVisible()
}

/** Orders in Norway, read for 1 to 31 Aug 2026: the figure both modes have. */
const august = 'Why did orders in Norway drop in August?'

test('off by default, an answer links into the tool', async ({ page }) => {
  await ask(page, august)
  await expect(
    page.getByRole('link', { name: /See the figure in Cube: Orders in Norway, 1 to 31 Aug 2026/ }),
  ).toBeVisible()
})

test('switched on for Cube, the answer shows one figure, its source and its query in words', async ({
  page,
}) => {
  await go(page, '/settings/integrations/cube')
  await page.getByRole('switch', { name: 'Show figures in Ask' }).click()
  // A move inside the app is the same page, so the switch holds without a review flag.
  await ask(page, august)
  const log = page.getByRole('log')
  await expect(log.getByText('€43,600')).toBeVisible()
  await expect(log.getByText('From Cube, data as of today at 06:00.')).toBeVisible()
  await log.getByRole('button', { name: 'Show the query' }).click()
  await expect(log.getByText(/added up for Norway from 1 to 31 Aug 2026/)).toBeVisible()
})

test("a figure that doesn't fit a context item shows both, and both routes", async ({ page }) => {
  // The mock's figure for discount cost in Norway after 9 May holds the item it doesn't fit; the
  // service shows it once someone has said so (go.ts files that report for `figconflict`).
  if (mode === 'http') await go(page, '/ask?example=figconflict&figures=on')
  else await ask(page, 'Did discount cost in Norway fall after 9 May?', '&figures=on')
  const log = page.getByRole('log')
  await expect(log.getByText("The figure doesn't fit a context item.")).toBeVisible()
  await expect(log.getByRole('button', { name: 'Tell the owner of Marketing' })).toBeVisible()
  await expect(
    log.getByRole('button', { name: /Tell Ravi Kapoor, the data contact/ }),
  ).toBeVisible()
})

test('a metric nobody defines gets no figure', async ({ page }) => {
  await onMockOnly('recorded answer for a metric no definition covers', async () => {
    // Ask reads no metric for net promoter score, only Norway and August, so there is no figure
    // to read, link to or explain.
    await ask(page, 'What was net promoter score in Norway in August?', '&figures=on')
    const log = page.getByRole('log')
    await expect(log.getByRole('button', { name: 'Not found', exact: true })).toBeVisible()
    await expect(log.getByText(/^From Cube/)).toHaveCount(0)
    await expect(log.getByRole('link', { name: /See the figure in/ })).toHaveCount(0)
    await expect(log.getByText(/No figure\./)).toHaveCount(0)
  })
})

test('figures are no integration of their own, and say so', async ({ page }) => {
  await go(page, '/settings/integrations')
  await expect(page.getByText(/warehouse/i)).toHaveCount(0)
  await expect(
    page.getByText(/Your workspace keeps no numbers\. Where a definitions tool can also read/),
  ).toBeVisible()
})

test("Cube's page shows figures as its second connection, where an admin tries one", async ({
  page,
}) => {
  await go(page, '/settings/integrations/cube')
  await expect(page.getByRole('heading', { name: 'Definitions connection' })).toBeVisible()
  const figures = page.getByRole('heading', { name: 'Figures connection' })
  await expect(figures).toBeVisible()
  await expect(page.getByText(/The second of Cube's two connections/)).toBeVisible()
  await page.getByRole('button', { name: 'Connection details' }).click()
  await expect(page.getByLabel('Token, set')).toBeVisible()
  await page.getByRole('button', { name: 'Try a figure' }).click()
  const dialog = page.getByRole('dialog', { name: 'Try a figure from Cube' })
  // Marketing is Cube's first view with a single date, and the demo week has no conversions in
  // its last 7 days: Cube still answered, so the endpoint and the token work.
  await expect(dialog.getByText('Conversion rate, 17 to 23 Oct 2026:')).toBeVisible()
  await expect(dialog.getByText('nothing for those days')).toBeVisible()
  await expect(dialog.getByText(/From Cube, data as of today at 06:00\./)).toBeVisible()
  await expect(dialog.getByText('The data endpoint and its token work.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Try again' }).click()
  await expect(dialog.getByText('The data endpoint and its token work.')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  // Trying switched nothing on.
  await expect(page.getByRole('switch', { name: 'Show figures in Ask' })).not.toBeChecked()
})

test("paused, Cube's page keeps its figures connection, and its switch still works", async ({
  page,
}) => {
  await go(page, '/settings/integrations/cube')
  await page.getByRole('button', { name: 'Pause reading' }).click()
  await expect(page.getByText('Reading paused for Cube')).toBeVisible()
  const figures = page.getByRole('switch', { name: 'Show figures in Ask' })
  await figures.click()
  await expect(page.getByText('Figures from Cube are on')).toBeVisible()
  await expect(figures).toBeChecked()
  await expect(page.getByText(/Reading Cube is paused, so figures are off in Ask/)).toBeVisible()
  await inHttpOnly('pause, kept over a reload', async () => {
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Figures connection' })).toBeVisible()
    await expect(figures).toBeChecked()
  })
  await figures.click()
  await expect(page.getByText('Figures from Cube are off')).toBeVisible()
  await expect(figures).not.toBeChecked()
})

test('paused, Cube gives an answer no figure, and its figures are back once it is resumed', async ({
  page,
}) => {
  await go(page, '/settings/integrations/cube')
  await page.getByRole('switch', { name: 'Show figures in Ask' }).click()
  await expect(page.getByText('Figures from Cube are on')).toBeVisible()
  await ask(page, august)
  const log = page.getByRole('log')
  await expect(log.getByText('€43,600')).toBeVisible()
  await go(page, '/settings/integrations/cube')
  await page.getByRole('button', { name: 'Pause reading' }).click()
  await expect(page.getByText('Reading paused for Cube')).toBeVisible()
  await ask(page, august)
  await expect(
    page.getByRole('link', { name: /See the figure in Cube: Orders in Norway, 1 to 31 Aug 2026/ }),
  ).toBeVisible()
  await expect(log.getByText('€43,600')).toHaveCount(0)
  await go(page, '/settings/integrations/cube')
  await page.getByRole('button', { name: 'Resume reading' }).click()
  await expect(page.getByText('Reading resumed for Cube')).toBeVisible()
  await ask(page, august)
  await expect(log.getByText('€43,600')).toBeVisible()
})
