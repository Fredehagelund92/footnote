import { minifyContractRouter, type AnyContractRouter } from '@orpc/contract'

/**
 * The contract's routes as the web app's http binding reads them (`src/web/api/contract.json`):
 * each operation's method, path, success status and scope, without its schemas and without the
 * words written for the OpenAPI document (summary, description, tags), which the browser never
 * reads and would download with its first load.
 */
export function webRoutes(router: AnyContractRouter): unknown {
  return JSON.parse(
    JSON.stringify(minifyContractRouter(router), (key, value: unknown) =>
      key === 'summary' || key === 'description' || key === 'tags' ? undefined : value,
    ),
  )
}
