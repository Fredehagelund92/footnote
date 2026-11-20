import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// Screenshot baselines of the review's comparison (design contract 9, Screenshots), at 1440 and
// 390 wide, light and dark: the bar, the Fields table opening with only what changed, and the text
// in two columns (one above the other on a phone), for a changed number with a new sentence, for
// a new look with a list made numbered, for a moved step, and for an archive and a new item, each
// with one side empty. The viewport is tall enough to hold the whole source,
// which scrolls inside the page. Each platform keeps its own baselines, as
// visual-inbox-pane.spec.ts says; where a platform has none yet the check skips, and
// `--update-snapshots` on that platform writes them.

const reviews = ['sug-ines', 'sug-ines-format', 'sug-ines-order', 'sug-lars-retire', 'gap-spain']
const widths = [
  { name: '1440', viewport: { width: 1440, height: 1600 } },
  { name: '390', viewport: { width: 390, height: 2400 } },
] as const

for (const { name: width, viewport } of widths)
  for (const theme of ['light', 'dark'] as const)
    test.describe(`${width}, ${theme}`, () => {
      test.use({ viewport, colorScheme: theme })
      for (const id of reviews)
        test(id, async ({ page }, info) => {
          const shot = `${id}-${width}-${theme}.png`
          const update = info.config.updateSnapshots
          test.skip(
            !existsSync(info.snapshotPath(shot)) && update !== 'all' && update !== 'changed',
            `No baseline of ${shot} for ${process.platform} yet: write one with --update-snapshots`,
          )
          await page.goto(`/inbox/${id}/review?theme=${theme}`)
          const source = page.getByRole('region', { name: 'The source' })
          await expect(source.getByRole('region', { name: 'Text' })).toContainText(/changed|Words/)
          await page.evaluate(() => document.fonts.ready)
          await expect(source).toHaveScreenshot(shot, {
            animations: 'disabled',
            caret: 'hide',
            maxDiffPixelRatio: 0.01,
          })
        })
    })
