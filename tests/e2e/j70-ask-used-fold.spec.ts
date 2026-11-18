import { expect, go, test } from './go.ts'

// J70: what an answer used is one line, however many items it cites: "Used N items" and how fresh
// they are, closed when the answer arrives; opening it lists the rows, one line each: the number,
// the kind's icon and the title, the details on the number's card. Each answer cites N live items
// (src/web/api/mock/loop-used.ts), and the words fold after five sentences. An item that needs a
// look is never folded: it stays in sight under the line, one line each.

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
        await expect(used).toContainText(n === 1 ? 'published, checked' : 'all published, checked')
        // One line, never taller than its fold.
        expect((await used.boundingBox())!.height).toBeLessThanOrEqual(24)
        // Closed, no row of it is drawn: each source is cited once, in the words.
        await expect(used.getByRole('listitem')).toHaveCount(0)
        await expect(used.locator('[data-pinned]')).toHaveCount(0)

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
      // The line counts the published ones; each that needs a look says why on its own row.
      await expect(used).toContainText('Used 6 items·4 published, checked 30 Jul to 3 Nov 2026')
      const pinned = used.locator('[data-pinned] > li')
      await expect(pinned).toHaveCount(2)
      await expect(pinned.nth(0).getByRole('button', { name: /^Source 2: / })).toBeVisible()
      await expect(pinned.nth(0)).toContainText('Due for a check')
      await expect(pinned.nth(1).getByRole('button', { name: /^Source 3: / })).toBeVisible()
      await expect(pinned.nth(1)).toContainText('May be out of date')
      for (const row of await pinned.all())
        expect((await row.boundingBox())!.height).toBeLessThanOrEqual(28)
      // Each row marks its own item still true, and says which (an admin reads it here).
      const titles = [
        'Payment provider switched in France on 12 May 2026',
        'Net revenue in Spain includes VAT',
      ]
      for (const [k, title] of titles.entries())
        await expect(
          pinned.nth(k).getByRole('button', { name: `Mark it still true: ${title}`, exact: true }),
        ).toBeVisible()
      // The footer still says which item may be out of date (FR-720.5).
      await expect(turn).toContainText(/“.+” may be out of date: its check date has passed\./)

      // Opening lists the rest; a pinned item is not listed twice.
      await fold.click()
      await expect(used.getByRole('button', { name: /^Source \d+: / })).toHaveCount(6)
    })
  })

// The height budget: what an answer used never outgrows its words. All live, Used is at most a
// quarter of the words' height, and one source, whose answer may be a single line, keeps to its
// one line of 24 px; with k items that need a look, at most 24 px for the line and 32 px for each
// of them, however many it cites (loop-used-N-look-K: K of N need a look).
const budget = [1, 4, 10, 20, 50].map((n) => ({ n, look: 0 }))
const looks = [
  { n: 4, look: 1 },
  { n: 6, look: 2 },
  { n: 10, look: 3 },
  { n: 20, look: 5 },
  { n: 50, look: 8 },
]

for (const { name, viewport } of widths)
  for (const colorScheme of ['light', 'dark'] as const)
    test.describe(`height budget, ${name} ${colorScheme}`, () => {
      test.use({ viewport, colorScheme })
      for (const { n, look } of [...budget, ...looks])
        test(`${n} ${n === 1 ? 'source' : 'sources'}, ${look} that need a look`, async ({
          page,
        }) => {
          await go(page, `/ask?example=loop-used-${n}${look ? `-look-${look}` : ''}`)
          const turn = page.locator('[data-turn]').first()
          await expect(turn.getByRole('group', { name: 'Answer actions' })).toBeVisible({
            timeout: 20_000,
          })
          const used = turn.locator('[data-used]')
          await expect(used.locator('[data-pinned] > li')).toHaveCount(look)
          const height = (await used.boundingBox())!.height
          const words = (await turn.locator('[data-answer-words]').boundingBox())!.height
          if (look) expect(height).toBeLessThanOrEqual(24 + 32 * look)
          else if (n === 1) expect(height).toBeLessThanOrEqual(24)
          else
            expect(height / words, `Used ${height} px, words ${words} px`).toBeLessThanOrEqual(0.25)
        })
    })
