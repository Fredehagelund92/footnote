import type { FastifyRequest } from 'fastify'
import { ORPCError } from '@orpc/client'
import { refusals } from '../../../contract/refusals.ts'
import type { Session } from './sessions.ts'

/** Full origin comparison includes scheme and port; proxy headers never establish trust. */
export function checkMutation(
  request: FastifyRequest,
  session: Session | null,
  origins: readonly string[],
  login = false,
) {
  const origin = request.headers.origin
  const expected = origins.length
    ? origins
    : [new URL(`${request.protocol}://${request.headers.host}`).origin]
  if (!origin || !expected.includes(origin) || request.headers['sec-fetch-site'] === 'cross-site') {
    throw new ORPCError('FORBIDDEN', {
      message:
        "We can't take changes from this address. Open the app at its usual address, then try again.",
    })
  }
  // The header was X-Heed-CSRF until the rename to Footnote: a web app or command line of before
  // it still sends that one for a release (docs/operations.md, "Upgrade from Heed 0.1").
  const csrf = request.headers['x-footnote-csrf'] ?? request.headers['x-heed-csrf']
  if (csrf !== (login ? 'dev-sign-in' : session?.csrfToken) || typeof csrf !== 'string') {
    throw new ORPCError('FORBIDDEN', { message: refusals.csrf })
  }
}
