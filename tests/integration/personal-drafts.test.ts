import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ItemBulkResult, LeftDrafts, SavedDraft } from '../../src/contract/context.ts'
import type { ItemImportReport, LibraryIndex } from '../../src/contract/index.ts'
import type { Card, Feed } from '../../src/contract/inbox.ts'
import type { ProposalListResult, ProposalRecord } from '../../src/contract/proposals.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { buildApp } from '../../src/server/app.ts'
import { identifier, localRoles } from '../../src/server/db/roles.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Drafts are personal (FR-139): only the person who wrote a draft reads it, through row security,
  so the Context list, a draft's page and a change to many rows follow it. Save as draft keeps the
  words as the person's own. An admin clears the drafts of someone who left by count, unread. The
  writer's Inbox has one card for their imported and old drafts. `owner` owns Finance, `admin` is
  an administrator, and `author` and `member` are members.
*/

const { client, url } = testDatabase()
const app = buildApp({
  database: apiDatabase(url),
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock: systemClock('2026-10-08'),
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
})

type Who = keyof typeof people
const headers: Partial<Record<Who, Record<string, string>>> = {}
const call = (method: 'GET' | 'POST', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
const ok = async <T>(response: Promise<{ statusCode: number; body: string; json: <U>() => U }>) => {
  const r = await response
  expect(r.statusCode, r.body).toBe(200)
  return r.json<T>()
}

const markets = Array.from({ length: 30 }, (_, i) => `d${String(i).padStart(2, '0')}`)
let nextMarket = 0
function draft(extra: Draft = {}): Draft {
  const market = markets[nextMarket++]!
  return {
    areaId: 'finance',
    kind: 'note',
    title: `Orders leave out test accounts in ${market}`,
    summary: 'Orders leave out the 40 accounts the team uses to test the webshop.',
    scope: {
      metrics: ['metric:orders'],
      dimensions: [],
      dimensionValues: [{ dimension: 'dim:market', value: `val:market/${market}` }],
    },
    validity: { start: '2026-01-01', end: null },
    evidence: [
      {
        url: 'https://wiki.example/test-accounts',
        quote: 'Test accounts are left out',
        date: '2026-10-01',
      },
    ],
    ...extra,
  }
}
/** A draft of `who`'s, never sent. */
const aDraft = async (who: Who = 'author', extra: Draft = {}) =>
  (await ok<ProposalRecord>(call('POST', '/proposals', who, { draft: draft(extra) }))).id

/** What the Context list reads for a person: the published index, and the drafts they see. */
async function contextOf(who: Who) {
  const [index, drafts] = await Promise.all([
    ok<LibraryIndex>(call('GET', '/library', who)),
    ok<ProposalListResult>(call('GET', '/proposals?state=draft&limit=100&offset=0', who)),
  ])
  return { items: index.items, drafts: drafts.rows.map((d) => d.id), total: drafts.total }
}
const draftsCard = async (who: Who) =>
  (await ok<Feed>(call('GET', '/inbox/feed', who))).cards.find(
    (c): c is Extract<Card, { group: 'drafts' }> => c.group === 'drafts',
  )

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    await client.query(
      `insert into vocab_terms(key,kind) select 'val:market/'||m,'dimension_value'
         from unnest($1::text[]) m`,
      [markets],
    )
    const [{ seq }] = (
      await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
    ).rows as [{ seq: string }]
    for (const [key, name, area] of [
      ['metric:orders', 'Orders', 'finance'],
      ['dim:market', 'Market', null],
      ...markets.map((m) => [`val:market/${m}`, `Market ${m}`, null]),
    ]) {
      const term = await client.query<{ id: string }>(
        `insert into vocab_term_versions (term_key,version_no,name,area_id,content_digest)
         values($1,1,$2,$3,sha256(convert_to($1,'UTF8'))) returning id`,
        [key, name, area],
      )
      await client.query(
        "insert into vocab_term_service(term_key,version_id,editions) values($1,$2,int8range($3,null,'[)'))",
        [key, term.rows[0]!.id, seq],
      )
    }
    await client.query('select edition_seal($1)', [seq])
    await client.query('select edition_publish($1)', [seq])
  })
  for (const name of Object.keys(people) as Who[]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin: 'http://localhost', 'x-footnote-csrf': 'dev-sign-in' },
      payload: { email: `${name}@example.test` },
    })
    expect(response.statusCode, response.body).toBe(200)
    headers[name] = {
      origin: 'http://localhost',
      cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-footnote-csrf': response.json<{ csrfToken: string }>().csrfToken,
    }
  }
})
afterAll(async () => {
  await app.close()
})

describe('row security of drafts', () => {
  async function as<T>(who: Who, work: () => Promise<T>): Promise<T> {
    await client.query('begin')
    try {
      await client.query(`set local role ${identifier(localRoles.api)}`)
      await client.query("select set_config('cl.person_id', $1, true)", [people[who]])
      return await work()
    } finally {
      await client.query('rollback')
    }
  }

  it("lets only its writer read or change a draft: an owner of its domain and an admin can't", async () => {
    const theirs = await aDraft('author')
    for (const who of ['owner', 'admin', 'member'] as const)
      await as(who, async () => {
        const read = await client.query('select 1 from proposals where id = $1', [theirs])
        expect(read.rowCount, who).toBe(0)
        const changed = await client.query(
          "update proposals set reason = 'changed' where id = $1",
          [theirs],
        )
        expect(changed.rowCount, who).toBe(0)
        const events = await client.query('select 1 from proposal_events where proposal_id = $1', [
          theirs,
        ])
        expect(events.rowCount, who).toBe(0)
      })
    await as('author', async () => {
      const read = await client.query('select 1 from proposals where id = $1', [theirs])
      expect(read.rowCount).toBe(1)
    })
  })

  it("never lets an owner or an admin write a draft in someone else's name", async () => {
    for (const who of ['owner', 'admin'] as const)
      await as(who, async () => {
        await expect(
          client.query(
            `insert into proposals (action, area_id, proposer_id, channel, draft)
             values ('create', 'finance', $1, 'form', '{}')`,
            [people.author],
          ),
        ).rejects.toThrow(/row-level security/)
      })
  })

  it("leaves a suggestion waiting for review to its domain's owners and admins, as before", async () => {
    const sent = await ok<ProposalRecord>(
      call('POST', `/proposals/${await aDraft('author')}/submit`, 'author', { revision: 1 }),
    )
    expect(sent.state).toBe('submitted')
    for (const who of ['owner', 'admin'] as const)
      expect((await call('GET', `/proposals/${sent.id}`, who)).statusCode, who).toBe(200)
    expect((await call('GET', `/proposals/${sent.id}`, 'member')).statusCode).toBe(404)
  })

  it("keeps an owner's Context list as it was when a member writes a draft in their domain", async () => {
    const before = await contextOf('owner')
    const theirs = await aDraft('author')
    const after = await contextOf('owner')
    expect(after).toEqual(before)
    expect((await contextOf('author')).drafts).toContain(theirs)
    // A change to many rows does not find it either.
    const r = await ok<{ skipped: { id: string; code: string }[] }>(
      call('POST', '/items/bulk', 'owner', { action: 'delete', rows: [theirs] }),
    )
    expect(r.skipped).toEqual([expect.objectContaining({ id: theirs, code: 'not_found' })])
  })
})

describe('Save as draft', () => {
  it("keeps the person's words as their own draft, and saves them again in place", async () => {
    const words = draft({ evidence: [] })
    const saved = await ok<SavedDraft>(call('POST', '/drafts', 'author', { draft: words }))
    const read = await ok<ProposalRecord>(call('GET', `/proposals/${saved.proposalId}`, 'author'))
    expect(read).toMatchObject({ state: 'draft', proposerId: people.author, channel: 'form' })
    expect(read.draft.title).toBe(words.title)
    expect((await call('GET', `/proposals/${saved.proposalId}`, 'owner')).statusCode).toBe(404)

    const again = await ok<SavedDraft>(
      call('POST', '/drafts', 'author', {
        draft: { ...words, title: 'Orders leave out every test account' },
        draftId: saved.proposalId,
        revision: saved.revision,
      }),
    )
    expect(again.proposalId).toBe(saved.proposalId)
    expect(again.revision).toBeGreaterThan(saved.revision)
    const reread = await ok<ProposalRecord>(call('GET', `/proposals/${saved.proposalId}`, 'author'))
    expect(reread).toMatchObject({ state: 'draft' })
    expect(reread.draft.title).toBe('Orders leave out every test account')
    // Who changed each field, and at which revision: the person, as the editor says it.
    expect(reread.fieldStamps.title).toMatchObject({ by: 'person', revision: again.revision })
  })

  it('saves over the revision the words were written from, and nothing over a newer one', async () => {
    const words = draft({ evidence: [] })
    const saved = await ok<SavedDraft>(call('POST', '/drafts', 'author', { draft: words }))
    const again = { draft: { ...words, title: 'Orders leave out test accounts' } }
    // Saved again with no revision says which one it needs.
    const unnamed = await call('POST', '/drafts', 'author', {
      ...again,
      draftId: saved.proposalId,
    })
    expect(unnamed.statusCode).toBe(400)
    await ok(
      call('POST', '/drafts', 'author', {
        ...again,
        draftId: saved.proposalId,
        revision: saved.revision,
      }),
    )
    // An editor still on the first revision (the agent wrote since) saves nothing, and gets the
    // draft as it is now to merge its words with.
    const stale = await call('POST', '/drafts', 'author', {
      draft: { ...words, title: 'Orders leave out staff accounts' },
      draftId: saved.proposalId,
      revision: saved.revision,
    })
    expect(stale.statusCode).toBe(409)
    const current = stale.json<{ data: { current: ProposalRecord } }>().data.current
    expect(current).toMatchObject({ id: saved.proposalId, revision: saved.revision + 1 })
    expect(current.draft.title).toBe('Orders leave out test accounts')
    expect(current.fieldStamps.title).toMatchObject({ by: 'person' })
  })

  it("never saves into someone else's draft, or into one that was sent", async () => {
    const theirs = await aDraft('author')
    const refused = await call('POST', '/drafts', 'owner', {
      draft: draft(),
      draftId: theirs,
      revision: 1,
    })
    expect(refused.statusCode).toBe(404)
    const sent = await ok<ProposalRecord>(
      call('POST', `/proposals/${await aDraft('author')}/submit`, 'author', { revision: 1 }),
    )
    const late = await call('POST', '/drafts', 'author', {
      draft: draft(),
      draftId: sent.id,
      revision: sent.revision,
    })
    expect(late.statusCode).toBe(404)
  })

  it('needs an active domain, as any draft does', async () => {
    const refused = await call('POST', '/drafts', 'author', {
      draft: draft({ areaId: 'nowhere' }),
    })
    expect(refused.statusCode).toBe(422)
  })
})

describe('the drafts of people who left', () => {
  it('counts them for an admin, who deletes them unread; the History log says how many', async () => {
    const gone = [await aDraft('member'), await aDraft('member')]
    const kept = await aDraft('member')
    await ok(call('POST', '/proposals/' + kept + '/submit', 'member', { revision: 1 }))
    // Still here: nothing to clear.
    expect(await ok<LeftDrafts[]>(call('GET', '/drafts/left', 'admin'))).toEqual([])
    const early = await call('POST', `/drafts/left/${people.member}/clear`, 'admin')
    expect(early.statusCode).toBe(409)

    await ok(call('POST', `/members/${people.member}/remove`, 'admin'))
    expect(await ok<LeftDrafts[]>(call('GET', '/drafts/left', 'admin'))).toEqual([
      { personId: people.member, name: 'member', drafts: 2 },
    ])
    expect((await call('GET', '/drafts/left', 'owner')).statusCode).toBe(403)
    expect((await call('POST', `/drafts/left/${people.member}/clear`, 'owner')).statusCode).toBe(
      403,
    )

    expect(
      await ok<{ deleted: number }>(call('POST', `/drafts/left/${people.member}/clear`, 'admin')),
    ).toEqual({ deleted: 2 })
    expect(await ok<LeftDrafts[]>(call('GET', '/drafts/left', 'admin'))).toEqual([])
    const left = await client.query<{ id: string; discarded: boolean; by: string | null }>(
      `select id::text, discarded_at is not null as discarded, discarded_by::text as by
         from proposals where proposer_id = $1 and state = 'draft' order by id`,
      [people.member],
    )
    expect(left.rows).toEqual(
      [...gone].sort().map((id) => ({ id, discarded: true, by: people.admin })),
    )
    // The suggestion it sent still waits for its owners.
    expect((await ok<ProposalRecord>(call('GET', `/proposals/${kept}`, 'owner'))).state).toBe(
      'submitted',
    )
    const logged = await client.query<{ details: { drafts: number; name: string } }>(
      "select details from audit_log where action = 'drafts.cleared' and subject_id = $1",
      [people.member],
    )
    expect(logged.rows).toEqual([{ details: { drafts: 2, name: 'member' } }])
  })
})

describe("the writer's drafts card in the Inbox", () => {
  it('holds their imported drafts and those not saved for 30 days, for them alone', async () => {
    const before = await draftsCard('admin')
    const fresh = await aDraft('admin')
    const imported = await aDraft('admin')
    const old = await aDraft('admin')
    await transaction(client, async () => {
      const [batch] = (
        await client.query<{ id: string }>(
          `insert into import_batches (created_by, mode, state, summary)
           values ($1, 'apply', 'done', '{}') returning id::text`,
          [people.admin],
        )
      ).rows
      await client.query('update proposals set import_batch_id = $2 where id = $1', [
        imported,
        batch!.id,
      ])
      await client.query(
        "update proposals set draft_saved_at = now() - interval '31 days' where id = $1",
        [old],
      )
    })
    expect(before).toBeUndefined()
    const card = await draftsCard('admin')
    expect(card).toMatchObject({ id: 'drafts:yours', areaId: 'finance', done: null })
    expect(card?.drafts).toEqual([
      { id: imported, areaId: 'finance', imported: true },
      { id: old, areaId: 'finance', imported: false },
    ])
    expect(card?.drafts.map((d) => d.id)).not.toContain(fresh)
    // An owner of the domain hears nothing of them.
    expect(await draftsCard('owner')).toBeUndefined()

    // Published from the card, as from the Context list, they leave it.
    const r = await ok<{ done: string[] }>(
      call('POST', '/items/bulk', 'admin', { action: 'publish', rows: [imported, old] }),
    )
    expect(r.done).toEqual([imported, old])
    expect(await draftsCard('admin')).toBeUndefined()
  })
})

describe('Undo of a publish from the Context list', () => {
  const undo = (who: Who, token: string) => ok(call('POST', '/decisions/undo', who, { token }))
  /** Imports `n` drafts as `who`'s, kept as drafts: the ids of the proposals it made. */
  async function imported(who: Who, n: number) {
    const report = await ok<ItemImportReport>(
      call('POST', '/imports', who, {
        content: JSON.stringify(Array.from({ length: n }, () => draft())),
        dryRun: false,
        submit: false,
      }),
    )
    return report.entries.map((e) => e.proposalId!)
  }
  /** Each draft's import batch and source links, by title: what its copy keeps. */
  const provenance = async (ids: string[]) =>
    (
      await client.query<Record<string, string | null>>(
        `select draft->>'title' as title, import_batch_id::text as batch, source_id::text as source,
                source_read_id::text as read, source_document_id as document
           from proposals where id = any($1::uuid[]) order by draft->>'title'`,
        [ids],
      )
    ).rows

  // Published at once by an owner, and sent to the owners by a member: either way, Undo makes the
  // drafts again, one of their import each, so the card counts what the Context list counts.
  it.each(['owner', 'author'] as const)(
    "keeps a %s's imported drafts in their import, so the Inbox card and Context agree",
    async (who) => {
      // What each counted before, as other tests leave drafts of theirs.
      const counted = async () => {
        const [context, card] = [await contextOf(who), await draftsCard(who)]
        return { context: context.drafts, card: card?.drafts.map((d) => d.id) ?? [] }
      }
      const before = await counted()
      const ids = await imported(who, 2)
      const was = await provenance(ids)
      expect(was.every((d) => d.batch)).toBe(true)
      const r = await ok<ItemBulkResult>(
        call('POST', '/items/bulk', who, { action: 'publish', rows: ids }),
      )
      expect(r.done).toEqual(ids)
      expect(await counted()).toEqual(before)

      await undo(who, r.undo!.token)
      const after = await counted()
      const back = after.context.filter((id) => !before.context.includes(id))
      expect(back).toHaveLength(ids.length)
      expect(after.card.filter((id) => !before.card.includes(id)).sort()).toEqual(back.sort())
      // The source links copy is defensive: source drafts have no proposer, so they never reach the bulk bar.
      // The copies are new drafts that keep the import of those they restore.
      expect(back.some((id) => ids.includes(id))).toBe(false)
      expect(await provenance(back)).toEqual(was)
    },
  )
})
