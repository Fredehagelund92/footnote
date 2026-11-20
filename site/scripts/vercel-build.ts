import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { repository } from '../lib/repository.ts'
import { releasesOf, vercelRef, vercelSiteUrl } from '../lib/vercel.ts'
import { collect } from './collect.ts'

/*
  The build Vercel runs (vercel.json, site/README.md "Publishing on Vercel"). First this commit:
  the landing page, and its docs as /docs/next/, which say they follow main only once a release
  has docs of its own. Then the docs of each release, the newest patch
  of each minor, built again from its own tag with that tag's sources and lockfile, so a release's
  docs stay as they were at its tag while every folder takes this deployment's address. A tag from
  before the site (it has no site/) adds nothing. scripts/collect.ts puts the builds together, and
  site/dist is what Vercel serves. docs/releases.json names every release tag the build looked at,
  so the ignored build step can tell when a new one came out (scripts/vercel-ignore.ts).
*/

const site = resolve(import.meta.dirname, '..')
const env = process.env
const siteUrl = vercelSiteUrl(env)
const repo =
  env.SITE_REPOSITORY ||
  (env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG
    ? `https://github.com/${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}.git`
    : `${repository}.git`)

const run = (command: string, args: string[], cwd: string, extra: Record<string, string> = {}) =>
  execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...env, ...extra } })
const output = (command: string, args: string[], cwd: string) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })

const scratch = mkdtempSync(join(tmpdir(), 'footnote-site-'))
const assembled = join(scratch, 'site')
console.log(`The site at ${siteUrl || 'the root of any host'}, its releases from ${repo}.`)

const releases = releasesOf(output('git', ['ls-remote', '--tags', repo], site))
// Each release's own sources, from its tag. A tag from before the site has no docs here.
const withDocs = releases.flatMap(({ tag, folder }) => {
  const source = join(scratch, tag)
  mkdirSync(source)
  run('git', ['init', '--quiet'], source)
  run('git', ['fetch', '--quiet', '--depth=1', repo, `refs/tags/${tag}`], source)
  try {
    output('git', ['cat-file', '-e', 'FETCH_HEAD:site/package.json'], source)
  } catch {
    console.log(`${tag} is from before the site, so it has no docs here.`)
    return []
  }
  run('git', ['archive', '--output=release.tar', 'FETCH_HEAD'], source)
  run('tar', ['-xf', 'release.tar'], source)
  return [{ tag, folder, source }]
})

// The commit's docs say they follow main only once a release's docs sit beside them.
run('npm', ['run', 'build'], site, {
  SITE_URL: siteUrl,
  DOCS_VERSION: 'next',
  DOCS_REF: vercelRef(env),
  DOCS_RELEASES: withDocs.map(({ folder }) => folder).join(','),
})
collect(assembled, join(site, 'dist'), 'next')

for (const { tag, folder, source } of withDocs) {
  console.log(`The docs of ${tag}, as /docs/${folder}/.`)
  run('npm', ['ci'], join(source, 'site'))
  run('npm', ['run', 'build'], join(source, 'site'), {
    SITE_URL: siteUrl,
    DOCS_VERSION: folder,
    DOCS_REF: tag,
  })
  collect(assembled, join(source, 'site/dist'), folder)
}

writeFileSync(
  join(assembled, 'docs/releases.json'),
  `${JSON.stringify({ tags: releases.map(({ tag }) => tag) }, null, 2)}\n`,
)
rmSync(join(site, 'dist'), { recursive: true, force: true })
cpSync(assembled, join(site, 'dist'), { recursive: true })
rmSync(scratch, { recursive: true, force: true })
