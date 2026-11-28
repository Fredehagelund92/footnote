import { docControls } from './docs-controls.ts'
import { expect, go, test } from './go.ts'

// The docs name controls in bold, in the words of the screen (docs/help/README.md). Each one named
// there is drawn on its screen, as a control or as the words of a row, found by its accessible name
// or its visible text (a heading may carry a count after its words); a failure names the page that promises it.
// A control only writing help draws is looked for once an admin has turned it on.

for (const { phrase, page: doc, at, drawn, open, writingHelp } of docControls)
  test(`${doc}.md: **${phrase}** is on ${at}`, async ({ page }) => {
    if (writingHelp) {
      await go(page, '/settings/advanced/writing-help')
      await page.getByRole('switch', { name: 'Let people write with writing help' }).click()
    }
    await go(page, at)
    if (open) await page.getByRole('button', { name: new RegExp(`^${open}\\b`) }).click()
    const scope = page.locator('body')
    const exact = { name: phrase, exact: true }
    const found =
      drawn === 'button'
        ? scope.getByRole('button', exact)
        : drawn === 'link'
          ? scope.getByRole('link', exact)
          : drawn === 'option'
            ? scope.getByRole('option', { name: new RegExp(`^${phrase}\\b`) })
            : scope.getByText(
                new RegExp(`^${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\d+)?$`),
              )
    await expect(found.first(), `${doc}.md names **${phrase}**`).toBeVisible()
  })
