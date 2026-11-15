import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Linter } from 'eslint'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'
import copyRules from '../../eslint.copy-rules.js'
import { missing, notAllowed, signedOutKept } from '../../src/contract/refusals.ts'

/**
 * An error says three things: what went wrong, what is safe, what to do next (copy.md, "The
 * voice"). The service throws its errors in src/server; none of them may go out with only a code.
 */

const root = fileURLToPath(new URL('../../', import.meta.url))
const linter = new Linter({ cwd: root })

const filesUnder = (dir: string): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(`${dir}/${entry.name}`)
      : entry.name.endsWith('.ts')
        ? [`${dir}/${entry.name}`]
        : [],
  )

/** The sentences of a message: the stops that end one and begin the next word. */
const sentencesOf = (message: string) => message.split(/(?<=[.!?])\s+/).filter(Boolean)

describe('an error thrown by the service', () => {
  it('always carries a message of its own', () => {
    const bare = filesUnder('src/server').flatMap((file) =>
      linter
        .verify(
          readFileSync(join(root, file), 'utf8'),
          [
            {
              files: ['**/*.ts'],
              languageOptions: { parser: tseslint.parser },
              plugins: { copy: copyRules },
              rules: { 'copy/errors-say-three-things': 'warn' },
            },
          ],
          { filename: join(root, file) },
        )
        .filter((message) => message.messageId === 'noMessage')
        .map((message) => `${file}:${message.line}`),
    )
    expect(bare).toEqual([])
  }, 300_000)
})

describe('the messages the service shares', () => {
  const messages = [
    missing('this comment'),
    missing('this suggestion'),
    notAllowed('change an agent'),
    notAllowed('see who is signed in'),
    signedOutKept,
  ]

  it.each(messages)('say three things in three sentences: %s', (message) => {
    expect(sentencesOf(message)).toHaveLength(3)
  })

  it('say what is safe in the second sentence', () => {
    for (const message of messages) expect(sentencesOf(message)[1]).toMatch(/^Nothing (was|is)/)
  })
})
