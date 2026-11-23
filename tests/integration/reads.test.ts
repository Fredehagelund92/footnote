import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { regression } from '../../db/seed/fixtures/items.ts'
import { seedPersonId } from '../../db/seed/bulk.ts'
import { demoTestQuestions } from '../../db/seed/test-questions.ts'
import { UTC_CALENDAR } from '../../src/domain/dates.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createToolService } from '../../src/server/mcp/service.ts'
import type { AskToolName, AskTools } from '../../src/server/modules/answer/index.ts'
import { loadLiveBundle, type ServingBundle } from '../../src/server/modules/editions/index.ts'
import { apiDatabase, askToolsAs, testDatabase } from './support.ts'

/*
  The reads at the demo's real size: the 1,500 items of the bulk seed, read as Ask's model and an
  outside agent read them, with no model and nothing recorded. Each case is a miss a live model hit
  on this library, when the reads gave the first 20 items that apply by risk and date whatever the
  question asked, read a name a different way in each tool, and told agents to raise a limit that
  was already at its largest (decided 23 November 2026: one engine and one order of items, for Ask
  and for agents alike). Seconds, in every build. DEMO DATA ONLY.
*/

const { url } = testDatabase({ seeded: true })
const database = apiDatabase(url)
const today = '2026-11-23'
const asTools = askToolsAs(database, systemClock(today))
const administrator = seedPersonId('per_ravi')
let bundle: ServingBundle

beforeAll(async () => {
  bundle = (await database.transaction(null, loadLiveBundle))!
}, 300_000)
afterAll(() => database.close())

type Reply = {
  status: string
  say: string
  next?: string
  asked?: string | null
  defined?: { metric: string }[]
  context?: { id: string; title: string }[]
  next_cursor?: string | null
  unread?: { word: string; closest: string[]; domain?: string }[]
  check_report?: { matched: number; cut: boolean }
}
/** get_context as an outside agent calls it, and the size of its reply. */
async function agent(input: Record<string, unknown>) {
  const execute = createToolService(
    {
      bundle: () => Promise.resolve(bundle),
      policy: () =>
        Promise.resolve({
          client: null,
          tools: [],
          limits: {},
          rates: { person: 30, client: 120 },
          about: '',
          calendar: UTC_CALENDAR,
        }),
    },
    {
      write: () => Promise.reject(new Error('no demand')),
      reportGap: () => Promise.reject(new Error('no demand')),
      feedback: () => Promise.reject(new Error('no demand')),
    },
    () => new Date(`${today}T12:00:00Z`),
  )
  const reply = await execute(
    'get_context',
    input,
    { client: 'reads-test', scopes: ['read'], caller: 'agent', canSelectEdition: false },
    100_000,
    () => {},
  )
  expect(reply.isError).not.toBe(true)
  return { out: reply.structuredContent as Reply, bytes: Buffer.byteLength(JSON.stringify(reply)) }
}

/** A read of Ask's, as the administrator, who may read every item: never an error. */
async function ask<N extends AskToolName>(tools: AskTools, name: N, input: object, question = '') {
  const result = await tools.run(name, input, { lastPeriod: null, question })
  if ('error' in result && typeof result.error === 'string' && !('found' in result))
    throw new Error(`${name} failed: ${result.error}`)
  return result as Exclude<typeof result, { error: string; ids: string[] }>
}

/** About 6,000 tokens: a reply's bytes are about four to a token. */
const REPLY_BUDGET = 24_000
const notReliable = /^Data for Gross margin before .+ is not reliable$/

describe('what applies, in the order of the question', () => {
  const question = 'Is the gross margin number reliable?'

  it('gives Ask the items titled "not reliable" first, and the rest by title', async () => {
    await asTools(administrator, async (tools) => {
      const read = await ask(tools, 'get_context', { about: 'gross margin' }, question)
      expect(read.items.slice(0, 3).map((i) => i.title)).toEqual([
        expect.stringMatching(notReliable),
        expect.stringMatching(notReliable),
        expect.stringMatching(notReliable),
      ])
      // Past the first 20, every item that applies is named, in the same order, and can be read.
      expect(read.items).toHaveLength(20)
      expect(read.more).toBeGreaterThan(20)
      expect(read.rest).toHaveLength(Math.min(read.more, 50))
      expect(read.ids).toEqual(expect.arrayContaining(read.rest.map((r) => r.id)))
      const one = await ask(tools, 'read_context', { id: read.rest[0]!.id })
      expect(one.item?.title).toBe(read.rest[0]!.title)
    })
  })

  it('gives agents the same first items, and the rest a cursor away', async () => {
    const first = await agent({ question })
    expect(first.out.context!.slice(0, 3).map((i) => i.title)).toEqual([
      expect.stringMatching(notReliable),
      expect.stringMatching(notReliable),
      expect.stringMatching(notReliable),
    ])
    expect(first.bytes).toBeLessThanOrEqual(REPLY_BUDGET)
    // What the reply says to do about the cut works: following it reaches every item once.
    expect(first.out.next).toContain('cursor set to next_cursor')
    expect(first.out.next).not.toContain('max_bytes')
    const seen = first.out.context!.map((i) => i.id)
    let cursor = first.out.next_cursor
    while (cursor) {
      const page = await agent({ question, cursor })
      expect(page.out.context!.map((i) => i.id).filter((id) => seen.includes(id))).toEqual([])
      seen.push(...page.out.context!.map((i) => i.id))
      cursor = page.out.next_cursor
    }
    expect(seen).toHaveLength(first.out.check_report?.matched ?? (await full(question)))
  })

  it("puts the item each of the demo's test questions expects first, and loses none", async () => {
    const cases = demoTestQuestions.filter(
      ({ question: q, setAside }) =>
        !setAside &&
        (q.split ?? 'development') === 'development' &&
        q.expected.must_deliver?.length,
    )
    const places: number[] = []
    await asTools(administrator, async (tools) => {
      for (const { question: q } of cases)
        for (const { text } of q.wordings) {
          const read = await ask(tools, 'get_context', { about: text }, text)
          const replied = await agent({ question: text })
          for (const id of q.expected.must_deliver ?? []) {
            // The demo's regression: the note ended on 30 September, so it rightly applies to none.
            if (id === regression.item) continue
            places.push(read.items.findIndex((i) => i.id === id) + 1)
            // Agents get it in the first reply.
            expect(
              replied.out.context!.map((i) => i.id),
              text,
            ).toContain(id)
          }
        }
    })
    expect(places.length).toBeGreaterThan(20)
    expect(places.filter((place) => place === 0)).toEqual([])
    expect(places.filter((place) => place === 1).length).toBeGreaterThanOrEqual(20)
  })
})

/** How many items apply to a question, as a full reply counts them. */
async function full(question: string) {
  const reply = await agent({ question, max_items: 50, response_format: 'full' })
  return reply.out.check_report!.matched
}

describe('find_context, best first', () => {
  it('puts what is in force today before what ended, not the oldest id first', async () => {
    await asTools(administrator, async (tools) => {
      const found = await ask(tools, 'find_context', { words: 'returns' })
      const ended = (id: string) => {
        const until = bundle.items.find((i) => i.id === id)!.validity.end
        return until !== null && until <= today
      }
      const order = found.items.map((i) => ended(i.id))
      // Every item that ended comes after every item in force.
      expect(order.indexOf(true) === -1 || !order.slice(order.indexOf(true)).includes(false)).toBe(
        true,
      )
      expect(order[0]).toBe(false)
    })
  })

  it('weighs a rare word above a common name', async () => {
    await asTools(administrator, async (tools) => {
      // Hundreds of items name Norway or Orders; few say "regulator".
      const found = await ask(tools, 'find_context', { words: 'Norway orders regulator' })
      expect(found.items[0]!.title).toMatch(/^Regulator /)
    })
  })
})

describe('one reader of names, in every tool', () => {
  // A name as people write it loosely, and the metric it reads as, or null for none.
  const loose: [string, string | null][] = [
    ['ROAS', 'Return on ad spend'],
    ['AOV', 'Average order value'],
    ['CPA', 'Cost per acquisition'],
    ['CLV', 'Customer lifetime value'],
    ['churn', 'Churn rate'],
    ['margin', 'Gross margin'],
    ['shipping', 'On-time shipping rate'],
    ['discount', 'Discount cost'],
    ['conversion', 'Conversion rate'],
    ['acquisition', 'Cost per acquisition'],
    ['lifetime value', 'Customer lifetime value'],
    ['customer churn', 'Churn rate'],
    ['gross margins', 'Gross margin'],
    ['customers active', 'Active customers'],
    ['margin gross', 'Gross margin'],
    ['order', 'Orders'],
    ['buyer', 'First-time buyers'],
    ['return', 'Returns'],
    // A word in several names names none of them; a word in none is no name.
    ['units', null],
    ['rate', null],
    ['EBITDA', null],
  ]

  it.each(loose)('reads "%s" the same in Ask and for agents', async (words, metric) => {
    await asTools(administrator, async (tools) => {
      const got = await ask(tools, 'get_context', { about: words, no_period: true }, words)
      const found = await ask(tools, 'find_context', { words })
      const defined = await ask(tools, 'definitions', { names: [words] })
      const replied = await agent({ question: words })
      const named = metric ? [metric] : []
      expect(got.read?.names ?? []).toEqual(named)
      expect(found.searched[0]!.names).toEqual(named)
      // A name nothing goes by may still be found in the words of a definition: never as its name.
      expect(defined.definitions.filter((d) => !d.mentions).map((d) => d.name)).toEqual(named)
      if (metric) expect(replied.out.asked).toMatch(new RegExp(`^${metric} `))
      else {
        expect(replied.out.status).toBe('need_more_detail')
        expect(replied.out.unread?.map((u) => u.word.toLowerCase())).toEqual([words.toLowerCase()])
        expect(got.unread.map((u) => u.word.toLowerCase())).toEqual([words.toLowerCase()])
      }
    })
  })

  it('gives an agent the definition of ROAS', async () => {
    const { out } = await agent({ question: 'What is ROAS?' })
    expect(out.defined?.map((d) => d.metric)).toEqual(['Return on ad spend'])
  })

  it('names the word it could not read, never answering for the rest alone', async () => {
    const question = 'How did sales in Norway change in October 2026?'
    const { out } = await agent({ question })
    expect(out.unread).toEqual([{ word: 'sales', closest: ['Gross sales'], domain: 'Sales' }])
    expect(out.say).toContain('"sales" names no metric here')
    await asTools(administrator, async (tools) => {
      const read = await ask(tools, 'get_context', { about: 'sales in Norway in October 2026' })
      expect(read.unread).toEqual([{ word: 'sales', closest: ['Gross sales'], domain: 'Sales' }])
    })
  })
})

describe('what agents are told', () => {
  it('answers a word that names nothing with that word, never with unrelated metrics', async () => {
    const { out } = await agent({ question: 'What is our EBITDA definition?' })
    expect(out.status).toBe('need_more_detail')
    expect(out.unread).toEqual([{ word: 'EBITDA', closest: [] }])
    const metrics = bundle.terms.filter((t) => t.kind === 'metric').map((t) => t.name)
    for (const name of metrics) expect(`${out.say} ${out.next}`).not.toContain(name)
    expect(out.next).toContain('find_context')
  })

  it('keeps every default reply on the demo under about 6,000 tokens', async () => {
    const questions = [
      'Is the gross margin number reliable?',
      'What is ROAS?',
      'What should I know about net revenue?',
      'Orders in Norway in 2026',
      ...demoTestQuestions.flatMap(({ question: q }) => q.wordings.map((w) => w.text)),
    ]
    for (const question of questions)
      expect((await agent({ question })).bytes, question).toBeLessThanOrEqual(REPLY_BUDGET)
  })
})
