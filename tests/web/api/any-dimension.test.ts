import { describe, expect, it } from 'vitest'
import type { Asked, LoopTurn } from '@contract/answer'
import type { ObsAgents, ObsTopic } from '@contract/observability'
import type { Vocabulary as ServiceVocabulary } from '@domain/item'
import { topicWords } from '@domain/say'
import { createHttpApi } from '@/api/http'
import { askedWeekOf, loopAnswerOf, namesOf } from '@/api/http-ask'
import { obsAgentsOf, topicOf } from '@/api/http-obs'
import { lookOf } from '@/components/footnote/scope-chips'
import { mentionablesOf, SCOPE_KINDS, searchMentions, valueMentionsOf } from '@/lib/mentions'
import { kindOfWhere } from '@/lib/tones'
import { observability } from '@/model/observability'

// Market is a dimension like any other: the web reads a workspace whose dimension is Channel as
// it reads one whose dimension is Market. Each check runs the real binding's reading on the same
// world twice, its one dimension holding Norway and Spain, once with id `market` (Market) and once
// with id `channel` (Channel), and compares what comes out with the dimension's own words taken out.

type Dimension = { id: string; name: string }
const MARKET: Dimension = { id: 'market', name: 'Market' }
const CHANNEL: Dimension = { id: 'channel', name: 'Channel' }

const vocabularyOf = (d: Dimension): ServiceVocabulary => ({
  families: [],
  metrics: [{ id: 'orders', name: 'Orders', group: 'Payments' }],
  dimensions: [
    {
      id: d.id,
      name: d.name,
      values: [
        { id: 'norway', name: 'Norway', aliases: ['Norge'] },
        { id: 'spain', name: 'Spain', aliases: [] },
      ],
    },
  ],
})

/** What came out, with the dimension's id and name in it read as `<dim>` and `<Dim>`. */
const plain = (d: Dimension, value: unknown) =>
  JSON.parse(JSON.stringify(value).replaceAll(d.id, '<dim>').replaceAll(d.name, '<Dim>')) as unknown

/** The same reading for both worlds: what Market gives, and what Channel gives. */
async function both<T>(read: (d: Dimension) => T | Promise<T>) {
  return {
    market: plain(MARKET, await read(MARKET)),
    channel: plain(CHANNEL, await read(CHANNEL)),
    raw: await read(MARKET),
  }
}

/** The http binding over a service whose answers are fixed, by path. */
function apiOf(d: Dimension) {
  const key = (v: string) => `val:${d.id}/${v}`
  const hit = (v: string, name: string) => ({
    key: key(v),
    kind: 'dimension_value' as const,
    name,
    dimension: { key: `dim:${d.id}`, name: d.name },
    alias: null,
    recent: false,
    uses: 0,
    variants: null,
  })
  const answers: Record<string, unknown> = {
    '/api/v1/auth/session': {
      person: { id: 'p1', name: 'Ines', permissions: { roles: [] } },
      csrfToken: 'token',
    },
    '/api/v1/vocabulary': vocabularyOf(d),
    '/api/v1/vocabulary/search': {
      recent: [],
      metrics: [],
      groups: [
        {
          dimension: { ...hit('', d.name), key: `dim:${d.id}`, kind: 'dimension', dimension: null },
          named: false,
          count: 1,
          values: [hit('norway', 'Norway')],
        },
      ],
      nextCursor: null,
    },
    '/api/v1/try-it/read': {
      about: [
        { key: 'metric:orders', name: 'Orders', kind: 'metric', dimension: null },
        { key: key('norway'), name: 'Norway', kind: 'dimension_value', dimension: d.name },
        { key: key('spain'), name: 'Spain', kind: 'dimension_value', dimension: d.name },
      ],
      from: null,
      to: null,
      dates: null,
      ambiguous: [],
      dates_problem: null,
      today: '2026-10-20',
      spans: [],
    },
  }
  const fetch: typeof globalThis.fetch = (input, init) => {
    const path = new URL(new Request(input, init).url).pathname
    return Promise.resolve(
      new Response(JSON.stringify(answers[path] ?? {}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }
  return createHttpApi({ baseUrl: 'https://footnote.example/api/v1', fetch })
}

describe('the web with a dimension that is not market', () => {
  it('reads the vocabulary the same', async () => {
    const { market, channel, raw } = await both((d) => apiOf(d).getVocabulary())
    expect(channel).toEqual(market)
    expect(raw.dimensions).toMatchObject([{ name: 'Market', values: 'Norway, Spain' }])
  })

  it("offers the dimension's values to Ask's @, as any other place offers them", async () => {
    const { market, channel } = await both(async (d) => {
      const all = mentionablesOf({ facts: [], definitions: [], domains: [], people: [] })
      const values = valueMentionsOf(await apiOf(d).searchScope({ q: 'Nor' }), 'Nor')
      return searchMentions(all, SCOPE_KINDS, 'Nor', values)
    })
    expect(channel).toEqual(market)
    expect(market).toEqual([
      {
        label: 'Values',
        items: [{ id: 'value:<dim>/norway', kind: 'value', label: 'Norway', hint: '<Dim>' }],
      },
    ])
  })

  it('reads a question with every value it names', async () => {
    const { market, channel } = await both((d) =>
      apiOf(d).readQuestion({ question: 'Orders in Norway and Spain' }),
    )
    expect(channel).toEqual(market)
    expect(market).toEqual({ metric: 'Orders', values: ['Norway', 'Spain'] })
  })

  it("shows an Asked this week row's value", async () => {
    const asked = (d: Dimension): Asked => {
      const scope = {
        metrics: ['metric:orders'],
        filters: { [`dim:${d.id}`]: [`val:${d.id}/norway`] },
        window: { start: '2026-10-01', end: '2026-11-01' },
      }
      return {
        week: '2026-10-19',
        rows: [
          {
            title: 'Orders in Norway',
            area: 'area_sales',
            scope,
            months: ['2026-10-01'],
            count: 3,
            atLeast: 3,
            nothing: 0,
            state: 'grounded',
            items: 1,
            gap: null,
          },
        ],
        hidden: null,
        asked: 3,
        askedAtLeast: 3,
        starters: [],
      }
    }
    const { market, channel } = await both((d) => askedWeekOf(asked(d), namesOf(vocabularyOf(d))))
    expect(channel).toEqual(market)
    expect(market).toMatchObject({ rows: [{ topic: { metric: 'Orders', where: 'Norway' } }] })
  })

  it("reads what Ask's answer narrowed to", async () => {
    const turn = (d: Dimension) =>
      ({
        kind: 'answer',
        state: 'grounded',
        text: 'Orders in Norway.',
        sources: [],
        nouns: [
          { id: 'metric:orders', name: 'Orders', of: null, type: null },
          { id: `value:${d.id}/norway`, name: 'Norway', of: d, type: null },
        ],
        subject: {
          about: ['metric:orders', `value:${d.id}/norway`],
          period: '',
          assumedToday: true,
        },
        read: [],
        reads: [],
        nearby: [],
        conflict: [],
        definitions: [],
        choices: [],
      }) as unknown as LoopTurn
    const { market, channel } = await both((d) => {
      const { metric, values } = loopAnswerOf(
        turn(d),
        'Orders in Norway?',
        namesOf(vocabularyOf(d)),
      )
      return { metric, values }
    })
    expect(channel).toEqual(market)
    expect(market).toEqual({ metric: 'Orders', values: ['Norway'] })
  })

  it('names an Observability topic as the service names it', async () => {
    const view = (d: Dimension) => {
      const values = [{ dimension: `dim:${d.id}`, value: `val:${d.id}/norway`, name: 'Norway' }]
      const names = new Map([
        ['metric:orders', 'Orders'],
        [`val:${d.id}/norway`, 'Norway'],
      ])
      const topic = {
        id: 't1',
        areaId: 'area_sales',
        subject: 's1',
        metric: 'Orders',
        metrics: ['metric:orders'],
        named: 'metric',
        values,
        dimensions: [],
        // As the service says it (src/server/modules/observability/service.ts), whatever the dimension.
        name: topicWords(
          { metrics: ['metric:orders'], values: [`val:${d.id}/norway`], dimensions: [] },
          (k) => names.get(k) ?? k,
        ),
        month: '2026-10',
        total: 3,
        atLeast: 3,
        counts: { grounded: 3, partial: 0, conflict: 0, stale: 0, missing: 0 },
        in: { notFound: false, reported: false, answers: ['grounded'] },
        gap: null,
      } satisfies ObsTopic
      return { topics: [topic], notFoundTopics: [], notFound: [] } as unknown as ObsAgents
    }
    const { market, channel } = await both((d) => {
      const data = { ...obsAgentsOf({ ...emptyView, ...view(d) }, 7) }
      const t = topicOf(view(d).topics[0]!)
      return { name: observability(data).topicName(t), title: observability(data).topicTitle(t) }
    })
    expect(channel).toEqual(market)
    expect(market).toEqual({ name: 'Orders in Norway', title: 'Orders in Norway, October 2026' })
  })

  it('gives every value chip one look, by key, by name and as a plain word', async () => {
    const { market, channel } = await both(async (d) => ({
      byKey: lookOf({
        key: `val:${d.id}/norway`,
        kind: 'value',
        name: 'Norway',
        dimension: d.name,
      }),
      byName: lookOf({ key: '', kind: 'value', name: 'Norway', dimension: d.name }),
      word: kindOfWhere('Norway', await apiOf(d).getVocabulary(), {}),
    }))
    expect(channel).toEqual(market)
    expect(market).toMatchObject({ byKey: { tone: 'dimension' }, word: 'value' })
  })
})

const emptyView = {
  state: 'normal',
  range: 7,
  last: '2026-10-19',
  minimumCount: 1,
  numbers: {
    asked: 3,
    counts: { grounded: 3, partial: 0, conflict: 0, stale: 0, missing: 0 },
    before: { asked: null, missing: null, grounded: null },
  },
  bars: [],
  subjects: [],
  domains: [],
  narrowed: null,
  couldNotRead: null,
  publishes: [],
  agents: [],
} as unknown as ObsAgents
