import { defineConfig } from '@playwright/test'

/*
  The golden journeys in http mode (golden plan, section 8.2): the same job specs as
  playwright.config.ts, on a production build of the web app with VITE_API_MODE=http, whose
  preview server forwards /api/v1 to the Footnote service on PostgreSQL 18. The global setup seeds the
  demo week into a template database (tests/e2e/http); each journey starts on its own
  copy with its own service, so they run one at a time. Only the journeys whose screens are wired
  run here (testIgnore lists the rest). GOLDEN_DATABASE_URL names a superuser's
  connection (default: TEST_DATABASE_URL, then the local server).
*/

const webPort = Number(process.env.PW_GOLDEN_WEB_PORT ?? 4175)
const apiPort = Number(process.env.PW_GOLDEN_API_PORT ?? 3110)
const ci = Boolean(process.env.CI)

process.env.GOLDEN_MODE = 'http'
process.env.GOLDEN_API_PORT = String(apiPort)
process.env.GOLDEN_WEB_ORIGIN = `http://localhost:${webPort}`

export default defineConfig({
  testDir: 'tests/e2e',
  // Every spec in tests/e2e runs here unless it is listed below as one that needs the mock
  // binding. A new journey runs in http mode by default; one whose screen is not wired yet adds a
  // line here with its reason. One spec per line, so two pull requests that each add one merge
  // cleanly.
  testIgnore: [
    // Addresses, axe and the docs controls check the mock build's pages (playwright.config.ts).
    /\/addresses\.spec\.ts$/,
    /\/axe\.spec\.ts$/,
    // Buttons and fields are measured on the mock build's pages too.
    /\/buttons-fields\.spec\.ts$/,
    // The pane's screenshot baselines are of the mock's demo data.
    /\/visual-inbox-pane\.spec\.ts$/,
    // So are Overview's.
    /\/visual-overview\.spec\.ts$/,
    // And Details', the review Preview's and the review comparison's.
    /\/visual-details\.spec\.ts$/,
    /\/visual-review-preview\.spec\.ts$/,
    /\/visual-review-comparison\.spec\.ts$/,
    // And the Docs area's, of the mock build's pages.
    /\/visual-docs\.spec\.ts$/,
    // The loop answers' baselines are the mock's examples, opened by their address.
    /\/visual-ask-loop\.spec\.ts$/,
    /\/docs-controls\.spec\.ts$/,
    // J8 asks the mock for a loading, failed or offline state (?state=), which the service has not.
    /\/j8-states\.spec\.ts$/,
    // J29 times saves the mock delays on purpose (docs/design/motion.md).
    /\/j29-motion\.spec\.ts$/,
    // J46 reads the names the mock makes; the service's are the own-data journey (tests/e2e-own).
    /\/j46-names\.spec\.ts$/,
    // J47 holds and fails the item's read by the mock's ?state=, which the service has not.
    /\/j47-peek-check\.spec\.ts$/,
    // J48 asks the mock for a model of hundreds of views (?views=); the service's Cube is the
    // server's own there, whose views are its file's (tests/integration/cube-view-list.test.ts).
    /\/j48-view-allowlist\.spec\.ts$/,
    // J84 asks the mock for 5,000 definitions with a metric per currency (?demo=variants); the
    // service reads such a model in tests/integration/metric-variants.test.ts.
    /\/j84-definitions-at-scale\.spec\.ts$/,
    // J86 asks the mock for twenty families of 250 variants (?demo=families); the service reads
    // and publishes families in tests/integration/metric-families.test.ts.
    /\/j86-families\.spec\.ts$/,
    // J87 reads what the mock's demo metrics are built from; the demo source on the service says
    // nothing of it, and a dbt read's is tests/integration/definition-relations.test.ts.
    /\/j87-built-from\.spec\.ts$/,
    // J88 asks the mock for a dbt folder beside the demo's Cube model (?demo=dbt); the service reads
    // one and gives its refs in tests/integration/server-folder-catalogue.test.ts.
    /\/j88-dbt-definitions\.spec\.ts$/,
    // J89 reads the families the mock's ?demo=families Names card offers; the service finds them
    // in tests/integration/declared-families.test.ts.
    /\/j89-family-trust\.spec\.ts$/,
    // J3 states asks for each answer state by a question the mock's recorded turns answer with it,
    // and opens the mock's Not looked up example; the service's demo week has no check that fails.
    /\/j3-ask-states\.spec\.ts$/,
    // J66 opens an answer of Ask's loop by the mock's example address, which the service has not;
    // Tell the owner on the service is tests/web/integration/ask-tell-owner.
    /\/j66-ask-tell-owner\.spec\.ts$/,
    // J67 opens a loop answer by the mock's example address; the service's read line is covered by
    // tests/web/integration/ask-loop-shapes.test.ts.
    /\/j67-ask-dates-read\.spec\.ts$/,
    // J69 opens a loop answer by the mock's example address; the card and quick view are the
    // same components on the service's answers.
    /\/j69-phone-cite\.spec\.ts$/,
    // J70 opens answers that cite N items by the mock's example address (loop-used-N); the
    // service's answers have the sources the demo week gives them.
    /\/j70-ask-sources\.spec\.ts$/,
    // J90 and J91 open answers of Ask's loop by the mock's example address; the service writes
    // them in tests/web/integration/ask-loop-shapes.test.ts, and the word an admin is told about
    // reaches the Inbox in tests/web/integration/ask-tell-owner.test.ts.
    /\/j90-ask-definition-card\.spec\.ts$/,
    /\/j91-ask-gap-card\.spec\.ts$/,
  ],
  outputDir: 'test-results/golden-http/output',
  globalSetup: './tests/e2e/http/global-setup.ts',
  // The demo week's fixtures live with the app (src/web), under its path aliases.
  tsconfig: './tsconfig.web.json',
  fullyParallel: false,
  workers: 1,
  // Each journey copies the demo week and starts its service first, and every read is a real
  // request, so a journey takes longer than on the mock.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report/golden-http' }]]
    : 'list',
  use: {
    baseURL: `http://localhost:${webPort}`,
    viewport: { width: 1440, height: 900 },
    locale: 'en-GB',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command:
      `vite build --outDir ../../dist/web-http --emptyOutDir && ` +
      `vite preview --outDir ../../dist/web-http --port ${webPort}`,
    url: `http://localhost:${webPort}`,
    reuseExistingServer: !ci,
    timeout: 180_000,
    env: { VITE_API_MODE: 'http', FOOTNOTE_API_URL: `http://127.0.0.1:${apiPort}` },
  },
})
