import { expect, go, test } from './go.ts'

// J70: what an answer used is one line, however many items it cites: "Used N items" and how fresh
// they are, closed when the answer arrives; opening it lists the rows. Each answer cites N live
// items (src/web/api/mock/loop-used.ts), and the words fold after five sentences. An item that
// needs a look is never folded: it stays in sight under the line, one line each.

const counts = [1, 4, 10, 20, 50]
const widths = [
  { name: '1440', viewport: { width: 1440, height: 900 } },
  { name: '390', viewport: { width: 390, height: 844 } },
] as const

for (const { name, viewport } of widths)
  test.describe(name, () => {
    test.use({ viewport })
    for (const n of counts)
      test(`${n} live ${n === 1 ? 'source is' : 'sources are'} one line, closed`, async ({
        page,
      }) => {
        await go(page, `/ask?example=loop-used-${n}`)
        const turn = page.locator('[data-turn]').first()
        await expect(turn.getByRole('group', { name: 'Answer actions' })).toBeVisible({
          timeout: 20_000,
        })
        const fold = turn.getByRole('button', { name: `Used ${n} ${n === 1 ? 'item' : 'items'}` })
        await expect(fold).toHaveAttribute('aria-expanded', 'false')
        const used = turn.locator('[data-used]')
        await expect(used).toContainText(n === 1 ? 'Live, checked' : 'all Live, checked')
        // One line, never taller than its fold.
        expect((await used.boundingBox())!.height).toBeLessThanOrEqual(24)
        // Closed, no row of it is drawn: each source is cited once, in the words.
        await expect(used.getByRole('listitem')).toHaveCount(0)
        await expect(used.locator('[data-pinned]')).toHaveCount(0)

        await fold.click()
        await expect(fold).toHaveAttribute('aria-expanded', 'true')
        await expect(used.getByRole('listitem')).toHaveCount(n)
        await expect(used.getByRole('button', { name: /^Source \d+: / })).toHaveCount(n)
      })

    test('the items that need a look stay in sight under the line, one line each', async ({
      page,
    }) => {
      await go(page, '/ask?example=loop-used-trust')
      const turn = page.locator('[data-turn]').first()
      await expect(turn.getByRole('group', { name: 'Answer actions' })).toBeVisible({
        timeout: 20_000,
      })
      const fold = turn.getByRole('button', { name: 'Used 6 items' })
      await expect(fold).toHaveAttribute('aria-expanded', 'false')
      const used = turn.locator('[data-used]')
      // The line counts each in the words of its row.
      await expect(used).toContainText(
        '4 Live, 1 Due for a check, 1 May be out of date, checked 30 Jul to 3 Nov 2026',
      )
      const pinned = used.locator('[data-pinned] > li')
      await expect(pinned).toHaveCount(2)
      await expect(pinned.nth(0).getByRole('button', { name: /^Source 2: / })).toBeVisible()
      await expect(pinned.nth(0)).toContainText('Due for a check')
      await expect(pinned.nth(1).getByRole('button', { name: /^Source 3: / })).toBeVisible()
      await expect(pinned.nth(1)).toContainText('May be out of date')
      for (const row of await pinned.all())
        expect((await row.boundingBox())!.height).toBeLessThanOrEqual(28)
      // The footer still says which item may be out of date (FR-720.5).
      await expect(turn).toContainText(/“.+” may be out of date: its check date has passed\./)

      // Opening lists the rest; a pinned item is not listed twice.
      await fold.click()
      await expect(used.getByRole('button', { name: /^Source \d+: / })).toHaveCount(6)
    })
  })
