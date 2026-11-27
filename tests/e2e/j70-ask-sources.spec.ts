import { expect, go, test } from './go.ts'

// J70: what an answer rests on shows under its words as one row each, in the order of their
// numbers, however many items it cites: the first three with their titles, without a press, and
// the rest behind Show n more, each row one line across the answer, the number its marks in the
// words carry; pointing at a row lights those marks. Each answer cites N live items
// (src/web/api/mock/loop-used.ts). An item that needs a look is a row of the same shape, in its
// place and always shown, ending in why and what its owner can do about it there (pixel pass P12).

const counts = [1, 4, 10, 20, 50]
const widths = [
  { name: '1440', viewport: { width: 1440, height: 900 } },
  { name: '390', viewport: { width: 390, height: 844 } },
] as const
const SHOWN = 3

for (const { name, viewport } of widths)
  test.describe(name, () => {
    test.use({ viewport })
    for (const n of counts)
      test(`${n} live ${n === 1 ? 'source shows' : 'sources show'} as rows with their titles`, async ({
        page,
      }) => {
        await go(page, `/ask?example=loop-used-${n}`)
        const turn = page.locator('[data-turn]').first()
        await expect(turn.getByRole('group', { name: 'Answer actions' })).toBeVisible({
          timeout: 20_000,
        })
        const sources = turn.getByRole('list', { name: 'Sources' })
        const rows = sources.getByRole('listitem')
        await expect(rows).toHaveCount(Math.min(n, SHOWN))
        // Its number names the item; the row shows the title, and the day it was checked where
        // the answer has room.
        await expect(
          rows.first().getByRole('button', { name: /^Source \d+: / }),
        ).toHaveAccessibleName('Source 1: Orders lags by one day in the source tool')
        await expect(rows.first()).toContainText('Orders lags by one day in the source tool')
        if (name === '1440') await expect(rows.first()).toContainText(/checked \d+ \w+ \d{4}$/)
        // Each row one line, however long its title or narrow the page, its left edge the list's.
        const left = (await sources.boundingBox())!.x
        for (const row of await rows.all()) {
          const box = (await row.boundingBox())!
          expect(box.height).toBeLessThanOrEqual(28)
          expect(box.x).toBe(left)
        }
        const more = turn
          .locator('[data-sources]')
          .getByRole('button', { name: /^Show \d+ more sources?$/ })
        if (n <= SHOWN) await expect(more).toHaveCount(0)
        else {
          await more.click()
          await expect(rows).toHaveCount(n)
          await expect(more).toHaveCount(0)
        }
        // Nothing needs a look.
        await expect(sources).not.toContainText(/Due for a check|May be out of date|Archived/)
      })

    test('pointing at a row lights its marks in the words', async ({ page }) => {
      await go(page, '/ask?example=loop-used-4')
      const turn = page.locator('[data-turn]').first()
      await expect(turn.getByRole('group', { name: 'Answer actions' })).toBeVisible({
        timeout: 20_000,
      })
      const mark = turn.locator('[data-answer-words]').getByRole('button', { name: /^Source 2: / })
      const before = await mark.evaluate((el) => getComputedStyle(el).backgroundColor)
      await turn.getByRole('list', { name: 'Sources' }).getByRole('listitem').nth(1).hover()
      await expect
        .poll(() => mark.evaluate((el) => getComputedStyle(el).backgroundColor))
        .not.toBe(before)
    })

    test('the items that need a look are rows of the same shape, in the order of their numbers', async ({
      page,
    }) => {
      await go(page, '/ask?example=loop-used-trust')
      const turn = page.locator('[data-turn]').first()
      await expect(turn.getByRole('group', { name: 'Answer actions' })).toBeVisible({
        timeout: 20_000,
      })
      // Six sources, two that need a look: those two and three live ones shown, one behind Show 1
      // more, in the order of their numbers.
      const sources = turn.locator('[data-sources]')
      const rows = sources.getByRole('list', { name: 'Sources' }).getByRole('listitem')
      await expect(rows).toHaveCount(SHOWN + 2)
      const numbers = await rows.evaluateAll((lis) =>
        lis.map((li) =>
          Number(
            /^Source (\d+)/.exec(
              li.querySelector('[aria-label^="Source "]')!.getAttribute('aria-label')!,
            )![1],
          ),
        ),
      )
      expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
      await expect(sources.getByRole('button', { name: 'Show 1 more source' })).toBeVisible()
      const pinned = rows.filter({ hasText: /Due for a check|May be out of date/ })
      await expect(pinned).toHaveCount(2)
      await expect(pinned.nth(0).getByRole('button', { name: /^Source 2: / })).toBeVisible()
      await expect(pinned.nth(0)).toContainText('Due for a check')
      await expect(pinned.nth(1).getByRole('button', { name: /^Source 3: / })).toBeVisible()
      await expect(pinned.nth(1)).toContainText('May be out of date')
      // One line at 1440; on a phone why and the action go under the title, which keeps its words.
      for (const row of await pinned.all()) {
        const title = row.getByRole('button', { name: /^(?!Source |Mark it)/ })
        expect((await row.boundingBox())!.height).toBeLessThanOrEqual(name === '1440' ? 28 : 52)
        // "Regulato..." once had eight letters beside them.
        expect((await title.boundingBox())!.width).toBeGreaterThan(200)
      }
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
    })
  })

// The height budget: what an answer rests on never outgrows its words. Closed, the rows are at
// most three lines of 28 px and Show n more, with their gaps, and each item that needs a look adds
// one line of 30 px (two on a phone, where its end goes under its title), however many it cites
// (loop-used-N-look-K: K of N need a look).
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
          const sources = turn.locator('[data-sources]')
          await expect(
            sources
              .getByRole('listitem')
              .filter({ hasText: /Due for a check|May be out of date|Archived/ }),
          ).toHaveCount(look)
          const height = (await sources.boundingBox())!.height
          expect(height).toBeLessThanOrEqual(4 * 32 + 3 * 6 + look * (name === '1440' ? 30 : 52))
        })
    })
