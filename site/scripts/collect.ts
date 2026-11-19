import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, posix, relative } from 'node:path'

/*
  Puts the builds of the site together into the one folder that is published
  (scripts/vercel-build.ts): this commit's build, then each release's, and writes what sits above
  the versions:

  - the docs of each build go to docs/<version>/, and nothing else of a release's build is used,
    so a release's docs are what its own tag builds;
  - the landing page and the 404 page at the root come from the build of the commit (next), so the
    root follows main. A release brings them only while the root has none yet;
  - docs/versions.json lists the versions for the switcher, and docs/ forwards to the newest
    release, or to next until there is one. So does every page of the docs without a version,
    /docs/privacy/, which is how the landing page links to them, and docs/llms.txt is the newest
    release's own.

  node scripts/collect.ts <the published site> <the built site> <MAJOR.MINOR or next>
*/

const release = /^(\d+)\.(\d+)$/
const isVersion = (name: string) => name === 'next' || release.test(name)

/** Newest first, by number: 0.10 is newer than 0.9. */
function newestFirst(a: string, b: string) {
  const [, aMajor, aMinor] = release.exec(a)!
  const [, bMajor, bMinor] = release.exec(b)!
  return Number(bMajor) - Number(aMajor) || Number(bMinor) - Number(aMinor)
}

/** A page that opens another, written as an address relative to it, so any root works. */
const forward = (to: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Documentation</title>
    <meta name="robots" content="noindex" />
    <meta http-equiv="refresh" content="0; url=${to}" />
    <script>
      location.replace('${to}' + location.search + location.hash)
    </script>
  </head>
  <body>
    <a href="${to}">Open the documentation</a>
  </body>
</html>
`

const entries = (folder: string) =>
  existsSync(folder) ? readdirSync(folder, { withFileTypes: true }) : []

/** Every page of one version, as its path in the folder: `privacy`, `reference/agent-tools`. */
function pagesOf(folder: string, at = ''): string[] {
  return entries(join(folder, at)).flatMap((entry) => {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name === 'pagefind') return []
    const path = at ? `${at}/${entry.name}` : entry.name
    const here = existsSync(join(folder, path, 'index.html')) ? [path] : []
    return [...here, ...pagesOf(folder, path)]
  })
}

/** The root of the site, from one build: everything but its docs. */
function replaceRoot(site: string, built: string) {
  for (const entry of entries(site))
    if (entry.name !== 'docs') rmSync(join(site, entry.name), { recursive: true, force: true })
  for (const entry of entries(built))
    if (entry.name !== 'docs')
      cpSync(join(built, entry.name), join(site, entry.name), { recursive: true })
}

export function collect(site: string, built: string, folder: string) {
  if (!isVersion(folder))
    throw new Error(`"${folder}" is no version folder: write MAJOR.MINOR or next.`)
  const docs = join(site, 'docs')
  const target = join(docs, folder)
  rmSync(target, { recursive: true, force: true })
  mkdirSync(docs, { recursive: true })
  cpSync(join(built, 'docs', folder), target, { recursive: true })
  if (folder === 'next' || !existsSync(join(site, 'index.html'))) replaceRoot(site, built)

  const folders = entries(docs)
    .filter((entry) => entry.isDirectory() && isVersion(entry.name))
    .map((entry) => entry.name)
  const releases = folders.filter((name) => release.test(name)).sort(newestFirst)
  const latest = releases[0] ?? 'next'
  const versions = [...releases, ...(folders.includes('next') ? ['next'] : [])]

  // What docs/ held for the newest release before goes, then is written again for this one.
  for (const entry of entries(docs))
    if (!isVersion(entry.name)) rmSync(join(docs, entry.name), { recursive: true, force: true })
  writeFileSync(join(docs, 'versions.json'), `${JSON.stringify({ latest, versions }, null, 2)}\n`)
  writeFileSync(join(docs, 'index.html'), forward(`${latest}/`))
  // The pages of main that the newest release lacks still open, from the next folder.
  const forwarded = new Map<string, string>()
  if (folders.includes('next'))
    for (const page of pagesOf(join(docs, 'next'))) forwarded.set(page, 'next')
  for (const page of pagesOf(join(docs, latest))) forwarded.set(page, latest)
  for (const [page, version] of forwarded) {
    if (isVersion(page.split('/')[0]!)) continue
    const from = join(docs, page)
    mkdirSync(from, { recursive: true })
    const to = posix.join(relative(from, join(docs, version)).split('\\').join('/'), page)
    writeFileSync(join(from, 'index.html'), forward(`${to}/`))
  }
  for (const file of ['llms.txt', 'llms-full.txt'])
    if (existsSync(join(docs, latest, file))) cpSync(join(docs, latest, file), join(docs, file))
}

if (import.meta.main) {
  const [site, built, folder] = process.argv.slice(2)
  if (!site || !built || !folder) throw new Error('collect <site> <built> <folder>')
  collect(site, built, folder)
}
