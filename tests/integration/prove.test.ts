import { randomUUID } from 'node:crypto'
import { Writable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { Draft } from '../../src/domain/draft.ts'
import type { ProofQuestion } from '../../src/domain/proof.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { planProof, proofDigest, runProof } from '../../src/server/modules/evals/index.ts'
import { createModelPort } from '../../src/server/modules/models/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { fileSource, prove } from '../../src/server/run-prove.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  The proof (`footnote prove`) through the real runner and database, with the scripted mock model:
  each question asked three ways (no context, the published notes as one plain file, Footnote
  through the MCP wire), graded by the same judge, counted by try, and kept only as counts. The
  scripted agent reads the plain file carelessly, by place alone, so it tells a note that had
  ended, and Footnote's matching does not: what the table shows here is the instrument working,
  never how a real agent answers.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const clock = systemClock('2026-11-25')
// Priced like Sonnet, so the estimate and the cap have something to count. Still no model.
const models = createModelPort({
  mode: 'mock',
  mockPrices: { input: 3, output: 15, cacheRead: 0.3 },
})
const deps = { port: models, clock }
const app = buildApp({
  database,
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock,
  models,
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
})
const logs: string[] = []
const logger = createLogger({
  level: 'info',
  destination: new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs.push(chunk.toString())
      done()
    },
  }),
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

const market = (value: string) => ({
  metrics: ['metric:orders'],
  dimensions: [],
  dimensionValues: [{ dimension: 'dim:market', value: `val:market/${value}` }],
})
/** Publishes a note as its owner does: suggested, submitted, then published from the Inbox. */
async function published(draft: Draft): Promise<string> {
  const created = await call('POST', '/proposals', 'author', {
    draft: {
      areaId: 'finance',
      kind: 'event',
      evidence: [{ url: 'https://example.test/notice', quote: 'A notice', date: '2026-02-01' }],
      ...draft,
    },
  })
  expect(created.statusCode, created.body).toBe(200)
  const p = created.json<ProposalRecord>()
  const submitted = await call('POST', `/proposals/${p.id}/submit`, 'author', {
    revision: p.revision,
  })
  expect(submitted.statusCode, submitted.body).toBe(200)
  const sheet = await call('GET', `/review/${p.id}/sheet`, 'owner')
  const decided = await call('POST', `/review/${p.id}/publish`, 'owner', {
    revision: sheet.json<{ proposal: { revision: number } }>().proposal.revision,
  })
  expect(decided.statusCode, decided.body).toBe(200)
  return submitted.json<ProposalRecord>().itemId!
}

const canary = 'CANARY5P1R'
let stopped = ''
let campaign = ''
let spain = ''
let questions: ProofQuestion[] = []

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    await client.query(
      "insert into vocab_terms(key,kind) values ('val:market/spain','dimension_value')",
    )
    const [{ seq }] = (
      await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
    ).rows as [{ seq: string }]
    for (const [key, name, area, ref] of [
      ['metric:orders', 'Orders', 'finance', 'demo:orders'],
      ['dim:market', 'Market', null, null],
      ['val:market/norway', 'Norway', null, null],
      ['val:market/spain', 'Spain', null, null],
    ]) {
      const term = await client.query<{ id: string }>(
        `with v as (insert into vocab_term_versions (term_key,version_no,name,area_id,content_digest) values($1,1,$2,$3,sha256(convert_to($1,'UTF8'))) returning id), r as (insert into vocab_term_refs (version_id,definition_ref) select id,$4 from v where $4::text is not null) select id from v`,
        [key, name, area, ref],
      )
      await client.query(
        "insert into vocab_term_service(term_key,version_id,editions) values($1,$2,int8range($3,null,'[)'))",
        [key, term.rows[0]!.id, seq],
      )
    }
    await client.query('select edition_seal($1)', [seq])
    await client.query('select edition_publish($1)', [seq])
  })
  for (const who of ['author', 'owner'] as const) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin: 'http://localhost', 'x-footnote-csrf': 'dev-sign-in' },
      payload: { email: `${who}@example.test` },
    })
    expect(response.statusCode, response.body).toBe(200)
    headers[who] = {
      origin: 'http://localhost',
      cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-footnote-csrf': response.json<{ csrfToken: string }>().csrfToken,
    }
  }
  stopped = await published({
    title: 'Online sales to Norway stopped on 4 August 2026',
    summary: 'A customs rule stopped online sales to Norway on 4 August 2026.',
    scope: market('norway'),
    validity: { start: '2026-08-04', end: null },
  })
  campaign = await published({
    title: 'Norway spring campaign started on 17 February 2026',
    summary: 'The spring campaign in Norway ran from 17 February to 6 March 2026.',
    scope: market('norway'),
    validity: { start: '2026-02-17', end: '2026-03-07' },
  })
  spain = await published({
    title: 'Payment provider switched in Spain on 12 May 2026',
    summary: 'Spain booked some card payments twice from 12 to 19 May 2026, after a new provider.',
    scope: market('spain'),
    validity: { start: '2026-05-12', end: '2026-05-20' },
  })
  questions = [
    {
      id: 'orders-norway-october',
      as_of: '2026-10-23',
      question: `Why are orders in Norway close to nothing in October 2026? ${canary}`,
      reasons: [stopped],
      wrong: [campaign, spain],
    },
    {
      id: 'orders-spain-october',
      as_of: '2026-10-23',
      question: `Why did orders in Spain drop in October 2026? ${canary}`,
      reasons: [],
      wrong: [stopped, spain],
    },
  ]
})
afterAll(async () => {
  await app.close()
})

/** Every row of every table of the database, as text. */
async function everyRow(): Promise<string> {
  const tables = await client.query<{ name: string }>(
    `select format('%I.%I', table_schema, table_name) as name from information_schema.tables
      where table_schema not in ('pg_catalog','information_schema') and table_type='BASE TABLE'`,
  )
  const texts: string[] = []
  for (const { name } of tables.rows) {
    const rows = await client.query<{ t: string | null }>(
      `select string_agg(x::text, ' ') as t from ${name} x`,
    )
    texts.push(rows.rows[0]?.t ?? '')
  }
  return texts.join('\n')
}

describe('the plan', () => {
  it('counts the questions, the answers, the plain file and the cost, and names what does not fit', async () => {
    const plan = await planProof(database, deps, questions, 3)
    expect(plan).toMatchObject({
      questions: 2,
      nothing: 1,
      tries: 3,
      answers: 18,
      notes: 3,
      unserved: [],
      model: 'mock/scripted-answer',
      judge: 'mock/scripted-judge',
      demo: false,
    })
    expect(plan.edition).toBeTruthy()
    expect(plan.fileTokens).toBeGreaterThan(50)
    expect(plan.costMicros).toBeGreaterThan(0)
    const more = await planProof(database, deps, questions, 6)
    expect(more.costMicros).toBeGreaterThan(plan.costMicros)
    const broken = await planProof(
      database,
      deps,
      [{ ...questions[0]!, wrong: ['itm_neverpub01'] }],
      3,
    )
    expect(broken.unserved).toEqual(['itm_neverpub01'])
  })
})

describe('a run', () => {
  it('asks every question three ways, counts each try, and keeps none of their words', async () => {
    logs.length = 0
    const run = await runProof(database, deps, {
      questions,
      tries: 3,
      about: 'Items: this workspace. Questions: the test.',
      person: null,
      ceilingMicros: null,
      signal: new AbortController().signal,
      logger,
    })
    expect(run.state).toBe('finished')
    expect(run.stopped).toBeNull()
    expect(run.results.map((r) => r.arm)).toEqual(['none', 'file', 'footnote'])
    const each = (right: number, wrong: number, nothing: number) =>
      Array.from({ length: 3 }, () => ({ right, wrong, nothing }))
    // No context: the scripted agent has nothing to read and says so in no way the judge counts.
    expect(run.results[0]).toEqual({ arm: 'none', tries: each(0, 0, 0), noAnswer: 0 })
    // The plain file, read by place alone: Norway's ended campaign is told with its stop, and
    // Spain's switch in May is told for October.
    expect(run.results[1]).toEqual({ arm: 'file', tries: each(0, 2, 0), noAnswer: 0 })
    // Footnote: the stop alone for Norway, and nothing written for Spain in October.
    expect(run.results[2]).toEqual({ arm: 'footnote', tries: each(2, 0, 1), noAnswer: 0 })
    expect(run.judging).toEqual({ judged: 18, errors: 0 })
    expect(run.costMicros).toBeGreaterThan(0)

    const [row] = (
      await client.query<{
        kind: string
        area_id: string | null
        summary: Record<string, unknown>
      }>('select kind::text,area_id,summary from eval_runs where id=$1', [run.runId])
    ).rows
    expect(row).toMatchObject({ kind: 'proof', area_id: null })
    expect(row!.summary.proof).toEqual({
      about: 'Items: this workspace. Questions: the test.',
      digest: await proofDigest(questions),
      questions: 2,
      nothing: 1,
      tries: 3,
      result: run.results,
    })
    const calls = await client.query('select 1 from model_calls where run_id=$1', [run.runId])
    // An answer and a judge's grade for each of the 18 answers, and Footnote's tool steps.
    expect(calls.rowCount).toBeGreaterThanOrEqual(36)
    // No question, note title or answer in any table or any log line.
    const rows = await everyRow()
    expect(rows).not.toContain(canary)
    expect(logs.join('\n')).not.toContain(canary)
  })

  it('stops at its cap before a call, incomplete, saying so in counts', async () => {
    const run = await runProof(database, deps, {
      questions,
      tries: 1,
      about: 'Items: this workspace. Questions: the test.',
      person: null,
      ceilingMicros: 0,
      signal: new AbortController().signal,
      logger,
    })
    expect(run).toMatchObject({ state: 'incomplete', costMicros: 0 })
    expect(run.stopped).toMatch(/ceiling\. 6 of 6 answers not made\.$/)
    expect(run.results.every((r) => r.tries[0]!.right === 0)).toBe(true)
  })
})

describe('the command', () => {
  const output = () => {
    const lines: string[] = []
    return {
      lines,
      io: {
        stdout: (line: string) => lines.push(line),
        stderr: (line: string) => lines.push(`error: ${line}`),
        ask: () => Promise.resolve(''),
      },
    }
  }
  const env = {
    ...process.env,
    DATABASE_URL: url,
    FOOTNOTE_FIXED_TODAY: '2026-11-25',
  }

  it('prints the plan, the table and what it spent on the scripted model, asking nothing', async () => {
    const { lines, io } = output()
    const code = await prove(
      io,
      { tries: 2, real: false, cap: null },
      fileSource(questions, 'the test file'),
      env,
    )
    expect(code, lines.join('\n')).toBe(0)
    expect(lines[0]).toBe(
      '2 questions about a period and a market, asked three ways, 2 tries each: 12 answers.',
    )
    expect(lines[1]).toMatch(
      /^Items: this workspace's published context, edition .+, 3 notes agents are told; as one plain file, about \d+ tokens\.$/,
    )
    expect(lines[2]).toBe(`Questions: the test file (digest ${await proofDigest(questions)}).`)
    expect(lines).toContain(
      'Scripted model: no AI model is called and nothing is spent. The table shows that the command works, not how an agent answers. Run with --real --cap <dollars> to ask a real agent.',
    )
    const table = lines.indexOf('') + 1
    expect(lines.slice(table, table + 5)).toEqual([
      '                 Right reason,   Told a note that had     Said nothing is',
      '                 no wrong one    ended or was elsewhere   written when true',
      'No context       0 of 2 (0, 0)   -                        0 of 1 (0, 0)',
      'One plain file   0 of 2 (0, 0)   2 of 2 (2, 2)            0 of 1 (0, 0)',
      'Footnote         2 of 2 (2, 2)   0 of 2 (0, 0)            1 of 1 (1, 1)',
    ])
    expect(lines.at(-1)).toMatch(
      /^Model: mock\/scripted-answer, judged by mock\/scripted-judge\. Items: this workspace's published context\. Questions: the test file\. Spent: USD \d+\.\d\d\.$/,
    )
    expect(lines.join('\n')).not.toContain(canary)
  })

  it('names the notes a plain file of questions names that agents are not told', async () => {
    const { lines, io } = output()
    const code = await prove(
      io,
      { tries: 1, real: false, cap: null },
      fileSource([{ ...questions[0]!, wrong: ['itm_neverpub01'] }], 'the test file'),
      env,
    )
    expect(code).toBe(1)
    expect(lines.at(-1)).toBe(
      'error: These notes are not published for every agent in this edition, so the questions do not fit these items: itm_neverpub01.',
    )
  })
})
