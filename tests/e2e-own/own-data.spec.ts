import { randomUUID } from 'node:crypto'
import { expect, test, type Page, type Request } from '@playwright/test'
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
  starts from seeded names, which is how this path broke once with every test green.
*/

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
async function post(page: Page, path: string, data: object) {
  const { csrfToken } = (await (await page.request.get('/api/v1/auth/session')).json()) as {
    csrfToken: string
  }
  const answer = await page.request.post(`/api/v1${path}`, {
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
  const json = body.startsWith('{') ? body : /^data: (.*)$/m.exec(body)![1]!
  return (JSON.parse(json) as { result: { structuredContent: Record<string, unknown> } }).result
    .structuredContent
}

test('from an own semantic manifest to a Checked answer', async ({ page }) => {
  const shot = (name: string) =>
    process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${name}.png` }) : null
  await page.goto('/')
  // Not the demo, though people pick who they are: nothing says the company is invented, and the
  // install's label says which install this is, there and in the header after.
  const label = page.locator('[data-profile-label]')
  await expect(page.getByText('Pick who you are.', { exact: true })).toBeVisible()
  await expect(page.getByText(/invented company|This is a demo/)).toHaveCount(0)
  await expect(label).toContainText('Own data trial')
  // The people it starts with are the sample file's, and the page says so and who the admin is.
  await expect(
    page.getByText(
      'These are sample people, made up for trying Footnote. Ravi Kapoor is the admin, who sets it up.',
    ),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /Ravi Kapoor/ })).toContainText('Admin')
  await shot('05-sign-in')
  await page.getByRole('button', { name: /Ravi Kapoor/ }).click()
  await expect(page).toHaveURL(/\/inbox$/)
  await expect(page.locator('header').locator(label)).toContainText('Own data trial')

  // The checklist, in the order it can be done: a domain, then the names, then writing.
  await expect(page.getByText('0 of 6 done')).toBeVisible()
  await expect(page.getByText(/^Until there is context, agents hear/)).toBeVisible()
  expect(await demoWords(page), 'the Inbox').toEqual([])
  await shot('10-setup')
  const steps = page.getByRole('main').getByRole('listitem')
  await expect(steps.nth(1)).toContainText('Add your first domain')
  await expect(steps.nth(2)).toContainText('Connect your definitions')
  await expect(steps.nth(3)).toContainText('Write your first context item')

  await button(page, 'Add a domain').click()
  await page.getByRole('textbox', { name: 'Name' }).fill('Sales')
  await button(page, 'Add the domain').click()
  await expect(page).toHaveURL(/\/inbox$/)
  await expect(page.getByText('1 of 6 done')).toBeVisible()

  // Connect dbt from the checklist: the fixture's file at an address, through all five steps.
  await button(page, 'Connect').click()
  await page.goto('/settings/integrations/dbt-metricflow/connect?setup=1&step=2')
  await page.getByLabel('File address').fill(store.link('/link/semantic_manifest.json'))
  await button(page, 'Test connection').click()
  await expect(page.getByText('A read would hold 13 metrics and 12 dimensions.')).toBeVisible({
    timeout: 30_000,
  })
  await button(page, 'Continue').click()
  await button(page, 'Continue').click()
  await button(page, 'Continue').click()
  await button(page, 'Add dbt').click()
  await expect(page).toHaveURL(/\/inbox$/)

  // The read ends by itself, and its names wait for one press.
  const waiting = page.getByRole('button', { name: /^Publish \d+ names$/ })
  await expect(waiting).toBeVisible({ timeout: 45_000 })
  await shot('11-names-waiting')
  await waiting.click()
  const review = page.getByRole('dialog')
  await expect(review.getByText('Net revenue', { exact: true })).toBeVisible()
  await shot('12-names-review')
  // Two definitions are called Revenue, and three semantic models have a Region: none is picked,
  // and Publish all leaves them all for a look.
  const flagged = review.getByRole('region', { name: 'Look at these first' })
  await expect(flagged.getByRole('listitem')).toHaveCount(9)
  await expect(flagged.getByRole('listitem').first()).toContainText(
    'Another definition is called “Revenue”',
  )
  await expect(flagged).toContainText('2 others are called “Region”')
  // Focus starts on Publish all, so the Enter it shows publishes every ready name.
  await expect(review.getByRole('button', { name: /^Publish all/ })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByText('2 of 6 done')).toBeVisible()
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

  // The vocabulary is live: Definitions lists the metric, and it has its domain.
  await page.goto('/definitions')
  await expect(page.getByRole('row', { name: /^Select Net revenue/ })).toBeVisible()
  await shot('13-definitions')

  // Nothing written yet: Context and Ask say what to write and to ask without the demo's words.
  await page.goto('/context')
  await expect(page.getByText('No context yet')).toBeVisible()
  expect(await demoWords(page), 'Context').toEqual([])
  await page.goto('/ask')
  await expect(page.getByRole('textbox', { name: 'Ask a question' })).toBeVisible()
  expect(await demoWords(page), 'Ask').toEqual([])

  // A context item that applies to the synced metric, published in one step by its owner.
  await page.goto('/context/new')
  await button(page, 'More').click()
  await page.getByRole('menuitem', { name: 'Draft from text' }).click()
  await expect(page.getByRole('dialog', { name: 'Draft from text' })).toBeVisible()
  expect(await demoWords(page), 'the editor and Draft from text').toEqual([])
  await page.keyboard.press('Escape')
  await page.getByRole('textbox', { name: 'Title' }).fill('Checkout was down for a day')
  await page.getByRole('textbox', { name: 'What agents should know' }).click()
  await page.keyboard.insertText(
    'Nobody could pay at the checkout for most of the day, so Net revenue reads low for it.',
  )
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
  await page.getByRole('button', { name: /Add a source/ }).click()
  await page.locator('#fact-source').fill('https://finance.example/checkout-outage')
  await page.locator('#fact-quote').fill('The checkout took no payments for most of the day.')
  await page.keyboard.press('Escape')
  await shot('14-editor')
  await button(page, 'Publish').click()
  await expect(page.getByText(/^Published just now by you/)).toBeVisible()

  // The setup's next step asks about it, with the question already written: about the item's own
  // day, which has passed, so the answer is the item, not Not found for today.
  await page.goto('/inbox')
  await button(page, 'Ask').click()
  await expect(page).toHaveURL(/\/ask\?/)
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  const question = `What should I know about Net revenue on ${day}?`
  await expect(box).toHaveText(question)

  // An agent asks the same over MCP, as a key that names nobody.
  const { key } = await post(page, '/access-keys', { name: 'Own data journey' })
  const reply = await getContext(page, key as string, { question })
  expect(reply).toMatchObject({ status: 'matched' })
  expect(reply.say).toMatch(/^Checked\./)
  expect(JSON.stringify(reply)).toContain('Checkout was down for a day')

  // And the owner presses Enter.
  await box.press('Enter')
  await expect(page.getByRole('log').getByText('Checked', { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole('log')).toContainText('Checkout was down for a day')
  await shot('15-ask')

  // Setup is at 5 of 6, one step left. Ten more items rely on Net revenue, and then its
  // calculation changes in dbt: the Inbox shows the eleven Due for a check above the checklist,
  // without waiting for the last step.
  const read = async <T>(path: string) => (await page.request.get(`/api/v1${path}`)).json() as T
  const metric = (await read<{ metrics: { id: string; name: string }[] }>('/vocabulary')).metrics
  // The vocabulary names a metric by its key without its kind: a draft's scope says the kind.
  const netRevenue = `metric:${metric.find((m) => m.name === 'Net revenue')!.id.replace(/^metric:/, '')}`
  const sales = (await read<{ id: string; name: string }[]>('/areas')).find(
    (area) => area.name === 'Sales',
  )!.id
  for (let n = 1; n <= 10; n++)
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
  await expect(page.getByText('5 of 6 done')).toBeVisible()
  const due = page.getByRole('region', { name: 'Needs you' })
  // Each try waits for the Inbox to draw before it looks: on a loaded machine a reload takes
  // longer than the look, and every try then reloaded before the row could show.
  await expect(async () => {
    await page.reload()
    await expect(page.getByText('5 of 6 done')).toBeVisible({ timeout: 20_000 })
    await expect(due.getByRole('link', { name: /^Due for a check 11 in all domains/ })).toBeVisible(
      { timeout: 3_000 },
    )
  }).toPass({ timeout: 90_000 })
  // Above the checklist, which is two screens long on a phone; and with context written, the
  // checklist no longer says agents hear that nothing is written down.
  const checklist = page.getByText('Set up your workspace so agents can use what you know')
  const [dueAt, checklistAt] = await Promise.all([due.boundingBox(), checklist.boundingBox()])
  expect(dueAt!.y).toBeLessThan(checklistAt!.y)
  await expect(page.getByText(/^Until there is context/)).toHaveCount(0)
  await shot('16-setup-due')
  await due.getByRole('link').click()
  await expect(page).toHaveURL(/\/context\?due=1$/)
})
