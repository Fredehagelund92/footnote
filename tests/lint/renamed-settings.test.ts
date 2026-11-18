import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renamedSettings } from '../../src/domain/renamed-settings.ts'

/*
  The settings were named CL_ before 0.1.0, HEED_ until the product was renamed Footnote, and are
  FOOTNOTE_ since. The fallback table (src/domain/renamed-settings.ts) is the one place that names
  an old setting, so a new setting cannot be added under an old prefix and an old name cannot creep
  back into the code, the configuration or the docs. The guard is shown failing on each, then run
  on the repository.
*/

const root = fileURLToPath(new URL('../../', import.meta.url))

/** The files that may name an old setting: the table, the tests of the fallback and the rename's plan. */
const allowedFiles = new Set([
  'src/domain/renamed-settings.ts',
  'tests/server/renamed-settings.test.ts',
  'tests/lint/renamed-settings.test.ts',
  'docs/rename-checklist.md',
  'CHANGELOG.md',
])
/** An applied migration is never changed (db/README.md), so its comments keep the old names. */
const migration = /^db\/migrations\/.+\.sql$/
/** The upgrade notes list the old names: the developers' page and the operators' page. */
const upgradeNotes = [
  { file: 'docs/contributing/internals.md', heading: '## Settings named HEED_ before the rename' },
  { file: 'docs/operations.md', heading: '## Upgrade from Heed 0.1' },
  { file: 'docs/operations.md', heading: '## Settings that started with HEED_' },
]
/**
 * Old names read outside the table, each beside its new one for the same release: the compose
 * file's ports, the web image's address of the service, and the held-out key, whose variables only
 * the seal's own files may name (scripts/check-held-out-seal.ts).
 */
const readBeside: Record<string, readonly string[]> = {
  'compose.yaml': ['HEED_PORT', 'HEED_WEB_PORT'],
  'docker/16-api-url.envsh': ['HEED_API_URL'],
  'db/seed/held-out.ts': ['HEED_HELDOUT_KEY', 'HEED_HELDOUT_KEY_FILE'],
  'scripts/check-held-out-seal.ts': ['HEED_HELDOUT_KEY'],
}
/** Retired before 0.1.0 and read by nothing: named only to say it no longer works. */
const retired = new Set(['CL_DEV_PERSON'])

/** An upgrade note's section of its page, up to the next heading of its level. */
function noteSection(text: string, heading: string): string {
  const start = text.indexOf(`${heading}\n`)
  if (start < 0) return ''
  const end = text.indexOf('\n## ', start + heading.length)
  return text.slice(start, end < 0 ? undefined : end)
}

/** The old setting names a file may not name. */
function oldSettingNames(path: string, text: string): string[] {
  if (allowedFiles.has(path)) return []
  const checked = upgradeNotes
    .filter((note) => note.file === path)
    .reduce((rest, note) => rest.replace(noteSection(rest, note.heading), ''), text)
  return (checked.match(/\b(?:CL|HEED)_[A-Z][A-Z0-9_]*/g) ?? []).filter(
    (name) => !retired.has(name) && !migration.test(path) && !readBeside[path]?.includes(name),
  )
}

/** Every file git tracks or would track, with its text; binary files are left out. */
function repositoryFiles(): { path: string; text: string }[] {
  const listed = spawnSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`)
  return [...new Set(listed.stdout.split('\0').filter(Boolean))]
    .filter((path) => existsSync(`${root}${path}`))
    .map((path) => ({ path, text: readFileSync(`${root}${path}`, 'utf8') }))
    .filter(({ text }) => !text.includes('\0'))
}

describe('the old CL_ and HEED_ setting names', () => {
  it('fails a new setting with an old prefix, in code, configuration or docs', () => {
    expect(oldSettingNames('src/server/config/env.ts', 'HEED_NEW_THING: z.string()')).toEqual([
      'HEED_NEW_THING',
    ])
    expect(oldSettingNames('compose.yaml', '      CL_NEW_THING: on')).toEqual(['CL_NEW_THING'])
    expect(oldSettingNames('docs/self-hosting.md', 'Set `HEED_NEW_THING`.')).toEqual([
      'HEED_NEW_THING',
    ])
  })

  it('fails an old name outside the table, even one the table pairs', () => {
    expect(oldSettingNames('src/server/brand.ts', 'process.env.HEED_PRODUCT_NAME')).toEqual([
      'HEED_PRODUCT_NAME',
    ])
    expect(oldSettingNames('.env.example', 'HEED_AUTH=dev')).toEqual(['HEED_AUTH'])
    const [note] = upgradeNotes
    const doc = `# Run\n\nSet \`HEED_AUTH\`.\n\n${note!.heading}\n\n\`HEED_AUTH\` is now \`FOOTNOTE_AUTH\`.\n\n## Next\n\n\`HEED_WEB_ORIGINS\`\n`
    expect(oldSettingNames(note!.file, doc)).toEqual(['HEED_AUTH', 'HEED_WEB_ORIGINS'])
  })

  it('passes the table, an applied migration, the upgrade notes and a name read beside its new one', () => {
    expect(oldSettingNames('compose.yaml', '# HEED_PORT still counts')).toEqual([])
    expect(oldSettingNames('compose.yaml', 'HEED_AUTH: dev')).toEqual(['HEED_AUTH'])
    expect(oldSettingNames('src/domain/renamed-settings.ts', "HEED_AUTH: 'FOOTNOTE_AUTH'")).toEqual(
      [],
    )
    expect(
      oldSettingNames('db/migrations/0014_oidc_sign_in.sql', '-- CL_OIDC_ADMIN_GROUPS'),
    ).toEqual([])
    for (const { file, heading } of upgradeNotes)
      expect(
        oldSettingNames(file, `${heading}\n\n\`HEED_AUTH\` is now \`FOOTNOTE_AUTH\`.\n`),
      ).toEqual([])
  })

  it('names no old setting anywhere in the repository but those places', () => {
    const found = repositoryFiles().flatMap(({ path, text }) =>
      oldSettingNames(path, text).map((name) => `${path}: ${name}`),
    )
    expect(found).toEqual([])
  })

  it('lists every old name in the developers’ upgrade note', () => {
    const [{ file, heading }] = upgradeNotes as [(typeof upgradeNotes)[number]]
    const note = noteSection(readFileSync(`${root}${file}`, 'utf8'), heading)
    expect(note).not.toBe('')
    for (const oldName of Object.keys(renamedSettings)) expect(note).toContain(`\`${oldName}\``)
  })
})
