import { execFile } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Market is a dimension like any other (country, currency, channel, whatever a source defines),
// and stays one: nothing decides or shows anything by the name market. Two guards keep it so. The
// server's tests pass with the dimension renamed (tests/lint/renamed-dimension.config.ts), and no
// code under src names market outside words people read and the demo world.

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

/* ---------- no market in the code ---------- */

/**
 * The demo world, which may name its own markets: the web's mock binding and its data. Words
 * people read are full sentences, so a sentence that says "a market" is not a name here.
 */
const DEMO = /^src\/web\/api\/mock\//

/**
 * What still names market under src, by file, and why; each goes with its own change. A name
 * here is an identifier with market in it, or a string that is market itself, a dimension's key
 * (`dim:market`, `val:market/norway`) or a mention's (`market:Norway`, `market/norway`).
 */
const STILL_NAMED: Record<string, { why: string; names: Record<string, number> }> = {
  'src/server/mcp/invalid-input.ts': {
    why: 'the static example calls the schema check reads; an install is shown its own terms',
    names: { "'market'": 2 },
  },
  'src/web/lib/mentions.ts': {
    why: "reads the market:Norway mentions saved chats hold, from before Ask's @ offered every value",
    names: { "'market'": 1, "'market/'": 1 },
  },
  'src/web/api/http-ask.ts': {
    why: 'reads the answers a browser kept before their values were named values, as markets',
    names: { markets: 3 },
  },
  // One look for every value: the Market-only icon and hue.
  'src/web/components/footnote/scope-chips.tsx': {
    why: 'the Market-only icon and hue',
    names: { isMarket: 2, "'market'": 2, "'Market'": 1 },
  },
  'src/web/components/footnote/mention-chip.tsx': {
    why: 'the Market-only icon and hue',
    names: { "'market'": 2, "'market/'": 1 },
  },
  'src/web/components/footnote/tag-chip.tsx': {
    why: 'the Market-only icon and hue',
    names: { market: 1 },
  },
  'src/web/lib/tones.ts': {
    why: 'the Market-only icon and hue',
    names: { "'market'": 4, market: 1 },
  },
  'src/web/pages/context-time.tsx': {
    why: 'the Market-only icon and hue',
    names: { "'Market'": 2 },
  },
  // A link's ?market= (about= takes values of any dimension); old links keep reading it.
  'src/web/pages/editor.tsx': {
    why: "the link's ?market=",
    names: { market: 3, "'market'": 2 },
  },
  'src/web/lib/search.ts': { why: "the link's ?market=", names: { market: 2 } },
  'src/web/lib/editor-start.ts': { why: "the link's ?market=", names: { "'market'": 1 } },
  'src/web/pages/inbox.tsx': { why: "the link's ?market=", names: { market: 1 } },
  'src/web/components/footnote/answer.tsx': { why: "the link's ?market=", names: { market: 1 } },
  'src/web/components/obs/answer-panel.tsx': {
    why: "the link's ?market=",
    names: { market: 1 },
  },
}

const NAMED = /^(markets?|Markets?)$|dim:market|val:market\/|^market[/:]/
// "marketing" is a domain of the demo world, not the dimension.
const NAMED_ID = /market(?!ing)/i

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* sources(path)
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) yield path
  }
}

/** The names of market in a file's code, counted: never its comments or the text of its JSX. */
function namesIn(path: string, text = readFileSync(path, 'utf8')): Record<string, number> {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, kind)
  const names: Record<string, number> = {}
  const visit = (node: ts.Node) => {
    const literal =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateLiteralToken(node)
    const name = literal
      ? NAMED.test(node.text) && `'${node.text}'`
      : ts.isIdentifier(node) && NAMED_ID.test(node.text) && node.text
    if (name) names[name] = (names[name] ?? 0) + 1
    ts.forEachChild(node, visit)
  }
  visit(file)
  return names
}

describe('the code under src', () => {
  it('names no market, but where the list above says why', () => {
    const found = Object.fromEntries(
      [...sources(join(root, 'src'))]
        .map((path) => [relative(root, path), namesIn(path)] as const)
        .filter(([path, names]) => !DEMO.test(path) && Object.keys(names).length),
    )
    const listed = Object.fromEntries(
      Object.entries(STILL_NAMED).map(([path, { names }]) => [path, names]),
    )
    // A new name of market is a rule of its own: read the value's dimension instead. One that went
    // comes off the list.
    expect(found).toEqual(listed)
  })

  it('finds a name of market in code, and none in its comments or words', () => {
    const sample = [
      '// The dimension with id market, in a comment.',
      "const isMarket = (d: { id: string }) => d.id === 'market'",
      "const key = `val:market/${'norway'}`",
      "const ok = { label: 'Pick a market or a channel.', marketing: 1 }",
      'export const A = () => <p>Markets</p>',
    ].join('\n')
    expect(namesIn('sample.tsx', sample)).toEqual({
      isMarket: 1,
      "'market'": 1,
      "'val:market/'": 1,
    })
  })
})
