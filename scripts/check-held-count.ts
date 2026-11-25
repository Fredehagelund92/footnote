import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/*
  The held-back count of Ask's evaluation harness only rises (docs/evaluations.md, "Ask's
  evaluation harness"): `node scripts/check-held-count.ts <base> [<head>]`, run on every pull
  request (.github/workflows/ci.yml, "Held-back count"). Each answerer's suite holds the number of
  held-back cases that pass every try in every build (`heldPassingToday`), and the build fails
  when the number is not what the run gives. This fails a change that writes a lower number than
  its base: a merge may keep the count or raise it, never lower it, unless the owner approved that
  lowering and the change records it in `heldCountApprovalFile`, naming the suite and the exact
  count it lowers from and to. CI runs the base branch's copy of this script, so a pull request
  cannot loosen the guard that judges it. It needs only git and node: no install.
*/

/** The suites that hold a held-back count: Ask's loop's. */
export const heldCountFiles = ['tests/web/integration/ask-eval-loop.test.ts']

/** The owner's approval of one lowering, added or changed by the change that lowers the count. */
export const heldCountApprovalFile = 'tests/web/integration/held-count-approval.json'

/** The held-back count a suite's text holds, or null where it holds none. */
export function heldCountIn(text: string): number | null {
  const found = [...text.matchAll(/^\s*heldPassingToday:\s*(\d+),?\s*$/gm)]
  return found.length === 1 ? Number(found[0]![1]) : null
}

/** Whether the head's approval record, new or changed since the base, names this exact lowering. */
function approves(
  base: string | null | undefined,
  head: string | null | undefined,
  suite: string,
  from: number,
  to: number,
): boolean {
  if (head == null || head === base) return false
  let record: unknown
  try {
    record = JSON.parse(head)
  } catch {
    return false
  }
  if (typeof record !== 'object' || record === null) return false
  const {
    suite: named,
    from: was,
    to: is,
    reason,
    approvedBy,
    date,
  } = record as Record<string, unknown>
  const words = (value: unknown) => typeof value === 'string' && value.trim() !== ''
  return (
    named === suite &&
    was === from &&
    is === to &&
    words(reason) &&
    words(approvedBy) &&
    typeof date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(date)
  )
}

/** Every suite whose count the change lowers or loses, in words; none when it passes. */
export function heldCountProblems(
  base: Readonly<Record<string, string | null>>,
  head: Readonly<Record<string, string | null>>,
): string[] {
  const problems: string[] = []
  const approval = [base[heldCountApprovalFile], head[heldCountApprovalFile]] as const
  for (const path of heldCountFiles) {
    const before = base[path] == null ? null : heldCountIn(base[path])
    if (before === null) continue
    const after = head[path] == null ? null : heldCountIn(head[path])
    if (after === null)
      problems.push(
        `${path} holds no held-back count (heldPassingToday) any more, where its base holds ${before}. Keep the count in the suite.`,
      )
    else if (after < before && !approves(...approval, path, before, after))
      problems.push(
        `${path} lowers the held-back count from ${before} to ${after}. A merge may keep the count or raise it, never lower it: fix what the change breaks in the held-back cases' answers, without reading which of them fail.\n  If the owner approved this lowering, record it in ${heldCountApprovalFile} in the same change: {"suite": "${path}", "from": ${before}, "to": ${after}, "reason": "<one sentence>", "approvedBy": "<who>", "date": "<YYYY-MM-DD>"}.`,
      )
  }
  return problems
}

/** A file's text in `rev`, or null where it has none. */
export function fileAt(rev: string, path: string): string | null {
  const run = spawnSync('git', ['show', `${rev}:${path}`], { encoding: 'utf8' })
  return run.status === 0 ? run.stdout : null
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [base, head = 'HEAD'] = process.argv.slice(2)
  if (!base) {
    console.error('Usage: node scripts/check-held-count.ts <base> [<head>]')
    process.exitCode = 2
  } else {
    const at = (rev: string) =>
      Object.fromEntries(
        [...heldCountFiles, heldCountApprovalFile].map((path) => [path, fileAt(rev, path)]),
      )
    const problems = heldCountProblems(at(base), at(head))
    if (problems.length) {
      console.error(`The held-back count of this change is lower:\n- ${problems.join('\n- ')}`)
      process.exitCode = 1
    } else console.log('Held-back count: no suite lowers it without an approval.')
  }
}
