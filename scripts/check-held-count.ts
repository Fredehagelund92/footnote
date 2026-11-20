import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/*
  The held-back count of Ask's evaluation harness only rises (docs/evaluations.md, "Ask's
  evaluation harness"): `node scripts/check-held-count.ts <base> [<head>]`, run on every pull
  request (.github/workflows/ci.yml, "Held-back count"). Each answerer's suite holds the number of
  held-back cases that pass every try in every build (`heldPassingToday`), and the build fails
  when the number is not what the run gives. This fails a change that writes a lower number than
  its base: a merge may keep the count or raise it, never lower it. CI runs the base branch's copy
  of this script, so a pull request cannot loosen the guard that judges it. It needs only git and
  node: no install.
*/

/** The suites that hold a held-back count: Ask's loop's. */
export const heldCountFiles = ['tests/web/integration/ask-eval-loop.test.ts']

/** The held-back count a suite's text holds, or null where it holds none. */
export function heldCountIn(text: string): number | null {
  const found = [...text.matchAll(/^\s*heldPassingToday:\s*(\d+),?\s*$/gm)]
  return found.length === 1 ? Number(found[0]![1]) : null
}

/** Every suite whose count the change lowers or loses, in words; none when it passes. */
export function heldCountProblems(
  base: Readonly<Record<string, string | null>>,
  head: Readonly<Record<string, string | null>>,
): string[] {
  const problems: string[] = []
  for (const path of heldCountFiles) {
    const before = base[path] == null ? null : heldCountIn(base[path])
    if (before === null) continue
    const after = head[path] == null ? null : heldCountIn(head[path])
    if (after === null)
      problems.push(
        `${path} holds no held-back count (heldPassingToday) any more, where its base holds ${before}. Keep the count in the suite.`,
      )
    else if (after < before)
      problems.push(
        `${path} lowers the held-back count from ${before} to ${after}. A merge may keep the count or raise it, never lower it: fix what the change breaks in the held-back cases' answers, without reading which of them fail.`,
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
      Object.fromEntries(heldCountFiles.map((path) => [path, fileAt(rev, path)]))
    const problems = heldCountProblems(at(base), at(head))
    if (problems.length) {
      console.error(`The held-back count of this change is lower:\n- ${problems.join('\n- ')}`)
      process.exitCode = 1
    } else console.log('Held-back count: no suite lowers it.')
  }
}
