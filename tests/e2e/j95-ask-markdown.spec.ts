import { expect, go, test } from './go.ts'

// J95, an answer from the help that the model wrote in Markdown, as the service drew it on the
// demo week (?example=loop-help-markdown): "lets create my first context", answered with bold
// labels, italics, code, a link to a help page and one to the web, a numbered list and a short
// table. The page draws each as it is meant, never as asterisks, tildes, backticks or pipes; each
// link opens in a new tab; the table scrolls in its own box on a phone, never the page; Copy
// copies the plain words.

for (const { name, viewport } of [
  { name: '1440', viewport: { width: 1440, height: 900 } },
  { name: '390', viewport: { width: 390, height: 844 } },
] as const)
  for (const theme of ['light', 'dark'] as const)
    test(`${name}, ${theme}: the model's Markdown is drawn, never shown as its marks`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize(viewport)
      await go(page, `/ask?example=loop-help-markdown&theme=${theme}`)
      const log = page.getByRole('log')
      await expect(log.getByRole('group', { name: 'Answer actions' })).toBeVisible({
        timeout: 20_000,
      })
      const words = log.locator('[data-answer-words]')
      await expect(words).not.toContainText(/\*\*|~~|`|\|/)
      await expect(words.locator('li > strong')).toHaveText([
        'Properties:',
        'Applies to:',
        'Source:',
      ])
      await expect(words.locator('em')).toHaveText('know')
      await expect(words.locator('code')).toHaveText('Definitions')
      // The bold label is set apart from the words after it, in the words' own colour.
      const label = words.locator('li > strong').first()
      const [weight, color, after] = await label.evaluate((el) => [
        getComputedStyle(el).fontWeight,
        getComputedStyle(el).color,
        getComputedStyle(el.parentElement!).color,
      ])
      expect(Number(weight)).toBeGreaterThanOrEqual(600)
      expect(color).toBe(after)

      const help = words.getByRole('link', { name: 'Write context (opens in a new tab)' })
      await expect(help).toHaveAttribute('href', '/docs/write-context#what-to-put-in-it')
      await expect(help).toHaveAttribute('target', '_blank')
      await expect(help).toHaveAttribute('rel', 'noreferrer')
      await expect(
        words.getByRole('link', { name: 'the customs notice (opens in a new tab)' }),
      ).toHaveAttribute('href', 'https://example.com/customs-notice')

      await expect(words.locator('ol[start="1"] > li')).toHaveText([
        'Give it a title that is one plain sentence.',
        'Say what it is about not, if people mix it up.',
        'Publish it.',
      ])
      const table = words.getByRole('table')
      await expect(table.getByRole('columnheader')).toHaveText(['Kind', 'When to pick it'])
      await expect(table.getByRole('row')).toHaveCount(3)
      await expect(table.locator('td strong')).toHaveText(['Event', 'Rule'])

      // Nothing is wider than the page: on a phone the table scrolls in its own box.
      const [scroll, client] = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
      ])
      expect(scroll).toBeLessThanOrEqual(client)
      const box = await words.boundingBox()
      const tableBox = await table.locator('xpath=..').boundingBox()
      expect(tableBox!.x + tableBox!.width).toBeLessThanOrEqual(box!.x + box!.width + 0.5)

      // Copy copies the plain words, with no Markdown.
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await log.getByRole('button', { name: 'Copy' }).last().click()
      const copied = await page.evaluate(() => navigator.clipboard.readText())
      expect(copied).toContain('- Properties: the Domain, the Kind, the Status and the owners.')
      expect(copied).toContain('1. Give it a title that is one plain sentence.')
      expect(copied).not.toMatch(/\*\*|~~|`/)
    })
