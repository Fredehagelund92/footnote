import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, go, moveTo, openRow, signInAs, test } from './go.ts'

// J104, an owner splits a family back into its metrics (FR-142, D2-D4): on the mock's
// ?demo=families, Sofia Brandt, an owner of Sales, finds Split into 2 metrics beside how the rate
// family was found. One dialog says what happens: each variant a metric of its own, the family's
// meaning kept in its history, the one context item about it applying to both and its owners each
// given a card, questions that name only the family asked back, and the next read keeping them
// apart. Split, the family is in the Families tab's Kept apart, its variants are metrics,
// and the item reads as about both, due. On the Inbox card Keep for both points it at both, and
// Make them one family again joins them. A family dbt declares is never split here: its page says
// where it is declared, links the file and copies the key. At 390 and 1440 wide, in light and
// dark, nothing is wider than the screen and axe finds nothing.

const widths = [
  { name: '390', width: 390, height: 844 },
  { name: '1440', width: 1440, height: 900 },
] as const
const themes = ['light', 'dark'] as const

const sideways = (page: Page) =>
  page.evaluate(() => document.scrollingElement!.scrollWidth - document.documentElement.clientWidth)

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return results.violations.map(
    (violation) =>
      `${violation.impact}: ${violation.id} (${violation.nodes.map((node) => node.target.join(' ')).join(', ')})`,
  )
}

const toasts = (page: Page) => page.getByRole('region', { name: /^Notifications/ })
const ACCRUED = 'Accrued share front loaded'

/**
 * The families of ?demo=families, read on a fresh load, then Sofia, an owner of Sales, signed in
 * where the sidebar shows, before the journey's own width.
 */
async function asOwner(page: Page) {
  const size = page.viewportSize()!
  await page.setViewportSize({ width: 1440, height: 900 })
  await go(page, '/definitions?demo=families')
  await expect(page.getByText(/^From dbt - change them there/)).toBeVisible()
  await signInAs(page, 'Sofia Brandt')
  await page.setViewportSize(size)
}

for (const { name, width, height } of widths) {
  for (const theme of themes) {
    test.describe(`${name}, ${theme}`, () => {
      test.use({ viewport: { width, height }, colorScheme: theme })

      test('an owner splits a family, and its item keeps reaching agents for both metrics', async ({
        page,
      }) => {
        await asOwner(page)
        await moveTo(page, `/definitions/${encodeURIComponent(ACCRUED)}`)
        await openRow(page, 'How it is built')
        const built = page.getByRole('region', { name: 'How it is built' })
        await expect(built).toContainText('Found from a rate in dbt.')
        const split = built.getByRole('button', { name: 'Split into 2 metrics' })
        await expect(split).toBeVisible()
        expect(await sideways(page)).toBe(0)
        expect(await axe(page)).toEqual([])

        await split.click()
        const dialog = page.getByRole('dialog', { name: `Split ${ACCRUED} into 2 metrics?` })
        await expect(dialog.getByRole('listitem')).toHaveText([
          `${ACCRUED} (EUR) and ${ACCRUED} (USD) each become a metric in Definitions. The family goes; its history stays.`,
          'Its meaning and its usual variant go with it, kept in its history.',
          `1 context item is about ${ACCRUED}. No words change: it now applies to both metrics, and its owner gets a card to check that it fits each one.`,
          `A question that says only “${ACCRUED.toLowerCase()}” then names no metric, so agents ask which one is meant.`,
          'The next read of dbt keeps them apart. You can make them one family again from Definitions.',
        ])
        expect(await axe(page)).toEqual([])
        await dialog.getByRole('button', { name: 'Split into 2 metrics' }).click()
        await expect(dialog).toHaveCount(0)
        await expect(page).toHaveURL(/\/definitions\?show=families$/)
        await expect(toasts(page)).toContainText(`${ACCRUED} is split into 2 metrics`)
        await expect(toasts(page)).toContainText(
          'Each is in Definitions now. 1 context item waits for a check by its owner.',
        )
        const splits = page.getByRole('region', { name: 'Kept apart' })
        await expect(splits).toContainText(`${ACCRUED} (EUR) and ${ACCRUED} (USD), split by you on`)
        await expect(splits).toContainText(
          '1 context item is still about the family and needs a recheck.',
        )
        expect(await sideways(page)).toBe(0)
        expect(await axe(page)).toEqual([])

        // Its variants are metrics in Definitions, each with a page of its own.
        await moveTo(page, `/definitions/${encodeURIComponent(`${ACCRUED} (USD)`)}`)
        await expect(
          page.getByRole('heading', { level: 2, name: `${ACCRUED} (USD)`, exact: true }),
        ).toBeVisible()
        await expect(page.getByText('Family of metrics')).toHaveCount(0)
        // The item about the family is about it too, and needing a recheck.
        await expect(page.getByText(`${ACCRUED} was restated for October`)).toBeVisible()

        // The item about it reads as about both, due, and its owner keeps it for both.
        await moveTo(page, '/inbox')
        const card = page.getByRole('button', {
          name: /Accrued share front loaded was restated for October/,
        })
        await card.first().click()
        await expect(page.getByText(`Its family ${ACCRUED} was split into`)).toBeVisible()
        await expect(page.getByText('Needs a recheck', { exact: true }).first()).toBeVisible()
        expect(await axe(page)).toEqual([])
        await page.getByRole('button', { name: 'Keep for both' }).click()
        await expect(toasts(page)).toContainText('Kept for both')
        await expect(toasts(page)).toContainText(
          `It is about ${ACCRUED} (EUR) and ${ACCRUED} (USD) now, and no longer due.`,
        )
        // Once the card has left, the decision is in.
        await expect(card).toHaveCount(0)
        await moveTo(page, '/definitions?show=families')
        await expect(splits).toContainText('No context is about the family now.')

        await splits.getByRole('button', { name: 'Make them one family again' }).click()
        await expect(toasts(page)).toContainText(`${ACCRUED} is one family again`)
        await expect(splits.getByRole('listitem').filter({ hasText: ACCRUED })).toHaveCount(0)
        await expect(page.getByRole('button', { name: ACCRUED, exact: true })).toBeVisible()
      })

      test('a family its tool declares is changed there, never split here', async ({
        page,
        context,
      }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])
        await asOwner(page)
        await moveTo(page, `/definitions/${encodeURIComponent('Active buyers')}`)
        await openRow(page, 'How it is built')
        await expect(page.getByRole('region', { name: 'How it is built' })).toContainText(
          'Declared as one family in dbt.',
        )
        await expect(page.getByRole('button', { name: /^Split into/ })).toHaveCount(0)
        const declared = page.getByRole('region', { name: 'Changed in dbt' })
        await expect(declared).toContainText('Changed in dbt, not here')
        await expect(declared).toContainText(
          'Each of its 3 metrics names this family in dbt, under meta.footnote.family: active_buyers. To split it, rename it or add a variant, change that in dbt. The next read follows.',
        )
        await expect(
          declared.getByRole('link', { name: /Open models\/orders\.yml in your repository/ }),
        ).toHaveAttribute('href', 'https://git.example/shop/dbt/blob/main/models/orders.yml')
        await declared.getByRole('button', { name: 'Copy the key' }).click()
        await expect(toasts(page)).toContainText('Copied the key')
        expect(await sideways(page)).toBe(0)
        expect(await axe(page)).toEqual([])
      })
    })
  }
}
