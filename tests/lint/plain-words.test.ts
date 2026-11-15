import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Linter } from 'eslint'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'
import plainWords from '../../eslint.plain-words.js'

/**
 * heed/plain-words (eslint.plain-words.js) holds the words people read to glossary v2
 * (docs/design/copy.md). It is only worth having if it is precise: it reports every banned word
 * in text, and nothing in code.
 */

const root = fileURLToPath(new URL('../../', import.meta.url))
const linter = new Linter({ cwd: root })

/** What the rule says about `code`, written in `file`, with the options a file there gets. */
function said(code: string, file = 'src/web/pages/example.tsx', errorsOnly = false) {
  return linter
    .verify(
      code,
      [
        {
          files: ['**/*.{ts,tsx}'],
          languageOptions: {
            parser: tseslint.parser,
            parserOptions: { ecmaFeatures: { jsx: true } },
          },
          plugins: { heed: plainWords },
          rules: { 'heed/plain-words': ['warn', { errorsOnly }] },
        },
      ],
      { filename: join(root, file) },
    )
    .map((message) => message.message)
}

const write = (found: string, instead: string) =>
  `Instead of "${found}", write: ${instead}. See docs/design/copy.md.`

describe('heed/plain-words reports the old words in text people read', () => {
  it('names the renames: fact, administrator, proposal and accept', () => {
    expect(said(`export const a = <p>Add a fact</p>`)).toEqual([write('a fact', 'a context item')])
    expect(said(`export const b = 'Ask an administrator.'`)).toEqual([
      write('administrator', 'Admin'),
    ])
    expect(said(`export const c = 'Send the proposal.'`)).toEqual([write('proposal', 'suggestion')])
    expect(said(`export const d = 'Accept this change.'`)).toEqual([write('Accept', 'publish')])
  })

  it('reads strings, template text, JSX text and the attributes people read', () => {
    expect(said('export const a = (n: number) => `${n} facts in scope`')).toEqual([
      write('facts', 'context items'),
    ])
    expect(said(`export const b = <input placeholder="Search facts" />`)).toEqual([
      write('facts', 'context items'),
    ])
    expect(said(`export const c = { label: 'Administrators' }`)).toEqual([
      write('Administrators', 'Admin'),
    ])
  })

  it('reads the server where people read it: error messages', () => {
    expect(
      said(
        `throw new ORPCError('CONFLICT', { message: 'This proposal changed' })`,
        'src/server/modules/proposals/service.ts',
        true,
      ),
    ).toEqual([write('proposal', 'suggestion')])
    expect(
      said(
        `const m = (n: number) => new ORPCError('CONFLICT', { message: n > 1 ? \`\${n} facts changed\` : 'It changed' })`,
        'src/server/modules/proposals/service.ts',
        true,
      ),
    ).toEqual([write('facts', 'context items')])
  })
})

describe('heed/plain-words leaves code alone', () => {
  it.each([
    ['an import', `import { fact } from './fact card'; export * from 'the proposal'`],
    ['a key', `export const a = { fact: 1, 'a fact': 2, ['the proposal']: 3 }`],
    ['a type', `type Role = 'Administrator' | 'the proposal'; type T = \`\${string} fact\``],
    ['a comparison', `export const a = (k: string) => k === 'Administrator' || k !== 'A fact'`],
    ['a switch case', `export function a(k: string) { switch (k) { case 'A fact': return 1 } }`],
    ['a member', `export const a = (o: Record<string, number>) => o['the proposal']`],
    [
      'a single lowercase word, a key',
      `export const a = ['fact', 'proposal', 'accept', 'retired']`,
    ],
    [
      'a word made of code marks',
      `export const a = 'Use fact_id, getFact or --proposal with /facts.'`,
    ],
    ['an address', `export const a = 'Open https://example.com/facts or /library/facts'`],
    ['a code span', 'export const a = "Run `heed fact list` first."'],
    ['class names', `export const a = <p className="facts-center gap-2 group/fact">x</p>`],
    ['a class list', `export const a = cn('facts-start', true && 'the proposal bar')`],
    [
      'test ids and ids',
      `export const a = <li data-testid="a fact" id="proposal" key="administrator" />`,
    ],
    ['a link target', `export const a = <a href="/library/facts" rel="fact">Open</a>`],
    ['a code element', `export const a = <code>proposal: fact</code>`],
    ['a code sample', `export const a = '{"type": "fact", "proposal": "all"}'`],
    ['a command line', `export const a = 'npx heed fact list --administrator me'`],
    ['a log', `console.warn('administrator missing for the fact')`],
    ['an error for developers', `throw new Error('The fact has no proposal')`],
    ['a directive', `'use client'`],
    [
      'a longer word that holds a banned one',
      `export const a = 'Factory of a proposalless telescope, context-item'`,
    ],
  ])('%s', (_what, code) => {
    expect(said(code)).toEqual([])
  })

  it('reads the text in a call used as a statement, but not a directive', () => {
    expect(said(`showToast('Proposal sent')`)).toEqual([write('Proposal', 'suggestion')])
    expect(said(`setFailure('Ask the administrator.')`)).toEqual([write('administrator', 'Admin')])
    expect(said(`'use client'`)).toEqual([])
  })

  it('reads only error messages in the rest of the server', () => {
    const file = 'src/server/modules/proposals/service.ts'
    expect(said(`log.info('The administrator changed the fact')`, file, true)).toEqual([])
    expect(
      said(`export const sql = 'select fact from facts where proposal = $1'`, file, true),
    ).toEqual([])
    expect(
      said(`throw new ORPCError('NOT_FOUND', { data: { why: 'no fact' } })`, file, true),
    ).toEqual([])
  })
})
