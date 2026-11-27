/*
  When the demo on Vercel builds (vercel.json, docs/vercel.md): only for a release. Pure, so the
  tests can reach every rule; scripts/vercel-ignore.ts runs it. No imports: the ignored build step
  runs before the install.
*/

/**
 * Whether a deployment of the app builds. As for the site (site/lib/vercel.ts), a redeploy of the
 * commit already deployed builds, and so does production's first deployment. Past that, only
 * production builds, and only a commit whose version has its release tag while the deployment it
 * replaces runs an older one: release.yml asks for that build once the release exists. Every other
 * push and every pull request builds nothing. On production, whatever cannot be told builds.
 */
export function appShouldBuild({
  production,
  previous,
  current,
  version,
  released,
  previousVersion,
}: {
  production: boolean
  previous: string | undefined
  current: string | undefined
  /** The version in the commit's package.json. */
  version: string
  /** Whether the tag v<version> exists, or undefined when git could not say. */
  released: boolean | undefined
  /** The version in package.json at the commit deployed now, or undefined when git could not say. */
  previousVersion: string | undefined
}): boolean {
  if (previous && previous === current) return true
  if (!production) return false
  if (!previous || !current) return true
  if (released === false) return false
  return released === undefined || previousVersion !== version
}
