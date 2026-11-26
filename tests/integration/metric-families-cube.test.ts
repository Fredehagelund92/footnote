import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Catalogue } from '../../src/contract/catalogue.ts'
import type { NamesRead } from '../../src/contract/inbox.ts'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { ReviewProposal } from '../../src/contract/review.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import {
  ConnectorRegistry,
  connectorSyncJob,
  createCubeSource,
} from '../../src/server/modules/connectors/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { variantCube } from '../server/connectors/metric-variants-fixture.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, queueReads, testDatabase } from './support.ts'

/*
  Families of metrics (FR-142) from a Cube model on the server, on the real service and
  PostgreSQL 18: an invented shop's measures, one per currency and channel, are found as families
  from their filters, and an item on a family is flagged once, with one Inbox entry, when the
  currency column every variant compares is renamed.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const logger = createLogger({ level: 'silent' })
const clock = systemClock('2026-10-08')
const folder = await mkdtemp(join(tmpdir(), 'footnote-families-cube-'))
/**
 * Three measures by four currencies by two channels: 24 metrics, three families of eight. And a
 * measure in EUR with one in USD worked out from it with each row's rate: two calculations whose
 * names are one name in two currencies.
 */
const model = variantCube({ measures: 3, currencies: 4, channels: 2 }).replace(
  '    measures:\n',
  `    measures:
      - name: accrued_share_front_loaded_eur
        type: sum
        sql: accrued_share
        title: "Accrued share front loaded (EUR)"
        description: The share of each booking accrued up front, in EUR.
        filters:
          - sql: "{CUBE}.accrual_type = 'front_loaded'"
      - name: accrued_share_front_loaded_usd
        type: sum
        sql: "accrued_share * fx_rate"
        title: "Accrued share front loaded (USD)"
        description: The EUR amount multiplied by the row's exchange rate.
        filters:
          - sql: "{CUBE}.accrual_type = 'front_loaded'"
`,
)
await writeFile(join(folder, 'model.yml'), model)
const registry = new ConnectorRegistry([createCubeSource({ modelDir: folder })])
const app = buildApp({
  database,
  jobs: idleJobs(),
  sources: registry,
  logger,
  clock,
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

/** One run of the sources' job, with the source made due. */
async function read() {
  await queueReads(client)
  await connectorSyncJob(registry, { clock }).run({
    database,
    logger,
    signal: new AbortController().signal,
  })
}

beforeAll(async () => {
  await foundation(client)
  await client.query("insert into areas (id,name) values ('sales','Sales')")
  await client.query(
    `insert into area_assignments (area_id,person_id,role) values ('sales',$1,'owner')`,
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
  await read()
}, 120_000)
afterAll(async () => {
  await app.close()
  await rm(folder, { recursive: true, force: true })
})

describe('families in a Cube model', () => {
  let itemId = ''

  it('refuses a family whose variant has a taken name, saying so without naming a variant', async () => {
    const taken = await ok<{ id: string }>(
      call('POST', '/terms', 'owner', {
        name: 'Net revenue (EUR) web',
        meaning: 'What the finance team calls net revenue taken in euros on the web.',
        areaId: 'sales',
      }),
    )
    const { revision, names } = await ok<NamesRead>(call('GET', '/inbox/names', 'admin'))
    const family = names.find((name) => name.key === 'group:net_revenue')!
    expect(family.state).toBe('flagged')
    expect(family.flags.map((flag) => flag.code)).toEqual(['variants'])
    expect(JSON.stringify(family.flags)).not.toMatch(/\(EUR\)/)
    const refused = await call('POST', '/inbox/names/decide', 'admin', {
      revision,
      accept: [{ key: family.key }],
      leaveOut: [],
    })
    expect(refused.statusCode, refused.body).toBe(422)
    expect(refused.body).not.toMatch(/\(EUR\)/)
    const left = await ok<{ leftOut: number }>(
      call('POST', '/inbox/names/decide', 'admin', {
        revision,
        accept: [],
        leaveOut: [family.key],
      }),
    )
    expect(left.leftOut).toBe(1)
    await client.query('delete from names_left_out')
    await ok(call('POST', '/terms/delete', 'owner', { ids: [taken.id] }))
  }, 120_000)

  it('are found from the measures’ filters and published with one press each', async () => {
    const { revision, names } = await ok<NamesRead>(call('GET', '/inbox/names', 'admin'))
    const families = names.filter((name) => name.kind === 'metric_group')
    const calculation = (name: string) => ({
      by: ['Currency', 'Channel'],
      found: 'calculation',
      names: [],
      values: [
        ['EUR', 'GBP', 'SEK', 'USD'],
        ['app', 'web'],
      ],
      meaning: {
        words: `${name} for orders paid in {Currency} through the {Channel} channel.`,
        source: 'common',
        agree: 8,
        base: null,
        differing: 0,
      },
    })
    expect(families.map((name) => [name.name, name.state, name.family])).toEqual([
      // Its column converts no other pair, so it is no rate: only its name says it is the same
      // amount in USD, and the owner says whether the two are one family (D1). Its measure reads
      // the EUR one's column and the rate, so it is converted from it, which then speaks for the
      // family.
      [
        'Accrued share front loaded',
        'flagged',
        {
          variants: 2,
          by: ['Currency'],
          found: 'names',
          names: ['Accrued share front loaded (EUR)', 'Accrued share front loaded (USD)'],
          values: [['EUR', 'USD']],
          meaning: {
            words: 'The share of each booking accrued up front, in {Currency}.',
            source: 'common',
            agree: 1,
            base: 'Accrued share front loaded (EUR)',
            differing: 0,
          },
        },
      ],
      ['Gross revenue', 'ready', { variants: 8, ...calculation('Gross revenue') }],
      ['Net revenue', 'ready', { variants: 8, ...calculation('Net revenue') }],
      ['Revenue', 'ready', { variants: 8, ...calculation('Revenue') }],
    ])
    expect(names.filter((name) => name.kind === 'metric')).toEqual([])
    // Publish all and, at its own press, the names that look alike as one family.
    await ok(
      call('POST', '/inbox/names/decide', 'admin', {
        revision,
        accept: names
          .filter((name) => name.state === 'ready' || name.family?.found === 'names')
          .map(({ key }) => ({ key })),
        leaveOut: [],
      }),
    )
    const { terms } = await ok<Catalogue>(call('GET', '/catalogue', 'admin'))
    expect(terms.map((term) => [term.name, term.family?.variants.length ?? null])).toEqual([
      ['Accrued share front loaded', 2],
      ['Gross revenue', 8],
      ['Net revenue', 8],
      ['Revenue', 8],
      ['Channel', null],
      ['Currency', null],
      ['Status', null],
    ])
    // The family's page says how one variant is worked out from the other, in the source's words.
    // Both carry one more filter, the same on each: the names still say it is the currency.
    expect(terms[0]!.family).toMatchObject({
      found: 'names',
      by: ['Currency'],
      conversions: [{ by: 'fx_rate' }],
      variants: [{ values: ['EUR'] }, { values: ['USD'] }],
      derivations: [
        "Accrued share front loaded (USD): The EUR amount multiplied by the row's exchange rate.",
      ],
    })
    expect(terms[1]!.family?.derivations).toEqual([])
  }, 120_000)

  it('flag an item on a family once when the currency column is renamed', async () => {
    const created = await ok<ProposalRecord>(
      call('POST', '/proposals', 'author', {
        draft: {
          areaId: 'sales',
          title: 'Revenue counts a gift card when it is spent',
          summary: 'Revenue counts a gift card when it is spent, not when it is sold.',
          scope: { metrics: ['group:revenue'], dimensions: [], dimensionValues: [] },
          validity: { start: '2026-08-04', end: null },
          evidence: [{ url: 'https://example.test/note', quote: 'Noted', date: '2026-08-04' }],
        },
      }),
    )
    const submitted = await ok<ProposalRecord>(
      call('POST', `/proposals/${created.id}/submit`, 'author', { revision: created.revision }),
    )
    const sheet = await ok<{ proposal: ReviewProposal; clashes: { itemId: string }[] }>(
      call('GET', `/review/${submitted.id}/sheet`, 'owner'),
    )
    await ok(
      call('POST', `/review/${submitted.id}/publish`, 'owner', {
        revision: sheet.proposal.revision,
        relations: sheet.clashes.map((clash) => ({ itemId: clash.itemId, relation: 'unrelated' })),
      }),
    )
    itemId = submitted.itemId!
    await writeFile(join(folder, 'model.yml'), model.replaceAll('currency_code', 'currency'))
    await read()
    const flags = await client.query<{ item_id: string; flag: string }>(
      "select item_id,flag::text from overlay_events where kind='flag_on'",
    )
    expect(flags.rows).toEqual([{ item_id: itemId, flag: 'needs_check' }])
    while (
      (await client.query<{ relayed: number }>('select relayed from cl_outbox_relay(1000)')).rows[0]
        ?.relayed
    );
    const entries = await client.query<{ subject: string }>(
      "select subject_id as subject from inbox_items where kind='item.flagged' and person_id=$1",
      [people.owner],
    )
    expect(entries.rows).toEqual([{ subject: itemId }])
  }, 120_000)

  it('keep a family published from its names when a read finds it from a rate (C2)', async () => {
    // Two pairs whose names look alike, each USD one the EUR column times the row's rate. Read
    // first as a Cube read did before it said what a measure reads, then as it does now.
    const pairs = (usd: (eur: string) => string) =>
      model.replaceAll('currency_code', 'currency').replace(
        '    measures:\n',
        `    measures:
${[
  ['partner_payouts', 'payout_eur', 'Payouts we send partners'],
  ['seller_fees', 'fee_eur', 'Fees sellers pay us'],
]
  .flatMap(([name, column, words]) => [
    `      - name: ${name}_eur`,
    '        type: sum',
    `        sql: "${column}"`,
    `        title: "${words} (EUR)"`,
    `        description: ${words} in EUR, on the day they are booked.`,
    `      - name: ${name}_usd`,
    '        type: sum',
    `        sql: "${usd(column!)}"`,
    `        title: "${words} (USD)"`,
    `        description: ${words} converted to USD at each row's rate.`,
  ])
  .join('\n')}
`,
      )
    await writeFile(
      join(folder, 'model.yml'),
      pairs((eur) => `ABS(${eur}) * fx_rate`),
    )
    await read()
    const before = await ok<NamesRead>(call('GET', '/inbox/names', 'admin'))
    const suggested = (read: NamesRead) =>
      read.names
        .filter((name) => name.kind === 'metric_group')
        .map((name) => [name.name, name.family?.found])
    expect(suggested(before)).toEqual([
      ['Fees sellers pay us', 'names'],
      ['Payouts we send partners', 'names'],
    ])
    await ok(
      call('POST', '/inbox/names/decide', 'admin', {
        revision: before.revision,
        accept: before.names
          .filter((name) => name.kind === 'metric_group')
          .map(({ key }) => ({ key })),
        leaveOut: [],
      }),
    )
    await writeFile(
      join(folder, 'model.yml'),
      pairs((eur) => `${eur} * fx_rate`),
    )
    await read()
    const { terms } = await ok<Catalogue>(call('GET', '/catalogue', 'admin'))
    const pair = (name: string) => terms.find((term) => term.name === name)?.family
    for (const name of ['Payouts we send partners', 'Fees sellers pay us'])
      expect(pair(name), name).toMatchObject({
        found: 'rate',
        variants: [{ values: ['EUR'] }, { values: ['USD'] }],
        conversions: [{ by: 'fx_rate' }],
        meaning: { source: 'common', words: `${name} in {Currency}, on the day they are booked.` },
      })
    // Never suggested again: the published family stays as it is.
    expect(suggested(await ok<NamesRead>(call('GET', '/inbox/names', 'admin')))).toEqual([])
  }, 120_000)
})
