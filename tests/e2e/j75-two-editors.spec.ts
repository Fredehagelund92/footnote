import type { Page } from '@playwright/test'
import { expect, go, mode, test } from './go.ts'

// J75, two owners edit one live item (Footnote vs Sanity, R1): Jon and Sofia open its editor, Jon
// saves first, and Sofia's Save from the page she opened before is refused in plain words, with
// Jon's published sentence beside hers. She reloads, keeping her words, adds his, and saves both.
// Nothing Jon published is taken away. Two people in two browsers need the service: the mock keeps
// one person's state in one browser.
test.skip(mode !== 'http', 'two people edit one item on the service, which the mock cannot share')

const origin = process.env.GOLDEN_WEB_ORIGIN ?? ''
const text = (page: Page) => page.getByRole('textbox', { name: 'What agents should know' })
const save = (page: Page) => page.getByRole('button', { name: 'Save', exact: true })
const before = (page: Page) => page.getByRole('region', { name: 'Before it can be published' })
const left = (page: Page) => !/\/edit(\?|$)/.test(page.url())

async function typeAtEnd(page: Page, words: string) {
  // The end of the last paragraph, wherever the text was clicked.
  await text(page).locator('p').last().click()
  await page.keyboard.press('End')
  await page.keyboard.type(words)
}

/** Save, answering "Unrelated" to every live item the service asks about first. */
async function saveAnswering(page: Page) {
  for (let round = 0; round < 3 && !left(page); round++) {
    await save(page).click()
    await expect(async () => {
      expect(left(page) || (await before(page).getByRole('alert').isVisible())).toBe(true)
    }).toPass()
    if (left(page)) break
    for (const answer of await before(page)
      .getByRole('button', { name: /^How this relates to / })
      .all()) {
      const name = (await answer.getAttribute('aria-label'))!
      await answer.click()
      await page
        .getByRole('menu', { name })
        .getByRole('menuitemradio', { name: 'Unrelated' })
        .click()
    }
  }
  await expect.poll(() => left(page)).toBe(true)
}

/** What agents get of the item now: its text as the service publishes it. */
async function published(page: Page, id: string) {
  const res = await page.request.get(`/api/v1/items/${id}/page`)
  const { item } = (await res.json()) as { item: { summary: string; body?: string } }
  return `${item.summary}\n\n${item.body ?? ''}`
}

test("a Save from an older view never takes away another owner's published sentence", async ({
  page,
  browser,
}) => {
  await go(page, '/context/itm_norway_stop/edit')
  await expect(text(page)).toBeVisible()
  const edit = new URL(page.url()).pathname
  const id = edit.split('/')[2]!

  // Sofia, another owner of Sales, opens the same editor in her own browser.
  const hers = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: { width: 1440, height: 900 },
    locale: 'en-GB',
  })
  try {
    const sofia = await hers.newPage()
    const signedIn = await sofia.request.post('/api/v1/auth/sign-in', {
      headers: { 'x-footnote-csrf': 'dev-sign-in', origin },
      data: { email: 'per_sofia@example.test' },
    })
    expect(signedIn.ok(), await signedIn.text()).toBe(true)
    await sofia.goto(edit)
    await expect(text(sofia)).toBeVisible()

    await typeAtEnd(page, ' Stores were not covered.')
    await typeAtEnd(sofia, ' It ended on 30 June.')
    await saveAnswering(page)
    expect(await published(page, id)).toContain('Stores were not covered.')

    // Her Save is refused, says who published and that nothing was saved, and shows his words.
    await save(sofia).click()
    const notice = before(sofia)
    await expect(notice.getByRole('alert')).toHaveText(
      "Couldn't save. Jon Abara published a change to this context item after you opened it, so nothing was saved. Reload it to see their words; yours stay here.",
    )
    await expect(notice).toContainText('Stores were not covered.')
    await expect(text(sofia)).toContainText('It ended on 30 June.')
    expect(await published(page, id)).not.toContain('It ended on 30 June.')

    // Reloading keeps her words and starts them from his version; she adds his and saves both.
    await notice.getByRole('button', { name: 'Reload, keep my words' }).click()
    await expect(notice).toContainText(
      'Agents get this now. Your words are kept below: add what you want of theirs, then save.',
    )
    await expect(text(sofia)).toContainText('It ended on 30 June.')
    await typeAtEnd(sofia, ' Stores were not covered.')
    await saveAnswering(sofia)
    const both = await published(page, id)
    expect(both).toContain('Stores were not covered.')
    expect(both).toContain('It ended on 30 June.')
  } finally {
    await hers.close()
  }
})
