import { expect, go, test } from './go.ts'

// J70: what an answer used is one line, however many items it cites: "Used N items" and how fresh
// they are, closed when the answer arrives; opening it lists the rows, one line each: the number,
// the kind's icon and the title, the details on the number's card. Each answer cites N live items
// (src/web/api/mock/loop-used.ts), and the words fold after five sentences.

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

        await fold.click()
        await expect(fold).toHaveAttribute('aria-expanded', 'true')
        await expect(used.getByRole('listitem')).toHaveCount(n)
        const sources = used.getByRole('button', { name: /^Source \d+: / })
        await expect(sources).toHaveCount(n)
        await expect(sources.first()).toHaveAccessibleName(
          'Source 1: Orders lags by one day in the source tool',
        )
        // Each row one line, however long its title or narrow the page; its name says the title whole.
        const rows = await used.getByRole('listitem').all()
        for (const [k, row] of rows.entries()) {
          expect((await row.boundingBox())!.height, `row ${k + 1}`).toBeLessThanOrEqual(28)
          const label = await row
            .getByRole('button', { name: /^Source \d+: / })
            .getAttribute('aria-label')
          const title = label!.replace(/^Source \d+: /, '')
          await expect(row.getByRole('button', { name: title, exact: true })).toBeVisible()
        }
      })
  })
