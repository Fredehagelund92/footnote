import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The site's own code (test/). The smoke test in e2e/ is Playwright's (playwright.config.ts).
// `@domain` is the app's alias for src/domain, which the app code the tests import is written with.
export default defineConfig({
  resolve: { alias: { '@domain': fileURLToPath(new URL('../src/domain', import.meta.url)) } },
  test: { include: ['test/**/*.test.ts'] },
})
