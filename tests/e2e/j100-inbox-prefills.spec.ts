import type { Page } from '@playwright/test'
import { card, expect, go, onMockOnly, test } from './go.ts'

// J100, Inbox cards that open what they are about (quick actions S3), as Jon, an owner of Sales.
// A report from Ask shows the question Maria asked, as she wrote it, and Try this question opens
// Ask beside the Inbox with it typed in and not sent; the question goes to Ask in memory, so the
// address never holds it. A card due for a check because Gross margin changed in its tool has See
// the definition, which opens Gross margin beside the Inbox; a card due by its date has none. At
// 1440 and 390, in light and dark. The service's demo week flags Gross margin's item for a check
// with no definition change behind it, so it names none to open: the service's card carries what
// changed in tests/web/api/http-inbox.test.ts.

const pane = (page: Page) =>
  page.getByRole('region', { name: /./ }).filter({
    has: page.getByRole('button', { name: 'Previous' }),
  })

for (const { name, viewport } of [
  { name: '1440', viewport: { width: 1440, height: 900 } },
  { name: '390', viewport: { width: 390, height: 844 } },
] as const)
  for (const theme of ['light', 'dark'] as const) {
    test(`${name}, ${theme}: a report from Ask shows its question, to try again`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await go(page, `/inbox?card=${card('flag-germany')}&theme=${theme}`)
      const p = pane(page)
      const question = 'Why are Germany orders low for yesterday?'
      await expect(p.getByText('Maria Lindqvist asked', { exact: true })).toBeVisible()
      await expect(p.locator('blockquote')).toHaveText(question)
      await p.getByRole('button', { name: 'Try this question' }).click()
      const box = page.getByRole('textbox', { name: 'Ask a question' })
      // The dock reads its start while it opens.
      await expect(box).toHaveText(question, { timeout: 20_000 })
      await expect(page).toHaveURL(/dock=ask/)
      const address = new URL(page.url())
      expect(address.searchParams.has('q')).toBe(false)
      expect(decodeURIComponent(address.search)).not.toMatch(/yesterday/i)
      // Typed in, not sent: nothing is asked until Jon sends it.
      await expect(page.getByRole('log')).toHaveCount(0)
    })

    test(`${name}, ${theme}: Try this question types the question in again over a chat already sent, and New chat starts empty`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await go(page, `/inbox?card=${card('flag-germany')}&theme=${theme}`)
      const question = 'Why are Germany orders low for yesterday?'
      const box = page.getByRole('textbox', { name: 'Ask a question' })
      const dock = page.getByRole('complementary', { name: 'Ask' })
      await pane(page).getByRole('button', { name: 'Try this question' }).click()
      await expect(box).toHaveText(question, { timeout: 20_000 })
      await box.press('Enter')
      await expect(page.getByRole('log')).toHaveCount(1, { timeout: 20_000 })
      await pane(page).getByRole('button', { name: 'Try this question' }).click()
      await expect(box).toHaveText(question, { timeout: 20_000 })
      await expect(page.getByRole('log')).toHaveCount(0)
      await dock.getByRole('button', { name: 'New chat' }).click()
      await expect(box).toHaveText('')
    })

    test(`${name}, ${theme}: a definition that changed opens beside the card due for its check`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await onMockOnly('definition change behind a check', async () => {
        await go(page, `/inbox?card=${card('check-margin')}&theme=${theme}`)
        const p = pane(page)
        await expect(p.getByText(/changed the definition of Gross margin/)).toBeVisible()
        const see = p.getByRole('button', { name: 'See the definition of Gross margin' })
        await expect(see).toHaveText('See the definition')
        await expect(see).toHaveAttribute('data-variant', 'outline')
        await see.click()
        await expect(page).toHaveURL(/dock=def\.Gross(\+|%20)margin/)
        await expect(page.getByRole('heading', { name: 'Gross margin' }).first()).toBeVisible()
      })

      await go(page, `/inbox?card=${card('check-returns')}&theme=${theme}`)
      await expect(
        pane(page)
          .getByText(/check date passed/)
          .first(),
      ).toBeVisible()
      await expect(pane(page).getByRole('button', { name: /^See the definition/ })).toHaveCount(0)
    })
  }
