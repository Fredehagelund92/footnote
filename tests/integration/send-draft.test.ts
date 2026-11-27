import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { draftingGuide } from '../../src/domain/drafting-guide.ts'
import { mintDevToken } from '../../src/server/mcp/auth.ts'
import { people } from './fixtures.ts'
import { signInHarness } from './sign-in-harness.ts'
import { tableContents } from './support.ts'

/*
  The send step (FR-121) end to end on PostgreSQL: a person signs their AI client in with the
  propose scope, the agent writes a draft with write_draft, and after the person says yes it sends
  exactly the revision they saw with send_draft, which waits for the owner with every field's mark;
  one the review checks refuse stays the person's draft. A draft the person changed after that
  revision is not sent: the person said yes to what they saw. Then each rule the wrong way: the
  switch, tokens that name no person, a sent draft, someone else's, a possible duplicate, the
  daily limit and the drafts waiting, which a batch of drafts meets, and that the person is named
  on the proposal only, never in another MCP record or a log line.
*/

const harness = await signInHarness()
const {
  admin,
  resource,
  devKey,
  registered,
  signInFlow,
  exchange,
  mcpClient,
  browser,
  logLines,
  rawLog,
} = harness

type Reply = {
  status: string
  saved?: boolean
  sent?: boolean
  message?: string
  draft_id: string
  revision: number
  title?: string
  url: string | null
  fields?: Record<string, { value: unknown; mark?: string; by?: string | null }>
  changed_since?: string[]
  blocking?: { code: string; field: string; message: string }[]
  possible_duplicates?: { id: string; title: string; kind: string }[]
  questions?: { field: string }[]
  instructions?: string
  drafts?: {
    waiting: number
    most_waiting: number
    new_in_24_hours: number
    most_new_in_24_hours: number
  }
}

const complete = {
  scope: { metrics: ['Orders'] },
  window: { from: '2026-09-01' },
  evidence: [
    {
      url: 'https://wiki.example/finance/orders-currency',
      quote: 'Every order is converted to euros at the rate of the day.',
    },
  ],
}
const text =
  'Orders in every market are booked in their own currency and turned into euros at the rate of the day, from 1 September 2026.'

async function personToken(person = 'author', scope = 'read feedback propose') {
  const clientId = await registered()
  const flow = await signInFlow(clientId, { person, scope })
  const exchanged = await exchange(clientId, flow.code!, flow.verifier)
  expect(exchanged.status).toBe(200)
  return exchanged.body.access_token!
}
async function call(token: string, name: string, args: Record<string, unknown>) {
  const wire = await mcpClient(token)
  const reply = await wire.callTool({ name, arguments: args })
  await wire.close()
  return { isError: reply.isError === true, out: reply.structuredContent as Reply }
}
async function callRaw(token: string, name: string, args: Record<string, unknown>) {
  const response = await fetch(resource, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  return { status: response.status, text: await response.text(), headers: response.headers }
}
/** The agent writes a draft and, on the person's yes, sends the revision it showed them. */
async function writeAndSend(token: string, args: Record<string, unknown>) {
  const written = await call(token, 'write_draft', args)
  expect(written.out.status).toBe('draft_saved')
  const sent = await call(token, 'send_draft', {
    draft_id: written.out.draft_id,
    revision: written.out.revision,
  })
  return { written: written.out, ...sent }
}
const switchTool = (enabled: boolean) =>
  admin.query("update tool_config set enabled=$1 where tool='send_draft'", [enabled])
const setLimits = (perDay: number, open: number) =>
  admin.query(
    `insert into settings_versions (key,version,value,reason)
     select 'limits.agent_drafts',max(version)+1,$1,'test' from settings_versions where key='limits.agent_drafts'`,
    [JSON.stringify({ per_day: perDay, open })],
  )
const agentDrafts = async () =>
  (
    await admin.query<{
      id: string
      state: string
      proposer_id: string
      draft: { title?: string }
    }>("select id,state,proposer_id,draft from proposals where channel='mcp' order by created_at")
  ).rows
const row = async (id: string) =>
  (
    await admin.query<{ state: string; revision: number; proposer_id: string; channel: string }>(
      'select state,revision,proposer_id,channel from proposals where id=$1',
      [id],
    )
  ).rows[0]!

/** The author saves their draft in the editor (Save as draft), with some fields changed. */
async function personSaves(id: string, change: Record<string, unknown>) {
  const person = browser()
  await person.signIn('author')
  const current = (await (await person.api(`/proposals/${id}`)).json()) as {
    draft: Record<string, unknown>
    revision: number
  }
  const saved = await person.api(
    '/drafts',
    { draftId: id, revision: current.revision, draft: { ...current.draft, ...change } },
    { 'idempotency-key': randomUUID() },
  )
  expect(saved.status).toBe(200)
}

describe("an AI agent sends a draft of the person's, after they say yes", () => {
  it('is on by default, and has a switch', async () => {
    const on = await mcpClient(await personToken())
    const tool = (await on.listTools()).tools.find((t) => t.name === 'send_draft')
    await on.close()
    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false })
    expect(tool?.description).toMatch(
      /^Send a draft of the person's own to the owner, after the person says yes\. Call it only after the person says yes to sending it\./,
    )
    expect(tool?.description).toMatch(/nothing changes until they do/)
    await switchTool(false)
    const token = await personToken()
    const wire = await mcpClient(token)
    expect((await wire.listTools()).tools.map((t) => t.name)).not.toContain('send_draft')
    await wire.close()
    // write_draft has its own switch: drafting stays on while sending is off.
    const written = await call(token, 'write_draft', { text, ...complete, new_item: true })
    expect(written.out.status).toBe('draft_saved')
    const refused = await callRaw(token, 'send_draft', {
      draft_id: written.out.draft_id,
      revision: written.out.revision,
    })
    expect(refused.status).toBe(403)
    expect((await row(written.out.draft_id)).state).toBe('draft')
    await switchTool(true)
  })

  it('sends exactly the revision the person said yes to, with its marks, to the owner, who reviews it', async () => {
    harness.advance(61)
    await setLimits(100, 100)
    // Sign in first, so the snapshot holds what the sign-in writes and the comparison sees only the draft.
    const token = await personToken()
    await admin.query("update people set display_name = 'Person ' || id::text")
    const before = await tableContents(admin)
    const { written, out, isError } = await writeAndSend(token, {
      text,
      ...complete,
      new_item: true,
    })
    expect(isError).toBe(false)
    expect(written.url).toBe(`http://localhost:5173/context/${written.draft_id}/edit`)
    expect(out).toMatchObject({
      status: 'sent',
      sent: true,
      draft_id: written.draft_id,
      revision: 2,
      message:
        'Sent to the owner of Finance. It waits for their check, and nothing changes until they publish it.',
      url: `http://localhost:5173/inbox?tab=all&card=waiting:${written.draft_id}`,
    })
    expect(out).not.toHaveProperty('policy')
    expect(written.fields).toMatchObject({
      summary: { mark: 'prefilled', by: 'agent' },
      scope: { mark: 'prefilled' },
      window: { mark: 'prefilled' },
      evidence: { mark: 'prefilled' },
    })
    const names = (await admin.query<{ name: string }>('select display_name as name from people'))
      .rows
    expect(names.length).toBeGreaterThan(0)
    for (const { name } of names) expect(JSON.stringify(out)).not.toContain(name)
    expect(await row(written.draft_id)).toMatchObject({
      state: 'submitted',
      proposer_id: people.author,
      channel: 'mcp',
    })

    // The person is named on the proposal and its history only: no other new row names them.
    await vi.waitFor(async () =>
      expect(
        (await admin.query("select 1 from mcp_requests where tool='send_draft' and status='ok'"))
          .rowCount,
      ).toBeGreaterThan(0),
    )
    const after = await tableContents(admin)
    const named = after.filter(
      (line) =>
        !before.includes(line) &&
        line.includes(people.author) &&
        !/^public\.(proposals|proposal_events|item_versions|audit_log|outbox_events) /.test(line),
    )
    expect(named).toEqual([])
    const requests = (await admin.query("select * from mcp_requests where tool='send_draft'")).rows
    expect(JSON.stringify(requests)).not.toContain(people.author)
    expect(requests).toContainEqual(
      expect.objectContaining({ client_label: 'signed-in', status: 'ok' }),
    )
    for (const line of rawLog) {
      expect(line).not.toContain(people.author)
      expect(line).not.toContain('rate of the day')
    }

    // The owner sees the marks while reviewing.
    const owner = browser()
    await owner.signIn('owner')
    const review = (await (await owner.api(`/proposals/${written.draft_id}`)).json()) as {
      channel: string
      state: string
      proposerId: string
      provenance: { by: string; fields: Record<string, string> }
    }
    expect(review).toMatchObject({ channel: 'mcp', state: 'submitted', proposerId: people.author })
    expect(review.provenance).toMatchObject({
      by: 'agent',
      fields: { areaId: 'derived', summary: 'prefilled', riskLevel: 'default' },
    })
  })

  it('sends nothing when the person changed the draft after the revision they said yes to', async () => {
    harness.advance(61)
    const token = await personToken()
    const written = await call(token, 'write_draft', {
      text: 'Online sales of Orders to Norway stopped on 4 August 2026 under a new customs rule.',
      title: 'Online sales to Norway stopped',
      ...complete,
      window: { from: '2026-08-04' },
      new_item: true,
    })
    const id = written.out.draft_id
    const drafts = (await agentDrafts()).length
    await personSaves(id, { title: 'Webshop sales to Norway stopped' })
    // The agent, at the revision it showed the person, sends: nothing goes, and no second draft.
    const stale = await call(token, 'send_draft', { draft_id: id, revision: written.out.revision })
    expect(stale.isError).toBe(false)
    expect(stale.out).toMatchObject({
      status: 'changed',
      sent: false,
      revision: 2,
      changed_since: ['title'],
      url: `http://localhost:5173/context/${id}/edit`,
    })
    expect(stale.out.message).toBe(
      'The draft changed since revision 1: title. It is at revision 2 now. Nothing was sent.',
    )
    expect(stale.out.instructions).toMatch(/only after they say yes to it/)
    expect(await row(id)).toMatchObject({ state: 'draft', revision: 2 })
    expect(await agentDrafts()).toHaveLength(drafts)
    // On the person's yes to what they wrote, the same draft goes, with their title.
    const sent = await call(token, 'send_draft', { draft_id: id, revision: 2 })
    expect(sent.out).toMatchObject({ status: 'sent', title: 'Webshop sales to Norway stopped' })
    const [mine] = (await agentDrafts()).filter((draft) => draft.id === id)
    expect(mine).toMatchObject({
      state: 'submitted',
      draft: { title: 'Webshop sales to Norway stopped' },
    })
    expect(await agentDrafts()).toHaveLength(drafts)
    // A revision the draft never reached is refused.
    const ahead = await call(token, 'send_draft', { draft_id: id, revision: 9 })
    expect(ahead.isError).toBe(true)
  })

  it("refuses a draft that was sent already, someone else's, and a call without a revision", async () => {
    harness.advance(61)
    const token = await personToken()
    const { written, out } = await writeAndSend(token, { text, ...complete, new_item: true })
    expect(out.status).toBe('sent')
    const again = await call(token, 'send_draft', { draft_id: written.draft_id, revision: 2 })
    expect(again).toMatchObject({
      isError: true,
      out: {
        status: 'refused',
        message: 'It was sent already, and waits for review. Nothing was sent again.',
      },
    })
    const other = await call(await personToken('owner'), 'send_draft', {
      draft_id: written.draft_id,
      revision: 2,
    })
    expect(other.out).toMatchObject({
      status: 'refused',
      message: 'No draft of yours has that draft_id.',
    })
    const bare = await call(token, 'send_draft', { draft_id: written.draft_id })
    expect(bare.isError).toBe(true)
    expect(JSON.stringify(bare.out)).toContain('revision')
  })

  it('marks a field the person changes before sending confirmed', async () => {
    const token = await personToken()
    // No source: the review checks would keep it, so the person finishes it in the editor.
    const reply = await call(token, 'write_draft', {
      text: 'Returns are not part of Orders, from 1 October 2026.',
      scope: complete.scope,
      window: complete.window,
      new_item: true,
    })
    const id = reply.out.draft_id
    const author = browser()
    await author.signIn('author')
    const current = (await (await author.api(`/proposals/${id}`)).json()) as {
      revision: number
      draft: Record<string, unknown>
    }
    // The person finishes the draft in the editor and sends it (Publish, which for an author sends
    // it to the domain's owners).
    const sent = await author.go(`${harness.issuer}/api/v1/items/publish`, {
      method: 'POST',
      headers: {
        origin: harness.web,
        'content-type': 'application/json',
        'x-footnote-csrf': await csrfOf(author),
        'idempotency-key': randomUUID(),
      },
      body: JSON.stringify({
        draftId: id,
        draft: {
          ...current.draft,
          title: 'Returns are counted on their own',
          evidence: complete.evidence.map((source) => ({ ...source, date: '2026-09-01' })),
        },
      }),
    })
    expect(sent.status).toBe(200)
    expect(await sent.json()).toMatchObject({ published: false, proposalId: id })
    const after = (await (await author.api(`/proposals/${id}`)).json()) as {
      provenance: { fields: Record<string, string> }
    }
    expect(after.provenance.fields.title).toBe('confirmed')
    expect(after.provenance.fields.summary).toBe('prefilled')
  })

  it('refuses a dev or service token, which names no person, with a clear message', async () => {
    const dev = await mintDevToken(devKey, resource, { scopes: ['read', 'feedback', 'propose'] })
    const args = { draft_id: randomUUID(), revision: 1 }
    const refused = await callRaw(dev, 'send_draft', args)
    expect(refused.status).toBe(403)
    expect(refused.text).toContain('needs a person signed in to Footnote through an AI agent')
    const eval_ = await mintDevToken(devKey, resource, {
      client: 'eval',
      scopes: ['read', 'propose'],
    })
    expect((await callRaw(eval_, 'send_draft', args)).status).toBe(403)
    const wire = await mcpClient(dev)
    expect((await wire.listTools()).tools.map((t) => t.name)).not.toContain('send_draft')
    await wire.close()
  })

  it('asks a person token without the propose scope to step up', async () => {
    const reader = await personToken('author', 'read feedback')
    const refused = await callRaw(reader, 'send_draft', { draft_id: randomUUID(), revision: 1 })
    expect(refused.status).toBe(403)
    expect(refused.headers.get('www-authenticate')).toContain('scope="propose"')
  })

  it('carries the drafting guide, and refuses a summary over its limit instead of cutting it', async () => {
    // The captain's report: an agent saved a summary of more than 280 characters.
    // A fresh minute: every test signs in anew, and sign-ups are counted per minute.
    harness.advance(61)
    const count = (await agentDrafts()).length
    const token = await personToken()
    const wire = await mcpClient(token)
    const tool = (await wire.listTools()).tools.find((t) => t.name === 'write_draft')
    expect(tool?.description).toContain(draftingGuide)
    expect(tool?.description).toMatch(/Don't include names of customers or staff/)
    await wire.close()
    // A summary of its own over the limit: the field is named with what to do, nothing saved.
    const long = `${'Orders are booked in euros at the rate of the day. '.repeat(6)}`.trim()
    const given = await call(token, 'write_draft', {
      text,
      ...complete,
      new_item: true,
      summary: long,
    })
    expect(given.isError).toBe(true)
    expect(JSON.stringify(given.out)).toContain(
      'summary: at most 280 characters: what happened, where and when. Move detail, caveats and what it does not mean into text, which becomes the body',
    )
    // No summary, and a first sentence too long to be one: refused, never cut part way.
    const sentence = `Orders in every market ${'and every currency that the payment providers settle '.repeat(6)}are turned into euros from 1 September 2026.`
    const cut = await call(token, 'write_draft', { text: sentence, ...complete, new_item: true })
    expect(cut.isError).toBe(true)
    expect(cut.out).toMatchObject({ status: 'refused', saved: false, reason: 'summary_too_long' })
    expect(cut.out.message).toMatch(
      /^The first sentence of text is longer than a summary may be \(280 characters\), so it would be cut part way\. Give summary:/,
    )
    expect(await agentDrafts()).toHaveLength(count)
  })

  it('flags the dates when the person was unsure of them, for the owner', async () => {
    harness.advance(61)
    const { written } = await writeAndSend(await personToken(), {
      text,
      ...complete,
      new_item: true,
      window: { from: '2026-09-01', uncertain: true },
    })
    const [saved] = (
      await admin.query<{ provenance: { flags: { code: string }[] } }>(
        'select provenance from proposals where id=$1',
        [written.draft_id],
      )
    ).rows
    expect(saved!.provenance.flags.map((flag) => flag.code)).toContain('uncertain_dates')
  })

  it('starts a change to a published item that reads alike, before saving a second one', async () => {
    const count = (await agentDrafts()).length
    const token = await personToken()
    const reply = await call(token, 'write_draft', {
      text: 'Orders',
      ...complete,
      title: 'A note',
      window: { from: '2026-08-04' },
    })
    expect(reply.out).toMatchObject({
      status: 'possible_duplicate',
      saved: false,
      possible_duplicates: [{ title: 'A note', kind: 'note' }],
    })
    expect(await agentDrafts()).toHaveLength(count)
    const item = reply.out.possible_duplicates![0]!.id
    const { written, out } = await writeAndSend(token, {
      text: 'Orders exclude test accounts.',
      ...complete,
      item_id: item,
    })
    expect(out).toMatchObject({
      status: 'sent',
      url: `http://localhost:5173/inbox?tab=all&card=waiting:${written.draft_id}`,
    })
    const [change] = (
      await admin.query<{ action: string; item_id: string }>(
        'select action::text,item_id from proposals where id=$1',
        [written.draft_id],
      )
    ).rows
    expect(change).toEqual({ action: 'change', item_id: item })
    // A change goes with a new draft only.
    const mixed = await call(token, 'write_draft', {
      draft_id: written.draft_id,
      revision: written.revision,
      item_id: item,
      title: 'Later',
    })
    expect(mixed.out).toMatchObject({ status: 'refused' })
    const missing = await call(token, 'write_draft', {
      text: 'Orders exclude test accounts.',
      ...complete,
      item_id: 'itm_00000000',
    })
    expect(missing.out).toMatchObject({
      status: 'refused',
      message: 'No published context item has that item_id. Nothing was saved.',
    })
  })

  it('installs 50 new drafts a day and 50 waiting, which an admin changes', async () => {
    const versions = await admin.query<{ value: unknown; reason: string }>(
      "select value,reason from settings_versions where key='limits.agent_drafts' order by version",
    )
    expect(versions.rows.slice(0, 2)).toEqual([
      { value: { per_day: 10, open: 20 }, reason: 'default (FR-121)' },
      {
        value: { per_day: 50, open: 50 },
        reason: 'default: 50, the most one Publish takes (FR-121)',
      },
    ])
  })

  it('writes a batch of drafts and sends none, counting them in each reply up to the limits', async () => {
    const token = await personToken()
    const mine = async () =>
      (
        await admin.query<{ today: number; open: number }>(
          `select count(*) filter (where created_at > now() - interval '24 hours')::int as today,
                  count(*) filter (where state='draft' and discarded_at is null)::int as open
             from proposals where channel='mcp' and proposer_id=$1`,
          [people.author],
        )
      ).rows[0]!
    const before = await mine()
    await setLimits(before.today + 3, 100)
    const markets = ['Norway', 'Sweden', 'Denmark']
    const batch = []
    for (const [i, market] of markets.entries())
      batch.push(
        await call(token, 'write_draft', {
          text: `Orders from ${market} are booked a day late from ${i + 7} October 2026.`,
          ...complete,
          new_item: true,
        }),
      )
    expect(batch.map(({ out }) => out.status)).toEqual([
      'draft_saved',
      'draft_saved',
      'draft_saved',
    ])
    expect(batch.map(({ out }) => out.drafts)).toEqual(
      [1, 2, 3].map((n) => ({
        waiting: before.open + n,
        most_waiting: 100,
        new_in_24_hours: before.today + n,
        most_new_in_24_hours: before.today + 3,
      })),
    )
    expect(batch[0]!.out.message).toContain(
      `${before.open + 1} drafts from the person's agents wait for them in Your drafts, and you may save 2 more now (${before.today + 3} new drafts in 24 hours and 100 waiting unsent at most).`,
    )
    expect(batch[2]!.out.message).toContain('and no more may be saved now')
    // None of them was sent: each waits as the person's draft.
    const ids = batch.map(({ out }) => out.draft_id)
    expect(await Promise.all(ids.map(async (id) => (await row(id)).state))).toEqual([
      'draft',
      'draft',
      'draft',
    ])

    const refused = await call(token, 'write_draft', {
      text: 'Orders from Finland are booked a day late from 10 October 2026.',
      ...complete,
      new_item: true,
    })
    expect(refused.out).toMatchObject({
      status: 'refused',
      saved: false,
      message: `The person's agents saved ${before.today + 3} new drafts in the last 24 hours, and the most allowed is ${before.today + 3} new drafts in 24 hours and 100 waiting unsent. Tell the person their drafts wait in Your drafts, in Footnote's Inbox, and save the rest tomorrow. Nothing was saved.`,
    })
    expect(await mine()).toEqual({ today: before.today + 3, open: before.open + 3 })

    await setLimits(100, before.open + 3)
    const waiting = await call(token, 'write_draft', {
      text: 'Orders from Finland are booked a day late from 10 October 2026.',
      ...complete,
      new_item: true,
    })
    expect(waiting.out).toMatchObject({
      status: 'refused',
      saved: false,
      message: `${before.open + 3} drafts from the person's agents wait unsubmitted, and the most allowed is 100 new drafts in 24 hours and ${before.open + 3} waiting unsent. Ask the person to publish, send or delete some in Your drafts, in Footnote's Inbox, before you save more. Nothing was saved.`,
    })
    expect(await mine()).toEqual({ today: before.today + 3, open: before.open + 3 })
    await setLimits(50, 50)
  })

  it('asks for the domain instead of guessing it', async () => {
    await setLimits(100, 100)
    const reply = await call(await personToken(), 'write_draft', {
      text: 'Something changed in the reports.',
    })
    expect(reply.out).toMatchObject({
      status: 'needs_area',
      saved: false,
      areas: [
        { id: 'finance', name: 'Finance' },
        { id: 'marketing', name: 'Marketing' },
      ],
    })
  })

  it("keeps a draft the review checks refuse as the person's draft, and says why", async () => {
    harness.advance(61)
    // No source: a draft may be saved without one, but it cannot be sent for review.
    const { written, out } = await writeAndSend(await personToken(), {
      text: 'Orders in every market exclude store credit, from 2 October 2026.',
      scope: { metrics: ['Orders'] },
      window: { from: '2026-10-02' },
      new_item: true,
    })
    expect(out).toMatchObject({
      status: 'kept',
      sent: false,
      draft_id: written.draft_id,
      url: `http://localhost:5173/context/${written.draft_id}/edit`,
    })
    expect(out.message).toMatch(/^It was kept as the person's draft and not sent: /)
    expect(out.blocking?.length).toBeGreaterThan(0)
    expect(Object.keys(out.blocking![0]!).sort()).toEqual(['code', 'field', 'message'])
    expect((await row(written.draft_id)).state).toBe('draft')
  })

  it('refuses a person who is no longer active', async () => {
    const token = await personToken('stranger')
    const written = await call(token, 'write_draft', { text, ...complete, new_item: true })
    await admin.query('update people set deactivated_at=now() where id=$1', [people.stranger])
    const sent = await call(token, 'send_draft', {
      draft_id: written.out.draft_id,
      revision: written.out.revision,
    })
    expect(sent.out).toMatchObject({
      status: 'refused',
      message: "Your account isn't active, so nothing was sent.",
    })
    expect(logLines.every((line) => !JSON.stringify(line).includes(people.stranger))).toBe(true)
  })
})

/** The CSRF token of a signed-in test browser, read back from the session. */
async function csrfOf(person: ReturnType<typeof browser>) {
  const session = (await (await person.api('/auth/session')).json()) as { csrfToken: string }
  return session.csrfToken
}
