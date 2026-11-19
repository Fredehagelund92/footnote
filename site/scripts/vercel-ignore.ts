import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { repository } from '../lib/links.ts'
import { liveSiteUrl, releasesOf, shouldBuild, siteInputs, unseenReleases } from '../lib/vercel.ts'

/*
  Vercel's ignored build step (vercel.json): exit 1 to build, 0 to skip. It runs before the
  install, so it uses nothing but Node and git. A push builds when it changed what the site reads,
  or when a release came out that the live site has not looked at; anything that cannot be told
  builds (lib/vercel.ts).
*/

const env = process.env
const previous = env.VERCEL_GIT_PREVIOUS_SHA
const current = env.VERCEL_GIT_COMMIT_SHA
const repo =
  env.SITE_REPOSITORY ||
  (env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG
    ? `https://github.com/${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}.git`
    : `${repository}.git`)

let changed: boolean | undefined
if (previous && current) {
  try {
    execFileSync('git', ['diff', '--quiet', previous, current, '--', ...siteInputs], {
      cwd: resolve(import.meta.dirname, '../..'),
      stdio: 'ignore',
    })
    changed = false
  } catch (error) {
    // 1 is a difference; anything else (a commit the shallow clone lacks) cannot tell.
    changed = (error as { status?: number }).status === 1 ? true : undefined
  }
}

/** How many releases the live site has not looked at, or undefined when that cannot be read. */
async function unseen(): Promise<number | undefined> {
  const live = liveSiteUrl(env)
  if (!live) return undefined
  try {
    const tags = execFileSync('git', ['ls-remote', '--tags', repo], { encoding: 'utf8' })
    const response = await fetch(`${live}/docs/releases.json`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return undefined
    const seen = ((await response.json()) as { tags?: string[] }).tags ?? []
    return unseenReleases(releasesOf(tags), seen).length
  } catch {
    return undefined
  }
}

const build = shouldBuild({
  previous,
  current,
  changed,
  unseen: changed === false ? await unseen() : 0,
})
console.log(
  build
    ? 'The site builds: its first deployment here, a redeploy, a change it reads or a new release.'
    : `Nothing the site reads changed since ${previous}, and it has every release: no build.`,
)
process.exit(build ? 1 : 0)
