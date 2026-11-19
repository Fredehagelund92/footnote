import { defineConfig, devices } from '@playwright/test'

/*
  The site's smoke test (e2e/smoke.spec.ts), on the built site in dist: run `npm run build`
  first. It serves dist the way the published site is served, at the root of a host.
*/

const port = Number(process.env.SMOKE_PORT ?? 4329)

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: { baseURL: `http://localhost:${port}`, ...devices['Desktop Chrome'] },
  webServer: {
    command: `ASTRO_TELEMETRY_DISABLED=1 npx astro preview --config astro.landing.config.ts --port ${port} --ignore-lock`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
  },
})
