import { createHash, randomBytes } from 'node:crypto'
import type { Browser, Page } from '@playwright/test'
import { expect, go, mode, test } from './go.ts'

/*
  J146, the editor keeps up with the person's agent (Route 1, slice R1b; AT7). Jon's Claude writes
  a draft through write_draft, and Jon opens it in Footnote. While he writes in the title, Claude
  changes the title and Don't conclude: within ten seconds Don't conclude shows Claude's words,
  with a strip that says so and Undo, and his title stays as he typed it, with Claude's beside it
  to take or leave. Undo puts Don't conclude back. When his save meets a change Claude made after
  he read the draft, the service refuses it (409), and the editor reads the draft again and saves
  both. The agent and the person are two browsers on one service: the mock has no agent.
*/
test.skip(mode !== 'http', 'an agent writes the draft through the service, which the mock has not')

const AGENT = 'Claude'
const title = (page: Page) => page.getByRole('textbox', { name: 'Title' })
const text = (page: Page) => page.getByRole('textbox', { name: 'What agents should know' })
const dontConclude = (page: Page) => page.getByRole('textbox', { name: "Don't conclude" })
const strip = (page: Page) => page.getByRole('region', { name: `What ${AGENT} changed` })
const saved = (page: Page) => page.getByText('Saved', { exact: true })

type Reply = {
  status: string
  draft_id: string
  revision: number
  url: string
  fields: Record<string, { value: unknown; by: string | null; mark?: string }>
}

/** Jon's own Claude, in a browser of its own: it signs in through the login server as him. */
async function jonsAgent(browser: Browser) {
  const issuer = `http://localhost:${process.env.GOLDEN_API_PORT}`
  const callback = 'http://127.0.0.1:43179/callback'
  const context = await browser.newContext({ locale: 'en-GB' })
  const page = await context.newPage()
  const registered = await page.request.post(`${issuer}/oauth/register`, {
    data: {
      client_name: AGENT,
      redirect_uris: [callback],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
  })
  const { client_id: clientId } = (await registered.json()) as { client_id: string }
  const verifier = randomBytes(32).toString('base64url')
  await page.route(`${callback}**`, (route) => route.fulfill({ body: 'Back in the agent' }))
  const authorize = new URL(`${issuer}/oauth/authorize`)
  for (const [key, value] of Object.entries({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: callback,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: 'j146',
    scope: 'read feedback propose',
    resource: `${issuer}/mcp`,
  }))
    authorize.searchParams.set(key, value)
  await page.goto(authorize.href)
  await page.getByRole('button', { name: /Jon Abara/ }).click()
  await page.getByRole('button', { name: 'Allow', exact: true }).click()
  await page.waitForURL((url) => url.href.startsWith(callback))
  const code = new URL(page.url()).searchParams.get('code')!
  const exchanged = await page.request.post(`${issuer}/oauth/token`, {
    form: {
      grant_type: 'authorization_code',
      code,
      redirect_uri: callback,
      client_id: clientId,
      code_verifier: verifier,
      resource: `${issuer}/mcp`,
    },
  })
  const token = ((await exchanged.json()) as { access_token: string }).access_token
  const call = async (name: string, args: Record<string, unknown>) => {
    const answer = await page.request.post(`${issuer}/mcp`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream' },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    })
    const body = await answer.text()
    const json = body.startsWith('{') ? body : /^data: (.*)$/m.exec(body)![1]!
    return (JSON.parse(json) as { result: { structuredContent: Reply } }).result.structuredContent
  }
  return {
    write: (args: Record<string, unknown>) => call('write_draft', args),
    read: (id: string) => call('read_draft', { draft_id: id }),
    close: () => context.close(),
  }
}

test("an agent's change shows in the open draft, never over what the person is typing, with Undo", async ({
  page,
  browser,
}) => {
  await go(page, '/context')
  const claude = await jonsAgent(browser)
  try {
    const written = await claude.write({
      title: 'Norway customs rule',
      new_item: true,
      text: 'Online sales of Orders to Norway stopped on 4 August 2026 under a new customs rule.',
      scope: { metrics: ['Orders'] },
      window: { from: '2026-08-04' },
      evidence: [
        {
          url: 'https://wiki.example/finance/norway-customs',
          quote: 'From 4 August 2026 parcels to Norway are held at the border.',
        },
      ],
    })
    expect(written.status).toBe('draft_saved')
    const id = written.draft_id

    // Jon opens the draft his agent wrote: what only Claude has written is marked.
    await go(page, new URL(written.url).pathname)
    await expect(title(page)).toHaveValue('Norway customs rule')
    await expect(page.getByText(`${AGENT} wrote the title and the text.`)).toBeVisible()

    // He writes in the title, and his words save themselves.
    // The end of the title, however many lines it takes.
    await title(page).click()
    await title(page).evaluate((el: HTMLTextAreaElement) =>
      el.setSelectionRange(el.value.length, el.value.length),
    )
    await page.keyboard.type(' for webshop orders')
    await expect(saved(page)).toBeVisible()
    await expect(page.getByText(`${AGENT} wrote the text.`)).toBeVisible()

    // Claude reads it again and changes the title and Don't conclude, while his cursor is still
    // in the title.
    const unconcluded = await dontConclude(page).inputValue()
    const read = await claude.read(id)
    expect(read.fields.title).toMatchObject({
      value: 'Norway customs rule for webshop orders',
      by: 'person',
    })
    const changed = await claude.write({
      draft_id: id,
      revision: read.revision,
      title: 'Online sales to Norway stopped',
      not_to_conclude: 'Not that customers in Norway stopped buying.',
    })
    expect(changed.status).toBe('draft_changed')

    // Within ten seconds: Don't conclude has Claude's words, and the strip says so.
    await expect(strip(page)).toContainText(`${AGENT} changed Don't conclude, just now`, {
      timeout: 10_000,
    })
    await expect(dontConclude(page)).toHaveValue('Not that customers in Norway stopped buying.')
    // His title is as he typed it; Claude's waits beside it.
    await expect(title(page)).toHaveValue('Norway customs rule for webshop orders')
    await expect(title(page)).toBeFocused()
    const theirs = page.getByRole('group', { name: `${AGENT}'s version of Title` })
    await expect(theirs).toContainText('Online sales to Norway stopped')
    await theirs.getByRole('button', { name: 'Keep mine' }).click()
    await expect(theirs).toBeHidden()

    // Undo puts Don't conclude back as it was, and saves it as Jon's.
    await strip(page).getByRole('button', { name: 'Undo' }).click()
    await expect(strip(page)).toBeHidden()
    await expect(dontConclude(page)).toHaveValue(unconcluded)
    await expect(saved(page)).toBeVisible()
    await expect
      .poll(async () => (await claude.read(id)).fields)
      .toMatchObject({
        title: { value: 'Norway customs rule for webshop orders', by: 'person' },
        not_to_conclude: { by: 'person' },
      })

    // His save meets a change Claude made after he read the draft: the service refuses it, and
    // the editor reads the draft again, takes Claude's title in, and saves his text with it.
    let hold = () => {}
    const held = new Promise<void>((resolve) => (hold = resolve))
    let refused = 0
    await page.route('**/api/v1/drafts', async (route) => {
      await held
      const response = await route.fetch()
      if (response.status() === 409) refused++
      await route.fulfill({ response })
    })
    await text(page).locator('p').last().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' Parcels are held at the border.')
    await expect(page.getByText('Saving', { exact: true })).toBeVisible()
    const now = await claude.read(id)
    expect(
      (
        await claude.write({
          draft_id: id,
          revision: now.revision,
          title: 'Webshop sales to Norway stopped',
        })
      ).status,
    ).toBe('draft_changed')
    hold()
    await expect(saved(page)).toBeVisible()
    expect(refused).toBe(1)
    await expect(title(page)).toHaveValue('Webshop sales to Norway stopped')
    await expect(strip(page)).toContainText(`${AGENT} changed Title`)
    await expect(text(page)).toContainText('Parcels are held at the border.')
    const both = await claude.read(id)
    expect(both.fields.title).toMatchObject({
      value: 'Webshop sales to Norway stopped',
      by: 'agent',
    })
    // His words are in the summary, the text's first paragraph: his, and read.
    expect(both.fields.summary).toMatchObject({
      value: expect.stringContaining('Parcels are held at the border.'),
      by: 'person',
      mark: 'confirmed',
    })
  } finally {
    await claude.close()
  }
})
