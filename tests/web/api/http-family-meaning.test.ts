import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/errors'
import { createHttpApi } from '@/api/http'

// Choosing a variant's words names it as Definitions lists it. A variant the tool stopped reading
// since the dialog opened is told so, not sent on to the service as a choice of nobody.

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
      member: null,
      common: null,
      base: null,
      differing: [],
      chosen: null,
      revision: 0,
    },
  },
}

describe('setFamilyMeaning', () => {
  it('says a variant that is no longer in the family is gone, without asking the service', async () => {
    const writes: string[] = []
    const answers: Record<string, unknown> = {
      '/api/v1/auth/session': {
        person: { id: 'p1', name: 'Ines', permissions: { roles: [] } },
        csrfToken: 'token',
      },
      '/api/v1/catalogue': { terms: [family] },
      '/api/v1/terms': { terms: [] },
      '/api/v1/people': [],
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
    const api = createHttpApi({ baseUrl: 'https://footnote.example/api/v1', fetch })
    const error = await api
      .setFamilyMeaning({ name: 'Revenue', choice: 'member', member: 'Revenue (GBP)', revision: 0 })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      kind: 'not-found',
      message: 'That variant is no longer in this family.',
    })
    expect(writes).toEqual([])
  })
})
