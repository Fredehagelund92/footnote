import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { repository } from '../site/lib/repository.ts'
import { appShouldBuild } from './vercel-release.ts'

/*
  Vercel's ignored build step for the demo (vercel.json): exit 1 to build, 0 to skip. It runs
  before the install, so it uses nothing but Node and git. Only a release builds
  (scripts/vercel-release.ts); release.yml asks for that build once the release exists.
*/

const env = process.env
const previous = env.VERCEL_GIT_PREVIOUS_SHA
const current = env.VERCEL_GIT_COMMIT_SHA
const repo =
  env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG
    ? `https://github.com/${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}.git`
    : `${repository}.git`
const root = new URL('../', import.meta.url)

const versionOf = (packageJson: string) => (JSON.parse(packageJson) as { version: string }).version
const version = versionOf(readFileSync(new URL('package.json', root), 'utf8'))
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

/** Whether the release tag of this version exists, or undefined when that cannot be read. */
function released(): boolean | undefined {
  try {
    return git('ls-remote', '--tags', repo, `refs/tags/v${version}`).trim() !== ''
  } catch {
    return undefined
  }
}

/** The version the deployment being replaced runs, fetched when the shallow clone lacks it. */
function previousVersion(): string | undefined {
  if (!previous) return undefined
  try {
    try {
      return versionOf(git('show', `${previous}:package.json`))
    } catch {
      git('fetch', '--depth=1', '--no-tags', repo, previous)
      return versionOf(git('show', `${previous}:package.json`))
    }
  } catch {
    return undefined
  }
}

const production = env.VERCEL_ENV === 'production'
const asked = production && previous && current && previous !== current
const isReleased = asked ? released() : undefined
const build = appShouldBuild({
  production,
  previous,
  current,
  version,
  released: isReleased,
  previousVersion: asked && isReleased ? previousVersion() : undefined,
})
console.log(
  build
    ? `The app builds ${version}: its first deployment, a redeploy or a new release.`
    : `The app builds only for a release, and ${current ?? 'this commit'} brings none: no build.`,
)
process.exit(build ? 1 : 0)
