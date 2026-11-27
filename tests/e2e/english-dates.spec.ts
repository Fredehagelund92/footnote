import type { Page } from '@playwright/test'
import { expect, go, newContext, test } from './go.ts'

// English dates in a Danish browser (copy.md 2.11, release slice H24): Footnote is English only,
// so no screen writes a date in the browser's language ("6. okt."), the When calendar opens on
// this month and starts on Monday, and a screen reader hears the date the eye sees.

test.use({ locale: 'da-DK', timezoneId: 'Europe/Copenhagen' })

const DANISH_MONTH = /\b\d{1,2}\.\s?(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)\b/i
const DANISH_WORDS =
  /\b(mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag|i dag|i går|man\.|tirs\.|ons\.|tors\.|fre\.|lør\.|søn\.)/i
// English writes a month with a capital, Danish without.
const DANISH_MONTH_NAME =
  /\b(januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december) 20\d\d\b/
// A day the app writes itself, short and without its year ("Since 2 Oct", "Tue 20 Oct"): a title's
// own date always has its year ("on 4 August 2026").
const SHORT_DAY =
  /\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)(?![a-z])(?! 20\d\d)/

/** What the eye reads on the page and what a screen reader hears there, both without Danish. */
async function noDanishDates(page: Page) {
  const main = page.locator('main')
  for (const words of [await main.innerText(), await main.ariaSnapshot()]) {
    expect(words).not.toMatch(DANISH_MONTH)
    expect(words).not.toMatch(DANISH_WORDS)
    expect(words).not.toMatch(DANISH_MONTH_NAME)
  }
}

test('a Danish browser reads every date in English', async ({ page }) => {
  // Each page first shows a date it wrote itself, so the check reads the page once it is drawn.
  await go(page, '/inbox')
  await expect(page.locator('main')).toContainText(SHORT_DAY)
  await noDanishDates(page)

  await go(page, '/context')
  await expect(
    page.getByRole('img', { name: /Checked \d{1,2} [A-Z][a-z]{2,3} 20\d\d by / }).first(),
  ).toBeVisible()
  await noDanishDates(page)

  await go(page, '/observability')
  await expect(page.locator('main')).toContainText(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}(?!\d)/)
  await noDanishDates(page)
})

test('the When calendar opens on this month, starts on Monday and says what it shows', async ({
  page,
}) => {
  await newContext(page)
  await page.getByRole('button', { name: /^When/ }).click()
  await page.getByRole('radio', { name: 'A single day' }).click()

  const grid = page.getByRole('grid')
  await expect(grid).toBeVisible()
  const weekdays = page.locator('[data-slot=calendar] .rdp-weekday')
  await expect(weekdays.first()).toHaveText('Mo')
  await expect(weekdays.last()).toHaveText('Su')
  const firstWeek = grid.getByRole('row').first().getByRole('gridcell')
  await expect(firstWeek.first()).toHaveAccessibleName(/^Monday, /)
  await expect(firstWeek.last()).toHaveAccessibleName(/^Sunday, /)

  // This month is today's: the day marked Today is in the month shown, and the grid is named as
  // its caption writes it.
  const todayButton = grid.getByRole('button', { name: /^Today, / })
  await expect(todayButton).toHaveCount(1)
  const said = (await todayButton.getAttribute('aria-label')) ?? ''
  const [, day, month, year] =
    said.match(/^Today, [A-Z][a-z]+day, (\d{1,2}) ([A-Z][a-z]+) (\d{4})$/) ?? []
  expect(said).toMatch(/^Today, [A-Z][a-z]+day, \d{1,2} [A-Z][a-z]+ \d{4}$/)
  await expect(todayButton).toHaveText(day!)
  await expect(grid).toHaveAccessibleName(`${month} ${year}`)
  await expect(page.getByText(`${month} ${year}`, { exact: true })).toBeVisible()

  // Picking a day: the field writes the day the screen reader said.
  await todayButton.click()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('button', { name: /^When/ })).toContainText(
    `${day} ${month!.slice(0, 3)}`,
  )
  await noDanishDates(page)
})
