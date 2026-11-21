import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { sitePages, unlistedHelpPages, type SitePage } from '../lib/pages.ts'
import { checkPages } from '../lib/reader-ready.ts'
import { checkReviewed } from '../lib/reviewed.ts'
import { docsPath, readSettings, type Settings } from '../lib/settings.ts'

/*
  The last step of `npm run build`, over the landing page and the docs. On the pages as they were
  built: every link and every heading a link names goes somewhere, every file a page loads is in
  the build and none comes from another host, the page body holds no tag that came through as raw
  HTML, the landing page and the 404 page are there, and every page of the docs is there and in
  llms.txt, and is no island: its words link to another page, and another page's words link to it.
  On their Markdown: every published page is written for its readers
  (lib/reader-ready.ts), no help page was left off the list, and a page checked against the app
  more than 90 days ago is named, failing when it names what the app no longer has
  (lib/reviewed.ts).
*/

const htmlFiles = (folder: string): string[] =>
  readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) return htmlFiles(path)
    return entry.name.endsWith('.html') ? [path] : []
  })

const isExternal = (url: string) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)

/** The file an address opens, or undefined when nothing is there. */
function fileOf(dist: string, path: string): string | undefined {
  const file = join(dist, path)
  if (existsSync(file) && statSync(file).isFile()) return file
  const index = join(file, 'index.html')
  return existsSync(index) ? index : undefined
}

export function checkSite(
  dist: string,
  settings: Pick<Settings, 'root' | 'version'>,
  pages: readonly SitePage[],
): string[] {
  const problems: string[] = []
  const base = settings.root
  const docs = docsPath(settings).slice(base.length)
  /**
   * The file an address under the site opens. The landing page names a page of the docs without a
   * version, /docs/privacy/, which the published site forwards to the newest release
   * (scripts/collect.ts), so in a build with a version it is that version's page.
   */
  const opened = (path: string) =>
    fileOf(dist, path) ??
    (settings.version && path.startsWith('/docs/')
      ? fileOf(dist, `${docs}/${path.slice('/docs/'.length)}`)
      : undefined)
  const ids = new Map<string, Set<string>>()
  const idsOf = (file: string) => {
    if (!ids.has(file)) {
      const html = readFileSync(file, 'utf8')
      ids.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]!)))
    }
    return ids.get(file)!
  }

  for (const file of htmlFiles(dist)) {
    const page = relative(dist, file)
    const html = readFileSync(file, 'utf8')
    const links = [...html.matchAll(/<a\b[^>]*?\shref="([^"]*)"/g)].map((match) => match[1]!)
    for (const link of links) {
      if (isExternal(link)) continue
      const [address = '', hash] = link.split('#')
      let target: string | undefined = file
      if (address) {
        if (address !== base && !address.startsWith(`${base}/`)) {
          problems.push(`${page}: "${link}" is outside the site's path, ${base || '/'}`)
          continue
        }
        target = opened(decodeURI(address.slice(base.length).split('?')[0]!))
      }
      if (!target) problems.push(`${page}: "${link}" opens nothing`)
      else if (hash && !idsOf(target).has(decodeURIComponent(hash)))
        problems.push(`${page}: "${link}" names no heading there`)
    }
    const loads = html.matchAll(
      /<(?:script|img|iframe)\b[^>]*?\ssrc="([^"]+)"|<link\b(?=[^>]*\srel="(?:stylesheet|preload|icon)")[^>]*?\shref="([^"]+)"/g,
    )
    for (const load of loads) {
      const url = load[1] ?? load[2]!
      if (url.startsWith('data:')) continue
      if (isExternal(url)) problems.push(`${page}: loads ${url} from another host`)
      // A stylesheet or script the build no longer has: Astro's cache of rendered pages can name
      // one from an earlier build.
      else if (!url.startsWith(`${base}/`) || !fileOf(dist, decodeURI(url.slice(base.length))))
        problems.push(`${page}: loads ${url}, which the build does not have`)
    }
    const body = html.indexOf('sl-markdown-content')
    if (body !== -1 && /<title\b/.test(html.slice(body)))
      problems.push(
        `${page}: a <title> tag reached the page's body: a line of the page starts with it`,
      )
  }

  if (!fileOf(dist, '/')) problems.push('no landing page')
  if (!fileOf(dist, '/404.html')) problems.push('no 404 page')
  const index = join(dist, docs, 'llms.txt')
  const listed = existsSync(index) ? readFileSync(index, 'utf8') : ''
  if (!listed) problems.push('no llms.txt')
  if (!existsSync(join(dist, docs, 'llms-full.txt'))) problems.push('no llms-full.txt')
  if (!existsSync(join(dist, docs, 'pagefind/pagefind.js'))) problems.push('no search index')
  for (const { slug, title } of pages) {
    if (!fileOf(dist, `${docs}/${slug}`)) problems.push(`${slug}: the page was not built`)
    if (!listed.includes(`/${slug}/`)) problems.push(`${slug}: llms.txt does not list ${title}`)
  }
  return problems
}

/**
 * Every page of the docs that is an island: its own words, not the sidebar or the footer, link to
 * no other page, or no other page's words link to it. A reader who lands on it from search then
 * has nowhere to go but the sidebar.
 */
export function checkIslands(
  dist: string,
  settings: Pick<Settings, 'root' | 'version'>,
  pages: readonly SitePage[],
): string[] {
  const docs = docsPath(settings)
  const slugs = new Set(pages.map((page) => page.slug))
  const into = new Map(pages.map((page) => [page.slug, 0]))
  const out = new Map(pages.map((page) => [page.slug, 0]))
  for (const { slug } of pages) {
    const file = fileOf(dist, `${docs.slice(settings.root.length)}/${slug}`)
    if (!file) continue
    const html = readFileSync(file, 'utf8')
    const start = html.indexOf('sl-markdown-content')
    if (start === -1) continue
    const end = html.indexOf('<footer', start)
    const words = html.slice(start, end === -1 ? undefined : end)
    for (const [, href] of words.matchAll(/<a\b[^>]*?\shref="([^"#]*)/g)) {
      if (!href!.startsWith(`${docs}/`)) continue
      const target = href!.slice(docs.length + 1).replace(/\/$/, '')
      if (target === slug || !slugs.has(target)) continue
      out.set(slug, out.get(slug)! + 1)
      into.set(target, into.get(target)! + 1)
    }
  }
  return pages.flatMap(({ slug, title }) => [
    ...(out.get(slug) ? [] : [`${slug}: ${title} links to no other page of the docs`]),
    ...(into.get(slug) ? [] : [`${slug}: no other page of the docs links to ${title}`]),
  ])
}

if (import.meta.main) {
  const pages = sitePages()
  const review = checkReviewed(pages, new Date())
  // In CI each one shows on the run's summary and beside the page's file.
  for (const warning of review.warnings)
    console.warn(
      process.env.GITHUB_ACTIONS
        ? `::warning file=${warning.split(':')[0]}::${warning}`
        : `Due for a check: ${warning}`,
    )
  const problems = [
    ...checkPages(pages),
    ...review.problems,
    ...unlistedHelpPages().map((page) => `${page}: add it to publishedPages in lib/pages.ts`),
    ...checkSite('dist', readSettings(process.env), pages),
    ...checkIslands('dist', readSettings(process.env), pages),
  ]
  for (const problem of problems) console.error(problem)
  if (problems.length) {
    console.error(`The site has ${problems.length} problems.`)
    process.exit(1)
  }
  console.log(
    `The site: the landing page and ${pages.length} pages of docs, ready for readers, every link goes somewhere.`,
  )
}
