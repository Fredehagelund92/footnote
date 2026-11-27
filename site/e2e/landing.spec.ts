import { existsSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { releaseWords } from '../landing/release.ts'

/*
  The landing page on the built site: the first screen's four questions by mouse, keyboard and
  typing, what a reader with reduced motion gets, the leaders ending on their marks, the
  definitions window and the tour, the release switch as it is built, an axe pass at WCAG AA, and
  screenshot baselines. Fonts render a little differently on each system, so each platform keeps
  its own baselines (Playwright's default path ends in the platform's name). Where a platform has
  none yet the check says so and skips; `npm run test:smoke -- e2e/landing.spec.ts
  --update-snapshots` on that platform writes them, for review by eye in a pull request.
*/

const themes = ['dark', 'light'] as const
type Theme = (typeof themes)[number]

async function open(page: Page, theme?: Theme) {
  if (theme)
    await page.addInitScript((picked) => localStorage.setItem('footnote-theme', picked), theme)
  await page.goto('/')
  await page.evaluate(() => document.fonts.ready)
}

/** No violation of WCAG 2.2 A or AA, of any impact. */
async function expectAxeClean(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`),
  ).toEqual([])
}

const win = (page: Page) => page.locator('#win')
const question = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Questions to try' }).getByRole('button', { name })
/** The answer on show: the thread and the notes beside it. */
const thread = (page: Page) => win(page).locator('.thread:not([hidden])')
const read = (page: Page) => win(page).locator('.read:not([hidden])')

const asked = [
  {
    q: 'How did orders in Norway change in October 2026?',
    line: 'Checked',
    notes: ['Online sales to Norway stopped on 4 August 2026'],
  },
  {
    q: "Why are Germany's orders low for yesterday?",
    line: 'Outdated',
    notes: ['Orders lags by one day in the source tool'],
  },
  {
    q: 'How are orders counted in the United Kingdom?',
    line: 'Conflict',
    notes: [
      'United Kingdom orders count store credit',
      'United Kingdom orders are card and cash payments only',
    ],
  },
  { q: 'Why did returns in Sweden jump in March 2023?', line: 'Not found', notes: ['No note'] },
] as const

async function expectAnswer(page: Page, a: (typeof asked)[number]) {
  await expect(thread(page).locator('.q')).toHaveText(a.q)
  await expect(thread(page).locator('.state .badge')).toHaveText(a.line)
  for (const note of a.notes)
    await expect(read(page).getByRole('heading', { name: note, exact: true })).toBeVisible()
}

test('opens dark without a pick, and light once the reader picked light', async ({ page }) => {
  await open(page)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await open(page, 'light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test("opens on Norway's answer, finished, with no canvas and nothing moving", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page)
    await expect(page.locator('html')).not.toHaveClass(/\banim\b/)
    await expect(page.locator('canvas')).toHaveCount(0)
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0)
    await expectAnswer(page, asked[0])
    await expect(
      thread(page).getByText('This may reflect weaker marketing performance.'),
    ).toBeVisible()
    await expect(thread(page).locator('.ans')).toBeVisible()
    // Everything below the first screen is there at once, too.
    await expect(page.locator('#h-close')).toBeVisible()
    await expect(page.locator('.rv:not(.in)')).toHaveCount(0)
    await expect(win(page).locator('.wires path')).toHaveCount(1)
  })

  for (const width of [390, 1440])
    for (const theme of themes)
      test(`passes axe at AA with each answer, at ${width} in ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        await open(page, theme)
        await expectAxeClean(page)
        for (const a of asked.slice(1)) {
          await question(page, a.q).click()
          await expectAnswer(page, a)
          await expectAxeClean(page)
        }
      })
})

test('with motion, the opening asks Norway and its leader ends on its number', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await open(page)
  await expect(page.locator('html')).toHaveClass(/\banim\b/)
  await expect(page.locator('#hero canvas.field')).toHaveCount(1)
  await expect(win(page)).toHaveClass(/\bwired\b/, { timeout: 15_000 })
  await expectAnswer(page, asked[0])
  await question(page, asked[2].q).click()
  await expect(win(page)).toHaveClass(/\bwired\b/, { timeout: 15_000 })
  await expect(win(page).locator('.wires path')).toHaveCount(2)
  // Once every step has settled, so the numbers are where they stay.
  await page.waitForFunction(() => {
    const root = document.querySelector('#win')
    return !document.getAnimations().some((a) => {
      const target = (a.effect as KeyframeEffect | null)?.target
      return a.playState !== 'finished' && !!target && !!root?.contains(target)
    })
  })
  // Each leader starts beside its number in the answer, on its middle line.
  const gaps = await page.evaluate(() => {
    const box = document.querySelector('#win')!.getBoundingClientRect()
    const marks = [...document.querySelectorAll('#win .thread:not([hidden]) .ref[data-n]')]
    return [...document.querySelectorAll('#wires path')].map((path, i) => {
      const [x, y] = /^M(-?\d+),(-?\d+)/.exec(path.getAttribute('d')!)!.slice(1).map(Number)
      const r = marks[i]!.getBoundingClientRect()
      return Math.max(
        Math.abs(x! - (r.right + 6 - box.left)),
        Math.abs(y! - (r.top + r.height / 2 - box.top)),
      )
    })
  })
  for (const gap of gaps) expect(gap).toBeLessThanOrEqual(3)
})

test.describe('the first screen', () => {
  test.use({ reducedMotion: 'reduce' })

  test('answers each of its four questions, by mouse and by keyboard', async ({ page }) => {
    await open(page)
    for (const a of asked.slice(1)) {
      await question(page, a.q).click()
      await expect(question(page, a.q)).toHaveAttribute('aria-pressed', 'true')
      await expectAnswer(page, a)
    }
    await question(page, asked[0].q).focus()
    await page.keyboard.press('Enter')
    await expectAnswer(page, asked[0])
    await page.keyboard.press('Tab')
    await page.keyboard.press('Space')
    await expectAnswer(page, asked[1])
    await expect(page.locator('#answer-live')).toHaveText(
      "Why are Germany's orders low for yesterday? Outdated: Some of this may be old.",
    )
  })

  test('matches a typed question by plain rules, and tells anything else that nothing is written', async ({
    page,
  }) => {
    await open(page)
    const box = page.getByRole('textbox', { name: 'A question about the demo company' })
    await box.fill('How are UK orders counted?')
    await box.press('Enter')
    await expect(thread(page).locator('.q')).toHaveText('How are UK orders counted?')
    await expect(thread(page).locator('.state .badge')).toHaveText('Conflict')
    await box.fill('Why did margin in Italy fall last week?')
    await page.getByRole('button', { name: 'Ask', exact: true }).click()
    await expect(thread(page).locator('.q')).toHaveText('Why did margin in Italy fall last week?')
    await expect(thread(page).locator('.state .badge')).toHaveText('Not found')
    await expect(thread(page)).toContainText('Nothing is written down about that on this page.')
    await expect(page.locator('#panel-title')).toHaveText('Nothing to read')
  })
})

test.describe('below the first screen', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the definitions window opens the metric pressed', async ({ page }) => {
    await open(page)
    const def = page.locator('#def')
    await expect(def.locator('.def-main:not([hidden]) h3')).toHaveText('Orders')
    await def.getByRole('button', { name: 'Gross margin' }).click()
    await expect(def.getByRole('button', { name: 'Gross margin' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(def.locator('.def-main:not([hidden]) h3')).toHaveText('Gross margin')
    await expect(
      def.getByRole('complementary', { name: 'Notes about Gross margin' }),
    ).toContainText('What to rule out before explaining a jump in Gross margin')
  })

  test('the tour shows the screen of the tab picked, by mouse and with the arrow keys', async ({
    page,
  }) => {
    await open(page)
    const shot = page.locator('#shot img:visible')
    await page.getByRole('tab', { name: /Two notes disagree/ }).click()
    await expect(shot).toHaveAttribute('src', /compare-dark/)
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('tab', { name: /What nobody wrote comes back/ })).toBeFocused()
    await expect(shot).toHaveAttribute('src', /observability-dark/)
    await page.keyboard.press('Home')
    await expect(shot).toHaveAttribute('src', /item-dark/)
  })
})

test('the build before the release carries only its words, not the release words', async ({
  page,
}) => {
  // The page as it is served, hidden parts and all.
  const html = await (await page.request.get('/')).text()
  const before = releaseWords(false)
  const at = releaseWords(true)
  const text = (s: string) => s.replaceAll("'", '&#39;')
  for (const line of [before.status, before.installLede, before.startLine, before.versionNote])
    expect(html).toContain(text(line))
  for (const line of [at.status, at.installLede, at.startLine, at.versionNote])
    expect(html).not.toContain(text(line))
  for (const words of ['0.1.0', 'two minutes', 'compose.images.yaml', 'published images'])
    expect(html).not.toContain(words)
  // No footer sends a reader to a release that is not there, here or under a page of the docs.
  for (const path of ['/', '/docs/'])
    await expect(
      (await page.goto(path), page.getByRole('navigation', { name: 'Footer' })),
    ).not.toContainText('Releases')
})

const shots = [
  { name: 'first-screen-1440-dark', viewport: { width: 1440, height: 900 }, theme: 'dark' },
  { name: 'first-screen-1440-light', viewport: { width: 1440, height: 900 }, theme: 'light' },
  { name: 'first-screen-390-dark', viewport: { width: 390, height: 844 }, theme: 'dark' },
  {
    name: 'conflict-1440-dark',
    viewport: { width: 1440, height: 900 },
    theme: 'dark',
    ask: asked[2].q,
  },
  {
    name: 'outdated-1440-dark',
    viewport: { width: 1440, height: 900 },
    theme: 'dark',
    ask: asked[1].q,
  },
  {
    name: 'not-found-1440-light',
    viewport: { width: 1440, height: 900 },
    theme: 'light',
    ask: asked[3].q,
  },
] as const

test.describe('screenshots', () => {
  // Reduced motion draws no moving ground and plays no opening, so a screenshot is the same each time.
  test.use({ reducedMotion: 'reduce' })
  for (const shot of shots)
    test(shot.name, async ({ page }, info) => {
      const file = `${shot.name}.png`
      const update = info.config.updateSnapshots
      test.skip(
        !existsSync(info.snapshotPath(file)) && update !== 'all' && update !== 'changed',
        `No baseline of ${file} for ${process.platform} yet: write one with --update-snapshots`,
      )
      await page.setViewportSize(shot.viewport)
      await open(page, shot.theme)
      if ('ask' in shot) {
        await question(page, shot.ask).click()
        await page.mouse.move(0, 0)
        await win(page).scrollIntoViewIfNeeded()
      }
      await expect(page).toHaveScreenshot(file, { caret: 'hide', maxDiffPixelRatio: 0.01 })
    })
})
