import { expect, it } from 'vitest'
import { UTC_CALENDAR } from '../../../src/domain/dates.ts'
import { servedWords, type WrittenTerm } from '../../../src/domain/served-terms.ts'
import { createToolService } from '../../../src/server/mcp/service.ts'
import type { EditionSource, ServingBundle } from '../../../src/server/modules/editions/index.ts'
import type { DefinitionRead } from '../../../src/server/mcp/reads.ts'
import { bundle, fakeReads, memoryStore } from './fixtures.ts'

/*
  read_context for a definition (FR-353), on the tool service's own code: words that name one
  definition read it whole, by any of its names; words that name several give their keys to pick
  from, and words that name none the closest names. A term reads as a person wrote it, by whom as
  a role, and never as a checked source. A copy the source's read cut says so.
*/

const peak = '0190f3a2-0000-7000-8000-000000000001'
const written: WrittenTerm[] = [
  {
    id: peak,
    name: 'Peak season',
    meaning: 'The weeks from 1 November to 24 December, when **online sales** double.',
    sameAs: null,
    areaId: 'finance',
    writtenOn: '2026-10-20',
    writtenAs: 'owner',
    conflict: false,
  },
  {
    id: '0190f3a2-0000-7000-8000-000000000002',
    name: 'Busy season',
    meaning: null,
    sameAs: `term:${peak}`,
    areaId: 'finance',
    writtenOn: '2026-10-21',
    writtenAs: 'owner',
    conflict: false,
  },
  {
    id: '0190f3a2-0000-7000-8000-000000000003',
    name: 'Purchases',
    meaning: null,
    sameAs: 'metric:orders',
    areaId: 'finance',
    writtenOn: '2026-10-22',
    writtenAs: 'administrator',
    conflict: false,
  },
]
/** The source's words for Market share, longer than Footnote keeps: its read cut them. */
const cut = `${'The share of the market a brand holds, by sales. '.repeat(9).trim()}…`

function edition(): ServingBundle {
  const data = bundle()
  const share = {
    key: 'metric:market_share',
    kind: 'metric' as const,
    name: 'Market share',
    // Another of its names is the name of a dimension: "Market" names both.
    aliases: ['Market'],
    parentKey: null,
    areaId: 'finance',
    definitionRefs: ['cube:finance.market_share'],
    definitions: [
      { ref: 'cube:finance.market_share', missing: false, renamedTo: null, changeMark: '1' },
    ],
    described: {
      ref: 'cube:finance.market_share',
      title: null,
      description: cut,
      tool: 'Cube',
      source: 'Cube local model',
    },
  }
  // A metric in a domain that is paused: agents get nothing of it, not even its name.
  const refunds = { ...share, key: 'metric:refunds', name: 'Refunds', aliases: [], areaId: 'paid' }
  const stopped = { ...data.stopped, areas: ['paid'] }
  const served = servedWords([...data.terms, share, refunds], written, stopped)
  return {
    ...data,
    stopped,
    areas: [
      ...data.areas,
      { id: 'paid', name: 'Paid media', team: null, summary: '', description: '' },
    ],
    terms: served.vocabulary,
    written: served.written,
    metricArea: { ...data.metricArea, 'metric:market_share': 'finance' },
  }
}

/** What Definitions shows of Orders: what it is built from, as its source's structure says. */
const relation = (r: Partial<DefinitionRead['relations'][number]>) => ({
  kind: 'built_from' as const,
  ref: null,
  name: '',
  key: null,
  missing: false,
  by: null,
  ...r,
})
const reads = fakeReads(undefined, {
  'metric:orders': {
    term: { definitions: [], definition: null, family: null } as unknown as DefinitionRead['term'],
    relations: [
      relation({
        ref: 'cube:finance.market_share',
        name: 'Market share',
        key: 'metric:market_share',
      }),
      relation({ ref: 'cube:finance.refunds', name: 'Refunds', key: 'metric:refunds' }),
      relation({ ref: 'cube:finance.unpublished', name: 'finance.unpublished' }),
      relation({ name: 'amount_eur' }),
    ],
  },
})
function call(input: Record<string, unknown>) {
  const source: EditionSource = {
    bundle: () => Promise.resolve(edition()),
    policy: () =>
      Promise.resolve({
        client: null,
        tools: [],
        limits: {},
        rates: { person: 30, client: 120 },
        about: '',
        calendar: UTC_CALENDAR,
      }),
  }
  const execute = createToolService(
    source,
    memoryStore().store,
    () => new Date('2026-10-07T12:34:56Z'),
    reads,
    'https://footnote.example',
  )
  return execute(
    'read_context',
    input,
    { client: 'claude-code', scopes: ['read'], caller: 'agent', canSelectEdition: false },
    100000,
    () => {},
  ).then((result) => result.structuredContent)
}

it('gives the keys to pick from for words that name several definitions', async () => {
  const reply = await call({ id: 'market' })
  expect(reply).toMatchObject({
    status: 'need_more_detail',
    say: 'Those words name 2 definitions.',
    next: 'Call again with one key from options.',
    options: [
      {
        field: 'id',
        input: 'market',
        options: ['dim:market (Market)', 'metric:market_share (Market share)'],
      },
    ],
  })
  expect(reply.definition).toBeUndefined()
  // Either key reads that one.
  expect(await call({ id: 'dim:market' })).toMatchObject({
    status: 'matched',
    definition: { key: 'dim:market', kind: 'dimension', words: null },
  })
})

it('reads a metric by a synonym a person wrote, as the metric it names', async () => {
  expect(await call({ id: 'Purchases' })).toMatchObject({
    status: 'matched',
    definition: {
      key: 'metric:orders',
      words: 'The value of paid orders, in euros.',
      other_names: ['Purchases'],
      domain: 'Finance',
      owner: { role: 'the owner of Finance', team: 'Regulation' },
      source: {
        tool: 'Cube',
        source: 'Cube local model',
        name: 'finance.orders',
        state: 'current',
      },
      url: 'https://footnote.example/definitions/Orders',
    },
  })
})

it('reads a term whole, as a person wrote it, by its own name or a synonym of it', async () => {
  const reply = await call({ id: 'Busy season' })
  expect(reply).toMatchObject({
    status: 'matched',
    say: 'This is the whole definition of Peak season, a term. No published context item is about it.',
    definition: {
      key: `term:${peak}`,
      kind: 'term',
      words: 'The weeks from 1 November to 24 December, when **online sales** double.',
      other_names: ['Busy season'],
      written: { role: 'the owner of Finance', date: '2026-10-20' },
      domain: 'Finance',
    },
  })
  expect(reply.next).toContain('never give them as a checked source')
  expect(await call({ id: 'Peak season' })).toEqual(reply)
})

it('says the source wrote more than Footnote keeps', async () => {
  const reply = await call({ id: 'Market share' })
  expect(reply).toMatchObject({ definition: { words: cut, shortened: true } })
  expect((await call({ id: 'Orders' })).definition).not.toHaveProperty('shortened')
})

it('gives the closest names for words that name none, and reads a missing item as before', async () => {
  expect(await call({ id: 'Orderz' })).toMatchObject({
    status: 'no_match',
    options: [{ field: 'id', input: 'Orderz', options: ['metric:orders (Orders)'] }],
  })
  expect(await call({ id: 'itm_missing001' })).toMatchObject({
    status: 'no_match',
    message: 'Not found',
  })
})

it('reads what Definitions shows of a metric from the live catalogue, by its key', async () => {
  reads.asked.length = 0
  await call({ id: 'Orders' })
  expect(reads.asked).toEqual([['definition', 'metric:orders']])
  // A term is all in the edition: what a person wrote, which the catalogue does not hold.
  reads.asked.length = 0
  await call({ id: 'Peak season' })
  expect(reads.asked).toEqual([])
})

it('names only what agents may read of what a metric is built from: never a paused or unpublished one', async () => {
  const reply = await call({ id: 'Orders' })
  expect((reply.definition as { relations: unknown }).relations).toEqual([
    { kind: 'built_from', name: 'Market share', key: 'metric:market_share' },
    { kind: 'built_from', name: 'amount_eur', key: null },
  ])
  expect(JSON.stringify(reply)).not.toMatch(/Refunds|unpublished/)
  // A definition in a paused domain is not read at all.
  expect(await call({ id: 'Refunds' })).toMatchObject({ status: 'no_match' })
})
