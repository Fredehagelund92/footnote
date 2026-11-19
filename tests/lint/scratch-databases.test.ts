import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
  A test run can make a Postgres of its own in a folder of the checkout (.tmp-pg, ignored in
  .gitignore). That folder is scratch and is never committed: once about 3,000 of its files were.
  This fails on any file git tracks, or would track, inside a Postgres data folder, whatever the
  folder is called: Postgres writes PG_VERSION at the top of every data folder it makes. It is
  shown failing, then run on the repository.
*/

const root = fileURLToPath(new URL('../../', import.meta.url))

/** The data folders the paths belong to: each folder named .tmp-pg or holding PG_VERSION. */
function scratchDatabases(paths: readonly string[]): string[] {
  const folders = paths.flatMap((path) => {
    const parts = path.split('/')
    const named = parts.indexOf('.tmp-pg')
    if (named !== -1) return [parts.slice(0, named + 1).join('/')]
    if (parts.at(-1) === 'PG_VERSION') return [parts.slice(0, -1).join('/') || '.']
    return []
  })
  return [...new Set(folders)].sort()
}

/** Every file git tracks or would track. */
function repositoryPaths(): string[] {
  const listed = spawnSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8' },
  )
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`)
  return listed.stdout.split('\0').filter(Boolean)
}

describe('scratch databases', () => {
  it('fails on a file inside a test Postgres, whatever its folder is called', () => {
    expect(scratchDatabases(['.tmp-pg/base/1/112', '.tmp-pg/PG_VERSION'])).toEqual(['.tmp-pg'])
    expect(scratchDatabases(['tests/.tmp-pg/global/1213'])).toEqual(['tests/.tmp-pg'])
    expect(scratchDatabases(['.pg-data/PG_VERSION', 'PG_VERSION'])).toEqual(['.', '.pg-data'])
  })

  it('passes files that only look alike', () => {
    expect(
      scratchDatabases(['db/migrations/0001_baseline.sql', 'docs/PG_VERSION.md', '.tmp-pgx/a']),
    ).toEqual([])
  })

  it('finds none in the repository', () => {
    expect(scratchDatabases(repositoryPaths())).toEqual([])
  })
})
