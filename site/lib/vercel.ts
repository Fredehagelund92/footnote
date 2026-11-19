/*
  The site on Vercel (site/README.md, "Publishing on Vercel"): where a deployment is served, which
  releases its docs are built from, and when a push needs no build. Pure, so the tests can reach
  every rule; scripts/vercel-build.ts and scripts/vercel-ignore.ts run them.
*/

type Env = Record<string, string | undefined>

/**
 * SITE_URL for a deployment: the setting when a maintainer set one, else the project's production
 * address on production and the deployment's own address on a preview. Vercel gives both without
 * the scheme. Outside Vercel nothing is set, and the site is served at the root of any host.
 */
export function vercelSiteUrl(env: Env): string {
  if (env.SITE_URL) return env.SITE_URL
  const host =
    env.VERCEL_ENV === 'production'
      ? env.VERCEL_PROJECT_PRODUCTION_URL
      : (env.VERCEL_BRANCH_URL ?? env.VERCEL_URL)
  return host ? `https://${host}` : ''
}

/**
 * Where the site of this branch is served now, to read what its last build held: the production
 * address, or a preview branch's own. Empty when there is none to ask.
 */
export function liveSiteUrl(env: Env): string {
  if (env.VERCEL_ENV === 'production') return vercelSiteUrl(env)
  return env.VERCEL_BRANCH_URL ? `https://${env.VERCEL_BRANCH_URL}` : ''
}

/** The reference repository links open at: main on production, the commit on a preview. */
export const vercelRef = (env: Env) =>
  env.VERCEL_ENV === 'production' ? 'main' : env.VERCEL_GIT_COMMIT_SHA || 'main'

export type Release = { tag: string; folder: string }

/**
 * The releases whose docs the site carries, from `git ls-remote --tags` output: the newest patch
 * of each minor, so /docs/0.1/ is always 0.1's last release. Newest first.
 */
export function releasesOf(lsRemote: string): Release[] {
  const newest = new Map<string, [number, number, number]>()
  for (const [, major, minor, patch] of lsRemote.matchAll(
    /\trefs\/tags\/v(\d+)\.(\d+)\.(\d+)$/gm,
  )) {
    const version: [number, number, number] = [Number(major), Number(minor), Number(patch)]
    const folder = `${version[0]}.${version[1]}`
    if ((newest.get(folder)?.[2] ?? -1) < version[2]) newest.set(folder, version)
  }
  return [...newest.values()]
    .sort((a, b) => b[0] - a[0] || b[1] - a[1])
    .map(([major, minor, patch]) => ({
      tag: `v${major}.${minor}.${patch}`,
      folder: `${major}.${minor}`,
    }))
}

/** What a change must touch for the site to need a build (from the repository's root). */
export const siteInputs = [
  'site',
  'docs',
  'src/domain/brand.ts',
  'src/domain/docs.ts',
  'src/web/public',
]

/** The releases a live site has not looked at yet, from the tags its build wrote down. */
export const unseenReleases = (releases: readonly Release[], seen: readonly string[]) =>
  releases.filter(({ tag }) => !seen.includes(tag))

/**
 * Whether a deployment builds. A branch's first deployment does, and so does a redeploy of the
 * commit already deployed. A push builds when it changed what the site reads, or when a release
 * came out that the live site has not looked at. Whatever cannot be told builds.
 */
export function shouldBuild({
  previous,
  current,
  changed,
  unseen,
}: {
  previous: string | undefined
  current: string | undefined
  /** Whether the site's inputs changed between the two, or undefined when git could not say. */
  changed: boolean | undefined
  /** How many releases the live site has not looked at, or undefined when it could not be read. */
  unseen: number | undefined
}): boolean {
  if (!previous || !current || previous === current) return true
  return changed !== false || unseen !== 0
}
