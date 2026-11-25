import { afterEach, describe, expect, it } from 'vitest'
import { ApiError } from '@/api/errors'
import { createHttpApi } from '@/api/http'
import { buildApp } from '../../../src/server/app.ts'
import type { Database } from '../../../src/server/db/database.ts'
import { createLogger } from '../../../src/server/observability/logger.ts'
import { idleJobs } from '../../server/idle-jobs.ts'

// The service's request limit, as the app says it: the service's own sentence, not the status's
// "Too Many Requests", which the names card once showed in red under a name as if it were wrong.

/** A database that answers the limiter's read of its setting, and finds no session. */
function limitDatabase(limits: { person: number; ip: number }): Database {
  const database: Database = {
    transaction: (_person, work) => work(database),
    ping: () => Promise.resolve(),
    query: <Row>(sql: string) =>
      Promise.resolve(
        (sql.includes('limits.api_rate_per_minute') ? [{ value: limits }] : []) as Row[],
      ),
    close: () => Promise.resolve(),
  }
  return database
}

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  close = undefined
})

describe('the request limit in the app', () => {
  it('says the service sentence, with when to try again', async () => {
    // Time stands still, so the wait the service names is its whole minute however slowly a
    // busy machine sends the second read.
    const now = new Date('2026-11-25T12:00:00Z')
    const app = buildApp({
      database: limitDatabase({ person: 1, ip: 1 }),
      jobs: idleJobs(),
      logger: createLogger({ level: 'silent' }),
      clock: { now: () => now, today: () => '2026-11-25' },
    })
    close = () => app.close()
    // The binding's requests, answered by the service itself.
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      const answer = await app.inject({
        method: request.method as 'GET',
        url: `${url.pathname}${url.search}`,
        headers: Object.fromEntries(request.headers),
      })
      return new Response(answer.body, {
        status: answer.statusCode,
        headers: answer.headers as Record<string, string>,
      })
    }
    const api = createHttpApi({ baseUrl: 'http://localhost/api/v1', fetch })
    // Two different reads: the binding shares a read made a moment ago.
    await api.listSignInPeople()
    const refused = await api.getSignInMethod().then(
      () => expect.unreachable('the second read got through'),
      (error: unknown) => error as ApiError,
    )
    expect(refused).toBeInstanceOf(ApiError)
    expect(refused.kind).toBe('failed')
    expect(refused.message).toBe('That was a lot at once. Try again in 60 seconds.')
  })
})
