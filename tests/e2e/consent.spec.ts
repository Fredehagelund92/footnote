import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, go, mode, signOut, test } from './go.ts'

/*
  An agent's consent page (FR-403, golden plan 2.3: the real app's page, in the web app's design).
  A person's agent asks to connect; the login server sends them to /connect/approve, where they
  sign in, read which agent asks and what it may do, and allow or deny. On the mock the demo's
  waiting sign-in plays the agent. On the service it is a real one: it registers, the browser goes
  through the login server, a yes gives it tokens that read over MCP, and a revoke in Settings ends
  them.
*/

/** The demo's agent sign-in waiting at the consent page (src/web/api/mock/data/agents.ts). */
const MOCK_REQUEST = 'demo-agent-sign-in-waiting-for-your-answer0'
const AGENT = 'Claude Code'
const toasts = (page: Page) => page.locator('[data-sonner-toast]')

/**
 * Opens an address of the app. On the mock, inside the running app, which keeps what the journey
 * did; on the service the browser may be with the agent, so it loads the app again.
 */
const open = (page: Page, address: string) =>
  mode === 'mock' ? go(page, address) : page.goto(address).then(() => undefined)

type Agent = {
  /** The consent page's address, once the agent sent the browser there. */
  consent: string
  /** After an answer: the browser is back with the agent, which collects its tokens on a yes. */
  back: (allowed: boolean) => Promise<void>
  /** Whether the agent's token still reads over MCP: 200, or 401 once it was revoked. */
  reads: () => Promise<number>
  /** A tool call over MCP with the agent's token, and what it gave back (on the service only). */
  calls: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>
}

/** The agent asks to connect, and the browser lands on the consent page. */
async function agentAsks(page: Page): Promise<Agent> {
  if (mode === 'mock') {
    await go(page, `/connect/approve?request=${MOCK_REQUEST}`)
    return {
      consent: `/connect/approve?request=${MOCK_REQUEST}`,
      // The demo has no agent to go back to: it lands in the Inbox.
      back: async () => {
        await expect(page).toHaveURL(/\/inbox$/)
        await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible()
      },
      reads: () => Promise.resolve(200),
      calls: () => Promise.reject(new Error('The mock has no agent')),
    }
  }
  // The login server's address, the issuer: on the web app's host (http/harness.ts), so the
  // cookie the browser gets when the sign-in starts goes with the consent page's requests.
  const issuer = `http://localhost:${process.env.GOLDEN_API_PORT}`
  const callback = 'http://127.0.0.1:43177/callback'
  const registered = await page.request.post(`${issuer}/oauth/register`, {
    data: {
      client_name: AGENT,
      redirect_uris: [callback],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
  })
  expect(registered.status()).toBe(201)
  const { client_id: clientId } = (await registered.json()) as { client_id: string }
  const verifier = randomBytes(32).toString('base64url')
  // Nothing listens at the agent's own callback: the journey reads the code from its address.
  await page.route(`${callback}**`, (route) => route.fulfill({ body: 'Back in the agent' }))
  const authorize = new URL(`${issuer}/oauth/authorize`)
  for (const [key, value] of Object.entries({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: callback,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: 'consent-journey',
    scope: 'read feedback propose',
    resource: `${issuer}/mcp`,
  }))
    authorize.searchParams.set(key, value)
  await page.goto(authorize.href)
  await expect(page).toHaveURL(/\/connect\/approve\?request=[\w-]{43}$/)
  const consent = new URL(page.url()).pathname + new URL(page.url()).search
  let token = ''
  return {
    consent,
    back: async (allowed) => {
      await page.waitForURL((url) => url.href.startsWith(callback))
      const answer = new URL(page.url()).searchParams
      expect(answer.get('state')).toBe('consent-journey')
      if (!allowed) {
        expect(answer.get('error')).toBe('access_denied')
        return
      }
      const exchanged = await page.request.post(`${issuer}/oauth/token`, {
        form: {
          grant_type: 'authorization_code',
          code: answer.get('code')!,
          redirect_uri: callback,
          client_id: clientId,
          code_verifier: verifier,
          resource: `${issuer}/mcp`,
        },
      })
      expect(exchanged.status()).toBe(200)
      token = ((await exchanged.json()) as { access_token: string }).access_token
    },
    reads: async () => (await mcp(page, issuer, token, 'tools/list', {})).status(),
    calls: async (name, args) => {
      const answer = await mcp(page, issuer, token, 'tools/call', { name, arguments: args })
      expect(answer.status()).toBe(200)
      // The answer is JSON, or one server-sent event that holds it.
      const body = await answer.text()
      const json = body.startsWith('{') ? body : /^data: (.*)$/m.exec(body)![1]!
      const { result } = JSON.parse(json) as {
        result: { structuredContent: Record<string, unknown> }
      }
      return result.structuredContent
    },
  }
}

/** One request to the MCP server with the agent's token. */
const mcp = (page: Page, issuer: string, token: string, method: string, params: object) =>
  page.request.post(`${issuer}/mcp`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method, params },
  })

test('signed out, sign in on the page, allow, and the agent reads until an admin revokes it', async ({
  page,
}) => {
  await go(page, '/inbox')
  await signOut(page)
  const agent = await agentAsks(page)
  await expect(page.getByRole('heading', { name: 'Sign in to Footnote' })).toBeVisible()
  await expect(page.getByText('An agent asked to connect as you.')).toBeVisible()
  await page.getByRole('button', { name: /Ines Duarte/ }).click()

  await expect(
    page.getByRole('heading', { name: `Allow ${AGENT} to use Footnote as you?` }),
  ).toBeVisible()
  const can = page.getByRole('region', { name: 'It will be able to' })
  await expect(can.getByText('Read context', { exact: true })).toBeVisible()
  await expect(can.getByText('Suggest changes', { exact: true })).toBeVisible()
  await expect(page.getByText('Signed in as Ines Duarte')).toBeVisible()
  await page.getByRole('button', { name: 'Allow', exact: true }).click()
  await agent.back(true)
  expect(await agent.reads()).toBe(200)

  // Answered, the link ends.
  await open(page, agent.consent)
  await expect(page.getByRole('heading', { name: 'This request is no longer open' })).toBeVisible()

  // An admin sees every person's agents in Settings, and revokes Ines's.
  await open(page, '/inbox')
  await signOut(page)
  await page.getByRole('button', { name: /Jon Abara/ }).click()
  await expect(page).toHaveURL(/\/inbox$/)
  await open(page, '/settings/agents')
  const row = page
    .getByRole('list', { name: 'Connected agents' })
    .getByRole('listitem')
    .filter({ hasText: AGENT })
    .filter({ hasText: 'Ines Duarte' })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Disconnect' }).click()
  await page
    .getByRole('dialog', { name: /^Disconnect / })
    .getByRole('button', { name: 'Disconnect' })
    .click()
  await expect(row).toHaveCount(0)
  if (mode === 'http') await expect.poll(() => agent.reads()).toBe(401)
})

test('a member finds the agent they connected in Settings, and disconnects it themselves', async ({
  page,
}) => {
  await go(page, '/inbox')
  await signOut(page)
  const agent = await agentAsks(page)
  await page.getByRole('button', { name: /Ines Duarte/ }).click()
  await expect(
    page.getByText('You can disconnect it at any time in Settings, under Agents and access.'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Allow', exact: true }).click()
  await agent.back(true)
  expect(await agent.reads()).toBe(200)

  // Ines owns no domain and is no admin: Settings has her own agents, and nothing of anyone else's.
  await open(page, '/inbox')
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Agents and access', level: 1 })).toBeVisible()
  const rows = page.getByRole('list', { name: 'Connected agents' }).getByRole('listitem')
  const row = rows.filter({ hasText: AGENT })
  await expect(row).toBeVisible()
  await expect(rows.filter({ hasNotText: 'Ines Duarte' })).toHaveCount(0)
  await expect(page.getByText('Settings are for admins')).toHaveCount(0)
  for (const admins of ['Pause sharing', 'Tools and access keys'])
    await expect(page.getByRole('heading', { name: admins })).toHaveCount(0)
  const nav = page.getByRole('navigation', { name: 'Settings' })
  await expect(nav.getByRole('link', { name: 'Agents and access' })).toBeVisible()
  for (const name of ['Domains and owners', 'People'])
    await expect(nav.getByRole('link', { name })).toHaveCount(0)
  for (const { path, title } of [
    { path: '/settings/people', title: 'People' },
    { path: '/settings/domains', title: 'Domains and owners' },
  ]) {
    await go(page, path)
    await expect(page.getByText('Settings are for admins')).toBeVisible()
    await expect(page.getByRole('heading', { name: title, level: 1 })).toHaveCount(0)
  }
  await go(page, '/settings/agents')

  // A disconnect that fails says so, and the agent stays.
  await go(page, '/settings/agents?state=offline')
  await row.getByRole('button', { name: 'Disconnect' }).click()
  const ask = page.getByRole('dialog', { name: `Disconnect ${AGENT}?` })
  await expect(ask).toContainText('It signs out at once and stops reading context as you.')
  await expect(ask).toContainText('You can connect it again.')
  await ask.getByRole('button', { name: 'Disconnect' }).click()
  await expect(toasts(page).filter({ hasText: `Couldn't disconnect ${AGENT}` })).toBeVisible()
  await expect(row).toBeVisible()
  if (mode === 'http') await page.context().setOffline(false)
  else await go(page, '/settings/agents')

  await row.getByRole('button', { name: 'Disconnect' }).click()
  await ask.getByRole('button', { name: 'Disconnect' }).click()
  await expect(toasts(page).filter({ hasText: `${AGENT} disconnected` })).toBeVisible()
  await expect(row).toHaveCount(0)
  if (mode === 'http') await expect.poll(() => agent.reads()).toBe(401)
})

test('deny sends the browser back with a no, and the agent gets nothing', async ({ page }) => {
  const agent = await agentAsks(page)
  await expect(page.getByText('Signed in as Jon Abara')).toBeVisible()
  await page.getByRole('button', { name: "Don't allow" }).click()
  await agent.back(false)
  await open(page, '/settings/agents')
  await expect(
    page
      .getByRole('list', { name: 'Connected agents' })
      .getByRole('listitem')
      .filter({ hasText: AGENT })
      .filter({ hasText: 'Jon Abara' }),
  ).toHaveCount(0)
})

test('a link with no sign-in in it, or one that ended, says to connect again', async ({ page }) => {
  await go(page, '/connect/approve')
  await expect(
    page.getByRole('heading', { name: "This sign-in link isn't complete" }),
  ).toBeVisible()
  await go(page, `/connect/approve?request=${'x'.repeat(43)}`)
  await expect(page.getByRole('heading', { name: 'This request is no longer open' })).toBeVisible()
})

test("an agent's suggestion links to where it waits, in the person's Inbox", async ({ page }) => {
  test.skip(mode === 'mock', 'The mock has no agent to suggest')
  await go(page, '/inbox')
  await signOut(page)
  const agent = await agentAsks(page)
  await page.getByRole('button', { name: /Ines Duarte/ }).click()
  await page.getByRole('button', { name: 'Allow', exact: true }).click()
  await agent.back(true)
  const sent = await agent.calls('suggest_context', {
    text: 'Orders in Norway include the accounts our teams use to test the webshop until 1 November 2026.',
    scope: { metrics: ['Orders'] },
    window: { from: '2026-10-01' },
    evidence: [{ url: 'https://wiki.example/test-accounts', quote: 'Test accounts are counted.' }],
    new_item: true,
  })
  expect(sent).toMatchObject({ status: 'suggestion_sent' })
  const url = sent.url as string
  expect(url).toMatch(/\/inbox\?tab=all&card=waiting:[0-9a-f-]{36}$/)
  await page.goto(url)
  await expect(
    page.getByText(/Waiting for .+\. You'll see here when it is published or returned\./),
  ).toBeVisible()

  // A draft the agent saved without sending (a check refused it) links to the editor at its own
  // address, as tests/integration/draft-tool.test.ts says; it opens there with what it holds.
  const { csrfToken } = (await (await page.request.get('/api/v1/auth/session')).json()) as {
    csrfToken: string
  }
  const saved = await page.request.post('/api/v1/proposals', {
    headers: {
      'x-footnote-csrf': csrfToken,
      'idempotency-key': randomUUID(),
      origin: new URL(page.url()).origin,
    },
    data: {
      draft: {
        areaId: 'area_sales',
        kind: 'note',
        title: 'Test accounts in Norway',
        summary: 'Orders in Norway include the accounts our teams use to test the webshop.',
      },
    },
  })
  expect(saved.status()).toBe(200)
  const { id } = (await saved.json()) as { id: string }
  await page.goto(`/context/${id}/edit`)
  await expect(page.getByRole('textbox', { name: /title/i })).toHaveValue('Test accounts in Norway')
})
