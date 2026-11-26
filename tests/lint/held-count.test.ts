import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  heldCountApprovalFile,
  heldCountFiles,
  heldCountIn,
  heldCountProblems,
} from '../../scripts/check-held-count.ts'

/*
  CI's check that no merge lowers the held-back count of Ask's evaluation harness unless the owner's
  approval is recorded (scripts/check-held-count.ts): each rule failing on its own, then the script
  on a real git history.
*/

const [loop] = heldCountFiles as [string]
const suite = (n: number) => `askEvalSuite({\n  answerer: 'loop',\n  heldPassingToday: ${n},\n})\n`
const approval = (from: number, to: number, changes: Record<string, unknown> = {}) =>
  JSON.stringify({
    suite: loop,
    from,
    to,
    reason: 'The live scores equal main and the old count was stale.',
    approvedBy: 'The owner',
    date: '2026-11-25',
    ...changes,
  })
const lowered = (from: number, to: number) =>
  `${loop} lowers the held-back count from ${from} to ${to}. A merge may keep the count or raise it, never lower it: fix what the change breaks in the held-back cases' answers, without reading which of them fail.\n  If the owner approved this lowering, record it in ${heldCountApprovalFile} in the same change: {"suite": "${loop}", "from": ${from}, "to": ${to}, "reason": "<one sentence>", "approvedBy": "<who>", "date": "<YYYY-MM-DD>"}.`

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
    expect(heldCountProblems({ [loop]: suite(14) }, { [loop]: suite(13) })).toEqual([
      lowered(14, 13),
    ])
    expect(heldCountProblems({ [loop]: suite(19) }, { [loop]: null })).toEqual([
      `${loop} holds no held-back count (heldPassingToday) any more, where its base holds 19. Keep the count in the suite.`,
    ])
  })

  it('passes a lowering whose approval the change records for that exact lowering', () => {
    expect(
      heldCountProblems(
        { [loop]: suite(15), [heldCountApprovalFile]: null },
        { [loop]: suite(11), [heldCountApprovalFile]: approval(15, 11) },
      ),
    ).toEqual([])
    expect(
      heldCountProblems(
        { [loop]: suite(15), [heldCountApprovalFile]: approval(20, 15) },
        { [loop]: suite(11), [heldCountApprovalFile]: approval(15, 11) },
      ),
    ).toEqual([])
  })

  it('fails a lowering whose approval is missing, unchanged, or does not match', () => {
    const lower = (base: string | null, head: string | null) =>
      heldCountProblems(
        { [loop]: suite(15), [heldCountApprovalFile]: base },
        { [loop]: suite(11), [heldCountApprovalFile]: head },
      )
    expect(lower(approval(15, 11), approval(15, 11))).toEqual([lowered(15, 11)])
    for (const head of [
      approval(15, 12),
      approval(14, 11),
      approval(15, 11, { suite: 'tests/web/integration/other.test.ts' }),
      approval(15, 11, { from: '15' }),
      approval(15, 11, { reason: ' ' }),
      approval(15, 11, { approvedBy: undefined }),
      approval(15, 11, { date: '25 Nov 2026' }),
      'not JSON',
      'null',
    ])
      expect(lower(null, head), head).toEqual([lowered(15, 11)])
  })

  it('does not let an approval excuse a suite that holds no count any more', () => {
    expect(
      heldCountProblems(
        { [loop]: suite(15) },
        { [loop]: null, [heldCountApprovalFile]: approval(15, 11) },
      ),
    ).toHaveLength(1)
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
    expect(up.stdout).toBe('Held-back count: no suite lowers it without an approval.\n')
    write(13)
    const down = check(raised, commit('lowered'))
    expect(down.status).toBe(1)
    expect(down.stderr).toMatch(/lowers the held-back count from 14 to 13\./)
    expect(down.stderr).toContain(`record it in ${heldCountApprovalFile}`)
  })

  it('passes a lowering the change records an approval for', () => {
    const base = git('rev-parse', 'HEAD')
    write(11)
    writeFileSync(join(root, heldCountApprovalFile), approval(13, 11))
    const approved = check(base, commit('approved lowering'))
    expect(approved.status, approved.stderr).toBe(0)
  })
})
