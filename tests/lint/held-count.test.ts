import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { heldCountFiles, heldCountIn, heldCountProblems } from '../../scripts/check-held-count.ts'

/*
  CI's check that no merge lowers the held-back count of Ask's evaluation harness
  (scripts/check-held-count.ts): each rule failing on its own, then the script on a real git
  history.
*/

const [loop, main] = heldCountFiles as [string, string]
const suite = (n: number) => `askEvalSuite({\n  answerer: 'loop',\n  heldPassingToday: ${n},\n})\n`

describe('the held-back count of a change', () => {
  it('is read from each suite as it holds it', () => {
    for (const path of heldCountFiles) {
      const text = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
      expect(heldCountIn(text), path).toEqual(expect.any(Number))
    }
    expect(heldCountIn('nothing here')).toBeNull()
  })

  it('passes a count kept or raised, and a suite the base did not have', () => {
    expect(heldCountProblems({ [loop]: suite(9) }, { [loop]: suite(9) })).toEqual([])
    expect(heldCountProblems({ [loop]: suite(9) }, { [loop]: suite(14) })).toEqual([])
    expect(heldCountProblems({ [loop]: null }, { [loop]: suite(3) })).toEqual([])
  })

  it('fails a count lowered, or a suite that holds none any more', () => {
    expect(
      heldCountProblems(
        { [loop]: suite(14), [main]: suite(19) },
        { [loop]: suite(13), [main]: suite(19) },
      ),
    ).toEqual([
      `${loop} lowers the held-back count from 14 to 13. A merge may keep the count or raise it, never lower it: fix what the change breaks in the held-back cases' answers, without reading which of them fail.`,
    ])
    expect(heldCountProblems({ [main]: suite(19) }, { [main]: null })).toEqual([
      `${main} holds no held-back count (heldPassingToday) any more, where its base holds 19. Keep the count in the suite.`,
    ])
  })
})

describe('the check on a real git history', () => {
  const root = mkdtempSync(join(tmpdir(), 'footnote-held-count-'))
  const script = fileURLToPath(new URL('../../scripts/check-held-count.ts', import.meta.url))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args: string[]) => {
    const run = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
    expect(run.status, run.stderr).toBe(0)
    return run.stdout.trim()
  }
  const write = (n: number) => {
    mkdirSync(join(root, 'tests/web/integration'), { recursive: true })
    writeFileSync(join(root, loop), suite(n))
  }
  const identity = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com']
  const commit = (message: string) => {
    git('add', '-A')
    git(...identity, 'commit', '-qm', message)
    return git('rev-parse', 'HEAD')
  }
  const check = (from: string, to: string) =>
    spawnSync(process.execPath, [script, from, to], { cwd: root, encoding: 'utf8' })

  it('passes a raised count and fails a lowered one', () => {
    git('init', '-q', '-b', 'main')
    write(9)
    const base = commit('base')
    write(14)
    const raised = commit('raised')
    const up = check(base, raised)
    expect(up.status, up.stderr).toBe(0)
    expect(up.stdout).toBe('Held-back count: no suite lowers it.\n')
    write(13)
    const down = check(raised, commit('lowered'))
    expect(down.status).toBe(1)
    expect(down.stderr).toMatch(/lowers the held-back count from 14 to 13\./)
  })
})
