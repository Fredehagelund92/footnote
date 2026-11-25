import { describe, expect, it } from 'vitest'
import type { LoopTurn } from '@contract/answer'
import { scriptedLoopChoice, type ScriptedStep } from '../../../src/server/modules/answer/index.ts'
import { createToolService } from '../../../src/server/mcp/service.ts'
import { createEditionSource } from '../../../src/server/modules/editions/index.ts'
import { servingPool } from '../../integration/support.ts'
import { askWorld } from './ask-world.ts'

/*
  What is not published yet, in Ask (FR-718.2 as amended 25 Nov 2026), on the demo week through
  the real service and row security. When nothing published matches every word of a search, Ask
  finds what does among the asker's own drafts and the suggestions waiting for review they may
  open, and shows it in one block under the answer: never a source, never said as a fact. Jon's
  own draft about Black Friday is his alone. Kofi's suggestion about Poland's payment provider
  waits for Sales' owners, Jon and Sofia, and the admin, Ravi. Ines, a member, may open neither,
  and her turn is the turn she gets with both gone. Agents get none of it (FR-718.5).
*/

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

const BLACK_FRIDAY = 'Black Friday 2026 orders are split over two weeks'
const POLAND = 'Payment provider delays order data in Poland'

let step: (results: readonly { toolName: string; value: unknown }[]) => ScriptedStep = () => ({})
let words = ''
const world = askWorld({
  askTrace: {
    loopModel: scriptedLoopChoice('drafts', (prompt) =>
      prompt.step === 0
        ? { calls: [{ toolName: 'find_context', input: { words } }] }
        : step(prompt.results),
    ),
  },
})

/** The drafts a find_context read gave, as the model reads them. */
const draftsIn = (results: readonly { toolName: string; value: unknown }[]) => {
  const r = results.find((x) => x.toolName === 'find_context')?.value
  return isObj(r) && isObj(r.drafts) ? (r.drafts.items as Obj[]) : []
}

async function ask(who: string, question: string, searched: string, write = step) {
  words = searched
  step = write
  const api = await world.as(who)
  return (await api.ask({ question })).loop!
}

/**
 * Every draft and suggestion waiting for review gone, as if none was ever written: drafts
 * discarded, suggestions withdrawn. Returns what puts each back as it was.
 */
async function hidePending() {
  const { rows } = await world.client.query<{ id: string; state: string }>(
    "select id::text, state::text from proposals where discarded_at is null and state in ('draft', 'submitted', 'in_review')",
  )
  const ids = rows.map((r) => r.id)
  await world.client.query(
    "update proposals set discarded_at = now() where id = any($1::uuid[]) and state = 'draft'",
    [ids],
  )
  await world.client.query(
    "update proposals set state = 'withdrawn', closed_at = now() where id = any($1::uuid[]) and state <> 'draft'",
    [ids],
  )
  // A suggestion moves on from withdrawn only past its guard, as the seed writes past it.
  return async () => {
    await world.client.query('begin')
    await world.client.query("set local session_replication_role = 'replica'")
    for (const r of rows)
      await world.client.query(
        'update proposals set discarded_at = null, closed_at = null, state = $2::proposal_state where id = $1',
        [r.id, r.state],
      )
    await world.client.query('commit')
  }
}

/** A turn as it compares: every part of it, what it read too. */
const same = (t: LoopTurn) => structuredClone(t)

describe('the reads, as each person may open what is not published yet', () => {
  it("gives Jon his own draft, and Sofia none of it: a draft is its writer's alone", async () => {
    const jon = await world.withTools('Jon Abara', (t) =>
      t.run('find_context', { words: 'Black Friday' }),
    )
    expect(jon).toMatchObject({ everyWord: 0, drafts: { found: 1 } })
    const [draft] = (jon as { drafts: { items: Obj[] } }).drafts.items
    expect(draft).toMatchObject({ state: 'draft', title: BLACK_FRIDAY, by: 'Jon Abara' })
    expect(draft!.ref).toMatch(/^draft:\d+$/)
    // It is no source: its id is not among the ids the words may cite.
    expect((jon as { ids: string[] }).ids).not.toContain(draft!.id)
    const sofia = await world.withTools('Sofia Brandt', (t) =>
      t.run('find_context', { words: 'Black Friday' }),
    )
    expect(sofia).not.toHaveProperty('drafts')
  })

  it("gives a suggestion waiting for review to its domain's owners and the admin, never a member", async () => {
    for (const who of ['Jon Abara', 'Sofia Brandt', 'Ravi Kapoor']) {
      const r = await world.withTools(who, (t) =>
        t.run('find_context', { words: 'Poland payment provider delays' }),
      )
      expect(r, who).toMatchObject({
        everyWord: 0,
        drafts: { items: [{ state: 'waiting', title: POLAND, by: 'Kofi Mensah' }] },
      })
    }
    for (const who of ['Ines Duarte', 'Maria Lindqvist', 'Tomas Eriksen']) {
      const r = await world.withTools(who, (t) =>
        t.run('find_context', { words: 'Poland payment provider delays' }),
      )
      expect(r, who).not.toHaveProperty('drafts')
    }
  })

  it('searches what is not published yet only when nothing published matches every word', async () => {
    const r = await world.withTools('Jon Abara', (t) => t.run('find_context', { words: 'Norway' }))
    expect(r).toMatchObject({ everyWord: expect.any(Number) as number })
    expect((r as { everyWord: number }).everyWord).toBeGreaterThan(0)
    expect(r).not.toHaveProperty('drafts')
  })
})

describe('the block under the answer', () => {
  it('(a) lists the writer’s draft apart from the answer, with its one conditional sentence', async () => {
    const loop = await ask(
      'Jon Abara',
      'How are Black Friday orders counted?',
      'Black Friday',
      (results) => {
        const [d] = draftsIn(results)
        return {
          text: `Nothing published covers Black Friday orders yet. If it is published as written, Black Friday weekend orders are counted in two reporting weeks [${String(d!.ref)}].`,
        }
      },
    )
    expect(loop.drafts).toMatchObject({
      words: ['Black Friday'],
      found: 1,
      more: 0,
      rows: [
        {
          state: 'draft',
          title: BLACK_FRIDAY,
          by: 'Jon Abara',
          action: { id: 'open_draft', draft: { mine: true } },
        },
      ],
    })
    expect(loop.drafts!.sentence?.map((r) => (r.t === 'text' ? r.text : '')).join('')).toMatch(
      /^If it is published as written, Black Friday weekend orders are counted in two reporting weeks\.$/,
    )
    // Nothing cites it, and the answer's words say nothing of it.
    expect(loop.sources).toEqual([])
    expect(loop.text).toBe('Nothing published covers Black Friday orders yet.')
    expect(loop.said).not.toMatch(/draft:/)
    expect(loop.read).toContain(
      'Searched the drafts and suggestions waiting for review you can open for “Black Friday”: 1 found, not published.',
    )
    // The block stands in for the gap card.
    expect(loop.unknown).toBeUndefined()
  })

  it('(b) gives Sofia, an owner of Sales, the waiting suggestion and Review', async () => {
    const loop = await ask(
      'Sofia Brandt',
      'Is order data from Poland late?',
      'Poland payment provider delays',
      () => ({ text: 'Nothing published covers late order data from Poland.' }),
    )
    expect(loop.drafts?.rows).toMatchObject([
      {
        state: 'waiting',
        title: POLAND,
        by: 'Kofi Mensah',
        domain: 'domain:area_sales',
        action: { id: 'review_suggestion', draft: { mine: false } },
      },
    ])
    expect(loop.drafts?.sentence).toBeNull()
    expect(loop.nouns.map((n) => n.id)).toContain('domain:area_sales')
  })

  it('(e) takes out of the answer a sentence that states what is not published yet as a fact', async () => {
    const loop = await ask(
      'Jon Abara',
      'How are Black Friday orders counted?',
      'Black Friday',
      (results) => {
        const [d] = draftsIn(results)
        return {
          text: `Black Friday weekend orders are counted in two reporting weeks [${String(d!.ref)}]. ${BLACK_FRIDAY}. Nothing published covers it yet.`,
        }
      },
    )
    expect(loop.text).toBe('Nothing published covers it yet.')
    expect(loop.drafts?.sentence).toBeNull()
    expect(loop.checks.filter((c) => c.kind === 'draft')).toHaveLength(2)
  })

  it('(c) gives Ines, a member, the turn she gets with nothing unpublished there at all', async () => {
    const write = () => ({ text: 'Nothing published covers late order data from Poland.' })
    const question = 'Is order data from Poland late?'
    const before = await ask('Ines Duarte', question, 'Poland payment provider delays', write)
    expect(before.drafts).toBeUndefined()
    const restore = await hidePending()
    try {
      const after = await ask('Ines Duarte', question, 'Poland payment provider delays', write)
      expect(same(after)).toEqual(same(before))
    } finally {
      await restore()
    }
  })
})

describe('agents (FR-718.5)', () => {
  it('get the same replies with what is not published yet there and gone', async () => {
    const pool = servingPool(world.url)
    const store = {
      write: () => Promise.resolve(),
      reportGap: () => Promise.resolve(),
      feedback: () => Promise.resolve(),
    }
    const mcp = createToolService(createEditionSource(pool), store as never, () => new Date())
    const principal = {
      client: 'claude',
      scopes: ['read'],
      caller: 'agent',
      canSelectEdition: false,
    } as const
    const calls = async () =>
      Promise.all(
        (
          [
            ['find_context', { query: 'Black Friday' }],
            ['find_context', { query: 'Poland payment provider delays' }],
            ['get_context', { about: 'orders in Poland' }],
          ] as const
        ).map(async ([tool, input]) =>
          JSON.stringify((await mcp(tool, input, principal, 100_000, () => {})).structuredContent),
        ),
      )
    let restore = async () => {}
    try {
      const before = await calls()
      for (const reply of before) {
        expect(reply).not.toContain(BLACK_FRIDAY)
        expect(reply).not.toContain(POLAND)
        expect(reply).not.toMatch(/draft:\d|"drafts"/)
      }
      restore = await hidePending()
      expect(await calls()).toEqual(before)
    } finally {
      await restore()
      await pool.end()
    }
  })
})
