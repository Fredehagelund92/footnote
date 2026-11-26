import { randomBytes } from 'node:crypto'
import type { SecretStore } from '../../../src/server/modules/connectors/index.ts'

/*
  The secret store of a service on the demo week: in memory, empty when it starts, as the
  server's store is for a new install. What the connect flow keeps in it lives only as long as
  the test.
*/

/** A token for a stand-in tool, invented for one run. */
export const inventedToken = () => `demo-token-${randomBytes(12).toString('hex')}`

export function memorySecrets(): SecretStore {
  const kept = new Map<string, Record<string, string>>()
  return {
    available: true,
    read: (ref) => Promise.resolve(kept.get(ref) ?? null),
    write: (secrets) => {
      const ref = `local:${crypto.randomUUID()}`
      kept.set(ref, { ...secrets })
      return Promise.resolve(ref)
    },
    remove: (ref) => {
      kept.delete(ref)
      return Promise.resolve()
    },
  }
}
