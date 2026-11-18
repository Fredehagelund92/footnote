import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
  The product was called Heed before it was called Footnote, and nothing reads or says the former
  name any more: no setting, cookie, header, file, code name, test or page (docs/product-name.md).
  This fails on the name in any file git tracks, or would track, and in any path, outside the
  historical records below, which are never rewritten. It is shown failing, then run on the
  repository.
*/

const root = fileURLToPath(new URL('../../', import.meta.url))
const formerName = /heed/i

/** The records that keep the former name, since they say what happened under it. */
const historical: readonly { path: RegExp; why: string }[] = [
  { path: /^CHANGELOG\.md$/, why: 'written by release-please from the commits' },
  { path: /^db\/migrations\/\d{4}_[a-z0-9_]+\.sql$/, why: 'an applied migration never changes' },
  {
    path: /^tests\/lint\/former-name\.test\.ts$/,
    why: 'this check, which names what it looks for',
  },
]

/** Where the former name appears in one file: its path, then each line that says it. */
function formerNames(path: string, text: string): string[] {
  if (historical.some((record) => record.path.test(path))) return []
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
    expect(formerNames('src/server/config/env.ts', 'const x = process.env.HEED_AUTH')).toEqual([
      'src/server/config/env.ts:1',
    ])
    expect(formerNames('docs/self-hosting.md', 'Intro\n\nUpgrade from Heed.\n')).toEqual([
      'docs/self-hosting.md:3',
    ])
    expect(formerNames('src/web/public/heed-mark.svg', '<svg/>')).toEqual([
      'src/web/public/heed-mark.svg: the path',
    ])
    expect(formerNames('tests/web/x.test.ts', "setItem('heed-theme', 'dark')")).toEqual([
      'tests/web/x.test.ts:1',
    ])
  })

  it('passes the historical records and a file that does not say it', () => {
    expect(formerNames('CHANGELOG.md', '* add the HeedApi seam')).toEqual([])
    expect(formerNames('db/migrations/0058_footnote_names.sql', "-- 'heed.roles'")).toEqual([])
    expect(formerNames('docs/README.md', 'Footnote, take note.')).toEqual([])
    // Only the migrations themselves: a file beside them is checked.
    expect(formerNames('db/migrations/latest.txt', 'heed')).toEqual(['db/migrations/latest.txt:1'])
  })

  it('appears nowhere in the repository but those records', () => {
    const found = repositoryFiles().flatMap(({ path, text }) => formerNames(path, text))
    expect(found).toEqual([])
  })
})
