import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J3, an answer of Ask's loop in each state its recorded answers have (Checked, Not found,
// Conflict and Outdated), the failed look-up's Not looked up, and the Definition mark, as the chat
// draws them: the state as a badge at the head of the answer with its fixed sentence beside it
// (none for Checked), its meaning in a floating card on the badge (on hover, on keyboard focus and
// on a tap) that never moves the chat, the words at 16/26 inside the reading measure, the sources as numbered chips, what was used
// as source chips with their titles, What Ask read under the footer, and one row of icons with More. Partial is
// left out: no recorded question answers Partial. The composer is one surface with Send in one
// 32 px slot.

const states = [
  {
    label: 'Checked',
    sentence: 'This is written down and checked.',
    question: 'How many test accounts does units sold leave out in Norway?',
    sources: 1,
    used: 1,
  },
  {
    label: 'Not found',
    sentence: 'Nothing published about this yet.',
    question: 'How did orders in Spain change in October 2026?',
    sources: 0,
    used: 0,
  },
  {
    label: 'Conflict',
    sentence: 'Two items say different things.',
    question: 'Do Norway orders include gift-card money?',
    sources: 3,
    used: 1,
  },
  {
    label: 'Outdated',
    sentence: 'Some of this may be old.',
    question: 'Why did Norway returns drop at the end of April?',
    sources: 1,
    used: 1,
  },
  {
    // The mock's history holds this question's chat as its failed example, so asking it opens that.
    label: 'Not looked up',
    sentence: 'Ask could not look this up just now.',
    question: 'What changed in returns in the United Kingdom this week?',
    sources: 0,
    used: 0,
  },
] as const

const badgeName = new RegExp(`^(${states.map((s) => s.label).join('|')})$`)

/** Asks, and waits until the answer is finished: its badge in, Stop gone and the row settled. */
type Box = { x: number; y: number; width: number; height: number }

/** Two boxes share no pixel. */
const apart = (a: Box, b: Box) =>
  a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y

/** Where everything in the chat is: each answer's words, its action row and the turn itself. */
const layout = (page: Page) =>
  page
    .locator('[data-turn], [data-turn] [data-answer-words], [data-turn] [role="group"]')
    .evaluateAll((all) =>
      all.map((el) => {
        const r = el.getBoundingClientRect()
        return [r.x, r.y, r.width, r.height].map(Math.round)
      }),
    )

/**
 * The card, wherever it opened, floats: it never covers the badge, and it covers the words it
 * explains only where nothing else fits, under the badge (the top of the view, or a phone).
 */
async function placed(page: Page, turn: number, label: string) {
  const log = page.getByRole('log')
  const badge = log
    .locator(`[data-turn="${turn}"]`)
    .locator('[data-slot="popover-trigger"]', { hasText: new RegExp(`^${label}`) })
  const card = page.getByRole('dialog', { name: `What ${label} means` })
  await expect(card).toBeVisible()
  // Settled where it goes: in, and no longer moving.
  await expect.poll(() => card.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
  const words = log.locator(`[data-turn="${turn}"] [data-answer-words]`)
  const [b, c] = [(await badge.boundingBox())!, (await card.boundingBox())!]
  expect(apart(b, c)).toBe(true)
  if ((await words.count()) && !apart((await words.boundingBox())!, c))
    expect(c.y).toBeGreaterThanOrEqual(b.y + b.height)
  return { badge: b, card: c }
}

async function ask(page: Page, question: string) {
  const turns = page.locator('[data-turn]')
  const n = await turns.count()
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially(question)
  await box.press('Enter')
  // The failed look-up's fold carries the same words, so the badge is the one that opens a card.
  await expect(
    turns.nth(n).locator('[data-slot="popover-trigger"]').getByText(badgeName),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  await expect(
    turns
      .nth(n)
      .getByRole('button', { name: /^(More|Ask again)$/ })
      .last(),
  ).toBeVisible()
}

for (const s of states)
  test(`${s.label}: the badge and its sentence, its meaning in its card, chips and one row of icons`, async ({
    page,
  }) => {
    await go(page, `/ask?n=${Date.now()}`)
    await ask(page, s.question)
    const log = page.getByRole('log')
    // The badge, by its label first: a source chip says when its item was checked.
    const badge = log.locator('[data-slot="popover-trigger"]', {
      hasText: new RegExp(`^${s.label}`),
    })
    await expect(badge).toBeVisible()
    await expect(badge).toHaveAttribute('aria-haspopup', 'dialog')
    // A 24 px badge, with its state's fixed sentence beside it; Checked needs none. A failed
    // look-up says it in its chat note.
    expect((await badge.boundingBox())!.height).toBe(24)
    await expect(log.getByText(s.sentence)).toHaveCount(s.label === 'Checked' ? 0 : 1)
    // Only a conflict sets the two that disagree side by side.
    await expect(log.getByText('These two disagree', { exact: true })).toHaveCount(
      s.label === 'Conflict' ? 1 : 0,
    )

    // Focused, the card opens and says what it means (hover: the fixme below).
    await badge.focus()
    const card = page.getByRole('dialog', { name: `What ${s.label} means` })
    await expect(card).toBeVisible()
    await expect(card).toContainText(s.sentence.charAt(0).toLowerCase() + s.sentence.slice(1))
    await expect(badge).toHaveAttribute('aria-expanded', 'true')
    // Never over the badge, and over the words only where nothing else fits.
    await placed(page, 0, s.label)
    // Gone with Escape.
    await page.keyboard.press('Escape')
    await expect(card).toBeHidden()

    // The words at 16 px on 26 px lines, inside the 60ch measure.
    const words = log.locator('[data-answer-words]')
    if (s.label !== 'Not looked up') {
      const type = await words.evaluate((el) => {
        const style = getComputedStyle(el)
        return { size: style.fontSize, line: style.lineHeight, width: el.clientWidth }
      })
      expect(type.size).toBe('16px')
      expect(type.line).toBe('26px')
      expect(type.width).toBeLessThanOrEqual(600)
    }

    // The sources as numbered chips in the words, what was used as source chips with their
    // titles, and What Ask read under the footer; a failed look-up folds what it tried under Not
    // looked up. No helper lines.
    await expect(words.getByRole('button', { name: /^Source \d+: / })).toHaveCount(s.sources)
    await expect(log.locator('[data-sources]')).toHaveCount(s.used)
    await expect(
      log.locator('[data-slot="collapsible-trigger"]', {
        hasText: s.label === 'Not looked up' ? /^Not looked up/ : /^What Ask read$/,
      }),
    ).toBeVisible()
    await expect(log.getByText('Select a sentence to see where it says that.')).toHaveCount(0)
    await expect(log.getByText(/^\d+ sources?$/)).toHaveCount(0)

    // One row of icons, the last answer's always on show: Copy, Good, Bad, Ask again and More.
    const actions = log.getByRole('group', { name: 'Answer actions' })
    await expect(actions).toHaveCount(s.label === 'Not looked up' ? 0 : 1)
    const names = await actions
      .getByRole('button')
      .evaluateAll((all) => all.map((b) => b.getAttribute('aria-label')))
    // A check that did not run has its own Ask again, and nothing to rate, copy or report.
    if (s.label === 'Not looked up') {
      expect(names).toEqual([])
      await expect(log.getByRole('button', { name: 'Ask again', exact: true })).toHaveCount(1)
    } else {
      expect(names).toEqual(['Copy', 'Good answer', 'Bad answer', 'Ask again', 'More'])
      expect(await actions.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
    }
  })

test('Conflict: the two that disagree side by side, each opening its item, and Compare the two', async ({
  page,
}) => {
  await go(page, `/ask?n=${Date.now()}`)
  await ask(page, 'Do Norway orders include gift-card money?')
  const log = page.getByRole('log')
  // Each of the two by its number, its domain, its title and its status; the third item cited is
  // only used.
  const pair = log.getByRole('button', { name: /^\d Sales , domain .+ Live · checked / })
  await expect(pair).toHaveCount(2)
  await expect(pair.first()).toContainText('Norway orders are card and cash payments only')
  await expect(pair.last()).toContainText('Norway orders count store credit')
  await expect(log.getByText('Which one holds is for the owners of')).toBeVisible()
  await pair.first().click()
  await expect(page).toHaveURL(/dock=context\./)
  await log.getByRole('button', { name: 'Compare the two' }).click()
  await expect(page).toHaveURL(/dock=conflict\./)
})

test('Definition: a neutral mark, not a state, with its card, over the definition it explains', async ({
  page,
}) => {
  await go(page, `/ask?n=${Date.now()}`)
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially('What is net revenue?')
  await box.press('Enter')
  const log = page.getByRole('log')
  const mark = log.getByRole('button', { name: 'Definition', exact: true })
  await expect(mark).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  // The badge's size and its card, with none of the six labels at the answer's head.
  await expect(mark).toHaveAttribute('aria-haspopup', 'dialog')
  expect((await mark.boundingBox())!.height).toBe(24)
  await expect(log.getByRole('button', { name: badgeName })).toHaveCount(0)
  // Its tint is neutral: none of a state's colours, and not Not found's dashed ring.
  const tone = await mark
    .locator('span')
    .first()
    .evaluate((el) => getComputedStyle(el).borderStyle)
  expect(tone).not.toBe('dashed')

  // By keyboard, as every badge: focus opens it, Tab goes in, Escape comes back.
  await mark.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(mark).toBeFocused()
  const card = page.getByRole('dialog', { name: 'What Definition means' })
  await expect(card).toBeVisible()
  // The answer uses no item: the definition is all it says.
  await expect(card).toContainText('The answer uses no context item.')
  await page.keyboard.press('Tab')
  await expect(card.getByRole('link', { name: 'Open in Definitions' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(card).toBeHidden()
  await expect(mark).toBeFocused()

  // Hovered, it covers not the mark, and the definition only from under the mark.
  await mark.hover()
  await expect(card).toBeVisible()
  await expect.poll(() => card.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
  const lead = log.locator('[data-answer-words]')
  const [m, c, l] = [
    (await mark.boundingBox())!,
    (await card.boundingBox())!,
    (await lead.boundingBox())!,
  ]
  expect(apart(m, c)).toBe(true)
  if (!apart(l, c)) expect(c.y).toBeGreaterThanOrEqual(m.y + m.height)
})

test('The badge card by keyboard: it opens on focus, Tab goes into it, Escape closes it', async ({
  page,
}) => {
  await go(page, `/ask?n=${Date.now()}`)
  await ask(page, 'How did orders in Spain change in October 2026?')
  const badge = page.getByRole('log').getByRole('button', { name: 'Not found', exact: true })
  const card = page.getByRole('dialog', { name: 'What Not found means' })
  // Reached from the answer's first sentence above it, backwards.
  await badge.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(badge).toBeFocused()
  await expect(card).toBeVisible()
  // Focus stays on the badge until Tab takes it into the card.
  await page.keyboard.press('Tab')
  await expect(card.getByRole('link', { name: 'All answer lines' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(card).toBeHidden()
  await expect(badge).toBeFocused()
})

test('At the very top of the view the card floats under its badge and moves nothing, and with room above it opens there', async ({
  page,
}) => {
  await go(page, `/ask?n=${Date.now()}`)
  await ask(page, 'Do Norway orders include gift-card money?')
  const log = page.getByRole('log')
  // A new question goes to the top of the view: no room above the badge for the card.
  const words = log.locator('[data-turn="0"] [data-answer-words]')
  const before = (await words.boundingBox())!.y
  const still = await layout(page)
  await log.getByRole('button', { name: 'Conflict', exact: true }).focus()
  await placed(page, 0, 'Conflict')
  expect(await layout(page)).toEqual(still)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect.poll(async () => (await words.boundingBox())!.y).toBe(before)

  // A later answer, with the earlier one above it on screen: the card opens above its badge.
  await ask(page, 'How did orders in Spain change in October 2026?')
  await page.locator('[data-thread]').evaluate((el) => el.scrollBy(0, -400))
  await log
    .locator('[data-turn="1"]')
    .getByRole('button', { name: 'Not found', exact: true })
    .focus()
  const above = await placed(page, 1, 'Not found')
  expect(above.card.y + above.card.height).toBeLessThanOrEqual(above.badge.y)
})

// The owner's case: Not found at the top of the view, hovered with the mouse. The card used to open
// in the thread under the badge and push the whole chat down, out from under the pointer.
test('Hovered, the badge keeps its card open while the pointer rests on it, and the chat stays put', async ({
  page,
}) => {
  await go(page, `/ask?n=${Date.now()}`)
  await ask(page, 'How did orders in Spain change in October 2026?')
  const badge = page.getByRole('log').getByRole('button', { name: 'Not found', exact: true })
  const still = await layout(page)
  await badge.hover()
  const card = page.getByRole('dialog', { name: 'What Not found means' })
  await expect(card).toBeVisible()
  await placed(page, 0, 'Not found')
  expect(await layout(page)).toEqual(still)
  await page.waitForTimeout(500)
  await expect(card).toBeVisible()
})

// Every control in an answer, under the pointer and by the keyboard: whatever it shows floats, so
// nothing else in the chat moves (the state badge, chips, source numbers and chips, the read line).
for (const question of [
  'How did orders in Spain change in October 2026?',
  'Do Norway orders include gift-card money?',
])
  test(`Hovering or focusing anything in an answer moves nothing in the chat: ${question}`, async ({
    page,
  }) => {
    // A dozen kinds of control, each hovered and focused.
    test.slow()
    await go(page, `/ask?n=${Date.now()}`)
    await ask(page, question)
    const controls = page
      .getByRole('log')
      .locator('[data-turn] :is(button, a[href], [role="button"])')
    // One of each kind: the first control drawn with each look.
    const kinds = await controls.evaluateAll((all) =>
      all.flatMap((el, i) => (all.findIndex((o) => o.className === el.className) === i ? [i] : [])),
    )
    expect(kinds.length).toBeGreaterThan(5)
    for (const i of kinds) {
      const control = controls.nth(i)
      if (!(await control.isVisible())) continue
      for (const how of ['hover', 'focus'] as const) {
        // Gone, not only closing: a card on its way out still takes the pointer.
        await expect(page.locator('[role="dialog"]')).toHaveCount(0)
        await control.scrollIntoViewIfNeeded()
        const still = await layout(page)
        if (how === 'hover') await control.hover()
        else await control.focus()
        // Past the 120 ms a card waits before it opens.
        await page.waitForTimeout(300)
        const name = await control.evaluate((el) => el.getAttribute('aria-label') ?? el.textContent)
        expect(await layout(page), `${how} on ${name}`).toEqual(still)
        // Closed as a person closes it: Escape on it, then the pointer and focus away.
        if (how === 'focus') await page.keyboard.press('Escape')
        await page.mouse.move(0, 0)
        await control.blur()
      }
    }
  })

// The cursor says what a press does: a pointer on what opens something (a metric's definition, a
// source's item), the arrow on a name whose press only keeps its card open, never the text cursor.
test('A chip in an answer points only where a press opens something', async ({ page }) => {
  await go(page, `/ask?n=${Date.now()}`)
  await ask(page, 'How many test accounts does units sold leave out in Norway?')
  const log = page.getByRole('log')
  const cursor = (name: RegExp) =>
    log
      .getByRole('button', { name })
      .first()
      .evaluate((el) => {
        const r = el.getBoundingClientRect()
        // As the pointer gets it over the chip's middle: the name's own text, not the chip box.
        const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)!
        return getComputedStyle(at).cursor
      })
  expect(await cursor(/, metric$/)).toBe('pointer')
  expect(await cursor(/^Source 1: /)).toBe('pointer')
  for (const kind of [/, value$/, /, domain$/, /, person$/]) {
    if (await log.getByRole('button', { name: kind }).count())
      expect(await cursor(kind), String(kind)).toBe('default')
  }
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('A tap on the badge opens its card inside the screen, and a tap outside closes it', async ({
    page,
  }) => {
    await go(page, `/ask?n=${Date.now()}`)
    await ask(page, 'Do Norway orders include gift-card money?')
    const badge = page.getByRole('log').getByRole('button', { name: 'Conflict', exact: true })
    await badge.tap()
    const card = page.getByRole('dialog', { name: 'What Conflict means' })
    await expect(card).toBeVisible()
    // No room beside the words on a phone: it floats under the badge, over the words, and moves
    // nothing.
    const { badge: b, card: box } = await placed(page, 0, 'Conflict')
    expect(box.y).toBeGreaterThanOrEqual(b.y + b.height)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    await page.getByRole('textbox', { name: 'Ask a question' }).tap()
    await expect(card).toBeHidden()
  })
})

test('More holds Something wrong?, Save question and Share; an earlier answer shows its row on hover', async ({
  page,
}) => {
  await go(page, `/ask?n=${Date.now()}`)
  await ask(page, 'Why did orders in Norway drop in August?')
  await ask(page, 'Why did Norway returns drop at the end of April?')
  const rows = page.getByRole('group', { name: 'Answer actions' })
  // Ask again is the last answer's only.
  await expect(rows.first().getByRole('button', { name: 'Ask again' })).toHaveCount(0)
  expect(await rows.first().evaluate((el) => getComputedStyle(el).opacity)).toBe('0')
  await page.locator('[data-turn="0"] [data-answer-words]').hover()
  await expect.poll(() => rows.first().evaluate((el) => getComputedStyle(el).opacity)).toBe('1')

  const last = rows.last()
  const more = last.getByRole('button', { name: 'More' })
  await more.click()
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Something wrong?',
    'Save question',
    'Share',
  ])
  await menu.getByRole('menuitem', { name: 'Save question' }).click()
  const save = page.getByRole('dialog').filter({ hasText: 'Should answer from' })
  await expect(save).toBeVisible()
  await save.getByRole('button', { name: 'Cancel' }).click()
  await expect(save).toBeHidden()
  await expect(more).toBeFocused()

  await more.click()
  await page.getByRole('menuitem', { name: 'Something wrong?' }).click()
  await expect(page.getByText('Which part?')).toBeVisible()
})

test('The composer is one surface: no hairline or keys inside, a 28 px Send, corners of 14 px', async ({
  page,
}) => {
  await go(page, `/ask?n=${Date.now()}`)
  const form = page.locator('form.ask-composer')
  await expect(form).toBeVisible()
  await expect(form.locator('kbd')).toHaveCount(0)
  await expect(form.getByText('to send')).toHaveCount(0)
  expect(await form.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('14px')
  // Nothing inside draws a rule across the box.
  const rules = await form.evaluate(
    (el) =>
      [...el.querySelectorAll('*')].filter((c) => {
        const s = getComputedStyle(c)
        return (
          c.getBoundingClientRect().width > el.clientWidth / 2 &&
          s.borderTopWidth !== '0px' &&
          s.borderTopStyle !== 'none' &&
          s.borderTopColor !== 'rgba(0, 0, 0, 0)'
        )
      }).length,
  )
  expect(rules).toBe(0)
  const send = form.getByRole('button', { name: 'Ask', exact: true })
  const size = (await send.boundingBox())!
  expect([size.width, size.height]).toEqual([28, 28])
  // Its keys are in its tooltip.
  await page.getByRole('textbox', { name: 'Ask a question' }).pressSequentially('Orders')
  await send.hover()
  await expect(page.locator('[data-slot=tooltip-content]')).toContainText('Enter')
})
