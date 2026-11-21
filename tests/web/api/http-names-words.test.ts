import { describe, expect, it } from 'vitest'
import { createHttpApi } from '@/api/http'

// The words a mention is named by (the vocabulary and the terms) are read once and kept. Publishing
// names on the Names card adds to them, a family among them, so the next read must ask again:
// "Write context" on the family needs its key.

describe('the words after names are published', () => {
  it('are read again, so a family published on the Names card is known without a reload', async () => {
    const reads: string[] = []
    const answers: Record<string, unknown> = {
      '/api/v1/auth/session': {
        person: { id: 'p1', name: 'Ines', permissions: { roles: [] } },
        csrfToken: 'token',
      },
      '/api/v1/vocabulary': { families: [], metrics: [], dimensions: [] },
      '/api/v1/terms': { terms: [] },
      '/api/v1/inbox/names/decide': { edition: 'today.1', accepted: 1, leftOut: 0 },
    }
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      const path = new URL(request.url).pathname
      if (request.method === 'GET') reads.push(path)
      return new Response(JSON.stringify(answers[path] ?? {}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const api = createHttpApi({ baseUrl: 'https://footnote.example/api/v1', fetch })
    const wordsRead = () => reads.filter((path) => path === '/api/v1/vocabulary').length

    await api.itemPage({ id: 'itm_norway01' }).catch(() => null)
    expect(wordsRead()).toBe(1)
    await api.decideNames({ revision: 'r', accept: [{ key: 'group:revenue' }], leaveOut: [] })
    await api.itemPage({ id: 'itm_norway01' }).catch(() => null)
    expect(wordsRead()).toBe(2)
  })
})
