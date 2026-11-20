import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J3, the frame around a chat of Ask's loop: answers with sources scroll the thread only, never
// the page around it, so the composer stays at the foot of the screen; and each turn is the
// question, how it was read, and the answer under them, set apart from the next.

async function ask(page: Page, question: string) {
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially(question)
  await box.press('Enter')
}

test('Three answers with sources leave the page frame where it was', async ({ page }) => {
  await go(page, `/ask?n=${Date.now()}`)
  const log = page.getByRole('log')
  const questions = [
    'How many test accounts does units sold leave out in Norway?',
    'Do Norway orders include gift-card money?',
    'Why did Norway returns drop at the end of April?',
  ]
  for (const [i, question] of questions.entries()) {
    await ask(page, question)
    // Each answer is finished, with its sources and What Ask read, before the next question.
    await expect(log.getByRole('button', { name: 'What Ask read' })).toHaveCount(i + 1)
    await expect(log.getByRole('button', { name: 'Good answer' })).toHaveCount(i + 1)
  }
  // The page holds nothing below the screen, so nothing can scroll it, and nothing has.
  const main = page.locator('main')
  expect(await main.evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0)
  expect(await main.evaluate((el) => el.scrollTop)).toBe(0)
})

test('A turn is the question in its bubble, how it was read, and the answer under them, with no avatars, set apart from the next', async ({
  page,
}) => {
  await go(page, `/ask?n=${Date.now()}`)
  const log = page.getByRole('log')
  for (const [i, question] of [
    'How many test accounts does units sold leave out in Norway?',
    'Do Norway orders include gift-card money?',
  ].entries()) {
    await ask(page, question)
    await expect(log.getByRole('button', { name: 'Good answer' })).toHaveCount(i + 1)
  }
  // No avatar beside the question or the answer: the answer starts at the thread's edge.
  await expect(log.locator('[data-slot=avatar]')).toHaveCount(0)
  // Measured in one pass: the thread scrolls to follow its last answer, so boxes read one at a time
  // would each sit at a different scroll offset.
  const m = await log.evaluate((el) => {
    const rect = (selector: string) => el.querySelector(selector)!.getBoundingClientRect()
    return {
      thread: rect('[data-turn="0"]'),
      bubble: rect('[data-turn="0"] .bg-muted.rounded-surface'),
      read: rect('[data-turn="0"] .group\\/q > p'),
      answer: rect('[data-turn="0"] .group\\/msg'),
      next: rect('[data-turn="1"]'),
    }
  })
  expect(m.answer.x).toBe(m.thread.x)
  // How it was read 8 px under the bubble, 38 px from that line to its own answer, and 48 px from
  // the answer's actions to the next question.
  expect(Math.round(m.read.y - m.bubble.bottom)).toBe(8)
  expect(Math.round(m.answer.y - m.read.bottom)).toBe(38)
  expect(Math.round(m.next.y - m.thread.bottom)).toBe(48)
})
