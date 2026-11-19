import { defineConfig } from 'vitest/config'

// The site's own code (test/). The smoke test in e2e/ is Playwright's (playwright.config.ts).
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } })
