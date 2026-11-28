import { describe, expect, it } from 'vitest'
import * as z from 'zod'
import type { RecordsItem } from '../../src/domain/records.ts'
import { toolSchemaDigest, toolNames } from '../../src/server/mcp/tools.ts'
import {
  askToolDefinitions,
  askToolNames,
  createAskTools,
  type ToolReads,
} from '../../src/server/modules/answer/index.ts'
import {
  queryRecords,
  recordsInput,
  type RecordsTable,
} from '../../src/server/modules/answer/tool-records.ts'
import { UTC_CALENDAR } from '../../src/domain/dates.ts'
import { bundle } from './mcp/fixtures.ts'

/*
  Ask's tools without a database (FR-718 to FR-720): the registry the loop will offer, what it
  leaves unchanged for agents, the errors an input that does not fit gets, and the records tool's
  counting, ranking and denominators, by code. The tools as each person, on the real service, are
  tests/web/integration/ask-tools.test.ts.
*/

/** Reads that fail if a test reaches them: the registry needs none until a tool runs. */
const unread = (): never => {
  throw new Error('not read here')
}
const noReads: ToolReads = {
  bundle: unread,
  index: unread,
  readable: unread,
  records: unread,
  pending: () => Promise.resolve([]),
  areas: unread,
  people: unread,
  catalogue: unread,
  glossary: unread,
  itemHistory: unread,
  termHistory: unread,
  conflicts: unread,
  inbox: unread,
  asked: unread,
  calendar: UTC_CALENDAR,
  today: '2026-10-23',
  now: '2026-10-23T12:00:00.000Z',
}

describe("Ask's tool registry", () => {
  it('gives every tool a description and schemas the loop can send, in the AI SDK shape', () => {
    expect(Object.keys(askToolDefinitions)).toEqual([...askToolNames])
    for (const name of askToolNames) {
      const { description, input, output } = askToolDefinitions[name]
      expect(description.length, name).toBeGreaterThan(80)
      expect(z.toJSONSchema(input, { io: 'input' }), name).toMatchObject({ type: 'object' })
      expect(z.toJSONSchema(output), name).toMatchObject({ type: 'object' })
    }
    const tools = createAskTools(noReads).ai()
    expect(Object.keys(tools)).toEqual([...askToolNames])
    for (const name of askToolNames) {
      expect(tools[name].description).toBe(askToolDefinitions[name].description)
      expect(tools[name].inputSchema).toBe(askToolDefinitions[name].input)
      expect(typeof tools[name].execute).toBe('function')
    }
  })

  it('says the searches read published context only, never that nothing is written', () => {
    for (const name of ['find_context', 'get_context'] as const) {
      const { description } = askToolDefinitions[name]
      expect(description, name).toContain('published items only, never drafts')
      expect(description, name).toContain('say that nothing published covers it')
      expect(description.replace('never that nothing is written', ''), name).not.toMatch(
        /nothing is written/,
      )
    }
  })

  it('leaves every MCP tool as agents have it (FR-718.5)', () => {
    // A deliberate change to an MCP tool changes these; Ask's tools never do.
    expect(toolNames).toEqual([
      'get_context',
      'find_context',
      'read_context',
      'report',
      'write_draft',
      'read_draft',
      'send_draft',
    ])
    expect(toolSchemaDigest).toBe(
      '53a9e0d988337624531efdd86dbf723c5ddd8872aff87a93f94c5cebb191bd0c',
    )
    // No Ask tool writes, reports or suggests: none is an agent tool that is not a read.
    expect(
      askToolNames.filter((n) => ['report', 'write_draft', 'read_draft', 'send_draft'].includes(n)),
    ).toEqual([])
  })

  it('refuses an input that does not fit, saying which part, and reads nothing', async () => {
    const tools = createAskTools(noReads)
    const refusal = async (name: 'records' | 'read_context' | 'find_context', input: object) => {
      const result = await tools.run(name, input)
      expect(result.ids).toEqual([])
      return 'error' in result ? result.error : null
    }
    expect(await refusal('records', { show: 'everything' })).toMatch(
      /^The input does not fit records: show /,
    )
    expect(await refusal('read_context', { id: 'not an id' })).toMatch(
      /^The input does not fit read_context: id /,
    )
    expect(
      await refusal('find_context', { words: 'orders', widen: { without: 'market' } }),
    ).toMatch(/widen\.without/)
    // Other names come as a list of up to three, each one name: never one phrase of them all.
    expect(
      await refusal('find_context', {
        words: 'accounting',
        widen: { other_words: 'general ledger bookkeeping entries' },
      }),
    ).toMatch(/widen\.other_words/)
    expect(
      await refusal('find_context', {
        words: 'accounting',
        widen: { other_words: ['bookkeeping', 'ledger', 'books', 'accounts'] },
      }),
    ).toMatch(/widen\.other_words/)
  })
})

const item = (over: Partial<RecordsItem> & Pick<RecordsItem, 'id' | 'title'>): RecordsItem => ({
  kind: 'event',
  areaId: 'area_sales',
  status: 'live',
  reviewDate: null,
  checkFlag: null,
  publishedAt: '2026-09-01T09:00:00.000Z',
  changedAt: '2026-09-01T09:00:00.000Z',
  checkedAt: '2026-09-01T00:00:00.000Z',
  archivedAt: null,
  owners: [],
  metrics: ['metric:orders'],
  values: [],
  ...over,
})
const table: RecordsTable = {
  items: [
    item({
      id: 'itm_a',
      title: 'Norway stop',
      values: ['val:market/norway'],
      checkedAt: '2026-10-03T00:00:00.000Z',
    }),
    item({ id: 'itm_b', title: 'Card only', kind: 'note', status: 'due', checkedAt: null }),
    item({
      id: 'itm_c',
      title: 'Old campaign',
      areaId: 'area_marketing',
      status: 'archived',
      metrics: ['metric:roas'],
    }),
    item({
      id: 'itm_d',
      title: 'Store credit',
      kind: 'note',
      values: ['val:market/norway', 'val:market/sweden'],
      publishedAt: '2026-10-20T08:00:00.000Z',
      checkedAt: '2026-08-01T00:00:00.000Z',
    }),
  ],
  areas: [
    { id: 'area_sales', name: 'Sales' },
    { id: 'area_marketing', name: 'Marketing' },
  ],
  nameOf: (key) =>
    ({
      'metric:orders': 'Orders',
      'metric:roas': 'Return on ad spend',
      'val:market/norway': 'Norway',
      'val:market/sweden': 'Sweden',
    })[key] ?? key,
  isShown: (key) => key !== 'metric:roas' && key !== 'val:market/sweden',
  keysOf: (names) => {
    const known: Record<string, string> = { orders: 'metric:orders', norway: 'val:market/norway' }
    return {
      keys: names.flatMap((n) => (known[n.toLowerCase()] ? [known[n.toLowerCase()]!] : [])),
      unknown: names.filter((n) => !known[n.toLowerCase()]).map((n) => `"${n}" names nothing.`),
    }
  },
}
const read = (input: object) => queryRecords(recordsInput.parse(input), table)
/** A records answer, which these inputs must get. */
const query = (input: object) => {
  const found = read(input)
  if ('error' in found) throw new Error(found.error)
  return found
}

describe('the records tool (FR-720.3)', () => {
  it('never names a metric or value Definitions hides, counting it as unnamed', () => {
    const named = (by: 'metric' | 'value') => {
      const groups = query({ group_by: by, show: 'count' }).groups
      return JSON.stringify(groups)
    }
    expect(named('metric')).not.toMatch(/roas|Return on ad spend/)
    expect(query({ group_by: 'metric', show: 'count' }).groups?.rows).toContainEqual(
      expect.objectContaining({ key: null, name: 'no metric named', count: 1, more: 0 }),
    )
    expect(named('value')).not.toMatch(/sweden|Sweden/)
  })

  it('says what every count is out of, by the domain and the statuses asked', () => {
    expect(query({ show: 'count' })).toMatchObject({
      count: 4,
      counted: '4 of 4 context items you can see',
      byStatus: { live: 2, due: 1, archived: 1 },
    })
    expect(query({ show: 'count', status: ['live', 'due'], about: ['Norway'] })).toMatchObject({
      count: 2,
      counted: '2 of 3 published context items you can see',
    })
    expect(query({ show: 'count', domain: 'sales', status: ['due'] })).toMatchObject({
      counted: '1 of 1 context item needing a recheck in Sales you can see',
    })
    expect(query({ show: 'count', status: ['live', 'archived'] })).toMatchObject({
      counted: '3 of 3 live or archived context items you can see',
    })
  })

  it('ranks in code, with an item that has no date of the kind last, either way', () => {
    const ranked = (order: string) =>
      query({ sort_by: 'last_checked', order }).items.map((i) => [i.rank, i.id])
    expect(ranked('newest_first')).toEqual([
      [1, 'itm_a'],
      [2, 'itm_c'],
      [3, 'itm_d'],
      [4, 'itm_b'],
    ])
    expect(ranked('oldest_first')).toEqual([
      [1, 'itm_d'],
      [2, 'itm_c'],
      [3, 'itm_a'],
      [4, 'itm_b'],
    ])
    expect(query({ limit: 2 })).toMatchObject({ more: 2, order: 'by title' })
  })

  it('counts by dates, kinds and groups, saying when groups add up to more', () => {
    expect(
      query({ dated: { field: 'published', from: '2026-10-01', to: '2026-10-20' } }),
    ).toMatchObject({ count: 1, filters: { period: 'published 1-20 Oct 2026' } })
    expect(query({ kinds: ['rule'], show: 'count' })).toMatchObject({ count: 2 })
    const groups = query({ group_by: 'value', show: 'count' }).groups
    expect(groups).toMatchObject({
      by: 'value',
      note: 'An item that names several counts under each, so the groups add up to more than 4 items.',
      order: 'the largest first',
    })
    // Each group by the id a typed mention writes, with its items as rows, in the list's order.
    expect(groups?.rows.map(({ key, name, count, more }) => ({ key, name, count, more }))).toEqual([
      { key: 'value:market/norway', name: 'Norway', count: 2, more: 0 },
      { key: null, name: 'no value named', count: 2, more: 0 },
    ])
    expect(groups?.rows[0]?.items.map((i) => i.id)).toHaveLength(2)
    // By status, what needs a check comes first, whatever the counts.
    expect(query({ group_by: 'status', show: 'count' }).groups?.rows.map((r) => r.key)).toEqual([
      'due',
      'live',
      'archived',
    ])
  })

  it('lists at most 50 rows across its groups, whatever their number, counting the rest (F4)', () => {
    // F4 of the re-run: 22 metrics' groups of 25 rows each sent the model 181 KB for a count.
    const metrics = Array.from({ length: 22 }, (_, m) => `metric:m${m}`)
    const many: RecordsTable = {
      ...table,
      items: metrics.flatMap((metric, m) =>
        Array.from({ length: 30 }, (_, i) =>
          item({ id: `itm_${m}_${i}`, title: `Item ${m} ${i}`, metrics: [metric] }),
        ),
      ),
      isShown: () => true,
    }
    const found = queryRecords(recordsInput.parse({ group_by: 'metric', show: 'count' }), many)
    if ('error' in found) throw new Error(found.error)
    const rows = found.groups!.rows
    expect(rows).toHaveLength(22)
    expect(rows.every((g) => g.count === 30 && g.items.length + g.more === 30)).toBe(true)
    expect(rows.reduce((n, g) => n + g.items.length, 0)).toBeLessThanOrEqual(50)
    expect(JSON.stringify(found).length).toBeLessThan(40_000)
    // Few groups still list up to 25 rows each.
    expect(query({ group_by: 'value', show: 'count' }).groups?.rows[0]?.items).toHaveLength(2)
  })

  it('names what it does not know instead of counting nothing', () => {
    expect(read({ domain: 'Sails' })).toEqual({
      error: 'No domain is called "Sails". The domains are Sales, Marketing.',
    })
    expect(read({ about: ['Orders', 'Atlantis'] })).toEqual({ error: '"Atlantis" names nothing.' })
  })
})

describe('a family of metrics in Ask (FR-142)', () => {
  const term = (key: string, name: string, kind: string, parentKey: string | null = null) => ({
    key,
    name,
    kind,
    parentKey,
    aliases: [],
    definitionRefs: [],
  })
  const variants = ['metric:revenue_aed_app', 'metric:revenue_eur_web', 'metric:revenue_usd_web']
  const family = {
    key: 'group:revenue',
    kind: 'metric',
    id: 'revenue',
    name: 'Revenue',
    aliases: [],
    group: null,
    domain: { areaId: 'area_sales', source: 'vocabulary' },
    definition: {
      ref: 'dbt:orders.revenue_aed_app',
      name: 'orders.revenue_aed_app',
      title: null,
      descriptionCopy: null,
      valueType: null,
      state: 'current',
      renamedTo: null,
      changedAt: null,
      readAt: null,
      sourceId: 'dbt',
      tool: 'dbt',
      connector: 'dbt-metricflow',
    },
    definitions: [],
    status: 'in_sync',
    shelf: {
      items: 0,
      byKind: { note: 0, event: 0, guide: 0, issue: 0 },
      needsALook: 0,
      activeIssues: 0,
      ended: 0,
      gaps: 0,
      mentionedBy: 0,
      lastUpdated: null,
    },
    family: {
      by: ['Currency', 'Channel'],
      derivations: [],
      conversions: [],
      // The USD variant's source says how it is worked out from the EUR one.
      variants: variants.map((key) => ({
        key,
        name: `${key} variant`,
        aliases: [],
        values: key
          .split('_')
          .slice(1)
          .map((v, i) => (i ? v : v.toUpperCase())),
        description: key.endsWith('usd_web')
          ? "The EUR web amount multiplied by the row's exchange rate."
          : null,
        ref: `dbt:sales.${key.slice('metric:'.length)}`,
        state: null,
        items: 0,
      })),
      // No words most variants share, and no base: no meaning, so every variant's own words.
      meaning: {
        source: 'none',
        words: null,
        common: null,
        base: null,
        differing: ['metric:revenue_usd_web'],
        chosen: null,
        revision: 0,
      },
      usual: { member: null, chosen: null, revision: 0 },
    },
  }
  const reads = {
    ...noReads,
    bundle: () =>
      Promise.resolve({
        items: [],
        terms: [
          term('group:revenue', 'Revenue', 'metric_group'),
          ...variants.map((key) => term(key, `${key} variant`, 'metric')),
        ],
      }),
    readable: () => Promise.resolve([]),
    areas: () => Promise.resolve([{ id: 'area_sales', name: 'Sales', ownerIds: [] }]),
    people: () => Promise.resolve([]),
    catalogue: () => Promise.resolve({ terms: [family] }),
    glossary: () => Promise.resolve({ terms: [] }),
    asked: () => Promise.resolve({ asked: { week: '2026-10-19', rows: [] }, minimum: 5 }),
    records: () =>
      Promise.resolve([
        item({ id: 'itm_f', title: 'On the family', metrics: ['group:revenue'] }),
        item({ id: 'itm_v', title: 'On one variant', metrics: ['metric:revenue_eur_web'] }),
        item({ id: 'itm_o', title: 'On orders', metrics: ['metric:orders'] }),
      ]),
  } as unknown as ToolReads
  const tools = createAskTools(reads)

  it('says where a family comes from without naming a variant', async () => {
    const result = await tools.run('definitions', {})
    expect(JSON.stringify(result)).not.toMatch(/revenue_aed_app/)
    expect(result).toMatchObject({ definitions: [{ name: 'Revenue', from: 'dbt' }] })
  })

  it("gives a family's variants' own words, each by what tells it apart (F2)", async () => {
    const result = await tools.run('definitions', { names: ['Revenue'] })
    const [revenue] = (result as { definitions: { words: string | null }[] }).definitions
    expect(revenue!.words).toBe(
      "A family of 3 near-identical metrics, one for each currency and channel. An item about it applies to every one of them. USD, web: The EUR web amount multiplied by the row's exchange rate.",
    )
  })

  it("gives a family's meaning first, then the words of the variants that say something else", async () => {
    const meaning = {
      ...family.family.meaning,
      source: 'common',
      words: 'Money taken in {Currency} via {Channel}.',
      common: { words: 'Money taken in {Currency} via {Channel}.', agree: 2 },
    }
    const withMeaning = createAskTools({
      ...reads,
      catalogue: () =>
        Promise.resolve({ terms: [{ ...family, family: { ...family.family, meaning } }] }),
    } as unknown as ToolReads)
    const result = await withMeaning.run('definitions', { names: ['Revenue'] })
    const [revenue] = (result as { definitions: { words: string | null }[] }).definitions
    expect(revenue!.words).toBe(
      "Money taken in each currency via each channel. A family of 3 near-identical metrics, one for each currency and channel. An item about it applies to every one of them. 1 variant says something else: USD, web: The EUR web amount multiplied by the row's exchange rate.",
    )
  })

  it('gives the words of a variant that says how it is worked out, which its meaning leaves out (R1)', async () => {
    // The USD variant says what the others do, and how it is converted: no variant says
    // something else, and its note on the rate still reaches the agent.
    const meaning = {
      ...family.family.meaning,
      source: 'common',
      words: 'Money taken in {Currency} via {Channel}.',
      common: { words: 'Money taken in {Currency} via {Channel}.', agree: 3 },
      differing: [],
    }
    const note = family.family.variants.map((v) => ({
      ...v,
      description: v.key.endsWith('usd_web')
        ? 'Money taken in USD (EUR × row fx_usd) via web.'
        : `Money taken in ${v.values.join(' via ')}.`,
    }))
    const withNote = createAskTools({
      ...reads,
      catalogue: () =>
        Promise.resolve({
          terms: [{ ...family, family: { ...family.family, meaning, variants: note } }],
        }),
    } as unknown as ToolReads)
    const result = await withNote.run('definitions', { names: ['Revenue'] })
    const [revenue] = (result as { definitions: { words: string | null; family?: unknown }[] })
      .definitions
    expect(revenue!.words).toBe(
      'Money taken in each currency via each channel. A family of 3 near-identical metrics, one for each currency and channel. An item about it applies to every one of them. How 1 variant is worked out from another, in its own words: USD, web: Money taken in USD (EUR × row fx_usd) via web.',
    )
    // The page shows the same as the family: its meaning, and that variant's words by its values.
    expect(revenue!.family).toEqual({
      by: ['Currency', 'Channel'],
      variants: 3,
      meaning: 'Money taken in each currency via each channel.',
      own: [{ values: ['USD', 'web'], words: 'Money taken in USD (EUR × row fx_usd) via web.' }],
      more: 0,
      // Where its meaning comes from (C1): the words 3 of its variants share.
      source: { kind: 'common', agree: 3 },
    })
  })

  it('shows the page a family with no meaning by every variant’s own words (R7)', async () => {
    const result = await tools.run('definitions', { names: ['Revenue'] })
    const [revenue] = (result as { definitions: { family?: unknown }[] }).definitions
    expect(revenue!.family).toEqual({
      by: ['Currency', 'Channel'],
      variants: 3,
      meaning: null,
      own: [
        {
          values: ['USD', 'web'],
          words: "The EUR web amount multiplied by the row's exchange rate.",
        },
      ],
      more: 0,
      source: { kind: 'none' },
    })
  })

  it('says where its meaning comes from: the words of its base, or words an owner wrote (C1, C4)', async () => {
    const shownWith = async (meaning: object, people: { id: string; name: string }[] = []) => {
      const withMeaning = createAskTools({
        ...reads,
        people: () => Promise.resolve(people),
        catalogue: () =>
          Promise.resolve({
            terms: [
              {
                ...family,
                family: { ...family.family, meaning: { ...family.family.meaning, ...meaning } },
              },
            ],
          }),
      } as unknown as ToolReads)
      const result = await withMeaning.run('definitions', { names: ['Revenue'] })
      return (result as { definitions: { family?: { source?: unknown } }[] }).definitions[0]!
        .family!.source
    }
    // The others are converted from EUR web: its words speak for the family.
    expect(
      await shownWith({
        source: 'common',
        words: 'Money taken in {Currency} via {Channel}.',
        common: { words: 'Money taken in {Currency} via {Channel}.', agree: 1 },
        base: 'metric:revenue_eur_web',
        differing: [],
      }),
    ).toEqual({
      kind: 'base',
      values: ['EUR', 'web'],
      converted: [
        ['AED', 'app'],
        ['USD', 'web'],
      ],
    })
    expect(
      await shownWith(
        {
          source: 'written',
          words: 'Money taken for paid orders.',
          chosen: {
            choice: 'written',
            words: 'Money taken for paid orders.',
            personId: 'p1',
            at: '2026-10-20T09:00:00Z',
          },
          differing: [],
        },
        [{ id: 'p1', name: 'Sofia Brandt' }],
      ),
    ).toEqual({ kind: 'written', by: 'Sofia Brandt', on: '2026-10-20' })
    expect(await shownWith({ source: 'declared', words: 'Money taken.', differing: [] })).toEqual({
      kind: 'declared',
    })
  })

  it('lists the variants that say something else by their values, never as all of them', async () => {
    const same = (key: string, description: string | null) => ({
      ...family.family.variants[0]!,
      key,
      description,
    })
    const meaning = {
      ...family.family.meaning,
      source: 'declared',
      words: 'Money taken in {Currency} via {Channel}.',
      differing: ['metric:revenue_aed_app', 'metric:revenue_eur_web'],
    }
    const variantsSaying = [
      { ...same('metric:revenue_aed_app', 'Money taken in AED via app.'), values: ['AED', 'app'] },
      { ...same('metric:revenue_eur_web', 'Money taken in EUR via web.'), values: ['EUR', 'web'] },
      { ...same('metric:revenue_usd_web', null), values: ['USD', 'web'] },
    ]
    const withMeaning = createAskTools({
      ...reads,
      catalogue: () =>
        Promise.resolve({
          terms: [{ ...family, family: { ...family.family, meaning, variants: variantsSaying } }],
        }),
    } as unknown as ToolReads)
    const result = await withMeaning.run('definitions', { names: ['Revenue'] })
    const [revenue] = (result as { definitions: { words: string | null }[] }).definitions
    expect(revenue!.words).toContain(
      '2 variants say something else: AED, app: Money taken in AED via app. EUR, web: Money taken in EUR via web.',
    )
    expect(revenue!.words).not.toContain('each other variant')
  })

  it('says which variant a question that names no value means, once an owner picked one (F3)', async () => {
    const usual = { member: 'metric:revenue_eur_web', chosen: null, revision: 1 }
    const withUsual = createAskTools({
      ...reads,
      catalogue: () =>
        Promise.resolve({ terms: [{ ...family, family: { ...family.family, usual } }] }),
    } as unknown as ToolReads)
    const result = await withUsual.run('definitions', { names: ['Revenue'] })
    const [revenue] = (result as { definitions: { words: string | null }[] }).definitions
    expect(revenue!.words).toContain(
      'When a question names no currency or channel, its owners say it means its EUR, web variant.',
    )
    // With none picked, nothing is said: the agent asks which, as before.
    const plain = await tools.run('definitions', { names: ['Revenue'] })
    expect(JSON.stringify(plain)).not.toContain('When a question names no')
  })

  describe('read as its usual variant (F3)', () => {
    // The edition: an item on the family, and one on each of two of its variants.
    const edition = bundle()
    const on = (id: string, metric: string) => ({
      ...edition.items[0]!,
      id,
      title: `On ${metric}`,
      summary: `On ${metric}.`,
      scope: { metrics: [metric], dimensions: [], dimensionValues: [] },
    })
    const items = [
      on('itm_family01', 'group:revenue'),
      on('itm_eurweb01', 'metric:revenue_eur_web'),
      on('itm_usdweb01', 'metric:revenue_usd_web'),
    ]
    const familyTerm = (key: string, name: string, parentKey: string | null) => ({
      key,
      kind: parentKey ? ('metric' as const) : ('metric_group' as const),
      name,
      aliases: [],
      parentKey,
      areaId: 'area_sales',
      definitionRefs: parentKey ? [] : variants.map((v) => `dbt:sales.${v.slice(7)}`),
      definitions: [],
    })
    const withUsual = (member: string | null) =>
      createAskTools({
        ...reads,
        bundle: () =>
          Promise.resolve({
            ...edition,
            terms: [
              ...edition.terms,
              familyTerm('group:revenue', 'Revenue', null),
              ...variants.map((key) => familyTerm(key, `${key} variant`, 'group:revenue')),
            ],
            metricArea: Object.fromEntries(variants.map((key) => [key, 'area_sales'])),
            groupsOfMetric: Object.fromEntries(variants.map((key) => [key, ['group:revenue']])),
            items,
          }),
        readable: () => Promise.resolve(items.map((i) => ({ ...i, status: 'accepted' }))),
        catalogue: () =>
          Promise.resolve({
            terms: [
              {
                ...family,
                family: {
                  ...family.family,
                  variants: family.family.variants.map((v) =>
                    v.key === 'metric:revenue_eur_web'
                      ? { ...v, description: 'Money taken in EUR via web.' }
                      : v,
                  ),
                  usual: { member, chosen: null, revision: member ? 1 : 0 },
                },
              },
            ],
          }),
      } as unknown as ToolReads)
    type Read = {
      read: { about: string[]; names: string[]; usual?: { name: string; values: string[] }[] }
      items: { id: string }[]
      definitions: { name: string; words: string | null; from: string }[]
    }
    const look = async (member: string | null, about: string) =>
      (await withUsual(member).run('get_context', { about, no_period: true })) as unknown as Read
    const ids = (r: Read) => r.items.map((i) => i.id).sort()

    it('reads what applies to the family and to its usual variant, named as the family', async () => {
      const r = await look('metric:revenue_eur_web', 'What is written about revenue?')
      expect(ids(r)).toEqual(['itm_eurweb01', 'itm_family01'])
      expect(r.read.names).toEqual(['Revenue'])
      expect(r.read.usual).toEqual([
        { id: r.read.about[0], name: 'Revenue', values: ['EUR', 'web'] },
      ])
      // Its definition is the usual variant's own words, with its name in its source tool.
      expect(r.definitions).toEqual([
        {
          id: r.read.about[0],
          name: 'Revenue',
          words: 'Money taken in EUR via web.',
          from: 'dbt (sales.revenue_eur_web)',
        },
      ])
    })

    it('reads the whole family when its owners picked no usual variant', async () => {
      const r = await look(null, 'What is written about revenue?')
      expect(ids(r)).toEqual(['itm_eurweb01', 'itm_family01', 'itm_usdweb01'])
      expect(r.read.usual).toBeUndefined()
      expect(r.definitions[0]!.words).toContain('A family of 3 near-identical metrics')
    })

    it('never reads the usual variant when the words name a value', async () => {
      const r = await look('metric:revenue_eur_web', 'What is written about revenue in USD?')
      expect(ids(r)).toEqual(['itm_eurweb01', 'itm_family01', 'itm_usdweb01'])
      expect(r.read.usual).toBeUndefined()
    })
  })

  it('counts the items on a family and on any of its variants under the family name', async () => {
    const result = await tools.run('records', { about: ['Revenue'], show: 'count' })
    expect(result).toMatchObject({ count: 2, filters: { about: ['Revenue'] } })
    expect(JSON.stringify(result)).not.toMatch(/variant/)
  })

  it('names only the family for an item on a variant', async () => {
    const result = await tools.run('records', { show: 'list' })
    const names = ('names' in result ? result.names : []).map((n: { name: string }) => n.name)
    expect(names).toContain('Revenue')
    expect(names.filter((n: string) => /variant/.test(n))).toEqual([])
  })

  it('never offers a variant as the closest name', async () => {
    const result = await tools.run('records', { about: ['Revenu'], show: 'count' })
    expect((result as { error: string }).error).toContain('The closest is Revenue.')
    const asked = await tools.run('agent_questions', { about: ['Revenu'] })
    expect((asked as { error: string }).error).toContain('The closest is Revenue.')
  })
})

describe('the definitions tool by other names', () => {
  const metric = (key: string, name: string, words: string) => ({
    key,
    kind: 'metric',
    id: key.replace(/^metric:/, ''),
    name,
    aliases: [],
    group: null,
    domain: { areaId: 'area_paid', source: 'vocabulary' },
    definition: {
      ref: `cube:marketing.${key}`,
      name: `marketing.${key.replace(/^metric:/, '')}`,
      title: name,
      descriptionCopy: words,
      valueType: null,
      state: 'current',
      renamedTo: null,
      changedAt: null,
      readAt: null,
      sourceId: 'cube',
      tool: 'Cube',
      connector: 'cube',
    },
    definitions: [],
    status: 'in_sync',
    shelf: {
      items: 3,
      byKind: { note: 3, event: 0, guide: 0, issue: 0 },
      needsALook: 0,
      activeIssues: 0,
      ended: 0,
      gaps: 0,
      mentionedBy: 0,
      lastUpdated: null,
    },
    family: null,
  })
  const reads = {
    ...noReads,
    bundle: () =>
      Promise.resolve({
        items: [],
        terms: [
          ['metric:return_on_ad_spend', 'Return on ad spend'],
          ['metric:net_revenue', 'Net revenue'],
        ].map(([key, name]) => ({
          key,
          name,
          kind: 'metric',
          parentKey: null,
          aliases: [],
          definitionRefs: [],
        })),
      }),
    readable: () => Promise.resolve([]),
    areas: () => Promise.resolve([{ id: 'area_paid', name: 'Paid media', ownerIds: [] }]),
    people: () => Promise.resolve([]),
    catalogue: () =>
      Promise.resolve({
        terms: [
          metric(
            'metric:return_on_ad_spend',
            'Return on ad spend',
            'Net revenue attributed to paid media divided by paid media spend.',
          ),
          metric('metric:net_revenue', 'Net revenue', 'Revenue after returns and discounts.'),
        ],
      }),
    glossary: () =>
      Promise.resolve({
        terms: [
          {
            id: '0190f3a2-0000-7000-8000-000000000001',
            name: 'Takings',
            meaning: null,
            sameAs: { ref: 'metric:net_revenue', name: 'Net revenue', type: 'metric' },
            areaId: 'area_paid',
            items: null,
          },
        ],
      }),
    termHistory: () => Promise.resolve([]),
    records: () => Promise.resolve([]),
  } as unknown as ToolReads
  const tools = createAskTools(reads)

  it('finds a metric by its short name, before it says none was found', async () => {
    for (const short of ['ROAS', 'roas', 'RAS']) {
      const result = await tools.run('definitions', { names: [short] })
      expect(result, short).toMatchObject({
        found: 1,
        notFound: [],
        definitions: [
          {
            name: 'Return on ad spend',
            words: 'Net revenue attributed to paid media divided by paid media spend.',
          },
        ],
      })
    }
    // Two letters say too little to be a name.
    expect(await tools.run('definitions', { names: ['NR'] })).toMatchObject({ found: 0 })
  })

  it('finds a metric by a word written in Definitions as another name for it', async () => {
    const result = await tools.run('definitions', { names: ['Takings'] })
    expect(result).toMatchObject({ found: 2, notFound: [] })
    expect(JSON.stringify(result)).toContain('Revenue after returns and discounts.')
  })
})

describe('get_context and the words people wrote (FR-718.7)', () => {
  const edition = bundle()
  const written = (
    id: string,
    name: string,
    meaning: string | null,
    sameAs: string | null = null,
  ) => ({
    id,
    name,
    meaning,
    sameAs,
    areaId: 'finance',
    writtenOn: '2026-09-16',
    writtenAs: 'owner' as const,
    conflict: false,
  })
  const commission = '0190f3a2-0000-7000-8000-00000000000a'
  const terms = [
    written(commission, 'Marketplace commission', 'The share of each marketplace sale it keeps.'),
    written('0190f3a2-0000-7000-8000-00000000000b', 'Cut', null, `term:${commission}`),
    written('0190f3a2-0000-7000-8000-00000000000c', 'Purchases', null, 'metric:orders'),
  ]
  const toolsWith = (words: typeof terms, vocabulary = edition.terms) =>
    createAskTools({
      ...noReads,
      bundle: () => Promise.resolve({ ...edition, terms: vocabulary, written: words }),
      readable: () => Promise.resolve(edition.items.map((i) => ({ ...i, status: 'accepted' }))),
      areas: () => Promise.resolve([{ id: 'finance', name: 'Finance', ownerIds: [] }]),
      people: () => Promise.resolve([]),
      catalogue: () => Promise.resolve({ terms: [] }),
      glossary: () => Promise.resolve({ terms: [] }),
      records: () => Promise.resolve([]),
    } as unknown as ToolReads)
  const look = (words: typeof terms, about: string, vocabulary = edition.terms) =>
    toolsWith(words, vocabulary).run('get_context', { about, no_period: true }) as Promise<
      Record<string, unknown>
    >

  it('gives what each term the words use means, as written in Definitions', async () => {
    const read = await look(terms, 'Orders in Norway after the marketplace commission')
    expect(read.terms).toEqual([
      {
        id: `term:${commission}`,
        word: 'marketplace commission',
        name: 'Marketplace commission',
        meaning: 'The share of each marketplace sale it keeps.',
        domain: 'Finance',
        from: 'written in Definitions',
      },
    ])
    // A synonym of a term is that term, once; a synonym of a metric reads as the metric.
    const again = await look(
      terms,
      'Purchases in Norway after the cut and the marketplace commission',
    )
    expect((again.terms as { word: string }[]).map((t) => t.word)).toEqual(['cut'])
    // A term alone names no metric: the read is not looked up, and still says what it means.
    const alone = await look(terms, 'marketplace commission')
    expect(alone).toMatchObject({ state: null, terms: [{ name: 'Marketplace commission' }] })
  })

  it('gives a term the words use after five other names of metrics', async () => {
    const orders = edition.terms.find((t) => t.key === 'metric:orders')!
    const metrics = ['Refunds', 'Visits', 'Baskets', 'Signups', 'Reviews'].map((name, i) => ({
      ...orders,
      key: `metric:m${i}`,
      name,
    }))
    const others = metrics.map((m, i) =>
      written(`0190f3a2-0000-7000-8000-00000000001${i}`, `Other ${m.name}`, null, m.key),
    )
    const read = await look(
      [...terms, ...others],
      'Other refunds, other visits, other baskets, other signups, other reviews and the marketplace commission',
      [...edition.terms, ...metrics],
    )
    expect((read.terms as { name: string }[]).map((t) => t.name)).toEqual([
      'Marketplace commission',
    ])
  })

  it('reads as before when the words use no term', async () => {
    const before = await look([], 'Orders in Norway')
    const after = await look(terms, 'Orders in Norway')
    expect(after).not.toHaveProperty('terms')
    expect(JSON.stringify(after)).toBe(JSON.stringify(before))
  })
})

describe('read_context in Ask', () => {
  it('lists 20 items that mention the item, reading past the conflicts that sort first', async () => {
    const data = bundle(),
      item = data.items[0]!
    const added = (prefix: string, rel: string, count: number) =>
      Array.from({ length: count }, (_, n) => {
        const id = `itm_${prefix}${String(n).padStart(4, '0')}`
        data.items.push({ ...item, id })
        data.links.push({
          from_item: id,
          rel,
          to_kind: 'item',
          to_id: item.id,
          label: item.title,
        })
        return id
      })
    added('conflict', 'conflicts_with', 5)
    const mentions = added('mention', 'mentions', 25)
    const reads = {
      ...noReads,
      bundle: () => Promise.resolve(data),
      readable: () => Promise.resolve(data.items),
      catalogue: () => Promise.resolve({ terms: [] }),
      areas: () => Promise.resolve([]),
      people: () => Promise.resolve([]),
      itemHistory: () => Promise.resolve([]),
    } as unknown as ToolReads
    const result = (await createAskTools(reads).run('read_context', { id: item.id })) as {
      item: { linkedFrom: { id: string }[] }
    }
    expect(result.item.linkedFrom.map((l) => l.id)).toEqual(mentions.slice(0, 20))
  })
})
