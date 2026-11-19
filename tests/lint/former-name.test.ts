import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
  The product had another name before it was called Footnote, and nothing reads or says the former
  name any more: no setting, cookie, header, file, code name, test or page (docs/product-name.md).
  This fails on the name in any file git tracks, or would track, and in any path, outside the
  historical records below, which are never rewritten. It is shown failing, then run on the
  repository. The name is spelled by its letters' codes, so this file does not say it either.
*/

const root = fileURLToPath(new URL('../../', import.meta.url))
const word = String.fromCharCode(104, 101, 101, 100)
const Word = `${word[0]!.toUpperCase()}${word.slice(1)}`
const formerName = new RegExp(word, 'i')

/**
 * The migrations, applied before the rename, that say the former name. An applied migration is
 * never edited (db/README.md): the runner refuses a database whose applied file changed, so
 * taking the name out of these would mean making every existing database again. A new migration
 * is checked like any other file.
 */
const appliedMigrations = [
  '0001_baseline',
  '0004_agent_contract',
  '0005_review_path',
  '0010_about_starts_empty',
  '0012_people_and_invites',
  '0014_oidc_sign_in',
  '0015_observability',
  '0033_obs_caught',
  '0043_ask_loop_limits',
  '0051_gap_states',
  '0053_invite_standing',
  '0058_footnote_names',
]

/** The records that keep the former name, since they say what happened under it. */
const historical: readonly { path: string; why: string }[] = [
  { path: 'CHANGELOG.md', why: 'written by release-please from the commits' },
  ...appliedMigrations.map((name) => ({
    path: `db/migrations/${name}.sql`,
    why: 'an applied migration is never edited',
  })),
]

/** Where the former name appears in one file: its path, then each line that says it. */
function formerNames(path: string, text: string): string[] {
  if (historical.some((record) => record.path === path)) return []
  const found = formerName.test(path) ? [`${path}: the path`] : []
  text.split('\n').forEach((line, i) => {
    if (formerName.test(line)) found.push(`${path}:${i + 1}`)
  })
  return found
}

/** Every file git tracks or would track, with its text; a binary file is checked by its path. */
function repositoryFiles(): { path: string; text: string }[] {
  const listed = spawnSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8' },
  )
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`)
  return [...new Set(listed.stdout.split('\0').filter(Boolean))]
    .filter((path) => existsSync(`${root}${path}`))
    .map((path) => {
      const text = readFileSync(`${root}${path}`, 'utf8')
      return { path, text: text.includes('\0') ? '' : text }
    })
}

describe("the product's former name", () => {
  it('fails in code, configuration, a test, a page or a path, in any case', () => {
    expect(
      formerNames('src/server/config/env.ts', `const x = process.env.${word.toUpperCase()}_AUTH`),
    ).toEqual(['src/server/config/env.ts:1'])
    expect(formerNames('docs/self-hosting.md', `Intro\n\nUpgrade from ${Word}.\n`)).toEqual([
      'docs/self-hosting.md:3',
    ])
    expect(formerNames(`src/web/public/${word}-mark.svg`, '<svg/>')).toEqual([
      `src/web/public/${word}-mark.svg: the path`,
    ])
    expect(formerNames('tests/web/x.test.ts', `setItem('${word}-theme', 'dark')`)).toEqual([
      'tests/web/x.test.ts:1',
    ])
    // This file too: it names the word only by its letters' codes.
    expect(formerNames('tests/lint/former-name.test.ts', Word)).toEqual([
      'tests/lint/former-name.test.ts:1',
    ])
  })

  it('passes the historical records and a file that does not say it', () => {
    expect(formerNames('CHANGELOG.md', `* add the ${Word}Api seam`)).toEqual([])
    expect(formerNames('db/migrations/0058_footnote_names.sql', `-- '${word}.roles'`)).toEqual([])
    expect(formerNames('docs/README.md', 'Footnote, take note.')).toEqual([])
    // Only those migrations: a new one, or a file beside them, is checked.
    expect(formerNames('db/migrations/0059_next.sql', `-- ${Word}`)).toEqual([
      'db/migrations/0059_next.sql:1',
    ])
    expect(formerNames('db/migrations/latest.txt', word)).toEqual(['db/migrations/latest.txt:1'])
  })

  it('appears nowhere in the repository but those records', () => {
    const found = repositoryFiles().flatMap(({ path, text }) => formerNames(path, text))
    expect(found).toEqual([])
  })
})
