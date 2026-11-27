import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appShouldBuild } from '../../scripts/vercel-release.ts'

/** When the demo on Vercel builds (vercel.json, scripts/vercel-ignore.ts, docs/vercel.md). */

const release = {
  production: true,
  previous: 'a',
  current: 'b',
  version: '0.3.0',
  released: true,
  previousVersion: '0.2.0',
}

describe('the demo on Vercel', () => {
  it('builds production for a release the deployment it replaces does not run', () => {
    expect(appShouldBuild(release)).toBe(true)
  })

  it('builds nothing on production for a push that brings no release', () => {
    expect(appShouldBuild({ ...release, previousVersion: '0.3.0' })).toBe(false)
    // The release pull request merged, and the version is not tagged yet.
    expect(appShouldBuild({ ...release, released: false, previousVersion: undefined })).toBe(false)
  })

  it('builds nothing for a pull request or another branch, whatever it brings', () => {
    expect(appShouldBuild({ ...release, production: false })).toBe(false)
    expect(appShouldBuild({ ...release, production: false, previous: undefined })).toBe(false)
  })

  it("builds a redeploy of the commit already deployed, and production's first deployment", () => {
    expect(appShouldBuild({ ...release, production: false, previous: 'b' })).toBe(true)
    expect(appShouldBuild({ ...release, previous: 'b', previousVersion: '0.3.0' })).toBe(true)
    expect(appShouldBuild({ ...release, previous: undefined, released: undefined })).toBe(true)
  })

  it('builds production when git cannot tell', () => {
    expect(appShouldBuild({ ...release, released: undefined, previousVersion: undefined })).toBe(
      true,
    )
    expect(appShouldBuild({ ...release, previousVersion: undefined })).toBe(true)
  })
})

/*
  Vercel runs the ignored build step before the install, so it must load with nothing but Node:
  copied alone, with no node_modules, it still answers.
*/
describe('the ignored build step', () => {
  let scratch: string
  const files = ['scripts/vercel-ignore.ts', 'scripts/vercel-release.ts', 'site/lib/repository.ts']

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'vercel-ignore-'))
    for (const file of [...files, 'package.json']) {
      mkdirSync(join(scratch, file, '..'), { recursive: true })
      cpSync(join(import.meta.dirname, '../..', file), join(scratch, file))
    }
  })

  afterAll(() => rmSync(scratch, { recursive: true, force: true }))

  const run = (env: Record<string, string>) =>
    spawnSync('node', ['scripts/vercel-ignore.ts'], {
      cwd: scratch,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, ...env },
    })

  it('loads without node_modules and builds a redeploy of the commit already deployed', () => {
    const redeploy = run({ VERCEL_GIT_PREVIOUS_SHA: 'abc123', VERCEL_GIT_COMMIT_SHA: 'abc123' })
    expect(redeploy.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
    expect(redeploy.status).toBe(1)
    expect(redeploy.stdout).toContain('The app builds')
  })

  it('skips a pull request', () => {
    const preview = run({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_SHA: 'abc123' })
    expect(preview.status).toBe(0)
    expect(preview.stdout).toContain('builds only for a release')
  })
})
