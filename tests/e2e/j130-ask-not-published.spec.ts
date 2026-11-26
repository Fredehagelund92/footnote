import type { Locator, Page } from '@playwright/test'
import { expect, go, signInAs, test } from './go.ts'

// J130, what is not published yet in Ask (FR-718.2), on answers of Ask's loop as the service wrote
// them on the demo week. Jon asks about Black Friday, where nothing is published but his own
// draft is (?example=loop-drafts): under the answer, one block, Not published yet, lists it with
// its Draft chip, its domain, his name and its day, holds the one sentence of what it would mean
// if published as written, and opens the draft. Sofia, an owner of Sales, asks whether Poland's
// order data is late (?example=loop-drafts-waiting): Kofi's suggestion waits for her review, and
// Review opens it to decide. Ines, a member, asks the same and gets no block at all
// (?example=loop-drafts-member). Each at 1440 and 390, in light and dark: one block, nothing
// wider than the page.

async function answer(page: Page, example: string, theme: string) {
  await go(page, `/ask?example=${example}&theme=${theme}`)
  const log = page.getByRole('log')
  await expect(log.getByRole('group', { name: 'Answer actions' })).toBeVisible({ timeout: 20_000 })
  return log
}

/** Signs in as someone from the wide sidebar's user menu, then reads at the viewport given. */
async function signInAt(page: Page, who: string, viewport: { width: number; height: number }) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signInAs(page, who)
  await page.setViewportSize(viewport)
}

async function fitsThePage(page: Page, el: Locator) {
  const [scroll, client] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ])
  expect(scroll).toBeLessThanOrEqual(client)
  const box = await el.boundingBox()
  expect(box!.x + box!.width).toBeLessThanOrEqual(client)
}

for (const { name, viewport } of [
  { name: '1440', viewport: { width: 1440, height: 900 } },
  { name: '390', viewport: { width: 390, height: 844 } },
] as const)
  for (const theme of ['light', 'dark'] as const) {
    test(`${name}, ${theme}: the writer's own draft stands apart from the answer and opens`, async ({
      page,
    }) => {
      await signInAt(page, 'Jon Abara', viewport)
      const log = await answer(page, 'loop-drafts', theme)
      await expect(log.locator('[data-answer-words]')).toHaveText(
        'Nothing published covers Black Friday orders yet.',
      )
      const blocks = log.getByRole('region', { name: 'Not published yet' })
      await expect(blocks).toHaveCount(1)
      await expect(blocks).toContainText('Not published yet: a draft mentions “Black Friday”')
      await expect(blocks).toContainText('Not final: a draft can still change or be deleted')
      const row = blocks.getByRole('listitem')
      await expect(row).toHaveCount(1)
      await expect(row).toContainText('Black Friday 2026 orders are split over two weeks')
      await expect(row).toContainText('Draft')
      await expect(row).toContainText('Sales')
      await expect(row).toContainText('Jon Abara')
      await expect(row).toContainText('started 23 Oct')
      await expect(blocks).toContainText(
        "If it is published as written: the weekend's orders are counted in two reporting weeks",
      )
      // It stands in for the gap card, and is no source of the answer.
      await expect(log.getByRole('region', { name: /^Not written yet/ })).toHaveCount(0)
      await expect(log.getByRole('list', { name: 'Sources' })).toHaveCount(0)
      const open = blocks.getByRole('button', { name: /^Open the draft/ })
      await expect(open).toHaveAttribute('href', '/context/itm_draft_black_friday')
      await fitsThePage(page, blocks)
      await fitsThePage(page, open)
      await open.click()
      await expect(page).toHaveURL(/\/context\/itm_draft_black_friday$/)
      await expect(
        page.getByRole('heading', { name: 'Black Friday 2026 orders are split over two weeks' }),
      ).toBeVisible()
    })

    test(`${name}, ${theme}: an owner reviews a suggestion that waits for them; a member sees none`, async ({
      page,
    }) => {
      await signInAt(page, 'Sofia Brandt', viewport)
      const log = await answer(page, 'loop-drafts-waiting', theme)
      const block = log.getByRole('region', { name: 'Not published yet' })
      await expect(block).toContainText(
        'Not published yet: a suggestion waiting for review mentions “Poland payment provider delays”',
      )
      const row = block.getByRole('listitem')
      await expect(row).toContainText('Payment provider delays order data in Poland')
      await expect(row).toContainText('Waiting')
      await expect(row).toContainText('Kofi Mensah')
      const review = block.getByRole('button', { name: /^Review/ })
      await expect(review).toHaveAttribute('href', '/context/sug-agent')
      await fitsThePage(page, block)
      await review.click()
      await expect(page).toHaveURL(/\/context\/sug-agent$/)
      await expect(
        page.getByRole('heading', { name: 'Payment provider delays order data in Poland' }),
      ).toBeVisible()

      await signInAt(page, 'Ines Duarte', viewport)
      const member = await answer(page, 'loop-drafts-member', theme)
      await expect(member.locator('[data-answer-words]')).toHaveText(
        'Nothing published covers late order data from Poland yet.',
      )
      await expect(member.getByRole('region', { name: 'Not published yet' })).toHaveCount(0)
      await expect(member).not.toContainText('Payment provider delays order data in Poland')
    })
  }
