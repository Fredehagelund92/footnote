import { stat } from 'node:fs/promises'
import { loadKeyRing } from './modules/oauth/index.ts'

/**
 * `npm run keys:create`, or `node src/server/create-keys.ts` in the service image: creates the key
 * production never creates on its own, only when its file does not exist yet, readable by its
 * owner only: the login server's signing key (FOOTNOTE_OAUTH_SIGNING_KEY_FILE). It reads an
 * existing key to check it, and prints the file name only, never key material
 * (docs/run-in-production.md, "Run the image in production mode").
 */

const file = process.env.FOOTNOTE_OAUTH_SIGNING_KEY_FILE || '.footnote-oauth-key.pem'
const had = await stat(file).then(
  () => true,
  () => false,
)

try {
  // Outside production the loader creates a missing key, owner-only, and checks one that exists.
  await loadKeyRing({ file, previousFiles: [], nodeEnv: 'development' })
  console.log(`FOOTNOTE_OAUTH_SIGNING_KEY_FILE: ${had ? 'kept' : 'created'} ${file}`)
} catch (error) {
  console.error(`Keys not created: ${(error as Error).message}`)
  process.exitCode = 1
}
