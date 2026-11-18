import type { Locator, Page } from '@playwright/test'
import { card, expect, go, mode, moveTo, onMockOnly, signInAs, test } from './go.ts'

// J28: the three Ask ideas to try first. An answer travels with its state and its sources; a
// sentence shows where it says that; the empty page shows what is asked this week.

/** Asks a question from an empty Ask, as typed. */
async function ask(page: Page, question: string) {
  await go(page, `/ask?n=${Date.now()}`)
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially(question)
  await box.press('Enter')
}

const grounded = 'Why did orders in Norway drop in August?'

/*
  What each mode answers. The mock's answers are written by hand. On the service the answer engine
  decides from the demo week's items: Orders in Norway also gets the two items about gift cards,
  which disagree, so it is a Conflict there; and the regulator's pause is about Return on ad spend,
  not Orders. The words are the items' own first sentences.
*/
const world =
  mode === 'http'
    ? {
        share: 'What should I know about Orders in Germany?',
        shareState: 'Checked (1 item)',
        shareSource:
          /1 Orders lags by one day in the source tool - Sofia Brandt, checked 12 Sep(t)? 2026/,
        firstSentence: /^A new customs rule stopped all online sales to Norway from 4 August 2026/,
        sentences: 4,
      }
    : {
        share: grounded,
        shareState: 'Checked (2 items)',
        shareSource:
          /1 Online sales to Norway stopped on 4 August 2026 - Jon Abara, checked 3 Oct 2026/,
        firstSentence: /^Online sales to Norway stopped on 4 August 2026/,
        sentences: 3,
      }

/** The six state words, as a line says one. */
const STATE = /^(Checked|Partial|Not found|Conflict|Outdated|Not looked up)$/

test('Share copies an answer for Slack with its state and sources, or as a card; a link is for later', async ({
  page,
}) => {
  await ask(page, world.share)
  await page.getByRole('button', { name: 'More' }).last().click()
  await page.getByRole('menuitem', { name: 'Share' }).click()
  // It opens beside the answer, in the right panel, so the answer stays in view.
  await expect(page).toHaveURL(/dock=share\./)
  const share = page.getByRole('region', { name: 'Share this answer' })
  const tabs = share.getByRole('tablist', { name: 'Share as' })
  await expect(tabs.getByRole('tab', { name: /Slack message/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(tabs.getByRole('tab', { name: /Link/ })).toHaveAttribute('aria-disabled', 'true')
  const message = share.getByRole('tabpanel', { name: 'Slack message' })
  await expect(message).toContainText(world.shareState)
  await expect(message).toContainText(world.shareSource)
  await expect(share.getByRole('button', { name: 'Copy for Slack' })).toBeFocused()
  await tabs.getByRole('tab', { name: /Card/ }).click()
  await expect(share.getByRole('tabpanel', { name: 'Card' })).toContainText(
    'Larchwood Outdoor - answered 23 Oct 2026',
  )
  await share.getByRole('button', { name: 'Copy card' }).click()
  await expect(page.getByText('Card copied')).toBeVisible()

  // Nothing written down travels as Not found, with no list of sources.
  await ask(page, 'How did orders in Spain change in October 2026?')
  await page.getByRole('button', { name: 'More' }).last().click()
  await page.getByRole('menuitem', { name: 'Share' }).click()
  const missing = page
    .getByRole('region', { name: 'Share this answer' })
    .getByRole('tabpanel', { name: 'Slack message' })
  await expect(missing).toContainText('Not found. Nothing is written about this yet.')
  await expect(missing.getByRole('listitem')).toHaveCount(0)
})

test('Only a sentence with a source behind it is a button: a press shows its sources, another puts them away', async ({
  page,
}) => {
  await ask(page, grounded)
  const log = page.getByRole('log')
  const first = log.getByRole('button', { name: world.firstSentence })
  await expect(first).toHaveAttribute('tabindex', '0')
  // Ask's own sentence, the last, cites nothing: plain words, with no role and no tab stop.
  const own = log
    .locator('span', { has: page.locator('.sr-only', { hasText: "Ask's own wording" }) })
    .last()
  await expect(own).toBeVisible()
  await expect(own).not.toHaveAttribute('role', 'button')
  await expect(own).not.toHaveAttribute('tabindex')
  await expect(own).not.toHaveAttribute('aria-pressed')
  await expect(own).toHaveCSS('cursor', 'auto')

  await first.press('Enter')
  await expect(page).toHaveURL(/dock=where\..*wn=1/)
  await expect(first).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page
      .getByRole('region', { name: 'Where it says that' })
      .getByRole('region', { name: 'From Online sales to Norway stopped on 4 August 2026' }),
  ).toBeVisible()
  await first.press(' ')
  await expect(page).not.toHaveURL(/dock=/)
  await expect(first).toHaveAttribute('aria-pressed', 'false')
})

test('Show me where it says that: a sentence walks back to its item and the source line, exact phrases marked', async ({
  page,
}) => {
  await ask(page, grounded)
  const log = page.getByRole('log')
  await log.getByRole('button', { name: world.firstSentence }).click()
  await expect(page).toHaveURL(/dock=where\..*wn=1/)
  const panel = page.getByRole('region', { name: 'Where it says that' })
  await expect(panel.getByText(`Sentence 1 of ${world.sentences}`)).toBeVisible()
  const chain = panel.getByRole('region', {
    name: 'From Online sales to Norway stopped on 4 August 2026',
  })
  // The date is marked at all three steps; "new customs rule" is the owner's wording, not the source's.
  await expect(chain.locator('mark', { hasText: '4 August 2026' })).toHaveCount(3)
  await expect(chain.locator('blockquote mark', { hasText: /customs rule/ })).toHaveCount(0)
  await expect(
    chain.getByText('Fewer orders in Norway after 4 August do not mean fewer customers.'),
  ).toBeVisible()
  await expect(log.getByRole('button', { pressed: true })).toContainText(/online sales to Norway/i)

  // The number keys move between sentences; Ask's own sentence, the last, says it has no item.
  const last = world.sentences
  await page.keyboard.press(String(last))
  await expect(panel.getByText(`Sentence ${last} of ${last}`)).toBeVisible()
  await expect(panel.getByText(/It is Ask's own wording/)).toBeVisible()
  await panel.getByRole('button', { name: 'Previous sentence' }).click()
  await expect(panel.getByText(`Sentence ${last - 1} of ${last}`)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).not.toHaveURL(/dock=/)
})

test('Asked this week: topics with the state Ask gives now and a count; an owner gets the waiting draft', async ({
  page,
}) => {
  await go(page, '/ask')
  const week = page.getByRole('region', { name: 'Asked this week' })
  await expect(week).toContainText('142 times · counts only, never the words')
  const rows = week.getByRole('listitem')
  // The four most asked; the rest open in place.
  await expect(rows).toHaveCount(4)
  await expect(rows.first()).toContainText('Orders in Norway')
  await expect(rows.first()).toContainText('31 times')
  const more = week.getByRole('button', { name: 'Show 9 more' })
  await more.click()
  await expect(rows).toHaveCount(13)
  const spain = rows.filter({ hasText: 'Orders in Spain' })
  await expect(spain).toContainText('Not found')
  await expect(spain.getByRole('link', { name: 'Write it for Orders in Spain' })).toHaveAttribute(
    'href',
    `/context/new?gap=${card('gap-spain')}`,
  )
  await week.getByRole('button', { name: 'Show fewer' }).click()
  await expect(rows).toHaveCount(4)

  // Asking a row gets the state its row showed.
  const shown = (await rows.first().getByText(STATE).first().textContent())!
  await rows.first().getByRole('button').click()
  const log = page.getByRole('log')
  await expect(log.getByText(shown, { exact: true }).first()).toBeVisible()
})

/**
 * No question to ask is offered in the chat: no chip, button or list that sends one. A button named
 * as a question would send one; "Something wrong?" opens the report form.
 */
async function suggestsNothing(page: Page) {
  const log = page.getByRole('log')
  await expect(log.getByRole('button', { name: /^(?!Something wrong\?$).*\?$/ })).toHaveCount(0)
  await expect(
    page.getByRole('group', { name: /Ask next|Questions Ask can answer|Suggested questions/ }),
  ).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Questions Ask can answer' })).toHaveCount(0)
}

test('once a message is sent, nothing in the chat suggests what to ask, except at the end of a refusal', async ({
  page,
}) => {
  // Checked.
  await ask(page, world.share)
  const log = page.getByRole('log')
  await expect(log.getByText('Checked', { exact: true }).first()).toBeVisible()
  await expect(log.getByRole('button', { name: 'Good answer' })).toBeVisible()
  await suggestsNothing(page)
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  const follow = async (question: string) => {
    await box.click()
    await box.pressSequentially(question)
    await box.press('Enter')
  }
  // Not found keeps its next step, and only that.
  await follow('How did orders in Spain change in October 2026?')
  await expect(log.getByText('Not found', { exact: true }).first()).toBeVisible()
  await expect(log.getByText(/Write context for/).first()).toBeVisible()
  await suggestsNothing(page)
  // A question that names nothing to look up says what Ask answers, in words.
  await follow('tell me a joke')
  await expect(log.getByText('Nothing was looked up').last()).toBeVisible()
  await expect(log.getByText(/^Ask answers three kinds of question/).last()).toBeVisible()
  await suggestsNothing(page)
  // A question about one person's work is refused, and ends with questions to press.
  await follow('what did Tomas Eriksen write this week?')
  await expect(
    log.getByText("Ask does not answer questions about one person's work."),
  ).toBeVisible()
  await expect(log.getByRole('button', { name: 'What changed this week?' })).toBeVisible()
})

test('someone who does not own the domain gets no unfinished control under Not found', async ({
  page,
}) => {
  await signInAs(page, 'Tomas Eriksen')
  await ask(page, 'How did orders in Spain change in October 2026?')
  const log = page.getByRole('log')
  await expect(log.getByText('Not found', { exact: true }).first()).toBeVisible()
  await expect(log.getByRole('button', { name: /Tell the owner/ })).toHaveCount(0)
  await expect(page.getByText(/Coming soon|comes later/)).toHaveCount(0)
})

test('Asked this week shows no draft to someone who does not own the domain, and a new workspace gets starters', async ({
  page,
}) => {
  await signInAs(page, 'Ines Duarte')
  await go(page, '/ask')
  await expect(
    page.getByRole('region', { name: 'Asked this week' }).getByRole('link', { name: /^Write it/ }),
  ).toHaveCount(0)
  await go(page, '/inbox?demo=setup')
  await go(page, '/ask')
  await expect(page.getByRole('region', { name: 'Asked this week' })).toHaveCount(0)
  // The service makes its starters from what the workspace has written, and a new one has written
  // nothing yet: only the empty page's words (decided 27 October 2026). The mock's are its examples.
  const starters = page.getByRole('group', { name: 'Suggested questions' })
  if (mode === 'http') {
    await expect(page.getByText('What do you want to know about your metrics?')).toBeVisible()
    await expect(starters).toHaveCount(0)
  } else await expect(starters).toBeVisible()
})

test('Asked this week: one line per topic, the state in its own column, the count in another', async ({
  page,
}) => {
  await go(page, '/ask')
  const week = page.getByRole('region', { name: 'Asked this week' })
  const rows = week.getByRole('listitem')
  await expect(rows).toHaveCount(4)
  await page.evaluate(() => document.fonts.ready)
  const boxes = await rows.evaluateAll((li) => li.map((l) => l.getBoundingClientRect().height))
  expect(boxes).toEqual([52, 52, 52, 52])
  const counts = await rows.evaluateAll((li) =>
    li.map((l) => l.querySelector('[id$="-count"]')!.getBoundingClientRect().right),
  )
  expect(new Set(counts).size).toBe(1)
  // Each row says its state in words; the sentence is the tooltip and the row's description.
  for (const row of await rows.all()) await expect(row.getByText(STATE)).toBeVisible()
  const first = rows.first()
  const state = (await first.getByText(STATE).textContent())!
  const sentence = {
    Checked: 'This is written down and checked.',
    Partial: 'Only part of this is written down.',
    'Not found': 'Nothing is written about this yet.',
    Conflict: 'Two items say different things.',
    Outdated: 'Some of this may be old.',
    'Not looked up': 'Ask could not look this up just now.',
  }[state]!
  await expect(first.getByRole('button')).toHaveAccessibleDescription(
    new RegExp(`^${state}\\. ${sentence.replace('.', '\\.')} \\d+\\+? times$`),
  )
  await first.getByText(STATE).hover()
  await expect(page.locator('[data-slot=tooltip-content]')).toHaveText(sentence)

  // The subline is one line in the Ask column, the caption one line in the card. The service here
  // has no AI model, and says so; the mock build's Ask says it is a design preview.
  const subline = page.getByText(
    mode === 'http'
      ? 'No AI model is connected, so answers list what your team wrote and an owner checked.'
      : 'A design preview: answers are made in this browser, with no service and no AI model.',
  )
  expect(await subline.evaluate((p) => p.getBoundingClientRect().height)).toBe(20)
  const caption = week.getByText(/times · counts only, never the words$/)
  expect(await caption.evaluate((p) => p.getBoundingClientRect().height)).toBe(16)
})

test("Asked this week: an owner's next step is a link after the topic, and the count stays put", async ({
  page,
}) => {
  await go(page, '/ask')
  const week = page.getByRole('region', { name: 'Asked this week' })
  // The box takes focus as Ask opens; the row is reached from there.
  await expect(page.getByRole('textbox', { name: 'Ask a question' })).toBeFocused()
  await week.getByRole('button', { name: /^Show \d+ more$/ }).click()
  const row = week
    .getByRole('listitem')
    .filter({
      has: page.getByRole('link', { name: /^(Write it|Review it|Open the card) for / }),
    })
    .first()
  const link = row.getByRole('link')
  await expect(link).toBeVisible()
  const button = row.getByRole('button').first()
  // After the topic, before the state.
  const [b, l, s] = await Promise.all([
    button.boundingBox(),
    link.boundingBox(),
    row.getByText(STATE).boundingBox(),
  ])
  expect(l!.x).toBeGreaterThan(b!.x + b!.width)
  expect(l!.x + l!.width).toBeLessThan(s!.x)
  // The row is reached from the button, not the box.
  await button.focus()
  await page.keyboard.press('Tab')
  await expect(link).toBeFocused()
  const right = await week
    .getByRole('listitem')
    .evaluateAll((li) =>
      li.map((l) => l.querySelector('[id$="-count"]')!.getBoundingClientRect().right),
    )
  expect(new Set(right).size).toBe(1)
})

test('Asked this week on a phone: the whole card above the box, its rows lined up with its title', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await go(page, '/ask')
  const week = page.getByRole('region', { name: 'Asked this week' })
  const rows = week.getByRole('listitem')
  await expect(rows).toHaveCount(4)
  const hint = page.locator('[data-placeholder]')
  await expect(hint).toHaveAttribute('data-placeholder', /^Ask what is written about a number/)
  // A short placeholder, whole on a phone, and it follows the width.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(hint).toHaveAttribute('data-placeholder', 'Ask about a number')
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(hint).toHaveAttribute('data-placeholder', /^Ask what is written about a number/)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(hint).toHaveAttribute('data-placeholder', 'Ask about a number')
  const composer = (await page.getByRole('textbox', { name: 'Ask a question' }).boundingBox())!
  const footer = (await week.getByRole('button', { name: 'Show 9 more' }).boundingBox())!
  const last = (await rows.last().boundingBox())!
  expect(last.y + last.height).toBeLessThanOrEqual(composer.y)
  expect(footer.y + footer.height).toBeLessThanOrEqual(composer.y)
  const title = (await week.getByRole('heading', { name: 'Asked this week' }).boundingBox())!
  const tile = (await rows.first().locator('span').first().boundingBox())!
  expect(tile.x).toBe(title.x)
})

for (const size of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`Asked this week while it loads holds its place at ${size.width} px, and a failed load says so`, async ({
    page,
  }) => {
    await onMockOnly('review flags ?state=loading and ?state=failed', async () => {
      await page.setViewportSize(size)
      await go(page, '/ask?state=loading')
      const week = page.getByRole('region', { name: 'Asked this week' })
      await expect(week.getByRole('status', { name: 'Loading' })).toBeVisible()
      const skeletons = week.locator('[data-skeleton-row]')
      await expect(skeletons).toHaveCount(4)
      await page.evaluate(() => document.fonts.ready)
      const top = async () => (await week.boundingBox())!.y
      const held = await skeletons.evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect()
          return { y: r.y, height: r.height }
        }),
      )
      const cardTop = await top()
      await moveTo(page, '/ask')
      const rows = week.getByRole('listitem')
      await expect(rows).toHaveCount(4)
      const shown = await rows.evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect()
          return { y: r.y, height: r.height }
        }),
      )
      shown.forEach((r, i) => {
        expect(Math.abs(r.y - held[i]!.y)).toBeLessThanOrEqual(0.5)
        expect(Math.abs(r.height - held[i]!.height)).toBeLessThanOrEqual(0.5)
      })
      expect(Math.abs((await top()) - cardTop)).toBeLessThanOrEqual(0.5)

      await go(page, '/ask?state=failed')
      const alert = week.getByRole('alert')
      await expect(alert).toHaveText(/Couldn't load this week's counts\./)
      await alert.getByRole('button', { name: 'Try again' }).click()
      await expect(rows).toHaveCount(4)
    })
  })
}

test.describe('on a touch phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

  test("a tap on a row's count asks the row's question", async ({ page }) => {
    await go(page, '/ask')
    const week = page.getByRole('region', { name: 'Asked this week' })
    const row = week.getByRole('listitem').first()
    const shown = (await row.getByRole('button').first().textContent())!
    const count = (await row.locator('[id$="-count"]').boundingBox())!
    await page.touchscreen.tap(count.x + count.width / 2, count.y + count.height / 2)
    await expect(page.getByRole('log')).toContainText(shown)
  })
})

/** Each move an element makes from here on, as it starts: its frames and its timing. */
async function movesOf(el: Locator) {
  await el.evaluate((el) => {
    const animate = el.animate.bind(el)
    const moves: unknown[] = []
    Object.assign(el, { moves })
    el.animate = (frames, options) => {
      moves.push({ frames, options })
      return animate(frames, options)
    }
  })
  return () => el.evaluate((el) => (el as unknown as { moves: unknown[] }).moves)
}

/** A question that is no example: it is asked in this chat, so the box stays the same box. */
const plain = 'What should I know about Orders in Germany?'

test('Ask on a wide pane: the box sits under the question until the first question, then docks and keeps focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await go(page, `/ask?n=${Date.now()}`)
  const dock = page.locator('[data-dock]')
  const pane = dock.locator('xpath=..')
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await expect(box).toBeFocused()
  const lifted = (await box.boundingBox())!
  const frame = (await pane.boundingBox())!
  expect(lifted.y).toBeLessThan(frame.y + frame.height / 2)
  // The states are taught once, under the box.
  await expect(dock).toContainText(/Checked,\s*Outdated,\s*Not found\.\s*Every answer says which\./)
  // The week comes after the box, in the same scroll.
  const week = (await page.getByRole('region', { name: 'Asked this week' }).boundingBox())!
  expect(week.y).toBeGreaterThan(lifted.y + lifted.height)

  const moves = await movesOf(dock)
  await box.pressSequentially(plain)
  await box.press('Enter')
  await expect(page.getByRole('log')).toContainText(plain)
  // It moves from under the question to the bottom edge in 220 ms on the move curve.
  expect(await moves()).toEqual([
    {
      frames: [
        { transform: expect.stringMatching(/^translateY\(-\d+(\.\d+)?px\)$/) },
        { transform: 'none' },
      ],
      options: {
        duration: 220,
        easing: expect.stringMatching(/^cubic-bezier\(0?\.77, 0, 0?\.175, 1\)$/),
      },
    },
  ])
  await expect(dock).not.toContainText('Every answer says which.')
  // Once it has arrived, it is docked to the bottom edge.
  await dock.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  expect((await box.boundingBox())!.y).toBeGreaterThan(frame.y + frame.height / 2)
  const docked = (await dock.boundingBox())!
  expect(Math.abs(docked.y + docked.height - (frame.y + frame.height))).toBeLessThanOrEqual(1)
  await expect(box).toBeFocused()
})

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the box docks on the first question without moving through the page', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await go(page, `/ask?n=${Date.now()}`)
    const dock = page.locator('[data-dock]')
    const box = page.getByRole('textbox', { name: 'Ask a question' })
    const moves = await movesOf(dock)
    await box.click()
    await box.pressSequentially(plain)
    await box.press('Enter')
    await expect(page.getByRole('log')).toContainText(plain)
    expect(await moves()).toEqual([])
    await expect(dock).not.toContainText('Every answer says which.')
    await expect(box).toBeFocused()
  })
})

test('Ask on a phone keeps the box docked at the bottom edge from the start', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await go(page, `/ask?n=${Date.now()}`)
  const dock = page.locator('[data-dock]')
  const frame = (await dock.locator('xpath=..').boundingBox())!
  const docked = (await dock.boundingBox())!
  expect(Math.abs(docked.y + docked.height - (frame.y + frame.height))).toBeLessThanOrEqual(1)
  await expect(dock).not.toContainText('Every answer says which.')
})

test("Asked this week: a bar of the week's topics by state, its counts the rows' own", async ({
  page,
}) => {
  await go(page, '/ask')
  const week = page.getByRole('region', { name: 'Asked this week' })
  const more = week.getByRole('button', { name: /^Show \d+ more$/ })
  const topics = Number((await more.textContent())!.match(/\d+/)![0]) + 4
  await more.click()
  const rows = week.getByRole('listitem')
  await expect(rows).toHaveCount(topics)
  // Every topic shown was asked 5 times or more; fewer stays out of the rows and the bar.
  for (const count of await rows.locator('[id$="-count"]').allTextContents())
    expect(parseInt(count)).toBeGreaterThanOrEqual(5)
  const states: Record<string, number> = {}
  for (const row of await rows.all()) {
    const state = (await row.getByText(STATE).textContent())!
    states[state] = (states[state] ?? 0) + 1
  }
  const bar = week.getByRole('img', { name: /topics: / })
  const label = (await bar.getAttribute('aria-label'))!
  expect(label).toMatch(new RegExp(`^${topics} topics: `))
  const named = Object.fromEntries(
    label
      .replace(/^\d+ topics: /, '')
      .split(', ')
      .map((part) => {
        const [, n, state] = part.match(/^(\d+) (.+)$/)!
        return [state!, Number(n)]
      }),
  )
  expect(named).toEqual(states)
  // Each row has its state's icon on a tile, and the word in the state's colour.
  const checked = rows.filter({ has: page.getByText('Checked', { exact: true }) }).first()
  await expect(checked.locator('svg').first()).toBeVisible()
})
