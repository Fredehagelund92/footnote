import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J118, the Cube page with one connection (the owner's calls of 24 Nov 2026: Families A, Test
// connection T2, figures out of version 1). Families are always on a definitions tool's page:
// with none, what a family is and how to make one in Cube, the model's YAML to copy. Test
// connection on the Connection section tests the tool as it is saved, for a Cube connected from
// Git and one the person who hosts the app set up from a folder on the server, which has no other
// way to be tested: each step, the views it reads against the model, a file it skipped by name,
// and a failure in plain words with what to do. Nothing on the page or in Ask speaks of figures.
// At 390 and 1440 wide, in light and dark, nothing is wider than the screen and axe finds nothing.

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

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

/** Presses Test connection, and waits for what it found. */
async function testConnection(page: Page) {
  await button(page, 'Test connection').click()
  await expect(page.getByText('Testing the connection…')).toBeHidden({ timeout: 30_000 })
  await expect(
    page.getByText(/^Tested at \d\d:\d\d\. Nothing was kept, and nothing changed\.$/),
  ).toBeVisible()
}

for (const { name, width, height } of widths) {
  for (const theme of themes) {
    test.describe(`${name}, ${theme}`, () => {
      test.use({ viewport: { width, height }, colorScheme: theme })

      test('Families are always on the page, with how to make one in Cube', async ({ page }) => {
        await go(page, '/settings/integrations/cube')
        const main = page.getByRole('main')
        const families = page
          .locator('section')
          .filter({ has: page.getByRole('heading', { name: 'Families', exact: true }) })
          .last()
        await expect(families).toContainText(
          'Metrics that are one metric with variants, such as Revenue in each currency. Cube has none: each of its 22 metrics is its own.',
        )
        await expect(families).toContainText(
          'A family is found in four ways: declared in Cube, from the calculation, from a rate, or by names that look alike.',
        )
        // With none, how to make one is open: the model's own YAML, to copy.
        await expect(
          families.getByRole('button', { name: 'Make a family in Cube' }),
        ).toHaveAttribute('aria-expanded', 'true')
        await expect(families.locator('pre')).toContainText('footnote:')
        await expect(families.locator('pre')).toContainText('family: revenue')
        await expect(families.getByRole('button', { name: 'Copy the commands' })).toBeVisible()
        // One connection: nothing speaks of figures.
        await expect(main.getByText(/figure/i)).toHaveCount(0)
        await expect(main.getByRole('heading', { name: 'Connection', exact: true })).toBeVisible()
        expect(await sideways(page)).toBe(0)
        expect(await axe(page)).toEqual([])
      })

      test('Test connection tests Cube as it is saved, and names a file it skipped', async ({
        page,
      }) => {
        await go(page, '/settings/integrations/cube')
        await testConnection(page)
        const found = page.getByRole('list').filter({ hasText: 'Reached the repository' })
        await expect(found).toContainText('Signed in with the token')
        await expect(found).toContainText('It reads every view in the model. 7 views')
        await expect(found).toContainText('A read would hold 22 metrics and 5 dimensions.')
        await expect(found).toContainText('A file was skipped')
        await expect(found).toContainText('cube/model/currencies.yml.jinja')
        expect(await sideways(page)).toBe(0)
        expect(await axe(page)).toEqual([])
      })

      test('a failed test says what failed, and what to do', async ({ page }) => {
        await go(page, '/settings/integrations/cube?check=failed')
        await testConnection(page)
        const found = page.getByRole('list').filter({ hasText: 'Reached the repository' })
        await expect(found).toContainText(
          'Sign in with the token. The repository refused the token.',
        )
        await expect(found).toContainText(
          'Check that the token can read the repository, then replace it under Change settings.',
        )
        await expect(found).toContainText('Read the model')
        expect(await axe(page)).toEqual([])
      })

      test('a Cube set up on the server is tested from its page too', async ({ page }) => {
        await go(page, '/settings/integrations/cube?origin=server')
        // Its settings are the host's: no Change settings, no Disconnect, but a test.
        await expect(button(page, 'Change settings')).toHaveCount(0)
        await expect(button(page, 'Disconnect')).toHaveCount(0)
        await testConnection(page)
        await expect(page.getByText('Reach the folder on the server')).toBeVisible()
        await expect(page.getByText(/set in CUBE_MODEL_DIR\./)).toBeVisible()
        expect(await sideways(page)).toBe(0)
        expect(await axe(page)).toEqual([])
      })
    })
  }
}

test("a server folder that isn't there says so, with what to do", async ({ page }) => {
  await go(page, '/settings/integrations/cube?origin=server&check=failed')
  await testConnection(page)
  await expect(
    page.getByText("It couldn't be read: the folder it reads isn't there."),
  ).toBeVisible()
  await expect(
    page.getByText(
      'Check the folder in its settings. A folder on the server is set by the person who hosts this app.',
    ),
  ).toBeVisible()
})

test('Ask shows no figure line, and the Definitions page names no data contact', async ({
  page,
}) => {
  await go(page, '/ask?example=grounded')
  const main = page.getByRole('main')
  await expect(page.getByText('Checked', { exact: true }).first()).toBeVisible()
  await expect(main.getByText(/See the figure|Show the query|data as of/i)).toHaveCount(0)
  await go(page, '/definitions')
  await expect(page.getByRole('main').getByText(/data contact/i)).toHaveCount(0)
})
