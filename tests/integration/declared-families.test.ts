import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  Catalogue,
  CatalogueTerm,
  DefinitionRelations,
  FamilyJoined,
  FamilyMeaningVersion,
  FamilySplit,
} from '../../src/contract/catalogue.ts'
import type { LoopTurn } from '../../src/contract/answer.ts'
import type { Feed, NamesDecision, NamesRead } from '../../src/contract/inbox.ts'
import type { SourceCheck, SourceSettings } from '../../src/contract/sources.ts'
import { resolve } from '../../src/domain/resolver.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import {
  scriptedLoopChoice,
  scriptedLoopModel,
  type ScriptedPrompt,
  type ScriptedStep,
} from '../../src/server/modules/answer/index.ts'
import {
  ConnectorRegistry,
  connectorSyncJob,
  createWorkspaceSources,
  openLocalSecretStore,
} from '../../src/server/modules/connectors/index.ts'
import { loadLiveBundle } from '../../src/server/modules/editions/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { gitHost, type GitHost } from '../server/connectors/git-server.ts'
import { partnerManifest } from '../server/connectors/partner-relations-fixture.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { accept, foundation, openEdition, people, publish, version } from './fixtures.ts'
import { apiDatabase, askToolsAs, queueReads, testDatabase, transaction } from './support.ts'

/*
  Families in the order of trust (FR-142, D1, D2, D9) on the real service and PostgreSQL 18: an
  invented partner programme's dbt project declares one family of its product lines in
  `meta.footnote`, keeps amounts in EUR with USD twins one rate converts, a fee in EUR and USD in
  columns of their own, and one declaration that does not hold. Test connection says what does not
  hold; the Names card offers the declared family and the converted ones, each marked, and holds
  the fee whose names alone look alike for the owner, who publishes it apart; the family pages say
  how each was found and which variant is converted from which. Every name is made up.
*/

const TOKEN = 'families-it-token-7d1e40b3'
const { client, url } = testDatabase()
const database = apiDatabase(url)
const logger = createLogger({ level: 'silent' })
const clock = systemClock('2026-11-21')
const secretsDir = await mkdtemp(join(tmpdir(), 'footnote-families-'))
const store = await openLocalSecretStore(join(secretsDir, 'store'))
const registry = new ConnectorRegistry([], { secrets: store })
/** The model of the next turn: the scripted reader, unless a test scripts one. */
let decide: ((prompt: ScriptedPrompt) => ScriptedStep) | null = null
const reader = scriptedLoopModel()
const scripted = scriptedLoopChoice('families', (prompt) => decide!(prompt))
const app = buildApp({
  database,
  askTrace: {
    get loopModel() {
      return decide ? scripted : reader
    },
  },
  jobs: idleJobs(),
  sources: registry,
  workspaceSources: createWorkspaceSources({ secrets: store, registry }),
  logger,
  clock,
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
})
let host: GitHost
type Who = keyof typeof people
const headers: Partial<Record<Who, Record<string, string>>> = {}

const call = (method: 'GET' | 'POST' | 'PUT', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
const ok = async <T>(
  response: Promise<{ statusCode: number; body: string; json: <U>() => U }>,
  status = 200,
) => {
  const r = await response
  expect(r.statusCode, r.body).toBe(status)
  return r.json<T>()
}

type Metric = ReturnType<typeof partnerManifest>['metrics'][number] & {
  label?: string
  config: { meta: Record<string, unknown> }
}

/**
 * The product lines in EUR and USD as one declared family, two amounts that one rate converts,
 * a fee kept in EUR and USD columns of its own and labelled by currency, and a family of one.
 */
function project() {
  const file = partnerManifest({ pairs: 3, summed: 2, locals: 0, forecasts: 0 })
  const metrics = file.metrics as Metric[]
  for (const metric of metrics) {
    const line = /^net_revenue_(retail|online|wholesale)_(eur|usd)$/.exec(metric.name)
    if (line)
      metric.config.meta = {
        footnote: {
          family: 'net_revenue_by_line',
          by: { sales_line: line[1], currency: line[2]!.toUpperCase() },
          family_description: 'Revenue from partners after refunds, by sales line.',
        },
      }
    if (metric.name === 'signups')
      metric.config.meta = { footnote: { family: 'sign_up_counts', by: { kind: 'all' } } }
  }
  // A fee in each currency, each a column of its own: nothing says one is worked out from the other.
  const fee = (code: 'eur' | 'usd') => ({
    name: `partner_fee_${code}`,
    label: `Partner fee (${code.toUpperCase()})`,
    description: `The fee partners pay, in ${code.toUpperCase()}.`,
    type: 'simple',
    type_params: {
      expr: `partner_fee_${code}`,
      metrics: [],
      metric_aggregation_params: {
        semantic_model: 'partner_results',
        agg: 'sum',
        agg_time_dimension: 'booked_at',
      },
      is_private: false,
    },
    filter: null,
    config: { meta: {} },
  })
  return { ...file, metrics: [...metrics, fee('eur'), fee('usd')] as unknown[] }
}

const route = () => ({
  type: 'dbt-metricflow',
  config: {
    location: 'git',
    repository: host.address('partners'),
    ref: 'main',
    folder: 'semantic',
    file: 'semantic_manifest.json',
  },
  secrets: { token: TOKEN },
})

/** One run of the sources' job, with the source made due. */
async function read() {
  await queueReads(client)
  await connectorSyncJob(registry, { clock }).run({
    database,
    logger,
    signal: new AbortController().signal,
  })
}

/** One question to Ask as a member, through the real service: the turn it answers with. */
const ask = async (question: string) => {
  const r = await call('POST', '/ask/lookup', 'member', { question })
  expect(r.statusCode, r.body).toBe(200)
  const turns = r.body
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice(5)) as { type: string; turn?: LoopTurn })
  return turns.findLast((e) => e.type === 'turn')!.turn!
}

const names = () => ok<NamesRead>(call('GET', '/inbox/names', 'admin'))
const named = (list: NamesRead, name: string) => list.names.find((n) => n.name === name)

beforeAll(async () => {
  await foundation(client)
  await client.query("insert into areas (id,name) values ('partners','Partners')")
  await client.query(
    `insert into area_assignments (area_id,person_id,role) values ('partners',$1,'owner')`,
    [people.owner],
  )
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
  host = await gitHost({ token: TOKEN })
  await host.repository('partners', {
    'semantic/semantic_manifest.json': JSON.stringify(project()),
  })
}, 300_000)
afterAll(async () => {
  await app.close()
  await host.close()
  await rm(secretsDir, { recursive: true, force: true })
})

describe('Test connection', () => {
  it('says a declared family does not hold, and reads its metric on its own', async () => {
    const check = await ok<SourceCheck>(call('POST', '/sources/test', 'admin', route()))
    expect(check.ok).toBe(true)
    expect(check.warnings.filter((w) => w.code.startsWith('family'))).toEqual([
      { code: 'family_one_member', target: 'sign_up_counts' },
    ])
  })
})

describe('the Names card', () => {
  let sourceId = ''
  beforeAll(async () => {
    const source = await ok<SourceSettings>(
      call('POST', '/sources', 'admin', {
        ...route(),
        name: 'dbt',
        reason: 'Our partner metrics live in dbt',
      }),
      201,
    )
    sourceId = source.id
    await read()
  }, 300_000)

  it('says the source each family comes from, and counts the families on the Inbox card', async () => {
    const list = await names()
    const families = list.names.filter((name) => name.family)
    expect(families.length).toBeGreaterThan(0)
    expect(families.every((name) => name.source === sourceId)).toBe(true)
    const feed = await ok<Feed>(call('GET', '/inbox/feed', 'admin'))
    const card = feed.cards.find((c) => c.group === 'names')
    expect(card?.families).toBe(families.filter((name) => name.state !== 'left_out').length)
    expect(card?.families).toBeGreaterThan(0)
  })

  it('keeps a family that holds, and leaves out the one that does not', async () => {
    const { rows } = await client.query<{ name: string; family: string | null }>(
      `select name, family_name as family from definitions
        where name in ('partner_results.net_revenue_online_usd', 'partner_results.signups')
        order by name`,
    )
    expect(rows).toEqual([
      { name: 'partner_results.net_revenue_online_usd', family: 'net_revenue_by_line' },
      { name: 'partner_results.signups', family: null },
    ])
  })

  it('offers the declared family and the converted ones, each marked, ready to publish', async () => {
    const list = await names()
    expect(named(list, 'Net revenue by line')).toMatchObject({
      kind: 'metric_group',
      state: 'ready',
      family: { variants: 6, by: ['Sales line', 'Currency'], found: 'declared', names: [] },
    })
    for (const stem of ['Accrued share 1', 'Accrued share 2'])
      expect(named(list, stem)).toMatchObject({
        kind: 'metric_group',
        state: 'ready',
        family: { variants: 2, by: ['Currency'], found: 'rate' },
      })
    // A variant is never a name of its own on the card.
    expect(list.names.map((n) => n.name)).not.toContain('Net revenue retail eur')
  })

  it('holds the names that only look alike for the owner, with what they differ by', async () => {
    const fee = named(await names(), 'Partner fee')
    expect(fee).toMatchObject({
      kind: 'metric_group',
      state: 'flagged',
      flags: [
        {
          code: 'look_alike',
          message:
            'Their names differ only by EUR and USD. Publish them as one family, or keep them separate.',
        },
      ],
      family: { found: 'names', names: ['Partner fee (EUR)', 'Partner fee (USD)'] },
    })
  })

  it('says the values a family holds and what it would mean, before it is published (F4)', async () => {
    const list = await names()
    expect(named(list, 'Net revenue by line')!.family).toMatchObject({
      values: [
        ['online', 'retail', 'wholesale'],
        ['EUR', 'USD'],
      ],
      meaning: {
        source: 'declared',
        words: 'Revenue from partners after refunds, by sales line.',
      },
    })
    expect(named(list, 'Accrued share 1')!.family!.values).toEqual([['EUR', 'USD']])
  })

  it('refuses to keep apart the variants of a family its source declares', async () => {
    const list = await names()
    const response = await call('POST', '/inbox/names/decide', 'admin', {
      revision: list.revision,
      accept: [{ key: named(list, 'Net revenue by line')!.key, apart: true }],
      leaveOut: [],
    })
    expect(response.statusCode, response.body).toBe(422)
    expect(response.json<{ message: string }>().message).toContain('declares')
  })

  it('publishes them apart at one press, each by its own name, and no family', async () => {
    const list = await names()
    const fee = named(list, 'Partner fee')!
    // A family its calculation finds can be kept separate too (Keep them separate).
    const converted = named(list, 'Accrued share 2')!
    const ready = list.names
      .filter((n) => n.state === 'ready' && n.key !== converted.key)
      .map(({ key }) => ({ key }))
    const decided = await ok<NamesDecision>(
      call('POST', '/inbox/names/decide', 'admin', {
        revision: list.revision,
        accept: [...ready, { key: fee.key, apart: true }, { key: converted.key, apart: true }],
        leaveOut: [],
      }),
    )
    expect(decided.waiting.names.filter((n) => n.state !== 'left_out')).toEqual([])
    const { rows } = await client.query<{ key: string; kind: string; parent: string | null }>(
      `select t.key, t.kind::text as kind, t.parent_key as parent
         from serving_vocabulary((select seq from live_edition)) t
        where t.key like '%partner_fee%' or t.key = $1 order by t.key`,
      [fee.key],
    )
    expect(rows.map((r) => [r.kind, r.parent])).toEqual([
      ['metric', null],
      ['metric', null],
    ])
    const apart = await client.query<{ kind: string; parent: string | null }>(
      `select t.kind::text as kind, t.parent_key as parent
         from serving_vocabulary((select seq from live_edition)) t
        where t.definition_refs && $1::text[]`,
      [converted.definitionRefs],
    )
    expect(apart.rows).toEqual([
      { kind: 'metric', parent: null },
      { kind: 'metric', parent: null },
    ])
  })
})

describe('a family’s page', () => {
  const family = async (name: string) =>
    (await ok<Catalogue>(call('GET', '/catalogue', 'member'))).terms.find((t) => t.name === name)

  it('says how each family was found', async () => {
    expect((await family('Net revenue by line'))?.family).toMatchObject({
      found: 'declared',
      by: ['Sales line', 'Currency'],
      conversions: expect.arrayContaining([
        expect.objectContaining({ by: 'exchange_rate_usd' }),
      ]) as unknown,
    })
    expect((await family('Accrued share 1'))?.family?.found).toBe('rate')
  })

  it('says which variant is converted from which, by the column', async () => {
    const accrued = (await family('Accrued share 1'))!.family!
    const keyOf = (code: string) => accrued.variants.find((v) => v.values[0] === code)!.key
    expect(accrued.conversions).toEqual([
      { from: keyOf('EUR'), to: keyOf('USD'), by: 'exchange_rate_usd' },
    ])
    const relations = await ok<DefinitionRelations>(
      call('GET', `/definitions/relations?key=${keyOf('USD')}`, 'member'),
    )
    expect(relations.relations[0]).toMatchObject({
      kind: 'converted_from',
      key: keyOf('EUR'),
      by: 'exchange_rate_usd',
    })
  })
})

describe('what a family means (M1)', () => {
  const family = async (name: string) =>
    (await ok<Catalogue>(call('GET', '/catalogue', 'member'))).terms.find((t) => t.name === name)!
  const choose = (key: string, who: Who, body: object) =>
    call('PUT', `/definitions/families/${encodeURIComponent(key)}/meaning`, who, body)

  it('is the words its source declares for it, which nobody replaces here', async () => {
    const line = await family('Net revenue by line')
    expect(line.family!.meaning).toMatchObject({
      source: 'declared',
      words: 'Revenue from partners after refunds, by sales line.',
      chosen: null,
      revision: 0,
    })
    // The family's definition still never speaks with one variant's words.
    expect(line.definition?.descriptionCopy).toBeNull()
    const refused = await choose(line.key, 'owner', {
      key: line.key,
      choice: 'written',
      words: 'Something else.',
      revision: 0,
    })
    expect(refused.statusCode, refused.body).toBe(409)
  })

  it('is the words of the variant the others are converted from, for a pair one rate converts', async () => {
    const accrued = (await family('Accrued share 1')).family!
    const keyOf = (code: string) => accrued.variants.find((v) => v.values[0] === code)!.key
    // The USD variant is converted from the EUR one: it has no say, and says nothing else.
    expect(accrued.meaning).toMatchObject({
      source: 'common',
      words: 'The accrued share 1 {Currency}.',
      base: keyOf('EUR'),
      differing: [],
    })
  })

  it('is changed by an owner of its domain only, against the meaning they read, with history', async () => {
    const accrued = await family('Accrued share 1')
    const written = {
      key: accrued.key,
      choice: 'written',
      words: '  The share of a partner contract booked up front.  ',
      revision: 0,
    }
    const forbidden = await choose(accrued.key, 'member', written)
    expect(forbidden.statusCode, forbidden.body).toBe(403)
    const first = await ok<FamilyMeaningVersion>(choose(accrued.key, 'owner', written))
    expect(first).toMatchObject({
      revision: 1,
      choice: 'written',
      words: 'The share of a partner contract booked up front.',
      personId: people.owner,
    })
    expect((await family('Accrued share 1')).family!.meaning).toMatchObject({
      source: 'written',
      words: 'The share of a partner contract booked up front.',
      chosen: { choice: 'written', personId: people.owner },
      revision: 1,
    })
    // Someone who read the meaning before that change is told so.
    const stale = await choose(accrued.key, 'admin', written)
    expect(stale.statusCode, stale.body).toBe(409)

    await ok(choose(accrued.key, 'admin', { key: accrued.key, choice: 'auto', revision: 1 }))
    expect((await family('Accrued share 1')).family!.meaning).toMatchObject({
      source: 'common',
      chosen: { choice: 'auto', words: null, personId: people.admin },
      revision: 2,
    })
    const history = await ok<FamilyMeaningVersion[]>(
      call(
        'GET',
        `/definitions/families/${encodeURIComponent(accrued.key)}/meaning/history`,
        'member',
      ),
    )
    expect(history.map((v) => [v.revision, v.personId])).toEqual([
      [2, people.admin],
      [1, people.owner],
    ])
    // History is append only, even for the service's own role.
    await expect(
      database.query(`update family_meaning_versions set words = 'x' where family_key = $1`, [
        accrued.key,
      ]),
    ).rejects.toThrow()
  })

  it('refuses one variant’s words as a choice, and an unknown family', async () => {
    const accrued = await family('Accrued share 1')
    const variant = accrued.family!.variants[0]!.key
    // Two choices only: worked out, or written.
    const member = await choose(accrued.key, 'admin', {
      key: accrued.key,
      choice: 'member',
      member: variant,
      revision: 2,
    })
    expect(member.statusCode, member.body).toBe(400)
    const unknown = await choose('group:no_such_family', 'admin', {
      key: 'group:no_such_family',
      choice: 'auto',
      revision: 0,
    })
    expect(unknown.statusCode, unknown.body).toBe(404)
  })

  it('is not declared by words only a variant the source stopped reading still has', async () => {
    await client.query(
      `update definitions set family_description = null where family_name = 'net_revenue_by_line'`,
    )
    const [{ id }] = (
      await client.query<{ id: string }>(
        `insert into connector_snapshots (connector_id, status, definitions_seen)
         select connector_id, 'ok', 1 from definitions where family_name = 'net_revenue_by_line'
          limit 1 returning id`,
      )
    ).rows as [{ id: string }]
    await client.query(
      `update definitions set family_description = 'Old words.', missing_since_snapshot = $1
        where ref = (select ref from definitions where family_name = 'net_revenue_by_line'
                      order by ref limit 1)`,
      [id],
    )
    const line = await family('Net revenue by line')
    expect(line.family!.meaning.source).not.toBe('declared')
    const changed = await choose(line.key, 'owner', {
      key: line.key,
      choice: 'written',
      words: 'Revenue after refunds.',
      revision: 0,
    })
    expect(changed.statusCode, changed.body).toBe(200)
  })
})

describe('Ask on a family', () => {
  it("gives the family's words with the look-up of it, as Definitions gives them", async () => {
    // Asked why its USD variant differs from its EUR one, Ask read only the look-up and said
    // nothing was written (captain's install, 21 November 2026): the words were only in Definitions.
    type Defined = {
      definitions?: {
        name: string
        from: string
        words: string | null
        family?: { by: string[]; variants: number; meaning: string | null }
      }[]
    }
    const [looked, defined] = (await askToolsAs(database, clock)(people.member, async (tools) => [
      await tools.run('get_context', {
        about: 'why is net revenue by line in USD different from EUR',
        no_period: true,
      }),
      await tools.run('definitions', { names: ['Net revenue by line'] }),
    ])) as [Defined, Defined]
    expect(looked.definitions?.map((d) => [d.name, d.from])).toEqual([
      ['Net revenue by line', 'dbt'],
    ])
    expect(looked.definitions?.[0]?.words).toContain('A family of 6 near-identical metrics')
    expect(looked.definitions?.[0]?.words).toBe(defined.definitions?.[0]?.words)
    // The page draws it as a family, from the same read: what tells its variants apart, how many.
    expect(looked.definitions?.[0]?.family).toMatchObject({ variants: 6 })
    expect(looked.definitions?.[0]?.family).toEqual(defined.definitions?.[0]?.family)
  })

  it('answers a why-question from its definition under the Definition label, in words of its own', async () => {
    // Answered from the definition, in words of its own, the answer still showed Not found
    // (captain's install, 22 November 2026): only a run of five of its words made it a Definition.
    const why = (words: (id: string) => string) => {
      decide = ({ step, results }) => {
        if (step === 0)
          return {
            calls: [
              { toolName: 'get_context', input: { about: 'net revenue by line', no_period: true } },
            ],
          }
        const got = results[0]!.value as { definitions: { id: string }[] }
        return { text: words(got.definitions[0]!.id) }
      }
      return ask('Why is net revenue by line in USD different from EUR?')
    }
    try {
      const drawn = await why((id) => `The USD figure is the EUR one at that day's rate [${id}].`)
      expect(drawn.text).toBe("The USD figure is the EUR one at that day's rate.")
      expect(drawn.state).toBeNull()
      expect(drawn.defined).toMatchObject({ names: ['Net revenue by line'], tool: 'dbt' })
      // Words that say nothing covers it, and rest on no definition, stay Not found.
      const none = await why(() => 'Nothing written covers why the USD figure differs.')
      expect(none.state).toBe('missing')
      expect(none.defined).toBeUndefined()
    } finally {
      decide = null
    }
  })
})

describe('the usual variant of a family (F3)', () => {
  const family = async (name: string) =>
    (await ok<Catalogue>(call('GET', '/catalogue', 'member'))).terms.find((t) => t.name === name)!
  const pick = (key: string, who: Who, body: object) =>
    call('PUT', `/definitions/families/${encodeURIComponent(key)}/usual`, who, body)

  it('is none until an owner of its domain picks one, against the pick they read', async () => {
    const accrued = await family('Accrued share 1')
    expect(accrued.family!.usual).toEqual({ member: null, chosen: null, revision: 0 })
    const eur = accrued.family!.variants.find((v) => v.values[0] === 'EUR')!
    // Each variant says its id in the source tool, which the quick view's Details names.
    expect(eur.ref).toMatch(/^dbt-metricflow:|:/)
    const body = { key: accrued.key, member: eur.key, revision: 0 }
    const forbidden = await pick(accrued.key, 'member', body)
    expect(forbidden.statusCode, forbidden.body).toBe(403)
    const made = await ok<{ member: string | null; revision: number }>(
      pick(accrued.key, 'owner', body),
    )
    expect(made).toMatchObject({ member: eur.key, revision: 1 })
    expect((await family('Accrued share 1')).family!.usual).toMatchObject({
      member: eur.key,
      chosen: { personId: people.owner },
      revision: 1,
    })
    // Someone who read it before that pick is told so.
    const stale = await pick(accrued.key, 'admin', body)
    expect(stale.statusCode, stale.body).toBe(409)
    // None again: agents are told of no usual variant.
    await ok(pick(accrued.key, 'admin', { key: accrued.key, member: null, revision: 1 }))
    expect((await family('Accrued share 1')).family!.usual).toMatchObject({
      member: null,
      revision: 2,
    })
    const { rows } = await client.query<{ revision: number; member: string | null }>(
      `select revision, member_key as member from family_usual_versions
        where family_key = $1 order by revision`,
      [accrued.key],
    )
    expect(rows).toEqual([
      { revision: 1, member: eur.key },
      { revision: 2, member: null },
    ])
    await expect(
      database.query(`update family_usual_versions set member_key = null where family_key = $1`, [
        accrued.key,
      ]),
    ).rejects.toThrow()
  })

  it('refuses a variant of another family, and an unknown family', async () => {
    const accrued = await family('Accrued share 1')
    const other = (await family('Net revenue by line')).family!.variants[0]!.key
    const wrong = await pick(accrued.key, 'admin', { key: accrued.key, member: other, revision: 2 })
    expect(wrong.statusCode, wrong.body).toBe(404)
    const unknown = await pick('group:no_such_family', 'admin', {
      key: 'group:no_such_family',
      member: null,
      revision: 0,
    })
    expect(unknown.statusCode, unknown.body).toBe(404)
  })

  it('is what Ask reads for a question that names none of its values, and says so', async () => {
    // Asked about a family whose owners picked EUR, Ask still read every variant (22 November
    // 2026): the pick was in Definitions only. The scripted reader stands in for the model.
    const accrued = await family('Accrued share 1')
    const plain = await ask('What is accrued share 1?')
    expect(plain.subject?.note).toBeNull()
    expect(plain.read.join(' ')).not.toContain('usual variant')
    const eur = accrued.family!.variants.find((v) => v.values[0] === 'EUR')!
    const { revision } = accrued.family!.usual
    await ok(pick(accrued.key, 'owner', { key: accrued.key, member: eur.key, revision }))
    const defined = await ask('What is accrued share 1?')
    expect(defined.text).toBe('Accrued share 1 in EUR means: The accrued share 1 eur.')
    expect(defined.subject).toMatchObject({
      names: ['Accrued share 1'],
      note: 'EUR, its usual variant',
    })
    expect(defined.read[0]).toContain(
      'Accrued share 1 was read as its usual variant, EUR, which its owners picked for a question that names none of its values.',
    )
    // A question that names a value means that value, whatever the usual variant is.
    const usd = await ask('What is accrued share 1 in USD?')
    expect(usd.subject?.note).toBeNull()
    expect(usd.text).toMatch(/^Accrued share 1 means: /)
  })
})

describe('splitting a family (D2-D4)', () => {
  const catalogue = () => ok<Catalogue>(call('GET', '/catalogue', 'member'))
  const family = async (name: string) => (await catalogue()).terms.find((t) => t.name === name)
  const split = (key: string, who: Who) =>
    call('POST', `/definitions/families/${encodeURIComponent(key)}/split`, who, { key })
  const join = (key: string, who: Who) =>
    call('POST', `/definitions/families/${encodeURIComponent(key)}/join`, who, { key })
  /** What agents get for a question about one metric, by key: the items, by id. */
  const reaching = async (metric: string) => {
    const bundle = (await loadLiveBundle(database))!
    return resolve(bundle, {
      scope: {
        status: 'resolved',
        scope: {
          metrics: [metric],
          filters: {},
          window: { start: '2026-11-01', end: '2026-11-30' },
        },
      },
      today: '2026-11-21',
      sizeLimit: 100_000,
      dependenciesAvailable: true,
      groups: [],
      hiddenMetrics: [],
    }).items.map((match) => match.id)
  }
  let accrued: CatalogueTerm
  let note = ''

  beforeAll(async () => {
    accrued = (await family('Accrued share 1'))!
    // A note about the family, published in its domain.
    const about = await transaction(client, async () => {
      const made = await version(client, {
        scope: false,
        area: 'partners',
        title: 'Accrued share 1 restated',
        summary: 'Accrued share 1 was restated for October.',
        owner: people.owner,
        validity: { from: '2026-10-01', until: null },
      })
      await client.query('insert into item_version_metrics values ($1,$2)', [made.id, accrued.key])
      await client.query(
        `insert into item_version_evidence (version_id,position,url,quote,read_on)
         values ($1,0,'https://example.test/restated','Restated for October','2026-11-02')`,
        [made.id],
      )
      return made
    })
    await accept(client, about.id)
    await publish(client, about.id)
    note = about.item
  })

  it('is refused to a member, and for a family its tool declares, which says where', async () => {
    const forbidden = await split(accrued.key, 'member')
    expect(forbidden.statusCode, forbidden.body).toBe(403)
    expect(forbidden.json<{ message: string }>().message).toBe(
      'Only an owner of Partners or an admin can split it.',
    )
    const line = (await family('Net revenue by line'))!
    expect(line.family!.declared).toBe('net_revenue_by_line')
    expect(accrued.family!.declared).toBeNull()
    const declared = await split(line.key, 'admin')
    expect(declared.statusCode, declared.body).toBe(409)
    expect(declared.json<{ message: string }>().message).toBe(
      'dbt declares “Net revenue by line” as one family, under the name net_revenue_by_line. Split it in dbt: the next read follows.',
    )
    const unknown = await split('group:no_such_family', 'admin')
    expect(unknown.statusCode, unknown.body).toBe(404)
  })

  it('makes each variant a metric of its own, and the items about it still reach agents, flagged', async () => {
    const variants = accrued.family!.variants
    const [eur, usd] = variants
    expect(await reaching(eur!.key)).toContain(note)
    const done = await ok<FamilySplit>(split(accrued.key, 'owner'))
    expect(done).toMatchObject({
      metrics: variants.map((v) => ({ key: v.key, name: v.name })),
      items: 1,
    })
    const after = await catalogue()
    // The family leaves Definitions; its variants are metrics there, under the names they had.
    expect(after.terms.find((t) => t.key === accrued.key)).toBeUndefined()
    expect(after.terms.filter((t) => t.key === eur!.key || t.key === usd!.key)).toMatchObject([
      { name: eur!.name, family: null },
      { name: usd!.name, family: null },
    ])
    expect(after.splits).toMatchObject([
      {
        key: accrued.key,
        name: 'Accrued share 1',
        areaId: 'partners',
        metrics: variants.map((v) => ({ key: v.key, name: v.name })),
        items: 1,
        personId: people.owner,
      },
    ])
    // No word of the note changed: it reaches agents for each former variant, flagged.
    expect(await reaching(eur!.key)).toContain(note)
    expect(await reaching(usd!.key)).toContain(note)
    const { rows: flags } = await client.query<{ flag: string; reason: string }>(
      `select flag::text, reason from v_overlay_on where kind = 'flag_on' and item_id = $1`,
      [note],
    )
    expect(flags).toEqual([{ flag: 'needs_check', reason: 'Family split: Accrued share 1' }])
    // Its page reads it as about each metric, as the editor starts a change from it.
    const page = await ok<{ chips: string[]; check: string | null }>(
      call('GET', `/items/${note}/page`, 'owner'),
    )
    expect(page).toMatchObject({ chips: [eur!.name, usd!.name], check: 'source_changed' })
    // Its owner has a card to check it, which names the metrics it reaches agents through.
    const feed = await ok<Feed>(call('GET', '/inbox/feed', 'owner'))
    expect(feed.cards.find((c) => c.group === 'check' && c.itemId === note)).toMatchObject({
      reason: 'family',
      families: [{ name: 'Accrued share 1', metrics: [eur!.name, usd!.name] }],
    })
    // The family's history, meaning and usual variant are kept.
    const { rows: kept } = await client.query<{ n: number }>(
      `select (select count(*) from vocab_term_versions where term_key = $1)::int
              + (select count(*) from family_meaning_versions where family_key = $1)::int as n`,
      [accrued.key],
    )
    expect(kept[0]!.n).toBeGreaterThan(1)
  })

  it('keeps them apart on the next read, and offers nothing new on the Names card', async () => {
    await read()
    const list = await names()
    expect(list.names.find((n) => n.key === accrued.key)).toBeUndefined()
    const refs = accrued.family!.variants.map((v) => v.ref)
    expect(list.names.filter((n) => n.definitionRefs.some((ref) => refs.includes(ref)))).toEqual([])
    expect(await family('Accrued share 1')).toBeUndefined()
  })

  it('is made one family again by Undo, which ends the flags', async () => {
    const refused = await join(accrued.key, 'member')
    expect(refused.statusCode, refused.body).toBe(403)
    expect(await ok<FamilyJoined>(join(accrued.key, 'admin'))).toMatchObject({
      name: 'Accrued share 1',
    })
    const again = (await family('Accrued share 1'))!
    expect(again.key).toBe(accrued.key)
    expect(again.family!.variants.map((v) => v.key)).toEqual(
      accrued.family!.variants.map((v) => v.key),
    )
    expect((await catalogue()).splits).toEqual([])
    const { rows } = await client.query(
      `select 1 from v_overlay_on where kind = 'flag_on' and item_id = $1`,
      [note],
    )
    expect(rows).toEqual([])
    const twice = await join(accrued.key, 'admin')
    expect(twice.statusCode, twice.body).toBe(404)
  })

  it('points an item at each former metric when its owner checks it as still true', async () => {
    await ok(split(accrued.key, 'admin'))
    const feed = await ok<Feed>(call('GET', '/inbox/feed', 'owner'))
    const card = feed.cards.find((c) => c.group === 'check' && c.itemId === note)!
    await ok(call('POST', '/inbox/cards/decide', 'owner', { card: card.id, action: 'still_true' }))
    const { rows } = await client.query<{ key: string }>(
      `select m.metric_key as key from item_version_service s
         join item_version_metrics m on m.version_id = s.version_id
        where s.item_id = $1 and upper_inf(s.editions) order by m.metric_key`,
      [note],
    )
    expect(rows.map((r) => r.key)).toEqual(accrued.family!.variants.map((v) => v.key).sort())
    const { rows: flags } = await client.query(
      `select 1 from v_overlay_on where kind = 'flag_on' and item_id = $1`,
      [note],
    )
    expect(flags).toEqual([])
    expect((await catalogue()).splits).toMatchObject([{ key: accrued.key, items: 0 }])
  })

  it('is whole again in an edition from before it, and can be split once more', async () => {
    const { rows } = await client.query<{ label: string }>(
      `select e.label from family_splits x join editions e on e.seq = x.split_in - 1
        where x.family_key = $1 and x.joined_in is null`,
      [accrued.key],
    )
    const back = await call('POST', `/editions/${rows[0]!.label}/rollback`, 'admin', {
      note: 'Back to before the split',
    })
    expect(back.statusCode, back.body).toBe(200)
    // The family's versions say it is one, so the edition serves its variants in it.
    const again = (await family('Accrued share 1'))!
    expect(again.family!.variants.map((v) => v.key)).toEqual(
      accrued.family!.variants.map((v) => v.key),
    )
    expect((await catalogue()).splits).toEqual([])
    // The edition brought back the note as it was then, about the family, so it is flagged again.
    expect(await ok<FamilySplit>(split(accrued.key, 'admin'))).toMatchObject({ items: 1 })
    const { rows: standing } = await client.query<{ n: number }>(
      'select count(*)::int as n from family_splits where family_key = $1 and joined_in is null',
      [accrued.key],
    )
    expect(standing[0]!.n).toBe(1)
  })

  const flagged = async () =>
    (
      await client.query<{ flag: string }>(
        `select flag::text from v_overlay_on where kind = 'flag_on' and item_id = $1`,
        [note],
      )
    ).rows
  const splitEdition = async () =>
    (
      await client.query<{ label: string }>(
        `select e.label from family_splits x join editions e on e.seq = x.split_in
          where x.family_key = $1 order by x.split_in desc limit 1`,
        [accrued.key],
      )
    ).rows[0]!.label
  const rollback = (label: string) =>
    ok(call('POST', `/editions/${label}/rollback`, 'admin', { note: 'Back' }))

  it('is served again by going back into it after it was joined, and can be joined once more', async () => {
    const [eur, usd] = accrued.family!.variants
    const edition = await splitEdition()
    await ok(join(accrued.key, 'admin'))
    expect(await family('Accrued share 1')).toBeDefined()
    await rollback(edition)
    // The edition has the content of the split one, so it reads as it does, joined or not.
    expect(await family('Accrued share 1')).toBeUndefined()
    expect((await catalogue()).splits).toMatchObject([{ key: accrued.key }])
    expect(await reaching(eur!.key)).toContain(note)
    expect(await reaching(usd!.key)).toContain(note)
    expect(await flagged()).toEqual([{ flag: 'needs_check' }])
    expect(await ok<FamilyJoined>(join(accrued.key, 'admin'))).toMatchObject({
      name: 'Accrued share 1',
    })
    expect(await family('Accrued share 1')).toBeDefined()
    expect((await catalogue()).splits).toEqual([])
    expect(await flagged()).toEqual([])
  })

  it('reads the family as live after going back to before a split that stands', async () => {
    await ok(split(accrued.key, 'admin'))
    const before = (
      await client.query<{ label: string }>(
        `select e.label from editions e where e.seq = (select max(split_in) from family_splits
          where family_key = $1) - 1`,
        [accrued.key],
      )
    ).rows[0]!.label
    await rollback(before)
    expect(await family('Accrued share 1')).toBeDefined()
    expect((await catalogue()).splits).toEqual([])
    expect(await flagged()).toEqual([])
    const page = await ok<{ chips: string[] }>(call('GET', `/items/${note}/page`, 'owner'))
    expect(page.chips).toEqual(['Accrued share 1'])
    const feed = await ok<Feed>(call('GET', '/inbox/feed', 'owner'))
    expect(feed.cards.find((c) => c.group === 'check' && c.itemId === note)).toBeUndefined()
    // It can be split once more, and joined again.
    await ok(split(accrued.key, 'admin'))
    await ok(join(accrued.key, 'admin'))
  })

  it('is not split when the family is closed after it was joined, whatever the reason', async () => {
    const [eur] = accrued.family!.variants
    expect((await catalogue()).splits).toEqual([])
    expect(await flagged()).toEqual([])
    const seq = await openEdition(client)
    await client.query(
      'update vocab_term_service set editions = int8range(lower(editions), $1::bigint) where term_key = $2 and upper_inf(editions)',
      [seq, accrued.key],
    )
    await client.query('select edition_seal($1)', [seq])
    await client.query('select edition_publish($1)', [seq])
    expect((await catalogue()).splits).toEqual([])
    expect(await flagged()).toEqual([])
    const page = await ok<{ chips: string[] }>(call('GET', `/items/${note}/page`, 'owner'))
    expect(page.chips).not.toContain(eur!.name)
  })
})
