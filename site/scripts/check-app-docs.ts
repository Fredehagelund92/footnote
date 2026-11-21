import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { repoRoot, sitePages, type SitePage } from '../lib/pages.ts'

/*
  The app's Docs area and these docs say the same (site/README.md, "The app's Docs area"). Both are
  built from docs/help at build time, never from a copy, by two different renderers, so this reads
  what each one built and compares them page by page: the app's as `npm run docs:build` draws it in
  dist/docs, with the components the app's Docs area draws, and the site's as `npm run build` draws
  it at the root of a host. It fails when a page is in one and not the other, or when the two
  differ in a page's title, headings, words, pictures or links to other pages, when a picture's
  file is missing from either, or when a link of the app's goes nowhere (scripts/check-site.ts
  checks the site's own).

  The app's own lists (docs/help/README.md, "Includes") are left out of the words: the app draws
  each from its source and the site draws the Markdown the docs check holds to it, so they read
  differently by design. Both mark them with `data-include`.
*/

/** One build of the docs: its folder, the path it is served under and each page's file. */
export type DocsBuild = {
  dist: string
  base: string
  /** The file of a page, by its slug. */
  fileOf: (slug: string) => string
}

/** What a page says, as the check compares it. */
export type PageWords = {
  title: string
  headings: string[]
  text: string
  /** Each picture's words, then its file's name without the build's hash, or `inline`. */
  pictures: string[]
  /** Each link: to a page of the docs as `slug#heading`, any other as its address. */
  links: string[]
  /** The name of each of the app's own lists the page draws, in order. */
  includes: string[]
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#')
      return String.fromCodePoint(
        code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1)),
      )
    return entities[code] ?? whole
  })
}

/**
 * Where the element whose opening tag starts at `start` ends. Both renderers write well-formed
 * HTML, so counting the tags of its name is enough.
 */
function endOf(html: string, start: number): number {
  const name = /^<([a-z0-9]+)/i.exec(html.slice(start))![1]!
  const tags = new RegExp(`<(/?)${name}\\b[^>]*>`, 'gi')
  tags.lastIndex = start
  let depth = 0
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += tag[1] ? -1 : 1
    if (depth === 0) return tags.lastIndex
  }
  throw new Error(`<${name}> at ${start} is not closed`)
}

/** The element whose opening tag matches, as HTML; undefined when there is none. */
function element(html: string, opening: RegExp): string | undefined {
  const at = html.search(opening)
  return at === -1 ? undefined : html.slice(at, endOf(html, at))
}

/** The HTML without every element whose opening tag matches. */
function without(html: string, opening: RegExp): string {
  for (let at = html.search(opening); at !== -1; at = html.search(opening))
    html = html.slice(0, at) + html.slice(endOf(html, at))
  return html
}

const block =
  /^(?:p|div|li|ul|ol|h[1-6]|table|thead|tbody|tr|td|th|figure|figcaption|aside|pre|br|dl|dt|dd|section|blockquote|img)$/i

/** The text after each rule is applied again and again until it no longer changes it. */
function stripped(text: string, rules: [RegExp, (name: string) => string][]): string {
  for (const [pattern, replacement] of rules) {
    for (let before = ''; before !== text;) {
      before = text
      text = text.replace(pattern, (_, name: string) => replacement(name))
    }
  }
  return text
}

/**
 * The words a reader reads, the same however each renderer sets them: no tags, comments, scripts or
 * buttons, and the typographer's quotes and dashes the site sets as the plain ones the pages write.
 */
export function wordsOf(html: string): string {
  return decode(
    stripped(html, [
      [/<!--[\s\S]*?-->/g, () => ''],
      [/<(script|style|button)\b[\s\S]*?<\/\1>/gi, () => ''],
      [/<\/?([a-z0-9-]+)\b[^>]*>/gi, (name) => (block.test(name) ? ' ' : '')],
    ]),
  )
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .replace(/ ([.,:;!?)])/g, '$1')
    .replace(/\( /g, '(')
    .trim()
}

const attribute = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]

/** The hash a build adds to a picture's file, at the end of its name: the app's and the site's. */
const appHash = /-[\w-]{8}(\.\w+)$/
const siteHash = /\.[\w-]{8}_[\w-]+(\.\w+)$/

/** A picture's file name as the page names it: `agents-light`, without the hash a build adds. */
const pictureName = (src: string, hash: RegExp) =>
  src.startsWith('data:') ? 'inline' : src.split('/').at(-1)!.replace(hash, '$1')

function pageWords(
  slug: string,
  title: string,
  body: string,
  base: string,
  hashed: RegExp,
): PageWords {
  const shown = without(body, /<[a-z]+\b[^>]*\sdata-include="/i)
  return {
    title: wordsOf(title),
    headings: [...shown.matchAll(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map(
      ([tag, depth, words]) => `h${depth}#${attribute(tag, 'id') ?? ''} ${wordsOf(words!)}`,
    ),
    text: wordsOf(shown),
    pictures: [...shown.matchAll(/<img\b[^>]*>/gi)].map(
      ([tag]) =>
        `${decode(attribute(tag, 'alt') ?? '')} ${pictureName(attribute(tag, 'src')!, hashed)}`,
    ),
    links: [...shown.matchAll(/<a\b[^>]*\shref="([^"]*)"/gi)].flatMap(([, href]) => {
      // A link to a heading of the same page, which the site writes as the heading alone.
      if (href!.startsWith('#')) return [`${slug}${href}`]
      if (!href!.startsWith(`${base}/`) && href !== base) return [href!]
      const [path = '', hash = ''] = href!.slice(base.length).split('#')
      return [`${path.replace(/^\/|\/$/g, '')}#${hash}`]
    }),
    includes: [...body.matchAll(/<[a-z]+\b[^>]*\sdata-include="([^"]*)"/gi)].map(
      ([, name]) => name!,
    ),
  }
}

/** A page of the app's docs, as dist/docs has it: drawn by the components of the app's Docs area. */
export function appPageWords(slug: string, html: string, base: string): PageWords | undefined {
  // A guide's lead is the first paragraph of its page on the site. What's new has none.
  const lead = element(html, /<p\b[^>]*\sdata-docs="lead"/) ?? ''
  const body = element(html, /<[a-z]+\b[^>]*\sdata-docs="body"/)
  const title = /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]
  if (!body || title === undefined) return undefined
  // The numbers of a numbered list's steps, which the site's list draws itself, and What's new's
  // days, which the app writes as words and the page as a date.
  const page = `${lead}${body}`
    .replace(/(<li\b[^>]*>\s*)<span\b[^>]*>\d+<\/span>/g, '$1')
    .replace(/<time\b[\s\S]*?<\/time>/g, '')
  return pageWords(slug, title, page, base, appHash)
}

/** A page of these docs, as `npm run build` draws it. */
export function sitePageWords(slug: string, html: string, base: string): PageWords | undefined {
  const content = element(html, /<div\b[^>]*\sclass="sl-markdown-content\b/)
  const title = /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]
  if (!content || title === undefined) return undefined
  // A change's day on What's new, a paragraph of its own.
  return pageWords(slug, title, content.replace(/<p>\d{4}-\d{2}-\d{2}<\/p>/g, ''), base, siteHash)
}

/** Where two texts part, with a little of each around it. */
function firstDifference(app: string, site: string): string {
  let at = 0
  while (at < app.length && app[at] === site[at]) at++
  const from = Math.max(0, at - 40)
  return `the app has "${app.slice(from, at + 40)}", the site "${site.slice(from, at + 40)}"`
}

function compareLists(slug: string, what: string, app: string[], site: string[]): string[] {
  const only = (a: string[], b: string[]) => a.filter((x) => !b.includes(x))
  if (app.join('\n') === site.join('\n')) return []
  const inApp = only(app, site)
  const inSite = only(site, app)
  if (!inApp.length && !inSite.length) return [`${slug}: its ${what} are in another order`]
  return [
    ...inApp.map(
      (x) => `${slug}: the app's Docs area has ${what.replace(/s$/, '')} "${x}", the site not`,
    ),
    ...inSite.map(
      (x) => `${slug}: the site has ${what.replace(/s$/, '')} "${x}", the app's Docs area not`,
    ),
  ]
}

/** The pages the app's docs have, by their slug: the ones their llms.txt lists. */
export function appSlugs(app: DocsBuild): string[] {
  const index = join(app.dist, 'llms.txt')
  if (!existsSync(index)) return []
  const links = readFileSync(index, 'utf8').matchAll(/\]\(([^)\s]+)\)/g)
  return [...links]
    .map(([, href]) => href!)
    .filter((href) => href.startsWith(`${app.base}/`))
    .map((href) => href.slice(app.base.length + 1).replace(/\/$/, ''))
    .filter((slug) => slug && !slug.includes('.'))
}

/** Every file a page loads from its own build that the build does not have. */
function missingFiles(build: DocsBuild, slug: string, html: string, who: string): string[] {
  return [...html.matchAll(/<img\b[^>]*\ssrc="([^"]+)"/gi)].flatMap(([, src]) => {
    if (src!.startsWith('data:') || !src!.startsWith(`${build.base}/`)) return []
    const file = join(build.dist, decodeURI(src!.slice(build.base.length).split('?')[0]!))
    return existsSync(file) ? [] : [`${slug}: ${who} shows ${src}, which its build does not have`]
  })
}

/** Every link of the app's docs to one of their pages, or to a heading there, that goes nowhere. */
function brokenLinks(app: DocsBuild, slug: string, words: PageWords, slugs: string[]): string[] {
  return words.links.flatMap((link) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(link)) return []
    const [target = '', hash] = link.split('#')
    if (!target) return []
    if (!slugs.includes(target))
      return [`${slug}: the app's Docs area links to ${target}, which it does not have`]
    if (!hash) return []
    const html = readFileSync(app.fileOf(target), 'utf8')
    return html.includes(` id="${hash}"`)
      ? []
      : [`${slug}: the app's Docs area links to ${link}, a heading ${target} does not have`]
  })
}

/** Every way the app's docs and the site's differ, as one line each; empty when they agree. */
export function checkAppDocs(
  app: DocsBuild,
  site: DocsBuild,
  pages: readonly SitePage[],
): string[] {
  const inApp = appSlugs(app)
  if (!inApp.length) return [`${app.dist} has no docs: run npm run docs:build in the repository`]
  // The app's Docs area carries the help pages, What's new among them; the site carries more.
  const inSite = pages.filter((page) => page.file.startsWith('docs/help/')).map((p) => p.slug)
  const problems = [
    ...inApp
      .filter((slug) => !inSite.includes(slug))
      .map((slug) => `${slug}: the app's Docs area has this page, the site not`),
    ...inSite
      .filter((slug) => !inApp.includes(slug))
      .map((slug) => `${slug}: the site has this page, the app's Docs area not`),
  ]
  for (const slug of inApp.filter((s) => inSite.includes(s))) {
    const [appFile, siteFile] = [app.fileOf(slug), site.fileOf(slug)]
    if (!existsSync(appFile)) problems.push(`${slug}: the app's docs build has no ${appFile}`)
    if (!existsSync(siteFile)) problems.push(`${slug}: the site's build has no ${siteFile}`)
    if (!existsSync(appFile) || !existsSync(siteFile)) continue
    const appHtml = readFileSync(appFile, 'utf8')
    const siteHtml = readFileSync(siteFile, 'utf8')
    const a = appPageWords(slug, appHtml, app.base)
    const s = sitePageWords(slug, siteHtml, site.base)
    if (!a) problems.push(`${slug}: the app's page has no title or body to compare`)
    if (!s) problems.push(`${slug}: the site's page has no title or content to compare`)
    if (!a || !s) continue
    if (a.title !== s.title)
      problems.push(`${slug}: the app's Docs area calls it "${a.title}", the site "${s.title}"`)
    problems.push(
      ...compareLists(slug, 'headings', a.headings, s.headings),
      ...compareLists(slug, 'pictures', a.pictures, s.pictures),
      ...compareLists(slug, 'links', a.links, s.links),
      ...compareLists(slug, 'includes', a.includes, s.includes),
      ...(a.text === s.text
        ? []
        : [`${slug}: the words differ: ${firstDifference(a.text, s.text)}`]),
      ...missingFiles(app, slug, appHtml, "the app's Docs area"),
      ...missingFiles(site, slug, siteHtml, 'the site'),
      ...brokenLinks(app, slug, a, inApp),
    )
  }
  return problems
}

if (import.meta.main) {
  // The app's docs as `npm run docs:build` writes them, and the site as `npm run build` writes it
  // with no settings: both at /docs.
  const appDist = resolve(repoRoot, 'dist/docs')
  const app: DocsBuild = {
    dist: appDist,
    base: '/docs',
    fileOf: (slug) => join(appDist, `${slug}.html`),
  }
  const siteDist = join(repoRoot, 'site/dist/docs')
  const site: DocsBuild = {
    dist: siteDist,
    base: '/docs',
    fileOf: (slug) => join(siteDist, slug, 'index.html'),
  }
  const pages = sitePages()
  const problems = checkAppDocs(app, site, pages)
  for (const problem of problems) console.error(problem)
  if (problems.length) {
    console.error(`The app's Docs area and the site differ in ${problems.length} ways.`)
    process.exit(1)
  }
  const count = appSlugs(app).length
  console.log(`The app's Docs area and the site: the same ${count} pages, word for word.`)
}
