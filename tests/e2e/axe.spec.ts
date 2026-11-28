import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// axe on every place of the app, at 390 and 1440 wide, in light and dark (docs/design/
// accessibility.md, "The gates"): WCAG 2.2 AA, and no finding of any weight. The overlays an
// address opens (the palette, the keys, Report a problem, Connect an agent) and a peek in the dock
// are checked too, and the Help menu once per width and theme.

const places = [
  '/signin',
  // An agent's consent page, with the demo's waiting sign-in (src/web/api/mock/data/agents.ts).
  '/connect/approve?request=demo-agent-sign-in-waiting-for-your-answer0',
  // The page a question link opens, for a Nothing written yet card and a Due for a check card
  // (src/web/api/mock/data/inbox.ts).
  '/question/demo-question-orders-in-germany',
  '/question/demo-question-returns-check',
  '/inbox',
  '/inbox?card=sug-ines',
  // The pane's answers in each state it draws: a conflict on the soft caution fill, a Not found
  // draft, and a card with no answers to compare; and the same quick view in the dock.
  '/inbox?card=sug-sofia-clash',
  '/inbox?card=gap-spain',
  '/inbox?card=check-returns',
  // A report from Ask with the words its sender would write and their link.
  '/inbox?card=flag-germany',
  '/inbox?dock=review.sug-sofia-clash',
  '/inbox?demo=setup',
  '/inbox?demo=names',
  // The imported drafts card, its list and one draft open in the card's place.
  '/inbox?demo=imported&card=drafts%3Ayours',
  '/inbox?demo=imported&card=drafts%3Ayours&draft=itm_draft_imported_07',
  '/inbox/sug-ines/review',
  '/inbox/sug-sofia-clash/review',
  '/inbox/gap-spain/review',
  // The Source review's archive and formatting cases, and its Preview of an edit and a new item.
  '/inbox/sug-lars-retire/review',
  '/inbox/sug-ines-format/review',
  '/inbox/sug-ines/review?view=preview',
  '/inbox/gap-spain/review?view=preview',
  '/context',
  '/context?dock=context.itm_norway_stop',
  // Context by time, and an item of it open in the side panel.
  '/context?view=time',
  '/context?view=time&dock=context.itm_za26xpzv',
  '/context/itm_norway_stop',
  '/context/itm_norway_stop/edit',
  '/context/itm_norway_stop/suggest',
  // A new item waiting for review, as an owner decides it.
  '/context/sug-agent',
  '/context/new',
  '/definitions',
  '/definitions?dock=def.Orders',
  '/definitions/Orders',
  // A dimension's page, with its values.
  '/definitions/Market',
  // What a metric is built from, as a tree on its page and in its quick view.
  '/definitions/Return%20on%20ad%20spend',
  '/definitions?dock=def.Gross%20margin',
  '/definitions/Gross%20margin?dock=def.Net%20revenue',
  '/definitions/Webshop/edit',
  '/definitions/new',
  '/ask',
  '/ask?example=grounded',
  '/ask?example=missing',
  // Marked text: the sentences that disagree, an item that disagrees, a failed read, a refused key.
  '/ask?example=conflict',
  // Ask's loop answers, as the service wrote them on the demo week: chips, rows, evidence and an
  // overview.
  '/ask?example=loop-missing',
  '/ask?example=loop-conflict',
  '/ask?example=loop-stale',
  '/ask?example=loop-list',
  '/ask?example=loop-overview',
  // The definition card, the gap card for a word the workspace does not know, a stop, and the
  // source chips with the items that need a look.
  '/ask?example=loop-definition',
  '/ask?example=loop-unknown',
  '/ask?example=loop-stopped',
  '/ask?example=loop-used-trust',
  // An answer from the help in Markdown: marks, a link, a numbered list and a table.
  '/ask?example=loop-help-markdown',
  // What is not published yet, in its own block under the answer: a draft, and a suggestion that
  // waits for review.
  '/ask?example=loop-drafts',
  '/ask?example=loop-drafts-waiting',
  '/context/itm_gift_store_credit',
  // Conflicts: the Context list filtered to them, a pair's page, the dock, a pair across two
  // domains, a near copy.
  '/context?show=conflicts',
  '/context/conflicts/itm_gift_card_only.itm_gift_store_credit',
  '/context?show=conflicts&dock=conflict.itm_gift_card_only.itm_gift_store_credit',
  '/context/conflicts/itm_spain_vat_in.itm_spain_vat_out',
  '/context/conflicts/itm_france_switch_12.itm_france_switch_21',
  '/settings/integrations?state=failed',
  '/settings/integrations?state=reauth',
  // Overview: the numbers, the chart and the topics; narrowed to an answer, a view and a domain;
  // the topics in another order; and a topic's answer panel beside the table.
  '/observability',
  '/observability?answer=missing',
  '/observability?view=look&group=domain',
  '/observability?sort=name&dir=desc',
  '/observability?dock=topic.orders-spain',
  // The filter bar: chips that keep and leave out, in an order of their own, and the facets with a
  // kind of agent not shown.
  '/observability?d.market=norway&answer=!missing&chips=d.market,answer',
  '/observability?d.campaign=*',
  // Days selected on the chart, read as a chip, with a part of a bar drilled into.
  '/observability?range=30&days=2026-10-12..2026-10-18&answer=missing',
  '/observability?state=empty',
  '/observability/quality',
  '/observability/feedback',
  '/observability/usage',
  '/observability/alerts',
  '/settings/general',
  '/settings/people',
  '/settings/domains',
  '/settings/domains/sales',
  '/settings/domains/new',
  '/settings/agents',
  '/settings/integrations',
  '/settings/integrations/cube',
  '/settings/integrations/cube/connect',
  '/settings/integrations/dbt-metricflow/connect?step=2',
  '/settings/integrations/cube-cloud/connect?step=2',
  '/settings/advanced',
  '/help',
  '/nowhere',
  '/docs',
  '/docs/connect-an-agent',
  '/docs/publish-without-review',
  // A page with a picture of a screen, in light and in dark.
  '/docs/ask-a-question',
  // Publishing without review switched on for the workspace (the review flag): the domain's row.
  '/settings/domains/sales?autopublish=on',
  '/inbox?open=palette',
  '/inbox?open=shortcuts',
  '/inbox?open=report',
  '/settings/agents?open=connect',
]

// The places whose trees draw lazily, with how many each shows: axe waits for them.
const trees = new Map([
  ['/definitions/Return%20on%20ad%20spend', 1],
  ['/definitions?dock=def.Gross%20margin', 1],
  ['/definitions/Gross%20margin?dock=def.Net%20revenue', 2],
])

const widths = [
  { name: '390', width: 390, height: 844 },
  { name: '1440', width: 1440, height: 900 },
] as const
const themes = ['light', 'dark'] as const

const withTheme = (place: string, theme: string) =>
  `${place}${place.includes('?') ? '&' : '?'}theme=${theme}`

/**
  Wait until the fonts are in, nothing is loading and nothing moves, so axe reads the colours a person sees. Still
  means still for ten frames in a row: a page's content can fade in a frame or two after its
  header shows, and one still frame before that would let axe read the text half faded. An
  animation tied to scrolling (the editor toolbar's edge fade) runs as long as the page is open and
  only moves when someone scrolls, so it does not count.
*/
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    delete (window as Window & { stillFrames?: number }).stillFrames
  })
  // A load under 150ms shows a busy placeholder and no skeleton, so nothing moves while it waits:
  // wait for it to end, or axe could read the content as it starts to fade in.
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'))
  await page.waitForFunction(() => {
    const still = document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== 'running' || animation.timeline !== document.timeline,
      )
    const frames = window as Window & { stillFrames?: number }
    frames.stillFrames = still ? (frames.stillFrames ?? 0) + 1 : 0
    return frames.stillFrames >= 10
  })
}

/** Sign out in the user menu, in the sidebar's sheet on a phone. */
async function signOut(page: Page, width: number) {
  if (width < 768) await page.getByRole('button', { name: /menu/i }).first().click()
  await page
    .locator('[data-sidebar=sidebar] [data-sidebar=footer]')
    .last()
    .getByRole('button')
    .click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/signin$/)
}

async function violations(page: Page) {
  await settle(page)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return results.violations.map(
    (violation) =>
      `${violation.impact}: ${violation.id} (${violation.nodes.map((node) => node.target.join(' ')).join(', ')})`,
  )
}

/** Whether the page is no wider than the screen. */
const fitsTheScreen = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

for (const { name, width, height } of widths) {
  for (const theme of themes) {
    test.describe(`${name}, ${theme}`, () => {
      test.use({ viewport: { width, height }, colorScheme: theme })

      for (const place of places) {
        test(place, async ({ page }) => {
          await page.goto(withTheme(place === '/signin' ? '/inbox' : place, theme))
          // The demo starts signed in, and someone signed in goes from sign-in to the Inbox.
          if (place === '/signin') await signOut(page, width)
          await expect(page.locator('main, [role=main], h1').first()).toBeVisible()
          if (trees.has(place)) await expect(page.getByRole('tree')).toHaveCount(trees.get(place)!)
          expect(await violations(page)).toEqual([])
        })
      }

      // Something wrong? beside an answer: the form with the right words open, then sent. Jon owns
      // the item, so it is checked as Ines, who can suggest them; none of it wider than the screen.
      test('Something wrong? beside an answer, then sent', async ({ page }) => {
        await page.goto(withTheme('/ask?example=grounded', theme))
        await signOut(page, width)
        await page.getByRole('button', { name: /Ines Duarte/ }).click()
        await expect(page).toHaveURL(/\/(inbox|ask)$/)
        // The demo's sign-in lives in this page's memory: move inside the app, never load it again.
        await page.evaluate(
          (to) => {
            const link = Object.assign(document.createElement('a'), { href: to })
            document.body.append(link)
            link.click()
            link.remove()
          },
          withTheme('/ask?example=grounded', theme),
        )
        await page.getByRole('button', { name: 'Bad answer' }).last().click()
        const panel = page.getByRole('region', { name: 'Something wrong?' })
        await panel.getByRole('textbox', { name: "What's wrong?" }).fill('Off by four.')
        await panel.getByRole('button', { name: 'Suggest the right words' }).click()
        await panel
          .getByRole('textbox', { name: 'The right words (a suggestion)' })
          .fill('New words.')
        expect(await violations(page)).toEqual([])
        expect(await fitsTheScreen(page)).toBe(true)
        await panel.getByRole('button', { name: 'Send the report and suggestion' }).click()
        await expect(panel.getByRole('heading', { name: /^Sent to the owners of/ })).toBeVisible()
        // Close takes Send's place under the pointer: hovered, a button is drawn lighter.
        await page.mouse.move(0, 0)
        expect(await violations(page)).toEqual([])
      })

      // A context item's Details, open: the lines, the source block, Related and the toolbar.
      test('the Details of a context item, open', async ({ page }) => {
        await page.goto(withTheme('/context?dock=context.itm_0tmqp7o1', theme))
        await page.getByRole('button', { name: 'Details', exact: true }).click()
        await expect(page.getByRole('list', { name: 'Links to' })).toBeVisible()
        expect(await violations(page)).toEqual([])
      })

      // Where dbt's file lives (CON-701): each place with its fields and recipe, each storage
      // service with its list open and closed, and what a test's read found; none of it wider
      // than the screen. One test each: a scan takes a second or two on a busy machine, and
      // thirteen in one test ran past its time.
      const connect = '/settings/integrations/dbt-metricflow/connect?step=2'
      for (const place of ['Server folder', 'Git repository', 'Address', 'Object storage']) {
        test(`where a file lives: ${place}`, async ({ page }) => {
          await page.goto(withTheme(connect, theme))
          await page.getByRole('radio', { name: new RegExp(`^${place}`) }).click()
          expect(await violations(page)).toEqual([])
          expect(await fitsTheScreen(page)).toBe(true)
        })
      }
      for (const service of [
        'S3-compatible store',
        'Google Cloud Storage',
        'Azure Blob Storage',
        'Amazon S3',
      ]) {
        test(`where a file lives: ${service}`, async ({ page }) => {
          await page.goto(withTheme(connect, theme))
          await page.getByRole('radio', { name: /^Object storage/ }).click()
          await page.getByLabel('Storage service').click()
          await page.getByRole('option', { name: service }).click()
          await expect(page.getByRole('listbox')).toBeHidden()
          expect(await violations(page)).toEqual([])
          expect(await fitsTheScreen(page)).toBe(true)
          await page.getByLabel('Storage service').click()
          await expect(page.getByRole('listbox')).toBeVisible()
          expect(await violations(page)).toEqual([])
        })
      }
      test('where a file lives: a test read', async ({ page }) => {
        await page.goto(withTheme(connect, theme))
        await page.getByRole('radio', { name: /^Object storage/ }).click()
        await page.getByLabel('Storage service').click()
        await page.getByRole('option', { name: 'Amazon S3' }).click()
        await page.getByLabel('File address').fill('https://b.s3.amazonaws.com/f.json')
        await page.getByRole('button', { name: 'Test connection' }).click()
        await expect(page.getByText('A read would hold', { exact: false })).toBeVisible()
        expect(await violations(page)).toEqual([])
        expect(await fitsTheScreen(page)).toBe(true)
      })

      // Don't publish: the reason an owner gives to close a new item waiting for review.
      test("Don't publish, its dialog open", async ({ page }) => {
        await page.goto(withTheme('/context/sug-agent', theme))
        // On a phone it is in the page's More menu.
        if (width < 768) {
          await page.getByRole('button', { name: 'More', exact: true }).click()
          await page.getByRole('menuitem', { name: "Don't publish" }).click()
        } else await page.getByRole('button', { name: "Don't publish", exact: true }).click()
        const dialog = page.getByRole('dialog', { name: "Don't publish it?" })
        await expect(
          dialog.getByRole('textbox', { name: "Why you don't publish it" }),
        ).toBeVisible()
        expect(await violations(page)).toEqual([])
        expect(await fitsTheScreen(page)).toBe(true)
      })

      // Publishing without review (FR-421): the dialog that sets a policy, the policy on the domain
      // page, the workspace switch, and the policy with Turn off in the agent's Details.
      test('publishing without review: the dialog, the policy and its Details', async ({
        page,
      }) => {
        await page.goto(withTheme('/settings/domains/sales?autopublish=on', theme))
        await page.getByRole('button', { name: 'Let an agent publish without review' }).click()
        const dialog = page.getByRole('dialog')
        await expect(dialog.getByRole('textbox', { name: 'Why' })).toBeVisible()
        expect(await violations(page)).toEqual([])
        await dialog.getByRole('textbox', { name: 'Why' }).fill('Its rules were right for weeks')
        await dialog.getByRole('button', { name: 'Let it publish' }).click()
        await expect(
          page.getByRole('list', { name: 'Agents that publish without review in Sales' }),
        ).toBeVisible()
        expect(await violations(page)).toEqual([])
        await page.evaluate(() => {
          const link = Object.assign(document.createElement('a'), { href: '/settings/agents' })
          document.body.append(link)
          link.click()
          link.remove()
        })
        await page.getByRole('button', { name: 'Show or hide Publish without review' }).click()
        await page.getByRole('button', { name: 'Details of Claude Code for Kofi Mensah' }).click()
        await expect(
          page.getByRole('list', { name: 'Where Claude Code publishes without review' }),
        ).toBeVisible()
        expect(await violations(page)).toEqual([])
      })

      // Folds open: the context item's row with its text and the way to its page (a card that
      // asks whether the item is still true opens it itself), and a suggestion's evidence in the
      // quick view.
      test('the Inbox pane with its folds open', async ({ page }) => {
        await page.goto(withTheme('/inbox?card=check-returns', theme))
        await expect(page.getByRole('button', { name: /^The context item: / })).toHaveAttribute(
          'aria-expanded',
          'true',
        )
        await expect(page.getByRole('link', { name: 'Open the context item' })).toBeVisible()
        expect(await violations(page)).toEqual([])
        await page.goto(withTheme('/inbox?card=sug-ines', theme))
        await page.getByRole('button', { name: 'What changes' }).click()
        await page.getByRole('button', { name: 'Why Ines Duarte suggested it' }).click()
        await expect(page.getByRole('button', { name: 'What changes' })).toHaveAttribute(
          'aria-expanded',
          'true',
        )
        expect(await violations(page)).toEqual([])
      })

      test('the Sort menu, open, sorted the other way', async ({ page }) => {
        await page.goto(withTheme('/context', theme))
        // On a phone Sort is a part of the Filter menu.
        const sort = page.getByRole('button', { name: /^Sort/ })
        await (width < 576 ? page.getByRole('button', { name: /^Filter/ }) : sort).click()
        await page.getByRole('menuitemradio', { name: 'Oldest first' }).click()
        await expect(page.getByRole('menu')).toBeVisible()
        expect(await violations(page)).toEqual([])
      })

      test("a comment's emoji list, open on ':' alone", async ({ page }) => {
        await page.goto(withTheme('/context/itm_norway_stop', theme))
        const box = page.getByRole('textbox', { name: 'Write a comment' })
        await box.scrollIntoViewIfNeeded()
        await box.click()
        await page.keyboard.type('Ship it :')
        const list = page.getByRole('listbox', { name: 'Emoji' })
        await expect(list).toBeVisible()
        // The text box keeps the focus and names the active row (aria-activedescendant), and the
        // arrows scroll it into view: the combobox pattern, which axe cannot tell from a scrolling
        // region no key reaches. Only that one finding, on this list, is let through.
        const reached = `serious: scrollable-region-focusable (#${await list.getAttribute('id')})`
        expect((await violations(page)).filter((v) => v !== reached)).toEqual([])
      })

      test("Overview's filter picker: its first step, a value search and a chip's values, open", async ({
        page,
      }) => {
        await page.goto(withTheme('/observability?d.market=norway&range=30', theme))
        await expect(page.getByRole('heading', { name: 'Topics' })).toBeVisible()
        // The box keeps the focus and names the active row: the combobox pattern, which axe cannot
        // tell from a scrolling region no key reaches (as the emoji list below).
        const list = async (name: string | RegExp) => {
          const el = page.getByRole('listbox', { name })
          await expect(el).toBeVisible()
          return `serious: scrollable-region-focusable (#${await el.getAttribute('id')})`
        }
        await page.keyboard.press('f')
        const first = await list('Filter by a field, a dimension or a value')
        expect((await violations(page)).filter((v) => v !== first)).toEqual([])
        await page.keyboard.type('nor')
        await expect(page.getByRole('option', { name: /^Norway/ })).toBeVisible()
        expect((await violations(page)).filter((v) => v !== first)).toEqual([])
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: /^Market is Norway\./ }).click()
        const values = await list('Search the values of Market')
        expect((await violations(page)).filter((v) => v !== values)).toEqual([])
      })

      test("Overview's chart: days selected from the keys, on a part of a bar", async ({
        page,
      }) => {
        await page.goto(withTheme('/observability?range=30', theme))
        await expect(page.getByRole('heading', { name: 'Topics' })).toBeVisible()
        await page.keyboard.press('b')
        await page.keyboard.press('Shift+ArrowLeft')
        await page.keyboard.press('ArrowUp')
        await expect(page.getByText(/^Enter to look at only /)).toBeVisible()
        await expect(page.getByRole('button', { name: /^Time is / })).toBeVisible()
        expect(await violations(page)).toEqual([])
      })

      test("a Conflict answer with its badge's card open, and its More menu", async ({ page }) => {
        await page.goto(withTheme('/ask?n=axe-conflict', theme))
        const box = page.getByRole('textbox', { name: 'Ask a question' })
        await box.click()
        await box.pressSequentially('Do Norway orders include gift-card money?')
        await box.press('Enter')
        const log = page.getByRole('log')
        await expect(log.getByRole('button', { name: 'More' })).toBeVisible()
        await log.getByRole('button', { name: 'Conflict', exact: true }).click()
        await expect(page.getByRole('dialog', { name: 'What Conflict means' })).toBeVisible()
        expect(await violations(page)).toEqual([])
        await page.keyboard.press('Escape')
        await log.getByRole('button', { name: 'More' }).click()
        await expect(page.getByRole('menu')).toBeVisible()
        expect(await violations(page)).toEqual([])
      })

      test('an answer that is the definition of the metric it asks about', async ({ page }) => {
        await page.goto(withTheme('/ask?n=axe-definition', theme))
        const box = page.getByRole('textbox', { name: 'Ask a question' })
        await box.click()
        await box.pressSequentially('What is net revenue?')
        await box.press('Enter')
        const mark = page.getByRole('log').getByRole('button', { name: 'Definition', exact: true })
        await expect(mark).toBeVisible()
        expect(await violations(page)).toEqual([])
        // The Definition mark's card, open.
        await mark.focus()
        await expect(page.getByRole('dialog', { name: 'What Definition means' })).toBeVisible()
        expect(await violations(page)).toEqual([])
      })

      // An overview from the records (FR-718): the person's Inbox, by group.
      test('an overview of what needs the person', async ({ page }) => {
        await page.goto(withTheme('/ask?example=loop-overview', theme))
        await expect(page.getByRole('log').locator('[data-answer-words]').first()).toBeVisible()
        expect(await violations(page)).toEqual([])
      })

      test('a review with an open and a resolved thread on its source, and a comment being written', async ({
        page,
      }) => {
        await page.goto(withTheme('/inbox/sug-ines/review', theme))
        const source = page.getByRole('region', { name: 'The source' })
        await source.locator('[data-source-place="after:1"]').focus()
        await page.keyboard.press('c')
        await expect(source.getByRole('textbox', { name: 'Comment on line 1' })).toBeFocused()
        await page.keyboard.type('Since when are there 340?')
        await page.keyboard.press('ControlOrMeta+Enter')
        await expect(source.getByText('Since when are there 340?')).toBeVisible()
        // A removed line is a place in the lines (S); its thread shows in the comparison too.
        await page.keyboard.press('s')
        await source.locator('[data-source-place="before:1"]').focus()
        await page.keyboard.press('c')
        await expect(
          source.getByRole('textbox', { name: 'Comment on removed line 1' }),
        ).toBeFocused()
        await page.keyboard.type('Was 312 ever right?')
        await page.keyboard.press('ControlOrMeta+Enter')
        await expect(source.getByText('Was 312 ever right?')).toBeVisible()
        await page.keyboard.press('s')
        await expect(source.getByRole('button', { name: 'Show the lines' })).toHaveAttribute(
          'aria-pressed',
          'false',
        )
        await source
          .getByRole('region', { name: /^Removed line 1: / })
          .getByRole('button', { name: 'Mark as done' })
          .click()
        await source.locator('[data-source-place="field:sources"]').focus()
        await page.keyboard.press('c')
        await expect(source.getByRole('textbox', { name: 'Comment on source' })).toBeFocused()
        await page.keyboard.type('Which page?')
        await expect(source.getByRole('textbox', { name: 'Comment on source' })).toBeVisible()
        // The pointer rests where Mark as done was, which the fold moves under another button.
        await page.mouse.move(0, 0)
        expect(await violations(page)).toEqual([])
      })

      test('the Help menu, open', async ({ page }) => {
        await page.goto(withTheme('/inbox', theme))
        if (width < 768) await page.getByRole('button', { name: /menu/i }).first().click()
        await page
          .locator('[data-sidebar=sidebar]')
          .last()
          .getByRole('button', { name: 'Help' })
          .click()
        await expect(page.getByRole('menu')).toBeVisible()
        expect(await violations(page)).toEqual([])
      })
    })
  }
}
