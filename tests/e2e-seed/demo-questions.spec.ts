import { expect, test, type Locator, type Page } from '@playwright/test'
import { readmeQuestion } from './readme-question.ts'

/*
  The eight demo questions: what a visitor to the demo is likely to ask Ask first, with no AI
  model connected, so the scripted reader answers. Each answer must be sensible: the right label,
  and the line that makes it right first or on the screen. Two of them are one chat, a question and
  its follow-up. The nightly run asks them of main's images (.github/workflows/demo-images.yml), and a
  release asks them of the images it published (.github/workflows/release.yml).
*/

type Question = {
  question: string
  label: string
  /** What the answer must show, in the turn. */
  shows: (turn: Locator) => Promise<void>
}

const answer = (turn: Locator) => turn.locator('[data-answer-words]')
const pair = (turn: Locator) => turn.getByText('These two disagree').locator('xpath=..')
const nothingWritten = (turn: Locator) =>
  expect(answer(turn)).toContainText('Nothing written covers this.')

const chats: Record<string, Question[]> = {
  'Norway, the README question: the customs rule first': [
    {
      question: readmeQuestion,
      label: 'Checked',
      shows: (turn) =>
        expect(answer(turn)).toHaveText(
          /^What is written for .*Online sales to Norway stopped on 4 August 2026/s,
        ),
    },
  ],
  'Germany last month: the stop of online sales is found': [
    {
      question: 'Why did net revenue drop in Germany last month?',
      label: 'Outdated',
      shows: (turn) =>
        expect(answer(turn)).toContainText('Online sales to Germany stopped on 1 February 2026'),
    },
  ],
  'a metric: its definition, first and alone': [
    {
      question: 'What is net revenue?',
      label: 'Definition',
      shows: (turn) =>
        expect(answer(turn)).toHaveText(
          /^Net revenue, metric\s*Metric\s*Gross sales after returns, discounts, VAT and payment fees/,
        ),
    },
  ],
  'the weather: nothing is looked up': [
    { question: 'What is the weather in Oslo today?', label: 'Not found', shows: nothingWritten },
  ],
  'store credit, and who decides: the two that disagree, then their owners': [
    {
      question: 'Do United Kingdom orders include store credit or not?',
      label: 'Conflict',
      shows: async (turn) => {
        for (const title of [
          'United Kingdom orders are card and cash payments only',
          'United Kingdom orders count store credit',
        ])
          await expect(pair(turn).getByRole('button', { name: new RegExp(title) })).toBeVisible()
      },
    },
    {
      question: 'And who decides which one is right?',
      label: 'Conflict',
      shows: async (turn) => {
        await expect(pair(turn).getByText(/^Which one holds is for the owners of/)).toBeVisible()
        await expect(turn.getByText(/so nothing was looked up/)).toHaveCount(0)
      },
    },
  ],
  'an index nobody wrote: not found': [
    {
      question: 'Define our customer happiness index.',
      label: 'Not found',
      shows: nothingWritten,
    },
  ],
  'a market the demo does not sell in: no such value': [
    {
      question: 'What is the churn rate in Japan?',
      label: 'Not found',
      shows: (turn) => expect(answer(turn)).toContainText('Nothing written covers this.'),
    },
  ],
}

async function ask(page: Page, question: string, n: number) {
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially(question)
  await box.press('Enter')
  const turn = page.locator(`[data-turn="${n}"]`)
  // The scripted reader answers in seconds, but a busy runner can take far longer.
  await expect(turn.getByText('What Ask read')).toBeVisible({ timeout: 60_000 })
  return turn
}

test('there are eight demo questions', () => {
  expect(Object.values(chats).flat()).toHaveLength(8)
})

for (const [name, questions] of Object.entries(chats)) {
  test(`the demo's Ask, ${name}`, async ({ page }) => {
    test.setTimeout(60_000 * (questions.length + 1))
    // A first visit signs in as the demo's administrator, then Ask, with no model connected.
    await page.goto('/')
    await expect(page).toHaveURL(/\/inbox$/)
    await page.goto('/ask')
    await expect(page.getByText(/^No AI model is connected/)).toBeVisible()
    for (const [n, { question, label, shows }] of questions.entries()) {
      const turn = await ask(page, question, n)
      await expect(turn.getByText(label, { exact: true }).first()).toBeVisible()
      await shows(turn)
    }
  })
}
