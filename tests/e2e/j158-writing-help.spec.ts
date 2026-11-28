import type { Page } from '@playwright/test'
import { expect, go, mode, signInAs, test } from './go.ts'

/*
  J158, Writing help (Route 3, slice S3; arrival, slice A1): Footnote's own help with one draft,
  in the dock beside the editor, open as a new item opens. Off as installed: the dock says so in
  one line, with the switch for an admin, and Draft from text fills the fields by rule. With no
  model connected, an admin's switch changes nothing and the dock says what is missing. With a
  model, the first minute: the words said in the dock become a draft field by field, marked, with
  one question; the person's words win in a field they are typing in, with Writing help's under it
  to use or dismiss; and Undo takes back one turn at a time, the latest first. Ask's Write context
  and Update it open the dock with what Ask found, also after the person closed it.

  The service in http mode has no model, so the no-model part runs there, and the parts that need a
  model run on the mock, whose writing help plays the first minute by rule with no model.
*/

const MESSAGE =
  'Ops says a new customs rule holds webshop parcels to Norway at the border from 4 August. https://customs.example.org/norway'

const box = (page: Page) =>
  dock(page).getByRole('textbox', { name: 'Say something to writing help' })
const title = (page: Page) => page.getByRole('textbox', { name: 'Title' })
const text = (page: Page) => page.getByRole('textbox', { name: 'What agents should know' })
const dontConclude = (page: Page) => page.getByRole('textbox', { name: "Don't conclude" })
const dock = (page: Page) => page.getByRole('region', { name: 'Writing help', exact: true })
const strip = (page: Page) => page.getByRole('region', { name: 'What writing help changed' })
const toggle = (page: Page) => page.getByRole('button', { name: 'Writing help', exact: true })
const done = (page: Page) =>
  expect(dock(page).getByRole('status')).toHaveText('Writing help is done.')

/** An admin turns writing help on in Settings, Advanced, and goes back to Context. */
async function turnOn(page: Page) {
  await go(page, '/settings/advanced/writing-help')
  const on = page.getByRole('switch', { name: 'Let people write with writing help' })
  // The address opens the section with the keyboard on its switch.
  await expect(on).toBeFocused()
  await expect(page.getByText(/^On a computer or tablet\. When it is on, a draft/)).toBeVisible()
  await on.click()
  await expect(on).toBeChecked()
  await expect(
    page.getByText('On. People can write a draft with writing help, beside the editor.'),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Back to app' }).click()
}

/** Write context, with the message in the box of the dock beside it. */
async function writeContext(page: Page) {
  await page.getByRole('link', { name: 'Context', exact: true }).click()
  await page.getByRole('button', { name: 'Write context' }).first().click()
  await expect(box(page)).toBeFocused()
  await box(page).fill(MESSAGE)
}

/** Says what is in the dock's box: its arrow is Say it, since Send is the page's own button. */
const sayIt = (page: Page) => dock(page).getByRole('button', { name: 'Say it' }).click()

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
})

test('Writing help is off as installed: the dock says so, and the fields fill in by rule', async ({
  page,
}) => {
  await go(page, '/context/new')
  // The dock opens beside the new item, says it is off in one line, and has no box.
  await expect(page).toHaveURL(/[?&]dock=write/)
  await expect(dock(page)).toContainText('Writing help is off for this workspace.')
  await expect(box(page)).toHaveCount(0)
  // An admin is led to the switch.
  await expect(dock(page).getByRole('link', { name: 'Turn it on in Settings' })).toHaveAttribute(
    'href',
    '/settings/advanced/writing-help',
  )
  await expect(page.getByText('Filled in by rule, with no AI model.')).toHaveCount(0)
  // Draft from text, in More, fills the fields by rule.
  await page.getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Draft from text' }).click()
  await page.getByRole('textbox', { name: 'Draft from text' }).fill(MESSAGE)
  await page.getByRole('button', { name: 'Fill it in' }).click()
  await expect(title(page)).toHaveValue(/Norway/)
  await expect(page.getByRole('button', { name: 'Try it' })).toBeVisible()
  await expect(toggle(page)).toBeVisible()
})

test('Someone who is not an admin is told who can turn writing help on', async ({ page }) => {
  await signInAs(page, 'Ines Duarte')
  await go(page, '/context/new')
  await expect(dock(page)).toContainText(
    'Writing help is off for this workspace. An admin can turn it on in Settings.',
  )
  await expect(page.getByRole('link', { name: 'Turn it on in Settings' })).toHaveCount(0)
  await expect(box(page)).toHaveCount(0)
})

test('With no model connected, the switch changes nothing, and the dock says what is missing', async ({
  page,
}) => {
  test.skip(
    mode !== 'http',
    'the mock plays writing help with no model, so it is never without one',
  )
  await turnOn(page)
  await page.getByRole('link', { name: 'Context', exact: true }).click()
  await page.getByRole('button', { name: 'Write context' }).first().click()
  await expect(dock(page)).toContainText(
    'Writing help needs an AI model, and none is connected to this workspace.',
  )
  await expect(dock(page).getByRole('link', { name: 'How to connect a model' })).toBeVisible()
  await expect(box(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Draft from text' }).click()
  await page.getByRole('textbox', { name: 'Draft from text' }).fill(MESSAGE)
  await page.getByRole('button', { name: 'Fill it in' }).click()
  await expect(title(page)).toHaveValue(/Norway/)
})

test.describe('with a model', () => {
  test.skip(
    mode === 'http',
    'the service has no model in the journeys; its turns are the integration tests',
  )

  test('the first minute: the words become a draft, field by field, with one question', async ({
    page,
  }) => {
    await turnOn(page)
    await writeContext(page)
    await expect(
      dock(page).getByText(
        "Your draft and what you write here go to the AI model set for Ask. Agents don't get it yet.",
      ),
    ).toBeVisible()
    await expect(
      dock(page).getByText(
        'Writing help fills in the draft. You check each field, then send or publish it yourself.',
      ),
    ).toBeVisible()
    await sayIt(page)

    // The words are the chat's first message, the draft says what is happening with Stop, and the
    // empty fields wait for their values while the title lands first.
    await expect(dock(page).getByText(MESSAGE)).toBeVisible()
    const working = page.getByRole('region', { name: 'Writing help is working' })
    await expect(working.getByRole('button', { name: 'Stop' })).toBeVisible()
    await expect(title(page)).toHaveValue('Online sales to Norway stopped on 4 August 2026')
    await expect(page).toHaveURL(/[?&]dock=write/)
    await done(page)
    await expect(working).toHaveCount(0)

    // A whole draft, each field it wrote marked, said in the strip with Undo, and Ready.
    await expect(strip(page)).toContainText(
      'Writing help filled in 5 fields from your message. Check each one.',
    )
    await expect(page.getByRole('button', { name: 'Kind Event' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Remove Orders', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Remove Market: Norway' })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'When From 4 Aug 2026, still going on' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Source customs.example' })).toBeVisible()
    await expect(text(page)).toContainText('A new customs rule stopped all online sales to Norway')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    // Jon owns Sales: the page's own button publishes it, and the chat has no Send for the draft.
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled()

    // The reply says what it did in the first person, the fields it changed, and one question.
    await expect(dock(page).getByText('Read your message and 1 link')).toBeVisible()
    await expect(
      dock(page).getByText(
        'I wrote a draft from your message and the notice. Check each field, then publish it.',
      ),
    ).toBeVisible()
    await expect(dock(page).getByRole('list', { name: 'Fields it changed' })).toHaveText(
      ['Title', 'Text', 'Applies to', 'When', 'Source'].join(''),
    )
    await expect(
      dock(page).getByText(
        "Don't conclude is empty. Should it say: “Fewer orders in Norway after 4 August do not mean fewer customers.”?",
      ),
    ).toBeVisible()
    await expect(dontConclude(page)).toHaveText('')

    // A tap answers it: the words are the next message, and Don't conclude is written.
    await dock(page).getByRole('button', { name: 'Yes, add it' }).click()
    await expect(dontConclude(page)).toHaveText(
      'Fewer orders in Norway after 4 August do not mean fewer customers.',
    )
    await expect(dock(page).getByText("Added to Don't conclude.")).toBeVisible()
    await expect(strip(page)).toContainText("Writing help changed Don't conclude, just now.")
    await expect(box(page)).toBeFocused()
  })

  test('the person’s words win in the field they are typing in, with Writing help’s under it', async ({
    page,
  }) => {
    await turnOn(page)
    await writeContext(page)
    await sayIt(page)
    // The person goes straight to the title while it reads.
    await title(page).click()
    await page.keyboard.type('Norway webshop orders stop')
    await expect(title(page)).toBeFocused()
    await done(page)
    await expect(title(page)).toHaveValue('Norway webshop orders stop')
    await expect(box(page)).toHaveValue('')
    const suggestion = page.getByRole('group', { name: "Writing help's suggestion for Title" })
    await expect(suggestion).toContainText(
      'Writing help suggests: Online sales to Norway stopped on 4 August 2026',
    )
    await expect(
      dock(page).getByText(
        'You were typing in Title, so I left your words and put mine under it. Use it, or keep yours.',
      ),
    ).toBeVisible()
    // Title is not one of the fields it changed, and the strip counts the rest.
    await expect(dock(page).getByRole('list', { name: 'Fields it changed' })).toHaveText(
      ['Text', 'Applies to', 'When', 'Source'].join(''),
    )
    await expect(strip(page)).toContainText('Writing help filled in 4 fields from your message.')

    // Dismiss keeps the person's words; Use it would have taken Writing help's.
    await suggestion.getByRole('button', { name: 'Dismiss' }).click()
    await expect(suggestion).toHaveCount(0)
    await expect(title(page)).toHaveValue('Norway webshop orders stop')
  })

  test('Undo takes back one turn at a time, the latest first', async ({ page }) => {
    await turnOn(page)
    await writeContext(page)
    await sayIt(page)
    await done(page)
    await dock(page).getByRole('button', { name: 'Yes, add it' }).click()
    await expect(dontConclude(page)).toHaveText(
      'Fewer orders in Norway after 4 August do not mean fewer customers.',
    )
    await done(page)

    // The strip's Undo takes back the latest turn only: Don't conclude.
    await strip(page).getByRole('button', { name: 'Undo' }).click()
    await expect(dontConclude(page)).toHaveText('')
    await expect(title(page)).toHaveValue('Online sales to Norway stopped on 4 August 2026')
    await expect(dock(page).getByText('Undone')).toHaveCount(1)
    await expect(strip(page)).toContainText(
      'Writing help filled in 5 fields from your message. Check each one.',
    )

    // Again: the turn before, the whole first fill, from the reply's own Undo.
    await dock(page).getByRole('button', { name: 'Undo' }).click()
    await expect(dock(page).getByText('Undone')).toHaveCount(2)
    await expect(strip(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Remove Orders', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Source customs.example' })).toHaveCount(0)
    await expect(text(page)).not.toContainText('customs rule')
    await expect(page.getByText(/^Not ready/)).toBeVisible()
    await expect(box(page)).toBeFocused()
  })

  test('Ask hands over what it found: Write context and Update it open the dock with it', async ({
    page,
  }) => {
    await turnOn(page)
    // Closed on a new item, the dock stays closed for the next one...
    await page.getByRole('link', { name: 'Context', exact: true }).click()
    await page.getByRole('button', { name: 'Write context' }).first().click()
    await dock(page).getByRole('button', { name: 'Close the panel' }).click()
    await expect(dock(page)).toBeHidden()

    // ...but Ask asked the person to say what happened, so its Write context opens it.
    await go(page, '/ask?example=loop-missing')
    await page.getByRole('button', { name: 'Write context for Orders in Poland' }).click()
    await expect(page).toHaveURL(/\/context\/new\?from=ask&.*dock=write/)
    await expect(
      dock(page).getByText('From Ask: nothing is published about Orders in Poland yet.'),
    ).toBeVisible()
    await expect(dock(page).getByText('Say what happened there.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Remove Orders', exact: true })).toBeVisible()
    await expect(box(page)).toBeFocused()

    // An Outdated answer's item opens in its editor, asking what changed since it was checked.
    await go(page, '/ask?example=loop-stale')
    await page.getByRole('link', { name: /^Update it: / }).click()
    await expect(page).toHaveURL(/\/context\/[^/]+\/edit\?from=ask&dock=write$/)
    await expect(
      dock(page).getByText(/^From Ask: this item was last checked on \d+ \w+ 2026\.$/),
    ).toBeVisible()
    await expect(dock(page).getByText('What changed since then?')).toBeVisible()
  })
})
