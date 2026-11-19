import { describe, expect, it } from 'vitest'
import { docsNeededFor, docsTouchedProblems } from '../../scripts/check-docs-touched.ts'

/*
  The docs follow the change (scripts/check-docs-touched.ts): a pull request people will notice,
  or one that changes a setting, also changes docs/ or says why not.
*/

const code = ['src/web/pages/inbox.tsx']

describe('a pull request the docs must follow', () => {
  it('is one that reaches the release notes, or changes a setting', () => {
    expect(docsNeededFor({ title: 'feat(web): sort the Inbox', body: '', paths: code })).toContain(
      'release notes',
    )
    expect(docsNeededFor({ title: 'fix: keep the draft', body: '', paths: code })).toBeDefined()
    expect(docsNeededFor({ title: 'perf(server): read once', body: '', paths: code })).toBeDefined()
    expect(
      docsNeededFor({ title: 'refactor!: drop the old name', body: '', paths: code }),
    ).toBeDefined()
    expect(
      docsNeededFor({ title: 'refactor: split a module', body: '', paths: ['.env.example'] }),
    ).toContain('.env.example')
    expect(
      docsNeededFor({ title: 'chore: tidy', body: '', paths: ['src/server/config/env.ts'] }),
    ).toContain('src/server/config/env.ts')
  })

  it('is one whose description has a breaking change footer', () => {
    for (const footer of ['BREAKING CHANGE: the flag is gone', 'BREAKING-CHANGE: the flag is gone'])
      expect(
        docsNeededFor({ title: 'refactor: x', body: `Why.\n\n${footer}\n`, paths: code }),
      ).toContain('breaking change')
    expect(
      docsNeededFor({
        title: 'refactor: x',
        body: 'It is not a BREAKING CHANGE: here',
        paths: code,
      }),
    ).toBeUndefined()
  })

  it('is not one nobody notices', () => {
    for (const title of [
      'refactor: split a module',
      'test: cover the Inbox',
      'ci: cache the browser',
      'chore(main): release 0.2.0',
      'build(deps): bump astro',
      'docs: say it plainly',
    ])
      expect(docsNeededFor({ title, body: '', paths: code })).toBeUndefined()
  })
})

describe('the check', () => {
  const feature = { title: 'feat(web): sort the Inbox', body: '', paths: code }

  it('fails a change people notice when nothing under docs/ changed', () => {
    expect(docsTouchedProblems(feature)[0]).toContain('nothing under docs/ changed')
  })

  it('passes when the docs changed', () => {
    expect(docsTouchedProblems({ ...feature, paths: [...code, 'docs/help/inbox.md'] })).toEqual([])
  })

  it('passes when the description says why the docs need not change, and only then', () => {
    const body = 'Sorts the Inbox.\n\nNo docs change: the help page never named the order.\n'
    expect(docsTouchedProblems({ ...feature, body })).toEqual([])
    expect(docsTouchedProblems({ ...feature, body: 'No docs change:' })).not.toEqual([])
    expect(docsTouchedProblems({ ...feature, body: 'No docs change: n/a' })).not.toEqual([])
    expect(docsTouchedProblems({ ...feature, body: 'There is no docs change here.' })).not.toEqual(
      [],
    )
  })
})
