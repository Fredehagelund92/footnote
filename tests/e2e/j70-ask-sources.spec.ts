import { expect, go, test } from './go.ts'

// J70: what an answer rests on shows as source chips under its words, however many items it
// cites: the first three with their titles, without a press, and the rest behind +n, each chip
// one line, the number its marks in the words carry; pointing at a chip lights those marks. Each
// answer cites N live items (src/web/api/mock/loop-used.ts). An item that needs a look is never a
// chip: it stays under them, one line each, with what its owner can do about it there.

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
      test(`${n} live ${n === 1 ? 'source shows' : 'sources show'} as chips with their titles`, async ({
        page,
      }) => {
        await go(page, `/ask?example=loop-used-${n}`)
        const turn = page.locator('[data-turn]').first()
        await expect(turn.getByRole('group', { name: 'Answer actions' })).toBeVisible({
          timeout: 20_000,
        })
        const sources = turn.getByRole('list', { name: 'Sources' })
        const chips = sources.getByRole('button', { name: /^Source \d+: / })
        await expect(chips).toHaveCount(Math.min(n, SHOWN))
        // Its name is what it shows: the number, the title and the day it was checked.
        await expect(chips.first()).toHaveAccessibleName(
          /^Source 1: Orders lags by one day in the source tool ?, checked \d+ \w+ \d{4}$/,
        )
        await expect(chips.first()).toContainText('Orders lags by one day in the source tool')
        // Each chip one line, however long its title or narrow the page.
        for (const chip of await chips.all())
          expect((await chip.boundingBox())!.height).toBeLessThanOrEqual(32)
        const more = sources.getByRole('button', { name: /^Show \d+ more sources?$/ })
        if (n <= SHOWN) await expect(more).toHaveCount(0)
        else {
          await expect(more).toHaveText(`+${n - SHOWN}`)
          await more.click()
          await expect(chips).toHaveCount(n)
          await expect(more).toHaveCount(0)
        }
        // Nothing needs a look, so nothing is pinned.
        await expect(turn.locator('[data-pinned]')).toHaveCount(0)
      })

    test('pointing at a chip lights its marks in the words', async ({ page }) => {
      await go(page, '/ask?example=loop-used-4')
      const turn = page.locator('[data-turn]').first()
      await expect(turn.getByRole('group', { name: 'Answer actions' })).toBeVisible({
        timeout: 20_000,
      })
      const mark = turn.locator('[data-answer-words]').getByRole('button', { name: /^Source 2: / })
      const before = await mark.evaluate((el) => getComputedStyle(el).backgroundColor)
      await turn
        .getByRole('list', { name: 'Sources' })
        .getByRole('button', { name: /^Source 2: / })
        .hover()
      await expect
        .poll(() => mark.evaluate((el) => getComputedStyle(el).backgroundColor))
        .not.toBe(before)
    })

    test('the items that need a look stay in sight under the chips, one line each', async ({
      page,
    }) => {
      await go(page, '/ask?example=loop-used-trust')
      const turn = page.locator('[data-turn]').first()
      await expect(turn.getByRole('group', { name: 'Answer actions' })).toBeVisible({
        timeout: 20_000,
      })
      // Six sources, two that need a look: four live chips, three shown and one behind +1.
      const sources = turn.locator('[data-sources]')
      await expect(
        sources.getByRole('list', { name: 'Sources' }).getByRole('button', { name: /^Source / }),
      ).toHaveCount(SHOWN)
      await expect(sources.getByRole('button', { name: 'Show 1 more source' })).toBeVisible()
      const pinned = sources.locator('[data-pinned] > li')
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
    })
  })

// The height budget: what an answer rests on never outgrows its words. Closed, the chips are at
// most four lines of 32 px with their gaps (three long titles and +n), and each item that needs a
// look adds one line of 30 px, however many it cites (loop-used-N-look-K: K of N need a look).
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
          await expect(sources.locator('[data-pinned] > li')).toHaveCount(look)
          const height = (await sources.boundingBox())!.height
          expect(height).toBeLessThanOrEqual(4 * 32 + 3 * 6 + (look ? 6 + 30 * look : 0))
        })
    })
