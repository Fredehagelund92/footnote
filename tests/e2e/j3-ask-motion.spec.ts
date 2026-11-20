import type { Locator, Page } from '@playwright/test'
import { expect, go, mode, test } from './go.ts'

/** The six state words, as an answer's line says one. */
const STATE = /^(Checked|Partial|Not found|Conflict|Outdated|Not looked up)$/

// J3, how an answer arrives: the question at once, a working line while Ask's loop reads, then
// its whole turn with its state, sources and actions; stoppable before the turn is in, with no
// fade under reduced motion, a new question at the top of the view and the view put while the
// reader has scrolled up. On the mock the turn comes whole after its working line
// (src/web/api/mock/ask-live.ts). The loop's own words, shown a sentence at a time as each passes
// the check, are the service's: the events on tests/server/ask-loop-check.test.ts and
// tests/web/integration, drawn as they come on tests/web/loop-answer.test.ts ("while the loop
// writes"). Stopping part way through those words went with them.

/** A recorded question the mock answers with a Conflict, which no chat in its history asks yet. */
const QUESTION = 'Why did orders in Norway drop in August?'

async function ask(page: Page, question: string) {
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially(question)
  await box.press('Enter')
}

/**
 * Time stands still from the start and moves only in small steps until what the test waits for is
 * on screen, so an answer stays on its way until the test moves on: on a loaded machine a real
 * clock carried it past that before the check could see it.
 */
async function held(page: Page, route: string, holdLookUp = true) {
  // On the service the look-up answers at once: the first is held, so its answer stays on its way.
  let looked = 0
  if (mode === 'http' && holdLookUp)
    await page.route('**/api/v1/ask/lookup', (r) => (looked++ ? r.continue() : undefined))
  await page.clock.install()
  await page.clock.pauseAt(Date.now() + 1000)
  await go(page, route)
  await until(page, page.getByRole('textbox', { name: 'Ask a question' }))
}

/** An answer on its way: on the mock, the loop reading; on the service, held while it looks up. */
const onTheWay = mode === 'http' ? 'Looking up context…' : 'Reading the context…'

async function until(page: Page, what: Locator) {
  while (!(await what.isVisible())) await page.clock.runFor(50)
}

test('Stop leaves an unfinished answer, said as such', async ({ page }) => {
  await held(page, '/ask?n=stop')
  await ask(page, QUESTION)
  await until(page, page.getByText(onTheWay))
  await page.getByRole('button', { name: 'Stop' }).click()
  const log = page.getByRole('log')
  // One line says so, with Ask again beside it.
  await expect(log.getByText(/stopped/i)).toHaveCount(1)
  await expect(log.getByText(/before an answer/)).toBeVisible()
  // The notice and Ask again come into view; no state or source is claimed.
  await expect(log.getByRole('button', { name: 'Ask again', exact: true })).toBeInViewport()
  await expect(log.getByText(STATE)).toHaveCount(0)
  await expect(log.getByRole('button', { name: /^Source \d+: / })).toHaveCount(0)
  await log.getByRole('button', { name: 'Ask again', exact: true }).click()
  await until(page, log.getByText(STATE).first())
})

test('Escape stops an answer on its way', async ({ page }) => {
  await held(page, '/ask?n=escape')
  await ask(page, QUESTION)
  await until(page, page.getByText(onTheWay))
  await page.keyboard.press('Escape')
  await expect(
    page
      .getByRole('log')
      .getByText(/Stopped/)
      .first(),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  // Nothing comes after, however long it waits.
  await page.clock.runFor(2000)
  await expect(page.getByRole('log').getByText(STATE)).toHaveCount(0)
})

test('a question that is already a chat opens that chat', async ({ page }) => {
  await go(page, '/ask?n=dedupe')
  const rows = page.getByRole('navigation', { name: 'Chats' }).locator('[data-open]')
  // The mock's history already has this question as a chat; a new history gets it now.
  const question = 'Do Norway orders include gift-card money?'
  await ask(page, question)
  await expect(page).toHaveURL(/[?&](example|chat)=/)
  const chat = new RegExp(`[?&]${/[?&]((?:example|chat)=[^&]+)/.exec(page.url())![1]}(&|$)`)
  const count = await rows.count()
  await page.getByRole('button', { name: 'New chat' }).first().click()
  await expect(page).not.toHaveURL(chat)
  await ask(page, question)
  await expect(page).toHaveURL(chat)
  await expect(rows).toHaveCount(count)
})

test('the question shows the moment it is sent, then a working line, then the whole answer', async ({
  page,
}) => {
  test.skip(mode === 'http', "the working line and the time before the turn are the mock's own")
  await held(page, '/ask?n=arrive')
  await ask(page, QUESTION)
  const log = page.getByRole('log')
  // No time has passed: the question is in the chat and Stop takes Ask's place.
  await expect(log.getByText(QUESTION)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  // A look-up that answers within moments shows no working line; this one says what it does.
  await expect(log.getByText(onTheWay)).toHaveCount(0)
  await until(page, log.getByText(onTheWay))
  await expect(
    page.getByRole('status').filter({ hasText: 'Looking up the answer.' }),
  ).toBeAttached()
  await expect(log.getByText(STATE)).toHaveCount(0)
  // Then the turn, whole: its state, its sources and its actions together, and Stop goes.
  await until(page, log.getByText(STATE).first())
  await expect(log.getByText('Conflict', { exact: true })).toBeVisible()
  await expect(log.getByRole('button', { name: /^Source \d+: / }).first()).toBeVisible()
  await expect(log.getByRole('button', { name: 'Good answer' })).toBeVisible()
  await expect(log.getByText(onTheWay)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Answer written.' })).toBeAttached()
})

test('the first question of a new chat arrives as a follow-up does, one that is already a chat too', async ({
  page,
}) => {
  test.skip(mode === 'http', "the time before the turn, which the held clock keeps, is the mock's")
  // Ask as it opens, with no chat: the question at once, then the answer, in the same thread,
  // which only moves to the chat once it has its answer.
  await held(page, '/ask')
  const rows = page.getByRole('navigation', { name: 'Chats' }).locator('[data-open]')
  const log = page.getByRole('log')
  const firstAsk = async () => {
    await ask(page, QUESTION)
    // No time has passed: the question is in the thread, Stop in Ask's place.
    const question = log.getByText(QUESTION)
    await expect(question).toBeVisible()
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    const shown = await question.elementHandle()
    // The working line, then the turn with its state, sources and actions.
    await until(page, log.getByText(onTheWay))
    await expect(page).not.toHaveURL(/[?&]chat=/)
    await until(page, log.getByRole('button', { name: 'Good answer' }))
    await expect(log.getByText(STATE).first()).toBeVisible()
    await expect(log.getByRole('button', { name: /^Source \d+: / }).first()).toBeVisible()
    // The thread was never started again: the question shown at first is the one still there.
    expect(await shown.evaluate((el) => el.isConnected)).toBe(true)
    await expect(page).toHaveURL(/[?&]chat=chat-/)
  }
  await firstAsk()
  const chat = new URL(page.url()).searchParams.get('chat')!
  const count = await rows.count()
  // A new chat with the same question, now a chat in the history: answered the same way too, and
  // it is that chat, not a second one.
  await page.getByRole('button', { name: 'New chat' }).first().click()
  await until(
    page,
    page.getByRole('heading', { name: 'What do you want to know about your metrics?' }),
  )
  await firstAsk()
  expect(new URL(page.url()).searchParams.get('chat')).toBe(chat)
  await expect(rows).toHaveCount(count)
})

test('scrolled up to read, the view stays put while an answer comes in', async ({ page }) => {
  test.skip(mode === 'http', "the held clock keeps the mock's turn on its way while the view moves")
  await page.setViewportSize({ width: 1440, height: 520 })
  await held(page, '/ask?n=scroll')
  const view = page
    .locator('[role=log]')
    .locator('xpath=ancestor::*[contains(@class,"overflow-y-auto")][1]')
  // Two answers, so there is something above to read.
  for (const [i, q] of [QUESTION, 'Do Norway orders include gift-card money?'].entries()) {
    await ask(page, q)
    await until(
      page,
      page.locator(`[data-turn="${i}"]`).getByRole('button', { name: 'Good answer' }),
    )
  }
  await ask(page, 'Did discount cost in Norway fall after 9 May?')
  await until(page, page.locator('[data-turn="2"]').getByText(onTheWay))
  // The reader scrolls up to the first answer while the third is on its way.
  await view.hover()
  await page.mouse.wheel(0, -5000)
  await expect.poll(() => view.evaluate((el) => el.scrollTop)).toBe(0)
  await until(page, page.locator('[data-turn="2"]').getByRole('button', { name: 'Good answer' }))
  await page.clock.runFor(1000)
  expect(await view.evaluate((el) => el.scrollTop)).toBe(0)
})

test('with reduced motion the answer comes in whole, with no fade', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await held(page, '/ask?n=reduced', false)
  await ask(page, QUESTION)
  const log = page.getByRole('log')
  await until(page, log.getByRole('button', { name: 'Good answer' }))
  await expect(log.getByRole('button', { name: /^Source \d+: / }).first()).toBeVisible()
  // Nothing around the words fades in.
  const words = log.locator('[data-answer-words]').first()
  await expect(words).toBeVisible()
  const fades = await words.evaluate((el) => {
    const found: string[] = []
    for (let at: Element | null = el; at; at = at.parentElement) {
      const { animationName, animationDuration } = getComputedStyle(at)
      if (animationName !== 'none' && parseFloat(animationDuration) > 0)
        found.push(`${at.tagName} ${animationName} ${animationDuration}`)
    }
    return found
  })
  expect(fades).toEqual([])
})

test('a new question goes to the top of the view, and the view stays put as its answer ends', async ({
  page,
}) => {
  await go(page, '/ask?n=view')
  const view = page
    .locator('[role=log]')
    .locator('xpath=ancestor::*[contains(@class,"overflow-y-auto")][1]')
  for (const q of [QUESTION, 'Do Norway orders include gift-card money?']) {
    await ask(page, q)
    const turn = page.getByRole('log').locator('[data-turn]').last()
    await expect(turn.getByRole('button', { name: 'Good answer' })).toBeVisible({ timeout: 6000 })
    // Its question is at the top of the view, with the answer under it.
    const offset = async () => (await turn.boundingBox())!.y - (await view.boundingBox())!.y
    await expect.poll(offset).toBeGreaterThanOrEqual(0)
    await expect.poll(offset).toBeLessThan(40)
    // Once the scroll to it has come to rest, the answer stays where it is: nothing scrolls it.
    const top = () => view.evaluate((el) => el.scrollTop)
    let at = await top()
    for (let was = -1; was !== at; at = await top()) {
      was = at
      await page.waitForTimeout(150)
    }
    await page.waitForTimeout(500)
    expect(await view.evaluate((el) => el.scrollTop)).toBe(at)
  }
})
