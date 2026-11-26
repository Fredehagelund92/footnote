import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { MyShare, MyShares, SharedChat } from '../../src/contract/shared-chats.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { localRoles } from '../../src/server/db/roles.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { accept, foundation, people, publish, version } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  A chat shared as a link (FR-721), over authenticated HTTP. The link keeps each turn's question,
  what Ask read, its state, its words and its sources by id, under the sender's name; a turn that
  rests on a draft is kept as left out, with no words. Anyone signed in opens it; each source is
  read as the reader, so a turn that rests on one they may not read keeps its question and state
  without its words. Its sender stops it, which deletes the copy; it ends after 90 days, and the
  admin switch turns sharing off. Agents never read it.
*/

const { client, url } = testDatabase()
const app = buildApp({
  database: apiDatabase(url),
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock: systemClock('2026-11-25'),
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
})

type Who = keyof typeof people
const sessions: Record<string, Record<string, string>> = {}
const call = (
  who: Who | null,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  payload?: Record<string, unknown>,
) =>
  app.inject({
    method,
    url: `/api/v1${path}`,
    headers: {
      ...(who ? sessions[who] : { origin: 'http://localhost' }),
      'idempotency-key': randomUUID(),
    },
    ...(payload === undefined ? {} : { payload }),
  })

async function setting(key: string, value: unknown) {
  await client.query(
    `insert into settings_versions (key, version, value, reason)
     select $1, max(version) + 1, $2, 'test' from settings_versions where key = $1`,
    [key, JSON.stringify(value)],
  )
}

/** A version of a context item agents get now. */
async function published(options: Parameters<typeof version>[1]) {
  const v = await transaction(client, () => version(client, options))
  await accept(client, v.id)
  await publish(client, v.id)
  return v
}

const ids = { open: '', hidden: '', hiddenVersion: '', draft: '' }

/** A chat of three turns: one on a live item, one on a draft, one on an item hidden later. */
const chat = () => ({
  chat: `chat-${randomUUID().slice(0, 8)}`,
  title: 'Why did orders in Norway drop in August?',
  turns: [
    {
      question: 'Why did orders in Norway drop in August?',
      read: ['Context about Orders in Norway, 1 to 31 Aug 2026'],
      state: 'grounded',
      words: 'Online sales to Norway stopped on 4 August.[1]',
      sources: [ids.open],
    },
    {
      question: 'WORDS-OF-A-DRAFT-TURN',
      read: [],
      state: 'grounded',
      words: 'DRAFT-ANSWER-WORDS[1]',
      sources: [ids.draft],
    },
    {
      question: 'And what about returns?',
      read: ['Context about Returns, hidden from some'],
      state: 'partial',
      words: 'Returns are counted on the refund day.[1] Stores reopened.[2]',
      sources: [ids.open, ids.hidden],
    },
  ],
})

beforeAll(async () => {
  await foundation(client)
  ids.open = (await published({ title: 'Online sales to Norway stopped' })).item
  const hidden = await published({ title: 'Returns counted on the refund day' })
  ids.hidden = hidden.item
  ids.hiddenVersion = hidden.id
  ids.draft = (
    await transaction(client, () => version(client, { title: 'A draft no one else reads' }))
  ).item
  for (const name of Object.keys(people)) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin: 'http://localhost', 'x-footnote-csrf': 'dev-sign-in' },
      payload: { email: `${name}@example.test` },
    })
    expect(response.statusCode, response.body).toBe(200)
    sessions[name] = {
      origin: 'http://localhost',
      cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-footnote-csrf': response.json<{ csrfToken: string }>().csrfToken,
    }
  }
})
afterAll(() => app.close())
beforeEach(async () => {
  await client.query('delete from shared_chats')
  await setting('ask.share_chats', true)
})

describe('a shared chat', () => {
  it('keeps every turn under the sender, leaves a draft turn out, and opens for a member', async () => {
    const input = chat()
    const made = await call('author', 'POST', '/shared-chats', input)
    expect(made.statusCode, made.body).toBe(200)
    const link = made.json<MyShare>()
    expect(link).toMatchObject({ chat: input.chat, title: input.title, turns: 3, left: 1 })
    expect(Date.parse(link.until) - Date.parse(link.at)).toBe(90 * 86_400_000)

    // The turn on a draft is kept as left out: none of its words are stored.
    const stored = await client.query<{ turns: unknown }>('select turns from shared_chats')
    expect(JSON.stringify(stored.rows[0]!.turns)).not.toMatch(/DRAFT/)

    const opened = await call('member', 'GET', `/shared-chats/${link.id}`)
    expect(opened.statusCode, opened.body).toBe(200)
    const shared = opened.json<SharedChat>()
    expect(shared).toMatchObject({
      title: input.title,
      by: { personId: people.author, name: 'author' },
      mine: false,
    })
    expect(shared.turns).toEqual([
      { kind: 'turn', ...input.turns[0], sources: [ids.open] },
      { kind: 'left', why: 'draft' },
      { kind: 'turn', ...input.turns[2], sources: [ids.open, ids.hidden] },
    ])
    expect((await call('author', 'GET', `/shared-chats/${link.id}`)).json()).toMatchObject({
      mine: true,
    })
  })

  it('reads each source as the reader: a turn on one they may not read loses its words and what it read', async () => {
    const link = (await call('author', 'POST', '/shared-chats', chat())).json<MyShare>()
    // The item is narrowed to an audience after the chat was shared.
    const narrowed = await published({
      item: ids.hidden,
      previous: ids.hiddenVersion,
      title: 'Returns counted on the refund day',
      audience: ['finance-leads'],
    })
    try {
      const shared = (await call('member', 'GET', `/shared-chats/${link.id}`)).json<SharedChat>()
      expect(shared.turns[0]).toMatchObject({
        kind: 'turn',
        words: 'Online sales to Norway stopped on 4 August.[1]',
      })
      expect(shared.turns[2]).toEqual({
        kind: 'turn',
        question: 'And what about returns?',
        read: [],
        state: 'partial',
        words: null,
        sources: [ids.open, null],
      })
    } finally {
      const back = await published({
        item: ids.hidden,
        previous: narrowed.id,
        title: 'Returns counted on the refund day',
      })
      ids.hiddenVersion = back.id
    }
  })

  it("lists only the sender's own links, which only the sender stops", async () => {
    const input = chat()
    const link = (await call('author', 'POST', '/shared-chats', input)).json<MyShare>()
    expect((await call('author', 'GET', '/shared-chats')).json<MyShares>()).toEqual({
      on: true,
      links: [link],
    })
    expect((await call('member', 'GET', '/shared-chats')).json<MyShares>()).toEqual({
      on: true,
      links: [],
    })
    expect((await call('member', 'DELETE', `/shared-chats/${link.id}`)).json()).toEqual({
      stopped: false,
    })
    expect((await call('author', 'DELETE', `/shared-chats/${link.id}`)).json()).toEqual({
      stopped: true,
    })
    // Stopped, its copy is gone and the link opens nothing.
    expect((await client.query('select 1 from shared_chats')).rowCount).toBe(0)
    const gone = await call('member', 'GET', `/shared-chats/${link.id}`)
    expect(gone.statusCode).toBe(404)
    expect(gone.json()).toMatchObject({
      message: "This link has stopped, or it isn't one of this workspace's.",
    })
  })

  it('makes no link and opens none while an admin has turned sharing off', async () => {
    const link = (await call('author', 'POST', '/shared-chats', chat())).json<MyShare>()
    await setting('ask.share_chats', false)
    const refused = await call('author', 'POST', '/shared-chats', chat())
    expect(refused.statusCode).toBe(412)
    expect(refused.json()).toMatchObject({ message: 'An admin has turned off sharing chats.' })
    expect((await call('member', 'GET', `/shared-chats/${link.id}`)).statusCode).toBe(404)
    expect((await call('author', 'GET', `/shared-chats/${link.id}`)).statusCode).toBe(404)
    // Its sender still sees the link, to stop it.
    expect((await call('author', 'GET', '/shared-chats')).json<MyShares>()).toMatchObject({
      on: false,
      links: [{ id: link.id }],
    })
  })

  it('ends after 90 days, and the retention run deletes it', async () => {
    const link = (await call('author', 'POST', '/shared-chats', chat())).json<MyShare>()
    await client.query(
      `update shared_chats set created_at = now() - interval '91 days',
         expires_at = now() - interval '1 day'`,
    )
    expect((await call('member', 'GET', `/shared-chats/${link.id}`)).statusCode).toBe(404)
    expect((await call('author', 'GET', '/shared-chats')).json<MyShares>().links).toEqual([])
    const removed = await client.query<{ what: string; n: string }>(
      'select what, n from cl_retention_run()',
    )
    expect(Number(removed.rows.find((r) => r.what === 'shared_chats')?.n)).toBe(1)
    expect((await client.query('select 1 from shared_chats')).rowCount).toBe(0)
  })

  it('opens for no one signed out, and refuses a link longer than 90 days', async () => {
    const link = (await call('author', 'POST', '/shared-chats', chat())).json<MyShare>()
    expect((await call(null, 'GET', `/shared-chats/${link.id}`)).statusCode).toBe(401)
    await expect(
      client.query(`update shared_chats set expires_at = created_at + interval '91 days'`),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('is never read on the agents’ path', async () => {
    for (const role of [localRoles.serve, localRoles.readonly]) {
      const allowed = await client.query<{ allowed: boolean }>(
        "select has_table_privilege($1, 'shared_chats', 'SELECT') as allowed",
        [role],
      )
      expect(allowed.rows[0]!.allowed).toBe(false)
    }
  })
})
