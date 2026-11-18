import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  Small things a stranger checks before trusting the repository. NOTICE names every logo of another
  product the app shows and every project whose MIT code was copied in, with its licence text. And
  access keys have no end date, so the README says so, until the day they can be given one.
*/

const root = new URL('../../', import.meta.url)
const read = (file: string) => readFileSync(new URL(file, root), 'utf8')
const notice = read('NOTICE')

/** The projects copied code names, as NOTICE heads their section. */
const COPIED = {
  editorcn: 'editorcn (https://github.com/shadcn-labs/editorcn), MIT License.',
  shadcn: 'shadcn/ui (https://github.com/shadcn-ui/ui), MIT License.',
}

describe('NOTICE', () => {
  it('names every logo in the app', () => {
    const logos = readdirSync(new URL('src/web/assets/logos/', root))
    expect(logos.length).toBeGreaterThan(0)
    for (const logo of logos)
      expect(notice, `NOTICE names ${logo}`).toMatch(new RegExp(`^\\s+${logo}\\s`, 'm'))
  })

  it('carries the licence of every project copied code says it is from', () => {
    // Tracked files only: a build's output under src/web/dist carries its libraries' notices.
    const sources = execFileSync('git', ['ls-files', 'src'], { cwd: root, encoding: 'utf8' })
      .split('\n')
      .filter((file) => /\.(ts|tsx|css)$/.test(file))
    const named = new Set<string>()
    for (const file of sources) {
      const text = read(file)
      for (const project of Object.keys(COPIED)) if (text.includes(project)) named.add(project)
      // A file that says it is MIT code from somewhere names a project NOTICE covers.
      if (/\bMIT\b/.test(text))
        expect(
          Object.keys(COPIED).some((project) => text.includes(project)),
          `${file} says MIT and names a project in NOTICE`,
        ).toBe(true)
    }
    expect([...named].sort()).toEqual(Object.keys(COPIED).sort())
    for (const heading of Object.values(COPIED)) expect(notice).toContain(heading)
    expect(notice.match(/Permission is hereby granted, free of charge/g)).toHaveLength(
      Object.keys(COPIED).length,
    )
  })
})

describe('access keys', () => {
  it('have no end date, and the README says so', () => {
    const migrations = readdirSync(new URL('db/migrations/', root)).map((f) =>
      read(`db/migrations/${f}`),
    )
    const expiry = migrations.some((sql) =>
      /alter table auth\.access_keys add column (expires|ends|valid_until)/i.test(sql),
    )
    const created = migrations.find((sql) => sql.includes('create table auth.access_keys'))!
    const start = created.indexOf('create table auth.access_keys')
    const columns = created.slice(start, created.indexOf(');', start))
    expect(expiry || /expires|ends_at|valid_until/i.test(columns)).toBe(false)
    expect(read('README.md').replace(/\s+/g, ' ')).toContain(
      'An access key, for a job that runs with nobody there to sign in, has no end date',
    )
  })
})
