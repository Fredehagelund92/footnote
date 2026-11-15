import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

/*
  The first load check (scripts/check-bundle-size.mjs), run on small builds: a change may add at
  most 1024 bytes of first load script over its base, and the script may never pass the hard
  ceiling of 443 KB. Random bytes barely compress, so each file's size is about its gzip size.
*/

const root = mkdtempSync(join(tmpdir(), 'heed-bundle-size-'))
const script = fileURLToPath(new URL('../../scripts/check-bundle-size.mjs', import.meta.url))
afterAll(() => rmSync(root, { recursive: true, force: true }))

/** A dist/web whose index.html loads one stylesheet and one script per entry of `scripts`. */
function build(name: string, scripts: readonly Buffer[]) {
  const dir = join(root, name)
  mkdirSync(join(dir, 'assets'), { recursive: true })
  writeFileSync(join(dir, 'assets/index.css'), 'body { margin: 0 }\n')
  const tags = scripts.map((bytes, index) => {
    writeFileSync(join(dir, `assets/part-${index}.js`), bytes)
    return `<script type="module" src="/assets/part-${index}.js"></script>`
  })
  writeFileSync(
    join(dir, 'index.html'),
    `<link rel="stylesheet" href="/assets/index.css">${tags.join('')}`,
  )
  return dir
}

const check = (dir: string, base?: string) => {
  const run = spawnSync('node', [script, dir, ...(base ? ['--base', base] : [])], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_STEP_SUMMARY: '' },
  })
  return { status: run.status, out: run.stdout, err: run.stderr }
}

const app = randomBytes(200_000)
const base = build('base', [app])

describe('the first load check', () => {
  it('passes a change that grows the script by less than 1024 bytes over its base', () => {
    const { status, out, err } = check(build('small', [app, randomBytes(400)]), base)
    expect(err).toBe('')
    expect(status).toBe(0)
    expect(out).toMatch(
      /^ok {3}js growth over the base: \+4\d\d bytes \(base \d+, this build \d+\)/m,
    )
    expect(out).toMatch(/^ok {3}initial js: \d+ bytes .* ceiling 453632 bytes \(443 KB\)/m)
  })

  it('fails a change that grows the script by more than 1024 bytes, naming the growth rule', () => {
    const { status, err } = check(build('grown', [app, randomBytes(1_500)]), base)
    expect(status).toBe(1)
    expect(err).toMatch(
      /^Script growth rule failed: This change grows the first load script by 15\d\d bytes, from \d+ bytes on its base to \d+ bytes, more than the 1024 bytes one change may add\./,
    )
    expect(err).not.toContain('ceiling rule failed')
  })

  it('fails a script over the ceiling even when it did not grow, naming the ceiling rule', () => {
    const large = build('large', [randomBytes(460_000)])
    const { status, err } = check(large, large)
    expect(status).toBe(1)
    expect(err).toMatch(
      /^Script ceiling rule failed: The first load script is \d+ bytes \(\d+\.\d KB\), \d+ bytes over its hard ceiling of 453632 bytes \(443 KB\)\./,
    )
    expect(err).not.toContain('growth rule failed')
  })

  it('checks only the ceilings without a base', () => {
    const { status, out } = check(build('alone', [app, randomBytes(5_000)]))
    expect(status).toBe(0)
    expect(out).not.toContain('growth')
  })
})
