import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { expect, test, type Browser, type Page, type Request } from '@playwright/test'
import {
  legacyManifest,
  withMetric,
  type Manifest,
} from '../server/connectors/dbt-metricflow-fixture.ts'
import { objectHost, type ObjectHost } from '../server/connectors/object-server.ts'

/*
  What a stranger does with their own semantic manifest (playwright.own-data.config.ts): on an empty
  database, with no demo, connect an invented dbt project through the app, accept the names its
  read made, write a context item about a past day for one of its metrics, publish it, and get
  Checked from get_context and from the question the setup writes in Ask. Every step is the real service on real PostgreSQL; nothing here
  starts from seeded names, which is how this path broke once with every test green. Nobody is
  seeded either: the first visitor says who they are and becomes the admin.
*/

// The second journey goes on from the first one's names, domain and access key: when the first
// fails, the second is not run, rather than failing on what the first never made.
test.describe.configure({ mode: 'serial' })

const mcp = `http://localhost:${process.env.PW_OWN_API_PORT ?? 3121}/mcp`

/**
 * The invented shop's project, with a second metric people call Revenue, and a customer's region,
 * status and tier in a second semantic model, of its stores, and the region in its orders too:
 * names to look at. One title in several semantic models is one dimension a project uses
 * everywhere, and each copy waits in "Look at these first".
 */
function ownManifest(): Manifest {
  const file = structuredClone(legacyManifest)
  const revenue = file.metrics.find((metric) => metric.name === 'revenue')!
  file.metrics.push({ ...structuredClone(revenue), name: 'shop_revenue', label: 'Revenue' })
  const model = (name: string) => file.semantic_models.find((entry) => entry.name === name)!
  file.semantic_models.push({
    ...structuredClone(model('customers')),
    name: 'stores',
    measures: [],
  })
  const region = model('customers').dimensions.find((dimension) => dimension.name === 'region')!
  model('orders').dimensions.push(structuredClone(region))
  // A metric titled as Cube titles one with no title of its own: "Mrr".
  const orders = file.metrics.find((metric) => metric.name === 'orders')!
  file.metrics.push({ ...structuredClone(orders), name: 'mrr', label: 'Mrr' })
  return file
}

let store: ObjectHost
test.beforeAll(async () => {
  store = await objectHost()
  store.put('/link/semantic_manifest.json', JSON.stringify(ownManifest()))
})
test.afterAll(() => store.close())

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

/**
 * Words of the demo's invented shop (db/seed): its markets, its company and its own products and
 * events. An install on its own data has none of them, so no screen of it may say one, in its
 * text or in a box's example.
 */
const DEMO_WORDS = [
  'Norway',
  'Spain',
  'Poland',
  'Germany',
  'Sweden',
  'France',
  'Italy',
  'Netherlands',
  'United Kingdom',
  'Mexico',
  'Canada',
  'Larchwood',
  'Footwear',
  'Camping',
  'customs',
  'gift card',
]

/** The demo's words the page says now: its text, and each box's placeholder, label and title. */
async function demoWords(page: Page) {
  return page.evaluate((words) => {
    const said = [
      document.body.innerText,
      ...[
        ...document.querySelectorAll('[placeholder], [data-placeholder], [aria-label], [title]'),
      ].flatMap((el) =>
        ['placeholder', 'data-placeholder', 'aria-label', 'title'].map(
          (a) => el.getAttribute(a) ?? '',
        ),
      ),
    ].join('\n')
    return words.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(said))
  }, DEMO_WORDS)
}

/** A write to the service as the signed-in person, as the app makes it. */
async function post(page: Page, path: string, data: object, method: 'POST' | 'PUT' = 'POST') {
  const { csrfToken } = (await (await page.request.get('/api/v1/auth/session')).json()) as {
    csrfToken: string
  }
  const answer = await page.request.fetch(`/api/v1${path}`, {
    method,
    headers: {
      'x-footnote-csrf': csrfToken,
      'idempotency-key': randomUUID(),
      origin: new URL(page.url()).origin,
    },
    data,
  })
  expect(answer.ok(), await answer.text()).toBe(true)
  return answer.json() as Promise<Record<string, unknown>>
}

/** The access key the first journey made, which the next one's agent uses too. */
let agentKey = ''

/** get_context as an agent calls it: over MCP, with an access key. */
async function getContext(page: Page, key: string, args: object) {
  const answer = await page.request.post(mcp, {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json, text/event-stream' },
    data: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_context', arguments: args },
    },
  })
  const body = await answer.text()
  expect(answer.ok(), body).toBe(true)
  const json = body.startsWith('{') ? body : /^data: (.*)$/m.exec(body)![1]!
  const { result } = JSON.parse(json) as {
    result?: { structuredContent: Record<string, unknown> }
  }
  expect(result, body).toBeDefined()
  return result!.structuredContent
}

test('from an own semantic manifest to a Checked answer', async ({ page }) => {
  const shot = (name: string) =>
    process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${name}.png` }) : null
  // Asked this week has nothing to say before anything is shared with agents: it says so in its
  // answer, so no page of a new install logs a failed request for it.
  const refused: string[] = []
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/ask/asked') && !response.ok())
      refused.push(`${response.status()} ${response.url()}`)
  })
  await page.goto('/')
  // Not the demo, and nobody in it yet: the first screen asks who you are, with no sample people
  // to pick and nothing that says the company is invented. The install's label says which install
  // this is, there and in the header after.
  const label = page.locator('[data-profile-label]')
  await expect(page.getByRole('heading', { name: 'Set up Footnote' })).toBeVisible()
  await expect(page.getByText(/invented company|This is a demo|Pick who you are/)).toHaveCount(0)
  await expect(label).toContainText('Own data trial')
  // Start with nothing typed says what each field needs, at the field.
  await button(page, 'Start').click()
  await expect(page.getByText('Add your name.')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Your name' })).toBeFocused()
  await page.getByRole('textbox', { name: 'Your name' }).fill('Amara Osei')
  await page.getByRole('textbox', { name: 'Your email' }).fill('amara@tallyfield')
  await page.getByRole('textbox', { name: 'Workspace name' }).fill('Tallyfield')
  await button(page, 'Start').click()
  await expect(page.getByText('That is not an email address.')).toBeVisible()
  await page.getByRole('textbox', { name: 'Your email' }).fill('Amara@Tallyfield.example')
  await shot('05-first-screen')
  await button(page, 'Start').click()
  await expect(page).toHaveURL(/\/inbox$/)
  await expect(page.locator('header').locator(label)).toContainText('Own data trial')
  // Amara is the admin, by the address she gave, and the workspace has the name she gave it.
  const me = (await (await page.request.get('/api/v1/auth/session')).json()) as {
    person: { name: string; permissions: { roles: string[] } }
  }
  expect(me.person).toMatchObject({
    name: 'Amara Osei',
    permissions: { roles: ['administrator'] },
  })
  expect(
    ((await (await page.request.get('/api/v1/workspace')).json()) as { name: string }).name,
  ).toBe('Tallyfield')
  // On a phone the label gives way before the page's title, which is never cut to a letter.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/definitions')
  const title = page.locator('header h1')
  await expect(title).toHaveText('Definitions')
  expect(
    await title.evaluate((h1) => {
      const words = h1.lastElementChild as HTMLElement
      return words.scrollWidth <= words.clientWidth + 1
    }),
  ).toBe(true)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/inbox')

  // The checklist, ask first: the names, a question, then writing and the same question again.
  await expect(page.getByText('0 of 4 done')).toBeVisible()
  await expect(page.getByText(/^Until there is context, agents hear/)).toBeVisible()
  expect(await demoWords(page), 'the Inbox').toEqual([])
  await shot('10-setup')
  const steps = page.getByRole('main').getByRole('listitem')
  await expect(steps.nth(0)).toContainText('Publish your names')
  await expect(steps.nth(1)).toContainText('Ask about a number you know')
  await expect(steps.nth(2)).toContainText('Write what you know, and ask again')
  // No domain yet: the first is made with the names.
  await expect(
    page.getByText(/Context goes to the domain your names are published under\./),
  ).toBeVisible()

  // Out of order, as a new owner may go: New context before any domain exists. The Domain field
  // says there is none yet and leads to adding one. Moved to
  // inside the app, as its own links do: each load reads every shared read again, and a person
  // may make 600 calls a minute.
  await moveTo(page, '/context/new')
  await expect(page.getByRole('textbox', { name: 'Title' })).toBeVisible()
  await page.getByRole('button', { name: /^Domain/ }).click()
  const noDomain = page.getByRole('dialog', { name: 'Domain' })
  await expect(noDomain.getByText('No domain yet')).toBeVisible()
  await expect(noDomain.getByRole('link', { name: 'Add a domain' })).toHaveAttribute(
    'href',
    '/settings/domains/new',
  )
  await shot('10-no-domain-yet')
  await page.keyboard.press('Escape')
  await moveTo(page, '/inbox')

  // Connect dbt from the checklist: the fixture's file at an address, through all five steps.
  await button(page, 'Connect').click()
  await page.goto('/settings/integrations/dbt-metricflow/connect?setup=1&step=2')
  // An address on this computer where nothing answers: the browser's own localhost is not the
  // server's, and the result says so in place of "check that the host is up". What was typed is
  // masked, and can be shown to look for a mistake.
  const address = page.getByLabel('File address')
  await address.fill('http://localhost:1/target/semantic_manifest.json')
  await expect(address).toHaveAttribute('type', 'password')
  await button(page, 'Show what you typed').click()
  await expect(address).toHaveAttribute('type', 'text')
  await expect(address).toHaveValue('http://localhost:1/target/semantic_manifest.json')
  await button(page, 'Test connection').click()
  await expect(page.getByText("It couldn't be read: it couldn't be reached.")).toBeVisible({
    timeout: 30_000,
  })
  await expect(
    page.getByText(
      'This address is on the server itself, which may not be your computer. For a file on your computer, share its folder with the server instead. If the server runs on your computer, try 127.0.0.1 in place of localhost.',
    ),
  ).toBeVisible()
  await shot('11-address-on-the-server')
  await address.fill(store.link('/link/semantic_manifest.json'))
  await button(page, 'Test connection').click()
  await expect(page.getByText('A read would hold 14 metrics and 12 dimensions.')).toBeVisible({
    timeout: 30_000,
  })
  await button(page, 'Continue').click()
  await button(page, 'Continue').click()
  await button(page, 'Continue').click()
  await button(page, 'Add dbt').click()
  await expect(page).toHaveURL(/\/inbox$/)

  // The read ends by itself, and its names wait for one press, under the domain the project names
  // for its orders (F08), which this workspace does not have yet.
  const waiting = page.getByRole('button', { name: /^Publish \d+ names$/ })
  await expect(waiting).toBeVisible({ timeout: 45_000 })
  await expect(steps.nth(0)).toContainText('They go under Sales, a new domain you own.')
  await shot('11-names-waiting')
  await waiting.click()
  const review = page.getByRole('dialog')
  // Every ready name is a box, to rename before it is published; a short form is in capitals.
  const ready = review.getByRole('region', { name: /^Ready to publish/ })
  await expect(ready.getByRole('textbox', { name: /net_revenue$/ })).toHaveValue('Net revenue')
  await expect(ready.getByRole('textbox', { name: /mrr$/ })).toHaveValue('MRR')
  await expect(review.getByRole('textbox', { name: 'Domain' })).toHaveValue('Sales')
  await expect(review.getByText('A new domain, owned by you.')).toBeVisible()
  await shot('12-names-review')
  // Two definitions are called Revenue, and three semantic models have a Region: none is picked,
  // and Publish all leaves them all for a look.
  const flagged = review.getByRole('region', { name: 'Look at these first' })
  await expect(flagged.getByRole('listitem')).toHaveCount(9)
  await expect(flagged.getByRole('listitem').first()).toContainText(
    'Another definition is called “Revenue”',
  )
  await expect(flagged).toContainText('2 others are called “Region”')
  // Focus starts on Publish all, so the Enter it shows publishes every ready name, each with the
  // name it was given.
  await expect(review.getByRole('button', { name: /^Publish all/ })).toBeFocused()
  await ready.getByRole('textbox', { name: /weekly_ordering_customers$/ }).fill('Weekly buyers')
  await review.getByRole('button', { name: /^Publish all/ }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText(/^\d+ names are published under Sales$/)).toBeVisible()
  await expect(page.getByText('1 of 4 done')).toBeVisible()
  await expect(review.getByRole('button', { name: /^Publish all/ })).toBeHidden()
  await shot('12-names-flagged')
  // The owner gives one Revenue a word of its own, and the other has nothing against it any more.
  // One name's Publish reads again only what a name changes: the service allows a person 600
  // calls a minute, and an owner clicks through many names.
  const calls: string[] = []
  const onRequest = (request: Request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/v1/')) calls.push(`${request.method()} ${url.pathname}`)
  }
  const second = flagged.getByRole('listitem').nth(1)
  await second.getByRole('textbox').fill('Shop revenue')
  // Over the request limit, the service's words say so once, and the name is not marked wrong.
  await page.route(
    '**/api/v1/inbox/names/decide',
    (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        headers: { 'retry-after': '20' },
        body: JSON.stringify({
          defined: false,
          code: 'TOO_MANY_REQUESTS',
          status: 429,
          message: 'That was a lot at once. Try again in 20 seconds.',
          data: { retryAfterSeconds: 20 },
        }),
      }),
    { times: 1 },
  )
  await second.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByText('That was a lot at once. Try again in 20 seconds.')).toBeVisible()
  await expect(second.getByRole('textbox')).not.toHaveAttribute('aria-invalid')
  await expect(second.getByRole('alert')).toHaveCount(0)
  page.on('request', onRequest)
  await second.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByText('Shop revenue is published')).toBeVisible()
  await page.waitForLoadState('networkidle')
  page.off('request', onRequest)
  // The decision, and the Inbox's own read for the card's count: 4 calls, where every cache read
  // again was 28, so a click every 3 s for a minute reached the limit.
  expect(
    calls.filter((call) => call.startsWith('POST ')),
    calls.join('\n'),
  ).toHaveLength(1)
  expect(calls.length, calls.join('\n')).toBeLessThanOrEqual(4)
  await expect(flagged.getByRole('listitem')).toHaveCount(7)
  await review.getByRole('button', { name: /^Publish all/ }).click()
  // The region, status and tier each semantic model has go out with the names shown, at one press.
  await expect(flagged.getByRole('listitem')).toHaveCount(7)
  await shot('12-names-as-suggested')
  await button(page, 'Publish these as suggested').click()
  await expect(page.getByText('7 names are published as suggested')).toBeVisible()
  await expect(review).toBeHidden()
  await expect(page.getByRole('button', { name: /^Publish \d+ names?$/ })).toBeHidden()

  // The vocabulary is live: Definitions lists the metric, and it has its domain; the renamed one
  // under its new name, and the short form in capitals.
  await page.goto('/definitions')
  await expect(page.getByRole('row', { name: /^Select Net revenue/ })).toBeVisible()
  await expect(page.getByRole('row', { name: /^Select Weekly buyers/ })).toBeVisible()
  await expect(page.getByRole('row', { name: /^Select MRR\b/ })).toBeVisible()
  await shot('13-definitions')

  // Nothing written yet: Context and Ask say what to write and to ask without the demo's words.
  await page.goto('/context')
  await expect(page.getByText('No context yet')).toBeVisible()
  expect(await demoWords(page), 'Context').toEqual([])
  await page.goto('/ask')
  await expect(page.getByRole('textbox', { name: 'Ask a question' })).toBeVisible()
  expect(await demoWords(page), 'Ask').toEqual([])
  // No model is connected, and whoever hosts the app connects one: on a trial that is this
  // admin, so the line leads to how.
  await expect(page.getByText(/^No AI model is connected/)).toBeVisible()
  expect(refused, 'Asked this week before anything is shared').toEqual([])
  await expect(page.getByRole('link', { name: /^How to connect a model/ })).toHaveAttribute(
    'href',
    /\/docs\/model-providers\/$/,
  )

  // A context item that applies to the synced metric, published in one step by its owner.
  await page.goto('/context/new')
  await expect(page.getByRole('textbox', { name: 'Title' })).toBeVisible()
  expect(await demoWords(page), 'the editor').toEqual([])
  await page.getByRole('textbox', { name: 'Title' }).fill('Checkout was down for a day')
  await page.getByRole('textbox', { name: 'What agents should know' }).click()
  await page.keyboard.insertText(
    'Nobody could pay at the checkout for most of the day. Net revenue reads low for it because of that, not because fewer people came.',
  )
  // The text gives a cause, and agents pass it on as the writer's: Don't conclude says so.
  await expect(
    page.getByText('Your text gives a cause (“because”), and agents pass it on as yours.', {
      exact: false,
    }),
  ).toBeVisible()
  await page.getByRole('button', { name: /^Applies to/ }).click()
  await page.getByRole('combobox', { name: 'Search Applies to' }).fill('Net revenue')
  await page
    .getByRole('listbox', { name: 'Applies to' })
    .getByRole('option', { name: /^Net revenue/ })
    .first()
    .click()
  await page.keyboard.press('Escape')
  // An event is dated by the writer: no day is picked for them. Most first items are about a day
  // that has passed, so this one is a day of last month.
  const when = page.getByRole('button', { name: /^When/ })
  await when.click()
  await page.getByRole('radio', { name: 'A single day' }).click()
  await page.getByRole('button', { name: 'Go to the Previous Month' }).click()
  await page
    .getByRole('grid')
    .getByRole('button', { name: /^[A-Z][a-z]+day, 9 / })
    .click()
  await page.getByRole('button', { name: 'Done' }).click()
  const day = /\b9 [A-Z][a-z]{2,3} 20\d\d\b/.exec((await when.innerText()) ?? '')?.[0]
  expect(day, 'the day the When says').toBeTruthy()
  // What happened is written nowhere a link opens: the source is who says so, with no link.
  await page.getByRole('button', { name: /Add a source/ }).click()
  await page.getByRole('radio', { name: 'No link' }).click()
  await expect(page.getByRole('textbox', { name: 'Who or what says so' })).toBeFocused()
  await page.keyboard.insertText('Payments team, in the incident call')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: /^Source/ })).toContainText(
    'Payments team, in the incident call',
  )
  await shot('14-editor')
  await button(page, 'Publish').click()
  await expect(page.getByText(/^Published just now by you/)).toBeVisible()
  // Published as the draft it kept itself as, with nothing saved to that draft after it.
  await expect(page.getByText('Agents get it from the next question.').first()).toBeVisible()
  await expect(page.getByText("Couldn't save your draft")).toHaveCount(0)
  // Its page says who says so, and that there is no link to open.
  await expect(page.getByText('Payments team, in the incident call').first()).toBeVisible()
  await expect(page.getByText(/ - no link$/).first()).toBeVisible()
  await shot('14-item-no-link')

  // Written and not asked again: the step asks it, with the question already written, about the
  // item's own day, which has passed, so the answer is the item, not Not found for today.
  await page.goto('/inbox')
  await expect(page.getByText('1 of 4 done')).toBeVisible()
  await button(page, 'Ask again').click()
  await expect(page).toHaveURL(/\/ask\?/)
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  const question = `What should I know about Net revenue on ${day}?`
  await expect(box).toHaveText(question)

  // The owner presses Enter.
  await box.press('Enter')
  await expect(page.getByRole('log').getByText('Checked', { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole('log')).toContainText('Checkout was down for a day')
  // With no model the answer lists what is written, each item whole: its second sentence, the
  // reason, is there too.
  await expect(page.getByRole('log')).toContainText(
    'Nobody could pay at the checkout for most of the day. Net revenue reads low for it because of that, not because fewer people came.',
  )
  await shot('15-ask')

  // Asked again, setup is at 3 of 4, one step left: the agent. Two more items rely on Net revenue,
  // and then its calculation changes in dbt: the Inbox shows the three Needs a recheck above the
  // checklist, without waiting for the last step.
  const read = async <T>(path: string) => (await page.request.get(`/api/v1${path}`)).json() as T
  const metric = (await read<{ metrics: { id: string; name: string }[] }>('/vocabulary')).metrics
  // The vocabulary names a metric by its key without its kind: a draft's scope says the kind.
  const netRevenue = `metric:${metric.find((m) => m.name === 'Net revenue')!.id.replace(/^metric:/, '')}`
  const sales = (await read<{ id: string; name: string }[]>('/areas')).find(
    (area) => area.name === 'Sales',
  )!.id
  for (let n = 1; n <= 2; n++)
    await post(page, '/items/publish', {
      draft: {
        areaId: sales,
        title: `Net revenue note ${n}`,
        summary: `Net revenue note ${n} for the finance team.`,
        scope: { metrics: [netRevenue], dimensions: [], dimensionValues: [] },
        validity: { start: '2026-01-01', end: null },
        evidence: [
          { url: `https://finance.example/note-${n}`, quote: 'Noted.', date: '2026-01-01' },
        ],
      },
    })
  store.put(
    '/link/semantic_manifest.json',
    JSON.stringify(
      withMetric(ownManifest(), 'net_revenue', (m) => {
        m.type_params.expr = 'revenue - discounts - 0'
      }),
    ),
  )
  const [source] = await read<{ id: string; type: string }[]>('/sources').then((all) =>
    all.filter((s) => s.type === 'dbt-metricflow'),
  )
  await post(page, `/sources/${source!.id}/read`, {})
  await page.goto('/inbox')
  await expect(page.getByText('3 of 4 done')).toBeVisible()
  const due = page.getByRole('region', { name: 'Needs you' })
  // Each try waits for the Inbox to draw before it looks: on a loaded machine a reload takes
  // longer than the look, and every try then reloaded before the row could show.
  await expect(async () => {
    await page.reload()
    await expect(page.getByText('3 of 4 done')).toBeVisible({ timeout: 20_000 })
    await expect(due.getByRole('link', { name: /^Needs a recheck 3 in all domains/ })).toBeVisible({
      timeout: 3_000,
    })
  }).toPass({ timeout: 90_000 })
  // Above the checklist, which is two screens long on a phone; and with context written, the
  // checklist no longer says agents hear that nothing is written down.
  const checklist = page.getByText('Set up your workspace so agents can use what you know')
  const [dueAt, checklistAt] = await Promise.all([due.boundingBox(), checklist.boundingBox()])
  expect(dueAt!.y).toBeLessThan(checklistAt!.y)
  await expect(page.getByText(/^Until there is context/)).toHaveCount(0)
  await shot('16-setup-due')
  await due.getByRole('link').click()
  await expect(page).toHaveURL(/\/context\?status=due$/)

  // Last, an agent asks the same over MCP, as a key that names nobody: it gets the item, needing
  // a recheck now that its definition changed, and the agent's step ends the setup.
  const { key } = await post(page, '/access-keys', { name: 'Own data journey' })
  agentKey = key as string
  const reply = await getContext(page, key as string, { question })
  expect(reply).toMatchObject({ status: 'stale' })
  expect(JSON.stringify(reply)).toContain('Checkout was down for a day')
  // Its source has no link, and the agent is told so: there is nothing to open.
  expect(JSON.stringify(reply)).toContain(
    '"source":{"url":null,"said_by":"Payments team, in the incident call","note":"No link to open: said_by is who or what says so."}',
  )
  await page.goto('/inbox')
  await expect(page.getByText(/ of 4 done$/)).toHaveCount(0)

  // After the checklist, the Inbox keeps a Next card until five items are published: three are.
  const next = page.getByRole('region', { name: 'Next: write down what agents will ask about' })
  await expect(next).toContainText('3 of 5 published')
  await expect(next.getByRole('listitem')).toHaveCount(5)
  await expect(next.getByRole('listitem').last()).toContainText('Connect your documents')
  await shot('16-next-card')
  // The agent asks once about a metric nothing is written about. With one person signed in, the
  // question shows at once, as a Nothing written yet card, and leads the Next card.
  const unanswered = await getContext(page, key as string, {
    question: 'How many orders did we have last month?',
    metrics: ['Orders'],
  })
  expect(unanswered).toMatchObject({ status: 'no_match' })
  await page.reload()
  await expect(
    page.getByRole('main').getByText('Nothing written yet', { exact: true }).first(),
  ).toBeVisible()
  await expect(next.getByRole('listitem').first()).toContainText('Write about Orders')
  await expect(next.getByRole('listitem').first()).toContainText(
    'Agents asked about it and found nothing written down.',
  )
  await expect(page.getByText('Agents asked nothing this week.')).toHaveCount(0)
  await shot('16-first-question')
  await next.getByRole('button', { name: 'Write context' }).first().click()
  await expect(page).toHaveURL(/\/context\/new\?metric=Orders$/)
  await moveTo(page, '/inbox')

  // Nobody has signed an agent in: the access key is no sign-in, so the line still says so.
  await moveTo(page, '/settings/agents')
  await expect(page.getByRole('status').filter({ hasText: 'Not connected yet' })).toBeVisible()
  await expect(page.getByText('1 access key.')).toBeVisible()

  // People pick who they are here, and nobody invited is on that list: Invite people says so
  // before a link is sent, and so does the toast with the link.
  await moveTo(page, '/settings/people')
  await button(page, 'Invite people').click()
  const invite = page.getByRole('dialog', { name: 'Invite people' })
  await expect(invite.getByRole('note')).toContainText(
    'People sign in here by picking who they are from a list, and someone you invite is not on it. An invite lets them in once company sign-in is set up.',
  )
  await expect(
    invite.getByRole('link', { name: /^How to set up company sign-in/ }),
  ).toHaveAttribute('href', /\/docs\/company-sign-in\/$/)
  await shot('17-invite')
  await invite.getByLabel('Email addresses').fill('kim@tallyfield.example')
  await invite.getByRole('button', { name: 'Invite', exact: true }).click()
  await expect(
    page.getByText('The link lets them in once company sign-in is set up. It works for 7 days.'),
  ).toBeVisible()

  // About our business: Start from the guide puts the shape of the text there, never another
  // company's words, and saves nothing.
  await moveTo(page, '/settings/general')
  await button(page, 'Start from the guide').click()
  const about = page.getByRole('textbox', { name: 'About our business' })
  await expect(about).toHaveText('We sell [what] to [whom], in [where], through [which channels].')
  expect(await demoWords(page), 'the guide').toEqual([])
  await expect(page.getByText('Not saved yet', { exact: true })).toBeVisible()
  const guide = page.getByRole('group', { name: 'Guide' })
  await expect(guide.getByRole('button', { name: 'Keep it' })).toBeDisabled()
  await shot('18-guide')
  await guide.getByRole('button', { name: 'Discard' }).click()
  await expect(about).toHaveText('')

  // Colleagues come in by company sign-in on a real install. Here the host puts three in the
  // workspace, and the picker offers the workspace's people from then on, none of them a sample.
  await colleagues(['Jon Abara', 'Maria Lindqvist', 'Sofia Brandt'])
  // Jon owns Sales with Amara: the next journey is his. Sofia owns it too, for the third, whose
  // calls must not count against the minute Amara's just made.
  const people = await read<{ id: string; name: string }[]>('/people')
  const idOf = (name: string) => people.find((p) => p.name === name)!.id
  await post(
    page,
    `/areas/${sales}/owners`,
    { personIds: [idOf('Amara Osei'), idOf('Jon Abara'), idOf('Sofia Brandt')] },
    'PUT',
  )
})

/**
 * Moves to another address inside the app, as a link does, without loading it again: a load reads
 * every shared read again, and one person may make 600 calls a minute.
 */
const moveTo = async (page: Page, route: string) => {
  await page.evaluate((to) => {
    const link = Object.assign(document.createElement('a'), { href: to })
    document.body.append(link)
    link.click()
    link.remove()
  }, route)
  await expect(page).toHaveURL((url) => url.pathname === new URL(route, url).pathname)
}

/**
 * People put in the workspace by its host, as members: the service's own function, as a list of
 * people the host gives makes them.
 */
async function colleagues(names: string[]) {
  const client = new pg.Client({
    connectionString:
      process.env.E2E_DATABASE_URL ??
      'postgres://context_layer_api@localhost:5432/context_layer_dev',
  })
  await client.connect()
  try {
    for (const name of names)
      await client.query("select auth.bootstrap_person($1, $2, '{}'::global_role[])", [
        `${name.split(' ')[0]!.toLowerCase()}@tallyfield.example`,
        name,
      ])
  } finally {
    await client.end()
  }
}

/** A new page signed in as someone in the workspace, by name. */
async function signedInAs(browser: Browser, name: string) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' })
  await page.goto('/')
  // The picker is ready once it says so: a click before that lands on nothing.
  await expect(page.getByText('Pick who you are.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: new RegExp(name) }).click()
  // The app opens on the Inbox while something waits there, and on Ask when nothing does.
  await expect(page).toHaveURL(/\/(inbox|ask)$/, { timeout: 30_000 })
  return page
}

/*
  The values of a dimension on the same install, which has none (values without figures): an
  agent's filter on a channel is read for every channel and says so; Jon, an owner of Sales, whose
  Channel is, adds a value in Definitions and another where he writes, each published at once; a
  contributor's pasted values and her item's new value wait for him, on the Names card and in the
  review. It follows the journey above, on its names, its Sales domain and its access key, with
  setup done: until then the Inbox holds the checklist and its cards wait.
*/
test('values people write, on an install that has none', async ({ browser }) => {
  const page = await signedInAs(browser, 'Jon Abara')
  const shot = (name: string, on: Page = page) =>
    process.env.SHOTS ? on.screenshot({ path: `${process.env.SHOTS}/${name}.png` }) : null
  const window = { from: '2026-01-01', to: '2026-12-31' }
  const asked = (values: string[]) => ({
    question: 'Why did net revenue drop?',
    metrics: ['Net revenue'],
    dimension_filters: [{ dimension: 'Channel', values }],
    window,
  })
  // No value of Channel is kept, so an agent's filter on one is read for every channel, and said.
  const key = agentKey
  const unkept = await getContext(page, key, asked(['Partner']))
  expect(unkept.status).not.toBe('need_more_detail')
  expect(unkept.say).toContain(
    "No values of Channel are kept yet, so this was read for every channel, not only 'Partner'.",
  )

  // Channel's page says it has none, and Jon, an owner of its domain, adds one, published at once.
  await moveTo(page, '/definitions/Channel')
  const values = page.getByRole('region', { name: /^Values/ })
  await expect(values.getByText(/^No values yet/)).toBeVisible()
  expect(await demoWords(page), 'a dimension with no values').toEqual([])
  await values.getByRole('button', { name: 'Add a value' }).click()
  await values.getByRole('textbox', { name: 'Name', exact: true }).fill('Partner')
  await values.getByRole('textbox', { name: 'Other names' }).fill('Partners')
  await values.getByRole('textbox', { name: 'How the data writes it' }).fill('PTR')
  await values.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByText('Partner is published')).toBeVisible()
  await expect(values.getByRole('listitem')).toHaveText([
    'Partneralso Partners · the data writes PTR',
  ])
  await shot('20-values-added')

  // Where an item is written: a channel nobody added yet, added in Applies to.
  await moveTo(page, '/context/new')
  await expect(page.getByRole('textbox', { name: 'Title' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Title' }).fill('Direct sales paused for a week')
  await page.getByRole('textbox', { name: 'What agents should know' }).click()
  await page.keyboard.insertText('Direct sales were paused for a week, so Net revenue reads low.')
  await page.getByRole('button', { name: /^Applies to/ }).click()
  const search = page.getByRole('combobox', { name: 'Search Applies to' })
  const list = page.getByRole('listbox', { name: 'Applies to' })
  await search.fill('Net revenue')
  await list
    .getByRole('option', { name: /^Net revenue/ })
    .first()
    .click()
  await search.fill('Direct')
  await expect(list.getByText('Nothing called “Direct”. Add it as a value of')).toBeVisible()
  expect(await demoWords(page), 'the picker adding a value').toEqual([])
  await shot('21-picker-add')
  await list.getByRole('option', { name: 'Add Direct as a value of Channel' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByTitle('Channel: Direct (new value)')).toBeVisible()
  await page.getByRole('button', { name: /^When/ }).click()
  await page.getByRole('radio', { name: 'A single day' }).click()
  await page.getByRole('button', { name: 'Go to the Previous Month' }).click()
  await page
    .getByRole('grid')
    .getByRole('button', { name: /^[A-Z][a-z]+day, 12 / })
    .click()
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: /Add a source/ }).click()
  await page.locator('#fact-source').fill('https://finance.example/direct-pause')
  await page.locator('#fact-quote').fill('Direct sales were paused for the week.')
  await page.keyboard.press('Escape')
  await button(page, 'Publish').click()
  await expect(page.getByText(/^Published just now by you/)).toBeVisible()
  // The value went live with the item, and an agent's filter on it gets the item.
  await moveTo(page, '/definitions/Channel')
  await expect(values.getByRole('listitem')).toHaveCount(2)
  await expect(values).toContainText('Direct')
  const scoped = await getContext(page, key, asked(['Direct']))
  expect(JSON.stringify(scoped)).toContain('Direct sales paused for a week')
  expect(scoped.say).not.toContain('No values of Channel')

  // A contributor's pasted values wait for the admin, on the Names card.
  const maria = await signedInAs(browser, 'Maria Lindqvist')
  await moveTo(maria, '/definitions/Channel')
  const hers = maria.getByRole('region', { name: /^Values/ })
  await hers.getByRole('button', { name: 'Paste a list' }).click()
  await hers.getByRole('textbox', { name: 'Values, one per line' }).fill('Wholesale\nRetail, Shops')
  await hers.getByRole('button', { name: 'Suggest 2 values' }).click()
  await expect(maria.getByText('2 values wait for an owner of Sales')).toBeVisible()
  await expect(hers.getByRole('listitem')).toHaveCount(2)
  // She writes an item about a channel nobody added yet: it goes to the owners with its value.
  const read = async <T>(path: string) =>
    (await maria.request.get(`/api/v1${path}`)).json() as Promise<T>
  const vocabulary = await read<{
    metrics: { id: string; name: string }[]
    dimensions: { id: string; name: string }[]
  }>('/vocabulary')
  // A metric nothing is written about yet, so her item overlaps none.
  const shopRevenue = vocabulary.metrics.find((m) => m.name === 'Shop revenue')!.id
  const channel = vocabulary.dimensions.find((d) => d.name === 'Channel')!.id
  const sales = (await read<{ id: string; name: string }[]>('/areas')).find(
    (area) => area.name === 'Sales',
  )!.id
  const online = `val:${channel}/online`
  const sent = await post(maria, '/items/publish', {
    draft: {
      areaId: sales,
      kind: 'event',
      title: 'Online orders doubled in the spring sale',
      summary: 'Online orders doubled during the spring sale, so Shop revenue reads high.',
      scope: {
        metrics: [`metric:${shopRevenue.replace(/^metric:/, '')}`],
        dimensions: [],
        dimensionValues: [{ dimension: `dim:${channel}`, value: online }],
      },
      validity: { start: '2026-03-01', end: '2026-04-01' },
      evidence: [
        { url: 'https://finance.example/spring', quote: 'Online doubled.', date: '2026-04-02' },
      ],
    },
    newValues: [{ key: online, name: 'Online' }],
  })
  expect(sent.published).toBe(false)
  await maria.close()

  // Jon reads it with its new value, and publishing it publishes both.
  // Loaded again: what Maria sent in her own browser is news to this one.
  await page.goto(`/inbox?card=${sent.proposalId as string}`)
  // The agent first asked today. The week counts the 7 full days before it, which are empty, and
  // the Inbox says agents asked today, never that they asked nothing this week.
  await expect(page.getByText('Agents asked today, for the first time this week.')).toBeVisible()
  await expect(page.getByText('Agents asked nothing this week.')).toHaveCount(0)
  await expect(
    page.getByText('New value: Online (Channel). Publishing it publishes the value too.'),
  ).toBeVisible()
  await shot('22-new-value-quick-view')
  await button(page, 'Review').click()
  await expect(page.getByText('New value: Online (Channel).', { exact: false })).toBeVisible()
  await shot('23-new-value-review')
  await page.locator('#decision').getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: /^Published “/ }),
  ).toBeVisible()

  await moveTo(page, '/inbox?card=names:waiting')
  const pane = page.getByRole('region', { name: /^Values people added/ })
  await expect(pane.getByRole('listitem')).toHaveCount(2)
  await expect(pane).toContainText('added by Maria Lindqvist')
  expect(await demoWords(page), 'the Names card with values').toEqual([])
  await shot('24-names-card-values')
  await pane.getByRole('button', { name: 'Publish 2 values' }).click()
  await expect(page.getByText('2 values are published')).toBeVisible()
  await moveTo(page, '/definitions/Channel')
  await expect(values.getByRole('listitem')).toHaveCount(5)
  await expect(values).toContainText('Online')
  await expect(values).toContainText('Retailalso Shops')
  await shot('25-values-all')
})

/*
  A new owner's first item, on the same install (wave 2 of the cold first-use test): it keeps
  itself as a draft once it has words, so a reload loses nothing; When offers the day its text
  names; and agents get the item with no line its writer never wrote. Sofia, an owner of Sales
  who has made no call yet: one person may make 600 calls a minute, and Amara's and Jon's are spent.
*/
test("a new owner's first item is never lost, and agents get only what was written", async ({
  browser,
}) => {
  const page = await signedInAs(browser, 'Sofia Brandt')
  const shot = (name: string) =>
    process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${name}.png` }) : null
  const title = 'Annual price went up on 1 September 2026'
  await moveTo(page, '/context/new')
  await expect(page.getByRole('textbox', { name: 'Title' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Title' }).fill(title)
  await page.getByRole('textbox', { name: 'What agents should know' }).click()
  await page.keyboard.insertText(
    'Net revenue rose in September because annual customers renewed at the new price.',
  )
  // Kept as a draft a moment after the typing stops, and the address names it.
  const status = page.locator('header [aria-live=polite]')
  await expect(status).toHaveText('Saved')
  await expect(page).toHaveURL(/\/context\/new\?saved=/)
  await shot('30-new-item-saved')

  // A reload opens the same draft, with every word.
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(title)
  await expect(page.getByRole('textbox', { name: 'What agents should know' })).toContainText(
    'renewed at the new price',
  )

  // When offers the day the title names, as that day or from it on, and a box to type one in.
  await page.getByRole('button', { name: /^When/ }).click()
  const offered = page.getByRole('group', { name: 'Dates in your text' })
  await expect(offered.getByRole('button')).toHaveText(['1 Sept 2026', 'From 1 Sept 2026'])
  await expect(page.getByRole('radio', { name: 'Ongoing' })).toHaveAccessibleDescription(
    'Not over yet',
  )
  await shot('31-when-offers')
  await offered.getByRole('button', { name: 'From 1 Sept 2026' }).click()
  await expect(page.getByRole('textbox', { name: 'Type a date' })).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('button', { name: /^When/ })).toContainText('From 1 Sept 2026')

  await page.getByRole('button', { name: /^Applies to/ }).click()
  await page.getByRole('combobox', { name: 'Search Applies to' }).fill('Net revenue')
  await page
    .getByRole('listbox', { name: 'Applies to' })
    .getByRole('option', { name: /^Net revenue/ })
    .first()
    .click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /Add a source/ }).click()
  await page.locator('#fact-source').fill('https://finance.example/pricing-2026')
  await page.locator('#fact-quote').fill('Annual plan up 12% from 1 September.')
  await page.keyboard.press('Escape')
  await button(page, 'Publish').click()
  await expect(page.getByText(/^Published just now by you/)).toBeVisible()

  // Published as itself: no draft is left beside it in Context.
  await moveTo(page, '/context')
  await page.getByPlaceholder('Search context').fill('Annual price went up')
  await expect(page.locator('tbody [data-row-open]')).toHaveCount(1)
  await expect(page.locator('tbody [data-row-open]')).not.toContainText('Draft')

  // Don't conclude was left empty: agents get the item and its cause as written, and no line
  // saying the cause is not proven.
  const reply = await getContext(page, agentKey, {
    question: 'Why did Net revenue rise in September 2026?',
    metrics: ['Net revenue'],
    window: { from: '2026-09-01', to: '2026-09-30' },
  })
  const item = (reply.context as { title: string }[]).find((i) => i.title === title)
  expect(item, JSON.stringify(reply)).toBeTruthy()
  expect(item).not.toHaveProperty('not_to_conclude')
  await page.close()
})
