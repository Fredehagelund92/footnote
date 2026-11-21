// Writes the files generated from the API contract (src/contract):
//   docs/api/openapi.json       the published OpenAPI document, reviewed as a diff in pull requests
//   src/web/api/contract.json   the routes alone, for the web app's http binding (no schemas and
//                               no OpenAPI words to download)
// tests/server/api-contract.test.ts fails when either is out of date. Run `npm run api:generate`.
import { writeFile } from 'node:fs/promises'
import { contract } from '../src/contract/index.ts'
import { webRoutes } from '../src/contract/web-routes.ts'
import { openApiDocument } from '../src/server/http/api.ts'

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

const outputs = {
  'docs/api/openapi.json': json(await openApiDocument()),
  'src/web/api/contract.json': json(webRoutes(contract)),
}
for (const [path, content] of Object.entries(outputs)) {
  await writeFile(new URL(`../${path}`, import.meta.url), content)
  console.log(`wrote ${path}`)
}
