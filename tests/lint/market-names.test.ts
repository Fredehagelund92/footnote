import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint, Linter } from 'eslint'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'
import marketNames, { stillNamesMarket } from '../../eslint.market-names.js'

/**
 * dimensions/market-names (eslint.market-names.js): market is a dimension like any other, so no
 * code names it; words people read are not names.
 */

const root = fileURLToPath(new URL('../../', import.meta.url))
const linter = new Linter({ cwd: root })

/** What the rule says of `code`, wherever it is written. */
const said = (code: string) =>
  linter
    .verify(
      code,
      [
        {
          files: ['**/*.{ts,tsx}'],
          languageOptions: { parser: tseslint.parser },
          plugins: { dimensions: marketNames },
          rules: { 'dimensions/market-names': 'error' },
        },
      ],
      { filename: join(root, 'src/web/lib/example.tsx') },
    )
    .map((message) => message.messageId)

describe('dimensions/market-names', () => {
  it('reports an identifier with market in it', () => {
    expect(said(`const isMarket = (d: { id: string }) => d.id === 'country'`)).toEqual(['named'])
    expect(said(`const x = { markets: [] }`)).toEqual(['named'])
  })

  it("reports a string that is market itself, a dimension's key or a mention's", () => {
    expect(said(`const a = d.id === 'market'`)).toEqual(['named'])
    expect(said(`const b = filters['dim:market']`)).toEqual(['named'])
    expect(said('const c = `val:market/${slug}`')).toEqual(['named'])
    expect(said(`const d = id.startsWith('market:')`)).toEqual(['named'])
  })

  it('leaves comments, sentences, marketing and the text of JSX', () => {
    expect(said(`// The dimension with id market, in a comment.\nconst a = 1`)).toEqual([])
    expect(said(`const a = { label: 'Pick a market or a channel.', marketing: 1 }`)).toEqual([])
    expect(said(`export const A = () => <p>Markets</p>`)).toEqual([])
  })

  it('runs on the app, through the repository config, and not on the demo world', async () => {
    const eslint = new ESLint({
      cwd: root,
      overrideConfig: { languageOptions: { parserOptions: { projectService: false } } },
      ruleFilter: ({ ruleId }) => ruleId === 'dimensions/market-names',
    })
    const code = `const a = d.id === 'market'`
    const [app] = await eslint.lintText(code, { filePath: join(root, 'src/web/lib/other.ts') })
    expect(app?.messages.map((message) => message.ruleId)).toEqual(['dimensions/market-names'])
    const [demo] = await eslint.lintText(code, {
      filePath: join(root, 'src/web/api/mock/example.ts'),
    })
    expect(demo?.messages).toEqual([])
  })

  it('lists only files that still name market', () => {
    const clean = stillNamesMarket.filter(
      (file) => said(readFileSync(join(root, file), 'utf8')).length === 0,
    )
    expect(clean, 'take these off stillNamesMarket').toEqual([])
  })
})
