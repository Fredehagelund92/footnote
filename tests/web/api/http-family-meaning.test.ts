import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/errors'
import { createHttpApi } from '@/api/http'

// A family's meaning and usual variant go to the service by the family's key, and a usual variant
// by its key. A family or a variant the tool stopped reading since the dialog opened is told so,
// not sent on to the service as a choice of nobody. A split goes by the family's key too, and
// joining one again by the key the catalogue's splits name it by, as does making one family of
// metrics kept separate when they were published. A family's History names the people who made
// it, never the tool that reads its metrics.

const family = {
  key: 'group:revenue',
  name: 'Revenue',
  kind: 'metric',
  aliases: [],
  domain: { areaId: null },
  group: null,
  definition: null,
  shelf: { lastUpdated: null },
  family: {
    by: ['Currency'],
    derivations: [],
    found: 'declared',
    conversions: [],
    variants: [{ key: 'metric:revenue_eur', name: 'Revenue (EUR)', values: ['EUR'] }],
    meaning: {
      source: 'none',
      words: null,
      common: null,
      base: null,
      differing: [],
      chosen: null,
      revision: 0,
    },
    usual: { member: null, chosen: null, revision: 0 },
  },
}

function serviceOf() {
  const writes: string[] = []
  const answers: Record<string, unknown> = {
    '/api/v1/auth/session': {
      person: { id: 'p1', name: 'Ines', permissions: { roles: [] } },
      csrfToken: 'token',
    },
    '/api/v1/catalogue': {
      terms: [family],
      splits: [
        {
          key: 'group:accrued_share',
          name: 'Accrued share',
          areaId: 'sales',
          metrics: [
            { key: 'metric:accrued_share_eur', name: 'Accrued share (EUR)' },
            { key: 'metric:accrued_share_usd', name: 'Accrued share (USD)' },
          ],
          items: 2,
          personId: 'p1',
          at: '2026-11-22T10:00:00.000Z',
        },
      ],
      apart: [
        {
          key: 'group:tip_amount',
          name: 'Tip amount',
          areaId: null,
          metrics: [
            { key: 'metric:tip_amount_eur', name: 'Tip amount (EUR)' },
            { key: 'metric:tip_amount_gbp', name: 'Tip amount (GBP)' },
          ],
          personId: 'p1',
          at: '2026-11-24T09:00:00.000Z',
        },
      ],
    },
    '/api/v1/definitions/families/group%3Arevenue/meaning/history': [
      {
        revision: 1,
        choice: 'written',
        words: 'Money taken in.',
        personId: 'p1',
        at: '2026-11-23T08:00:00.000Z',
      },
    ],
    '/api/v1/definitions/families/group%3Arevenue/changes': [
      { kind: 'split', personId: 'p1', at: '2026-11-25T08:00:00.000Z' },
      { kind: 'published', personId: 'p1', at: '2026-11-21T08:00:00.000Z' },
    ],
    '/api/v1/definitions/families/group%3Arevenue/split': {
      edition: '2026-11-23.1',
      metrics: [{ key: 'metric:revenue_eur', name: 'Revenue (EUR)' }],
      items: 0,
    },
    '/api/v1/terms': { terms: [] },
    '/api/v1/people': [{ id: 'p1', name: 'Ines Duarte' }],
  }
  const fetch: typeof globalThis.fetch = (input, init) => {
    const request = new Request(input, init)
    const path = new URL(request.url).pathname
    if (request.method !== 'GET') writes.push(path)
    return Promise.resolve(
      new Response(JSON.stringify(answers[path] ?? {}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }
  return { api: createHttpApi({ baseUrl: 'https://footnote.example/api/v1', fetch }), writes }
}

describe('setFamilyMeaning', () => {
  it('says a family that is no longer in Definitions is gone, without asking the service', async () => {
    const { api, writes } = serviceOf()
    const error = await api
      .setFamilyMeaning({ name: 'Margin', choice: 'written', words: 'Money kept.', revision: 0 })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      kind: 'not-found',
      message: "“Margin” isn't a family in Definitions any more.",
    })
    expect(writes).toEqual([])
  })

  it('sends the words written for the family by its key', async () => {
    const { api, writes } = serviceOf()
    await api.setFamilyMeaning({ name: 'Revenue', choice: 'written', words: 'Money.', revision: 0 })
    expect(writes).toEqual(['/api/v1/definitions/families/group%3Arevenue/meaning'])
  })
})

describe('setFamilyUsual', () => {
  it('says a variant that is no longer in the family is gone, without asking the service', async () => {
    const { api, writes } = serviceOf()
    const error = await api
      .setFamilyUsual({ name: 'Revenue', member: 'Revenue (GBP)', revision: 0 })
      .catch((e: unknown) => e)
    expect(error).toMatchObject({
      kind: 'not-found',
      message: 'That variant is no longer in this family.',
    })
    expect(writes).toEqual([])
  })

  it('sends the variant by its key, or none', async () => {
    const { api, writes } = serviceOf()
    await api.setFamilyUsual({ name: 'Revenue', member: 'Revenue (EUR)', revision: 0 })
    await api.setFamilyUsual({ name: 'Revenue', member: null, revision: 1 })
    expect(writes).toEqual([
      '/api/v1/definitions/families/group%3Arevenue/usual',
      '/api/v1/definitions/families/group%3Arevenue/usual',
    ])
  })
})

describe('splitFamily and joinFamily', () => {
  it('splits a family by its key, and says the metrics it made by name', async () => {
    const { api, writes } = serviceOf()
    expect(await api.splitFamily({ name: 'Revenue' })).toEqual({
      metrics: ['Revenue (EUR)'],
      items: 0,
    })
    expect(writes).toEqual(['/api/v1/definitions/families/group%3Arevenue/split'])
  })

  it('says a family no longer in Definitions is gone, without asking the service', async () => {
    const { api, writes } = serviceOf()
    const error = await api.splitFamily({ name: 'Margin' }).catch((e: unknown) => e)
    expect(error).toMatchObject({ kind: 'not-found' })
    expect(writes).toEqual([])
  })

  it('lists what was kept apart, newest first, with who did it and when, and joins each by its key', async () => {
    const { api, writes } = serviceOf()
    expect(await api.getKeptApart()).toEqual([
      {
        how: 'apart',
        name: 'Tip amount',
        metrics: ['Tip amount (EUR)', 'Tip amount (GBP)'],
        items: 0,
        by: 'Ines Duarte',
        on: expect.stringMatching(/24 Nov 2026$/) as unknown,
      },
      {
        how: 'split',
        name: 'Accrued share',
        domain: 'sales',
        metrics: ['Accrued share (EUR)', 'Accrued share (USD)'],
        items: 2,
        by: 'Ines Duarte',
        on: expect.stringMatching(/22 Nov 2026$/) as unknown,
      },
    ])
    await api.joinFamily({ name: 'Accrued share' })
    await api.joinFamily({ name: 'Tip amount' })
    expect(writes).toEqual([
      '/api/v1/definitions/families/group%3Aaccrued_share/join',
      '/api/v1/definitions/families/group%3Atip_amount/join',
    ])
  })

  it('says something no longer kept apart is gone, without asking the service', async () => {
    const { api, writes } = serviceOf()
    const error = await api.joinFamily({ name: 'Late fee' }).catch((e: unknown) => e)
    expect(error).toMatchObject({
      kind: 'not-found',
      message: "“Late fee” isn't kept apart any more.",
    })
    expect(writes).toEqual([])
  })
})

describe("a family's History", () => {
  it('names who published it, chose its meaning and split it, newest first, never its tool', async () => {
    const { api } = serviceOf()
    const history = await api.getDefinitionHistory({ name: 'Revenue' })
    expect(
      history.map(({ v, who, kind, field, before, after }) => ({
        v,
        who,
        kind,
        field,
        before,
        after,
      })),
    ).toEqual([
      {
        v: 3,
        who: 'Ines Duarte',
        kind: 'split',
        field: 'Its metrics',
        before: 'One family',
        after: 'Separate metrics',
      },
      {
        v: 2,
        who: 'Ines Duarte',
        kind: 'wording',
        field: 'Meaning',
        before: 'Worked out from its variants',
        after: 'Money taken in.',
      },
      {
        v: 1,
        who: 'Ines Duarte',
        kind: 'family',
        field: 'Its metrics',
        before: 'Metrics waiting to be published',
        after: 'One family',
      },
    ])
  })
})
