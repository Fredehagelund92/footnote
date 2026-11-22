import type { Locator, Page } from '@playwright/test'
import { expect, go, signInAs, test } from './go.ts'

// J98, quick actions in Ask (FR-719.10, quick actions S2), on answers from the help as the service
// wrote them on the demo week. "How do I create my first context item?" (?example=loop-help-write)
// ends with Write context, an outline button that opens the editor, for an admin, an owner and a
// member alike: what a member writes goes to the owners as a suggestion. "How do I invite a
// colleague?" (?example=loop-help-invite) opens People for an admin; a member gets no button, and
// one line that names the admins. A word the workspace does not know (?example=loop-unknown) is
// the gap card's to add, by the same rule: an owner who is no admin may add it to Definitions too.
// Each at 1440 and 390, in light and dark: the row never runs wider than the page.

async function answer(page: Page, example: string, theme: string) {
  await go(page, `/ask?example=${example}&theme=${theme}`)
  const log = page.getByRole('log')
  await expect(log.getByRole('group', { name: 'Answer actions' })).toBeVisible({ timeout: 20_000 })
  return log
}

/** Signs in as someone from the wide sidebar's user menu, then reads at the viewport given. */
async function signInAt(page: Page, who: string, viewport: { width: number; height: number }) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signInAs(page, who)
  await page.setViewportSize(viewport)
}

/** The answer's quick actions, between its words and From the help. */
const actionsOf = (log: Locator) => log.locator('[data-actions]')

async function fitsThePage(page: Page, row: Locator) {
  const [scroll, client] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ])
  expect(scroll).toBeLessThanOrEqual(client)
  const box = await row.boundingBox()
  expect(box!.x + box!.width).toBeLessThanOrEqual(client)
}

for (const { name, viewport } of [
  { name: '1440', viewport: { width: 1440, height: 900 } },
  { name: '390', viewport: { width: 390, height: 844 } },
] as const)
  for (const theme of ['light', 'dark'] as const) {
    test(`${name}, ${theme}: how to create a context item opens the editor, for an admin, an owner and a member`, async ({
      page,
    }) => {
      for (const who of ['Jon Abara', 'Tomas Eriksen', 'Ines Duarte']) {
        await signInAt(page, who, viewport)
        const log = await answer(page, 'loop-help-write', theme)
        const row = actionsOf(log)
        const write = row.getByRole('button', { name: 'Write context' })
        await expect(write).toBeVisible()
        await expect(write).toHaveAttribute('href', '/context/new')
        // An outline, as the gap card's Write context, with a border that shows in either theme.
        await expect(write).toHaveAttribute('data-variant', 'outline')
        const border = await write.evaluate((el) => getComputedStyle(el).borderTopColor)
        expect(border).not.toBe('rgba(0, 0, 0, 0)')
        // Under the words, above From the help, and none of the model's marks in the words.
        const help = log.getByText('From the help', { exact: true })
        expect((await row.boundingBox())!.y).toBeLessThan((await help.boundingBox())!.y)
        await expect(log.locator('[data-answer-words]')).not.toContainText('do:')
        await fitsThePage(page, row)
        await write.click()
        await expect(page).toHaveURL(/\/context\/new$/)
        await expect(page.getByRole('heading', { name: 'New context', level: 1 })).toBeVisible()
      }
    })

    test(`${name}, ${theme}: how to invite a colleague: People for an admin, who does it for a member`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      const admin = actionsOf(await answer(page, 'loop-help-invite', theme))
      await expect(admin.getByRole('button', { name: 'Invite people' })).toHaveAttribute(
        'href',
        '/settings/people',
      )

      await signInAt(page, 'Ines Duarte', viewport)
      const row = actionsOf(await answer(page, 'loop-help-invite', theme))
      await expect(row.getByRole('button', { name: 'Invite people' })).toHaveCount(0)
      // The admins as their chips, each a person to a screen reader too.
      await expect(row).toHaveText(
        /^Invite people is for admins: Jon Abara(, person)? and Ravi Kapoor(, person)?$/,
      )
      await expect(row.getByRole('button', { name: /Jon Abara/ })).toBeVisible()
      await fitsThePage(page, row)
    })

    test(`${name}, ${theme}: a word the workspace does not know is an owner's to add as well as an admin's`, async ({
      page,
    }) => {
      await signInAt(page, 'Tomas Eriksen', viewport)
      const log = await answer(page, 'loop-unknown', theme)
      const gap = log.getByRole('region', { name: 'Not written yet: “EBITDA”' })
      await expect(gap).toContainText('It is yours to add.')
      await expect(gap.getByRole('button', { name: 'Add it to Definitions' })).toBeVisible()
      // The card offers it once: no quick action repeats it beside the card.
      await expect(actionsOf(log)).toHaveCount(0)

      await signInAt(page, 'Ines Duarte', viewport)
      const member = (await answer(page, 'loop-unknown', theme)).getByRole('region', {
        name: 'Not written yet: “EBITDA”',
      })
      await expect(member.getByRole('button', { name: 'Tell an admin' })).toBeVisible()
      await expect(member.getByRole('button', { name: 'Add it to Definitions' })).toHaveCount(0)
    })
  }
