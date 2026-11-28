import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

// Market is a dimension like any other (country, currency, channel, whatever a source defines),
// and stays one: nothing decides or shows anything by the name market. Two guards keep it so. The
// server's tests pass with the dimension renamed (tests/lint/renamed-dimension.config.ts), and no
// code under src names market outside words people read and the demo world (eslint.market-names.js,
// run by eslint).

const root = fileURLToPath(new URL('../../', import.meta.url))

/**
 * The tests that still fail renamed, each because words people or agents read say "market": the
 * wording, not a rule. Each goes when its words say a value of a dimension.
 */
const SAYS_MARKET: Record<string, string> = {
  'tests/server/ask-loop.test.ts > About our business in the instructions follows the rules, marked as background and not a source, before the day; none without text':
    'src/domain/about-business.ts: "never take anything about a metric, a market or a date from it"',
  'tests/server/domain/agent-draft.test.ts > the drafting guide asks for a short summary, detail in the body, no cause, own names, unsure dates and one fact':
    'src/domain/drafting-guide.ts: "Name metrics and markets as the person does"',
  'tests/server/mcp/conformance.test.ts > the server instructions (FR-343), legacy end with About our business, after every rule, marked as background and not a source':
    'src/domain/about-business.ts, as above',
  'tests/server/mcp/conformance.test.ts > the server instructions (FR-343), auto end with About our business, after every rule, marked as background and not a source':
    'src/domain/about-business.ts, as above',
  "tests/server/mcp/say.test.ts > find_context's sentence when no words match but what they name does names what it read, how far it checked and the day it assumed":
    'src/server/mcp/outcomes.ts: "Call get_context for other metrics, markets or dates"',
}

type Report = {
  numTotalTests: number
  testResults: {
    name: string
    status: string
    message: string
    assertionResults: { fullName: string; status: string }[]
  }[]
}

describe('the server with market renamed', () => {
  it('passes its domain, MCP and Ask tests, but where its words say market', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'footnote-renamed-'))
    const out = join(dir, 'report.json')
    // A clean environment: the run is a vitest of its own, not a worker of this one.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !/^(VITEST|TEST|NODE_ENV$)/.test(key)),
    )
    try {
      await promisify(execFile)(
        process.execPath,
        [
          join(root, 'node_modules/vitest/vitest.mjs'),
          'run',
          '--config',
          'tests/lint/renamed-dimension.config.ts',
          '--reporter=json',
          `--outputFile=${out}`,
        ],
        { cwd: root, env, maxBuffer: 64 * 1024 * 1024 },
      ).catch(() => undefined)
      const report = JSON.parse(readFileSync(out, 'utf8')) as Report
      const name = (file: string) => relative(root, file)
      // A file that could not even load fails with no test in it.
      expect(
        report.testResults
          .filter((f) => f.status === 'failed' && !f.assertionResults.length)
          .map((f) => `${name(f.name)}: ${f.message}`),
      ).toEqual([])
      const failed = report.testResults.flatMap((f) =>
        f.assertionResults
          .filter((a) => a.status === 'failed')
          .map((a) => `${name(f.name)} > ${a.fullName}`),
      )
      // Every other test passes; and a test listed above that passes now comes off the list.
      expect(failed.sort()).toEqual(Object.keys(SAYS_MARKET).sort())
      expect(report.numTotalTests).toBeGreaterThan(1500)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 600_000)
})
