import type { Locator, Page } from '@playwright/test'
import { expect, go, signInAs, test } from './go.ts'

// J99, quick actions that open their screen filled in (quick actions S3), on answers of Ask's
// loop as the service wrote them on the demo week. A word the workspace does not know
// (?example=loop-unknown) is "Add “EBITDA” to Definitions" for an admin or an owner, and the new
// term starts with the word in it; a member is offered Tell an admin instead. The definition card
// of a metric nothing is written about (?example=loop-definition-unwritten, Churn rate in Customer
// value) offers its owners and the admins Write context, which opens the editor on the metric, in
// its domain; an owner of another domain and a member get no button. Each at 1440 and 390, in
// light and dark: nothing runs wider than the page.

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
    test(`${name}, ${theme}: a word nobody defined opens a new term with the word in it`, async ({
      page,
    }) => {
      for (const who of ['Jon Abara', 'Tomas Eriksen']) {
        await signInAt(page, who, viewport)
        const log = await answer(page, 'loop-unknown', theme)
        const gap = log.getByRole('region', { name: 'Not written yet: “EBITDA”' })
        const add = gap.getByRole('button', { name: 'Add “EBITDA” to Definitions' })
        await expect(add).toHaveAttribute('href', '/definitions/new?name=EBITDA')
        await expect(add).toHaveAttribute('data-variant', 'outline')
        await fitsThePage(page, add)
        await add.click()
        await expect(page).toHaveURL(/\/definitions\/new\?name=EBITDA$/)
        await expect(page.getByRole('heading', { name: 'New term', level: 1 })).toBeVisible()
        await expect(page.getByRole('textbox', { name: 'The word' })).toHaveValue('EBITDA')
      }

      await signInAt(page, 'Ines Duarte', viewport)
      const member = (await answer(page, 'loop-unknown', theme)).getByRole('region', {
        name: 'Not written yet: “EBITDA”',
      })
      await expect(member.getByRole('button', { name: 'Tell an admin' })).toBeVisible()
      await expect(member.getByRole('button', { name: /to Definitions$/ })).toHaveCount(0)
    })

    test(`${name}, ${theme}: a metric with no context offers its owners Write context, in its domain`, async ({
      page,
    }) => {
      await signInAt(page, 'Jon Abara', viewport)
      const log = await answer(page, 'loop-definition-unwritten', theme)
      const card = log.getByRole('article', { name: /Churn rate/ })
      await expect(card).toContainText('Owned by')
      await expect(card.getByRole('button', { name: /^See the/ })).toHaveCount(0)
      const write = card.getByRole('button', { name: 'Write context about Churn rate' })
      await expect(write).toHaveAttribute(
        'href',
        '/context/new?metric=Churn+rate&domain=customer_value',
      )
      await expect(write).toHaveAttribute('data-variant', 'outline')
      await fitsThePage(page, card)
      await write.click()
      await expect(page.getByRole('heading', { name: 'New context', level: 1 })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Domain Customer value' })).toBeVisible()
      await expect(page.getByRole('button', { name: /Churn rate/ }).first()).toBeVisible()

      // A metric with context already has its items in the card, and no Write context.
      const written = (await answer(page, 'loop-definition', theme)).getByRole('article', {
        name: /Net revenue/,
      })
      await expect(
        written.getByRole('button', { name: /^See the \d+ context items?$/ }),
      ).toBeVisible()
      await expect(written.getByRole('button', { name: /^Write context/ })).toHaveCount(0)

      // Tomas owns Marketing, not Customer value; Ines owns no domain.
      for (const who of ['Tomas Eriksen', 'Ines Duarte']) {
        await signInAt(page, who, viewport)
        const other = (await answer(page, 'loop-definition-unwritten', theme)).getByRole(
          'article',
          { name: /Churn rate/ },
        )
        await expect(other.getByRole('button', { name: 'Open the definition' })).toBeVisible()
        await expect(other.getByRole('button', { name: /^Write context/ })).toHaveCount(0)
      }
    })
  }
