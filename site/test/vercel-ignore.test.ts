import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/*
  Vercel runs the ignored build step before the install, so it must load with nothing but Node:
  copied alone, with no node_modules, it still answers.
*/

let scratch: string

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'vercel-ignore-'))
  mkdirSync(join(scratch, 'site'))
  for (const file of ['scripts/vercel-ignore.ts', 'lib/vercel.ts', 'lib/repository.ts']) {
    cpSync(join(import.meta.dirname, '..', file), join(scratch, 'site', file), { recursive: true })
  }
})

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

describe('the ignored build step', () => {
  it('loads without node_modules and builds a redeploy of the commit already deployed', () => {
    const run = spawnSync('node', ['scripts/vercel-ignore.ts'], {
      cwd: join(scratch, 'site'),
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        VERCEL_GIT_PREVIOUS_SHA: 'abc123',
        VERCEL_GIT_COMMIT_SHA: 'abc123',
      },
    })
    expect(run.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('The site builds')
  })
})
