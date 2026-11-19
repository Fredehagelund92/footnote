import { readFileSync } from 'node:fs'

/*
  A pull request that changes what people see or set also changes the docs, or says why not
  (.github/workflows/docs-touched.yml, docs/development.md "The docs follow the change"). The docs
  are published per release, so a change that skips them leaves that release's docs wrong.

  The check is simple on purpose and says what it cannot know:
  - what people see is what reaches the release notes: a title that starts feat, fix or perf, or
    any title with a !, or a description with a BREAKING CHANGE: or BREAKING-CHANGE: line, as
    release-please reads them (docs/releasing.md);
  - what people set is a settings file: .env.example or the service's settings in
    src/server/config;
  - the docs changed when a file under docs/ did;
  - otherwise the description holds a line `No docs change: ` and the reason.

    gh api --paginate repos/<owner>/<repo>/pulls/<n>/files --jq '.[].filename' \
      | TITLE=<title> BODY=<description> node scripts/check-docs-touched.ts
*/

export type PullRequest = { title: string; body: string; paths: readonly string[] }

const reachesReleaseNotes = /^(?:(?:feat|fix|perf)(?:\([^)]*\))?!?|[a-z]+(?:\([^)]*\))?!):/
const breaking = /^BREAKING[ -]CHANGE:/m
const isSetting = (path: string) => path === '.env.example' || path.startsWith('src/server/config/')
const reason = /^\s*No docs change:\s*\S.{4,}$/im

/** Why the pull request needs the docs, or undefined when it does not. */
export function docsNeededFor({ title, body, paths }: PullRequest): string | undefined {
  if (reachesReleaseNotes.test(title.trim()))
    return 'its title puts it in the release notes, so people will notice it'
  if (breaking.test(body))
    return 'its description has a breaking change footer, which puts it in the release notes'
  const settings = paths.filter(isSetting)
  if (settings.length) return `it changes a setting (${settings.join(', ')})`
  return undefined
}

/** What is wrong with the pull request, or an empty list. */
export function docsTouchedProblems(pr: PullRequest): string[] {
  const needed = docsNeededFor(pr)
  if (!needed || pr.paths.some((path) => path.startsWith('docs/')) || reason.test(pr.body))
    return []
  return [
    `This pull request needs the docs: ${needed}, and nothing under docs/ changed.`,
    'Change the page it affects, or add a line to the description that says why not, such as:',
    '  No docs change: the error message was already the one the docs show.',
  ]
}

if (import.meta.main) {
  const paths = readFileSync(0, 'utf8').split('\n').filter(Boolean)
  const problems = docsTouchedProblems({
    title: process.env.TITLE ?? '',
    body: process.env.BODY ?? '',
    paths,
  })
  for (const problem of problems) console.error(problem)
  if (problems.length) process.exit(1)
  console.log(
    docsNeededFor({ title: process.env.TITLE ?? '', body: process.env.BODY ?? '', paths })
      ? 'The docs follow the change, or the description says why they need not.'
      : 'Nothing in this change needs the docs.',
  )
}
