import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The server's domain, MCP and Ask tests with the dimension the demo world calls market renamed
// to mode: the word in every test and fixture under tests/server, any case, so `dim:market` is
// `dim:mode`, "Orders by market" is "Orders by mode" and the vocabulary's Market is Mode. Mode sorts
// where market does, so a topic's keys, sorted by dimension, keep their order. The code under test
// is not touched, so a rule that names market fails here (tests/lint/any-dimension.test.ts).

const root = fileURLToPath(new URL('../../', import.meta.url))
const tests = `${root}tests/server/`

/** The tests rerun, from the repository's root. */
export const RENAMED_TESTS = [
  'tests/server/domain/**/*.test.ts',
  'tests/server/mcp/**/*.test.ts',
  'tests/server/ask-*.test.ts',
  'tests/server/evals/**/*.test.ts',
  'tests/server/proposal-attributes.test.ts',
]

/** Market as mode, in the same case: market, Market, MARKET. */
export const renamed = (code: string) =>
  code.replace(/market/gi, (word) =>
    word === word.toUpperCase() ? 'MODE' : word[0] === 'M' ? 'Mode' : 'mode',
  )

export default defineConfig({
  root,
  resolve: { tsconfigPaths: true },
  plugins: [
    {
      name: 'market-renamed',
      enforce: 'pre',
      transform: (code, id) => (id.startsWith(tests) ? { code: renamed(code), map: null } : null),
    },
  ],
  test: {
    name: 'renamed',
    environment: 'node',
    include: RENAMED_TESTS,
    // It runs beside the other tests, so a slow test is given time: a rename fails, never a clock.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
