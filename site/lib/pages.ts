import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'

/*
  Which of the repository's Markdown files are pages of the site, and where they sit in its
  sidebar. Nothing moves on disk: a page stays in docs/, and its front matter says its place.

  The site publishes only what is written for its readers. A page outside this list stays in the
  repository: it is out of the sidebar, the search, llms.txt and the sitemap, and a published page
  that links to it opens it on GitHub. A page joins the list once it passes the reader check
  (lib/reader-ready.ts).
*/

/** The folder `npm run build` runs in is site, whichever way it is started. */
export const repoRoot = resolve(process.cwd(), '..')

/** The sidebar's groups, in order: docs/help's, then the operators' and integrators' pages. */
export const siteGroups = [
  'Start',
  'Ask',
  'Write and review',
  'Set up',
  'How it works',
  'Run the service',
  'Connectors',
  'Reference',
] as const
export type SiteGroup = (typeof siteGroups)[number]

/** The published pages, by their path under docs/. */
export const publishedPages = [
  'try-the-demo',
  'help/set-up-your-workspace',
  'help/connect-an-agent',
  'help/words',
  'help/ask-a-question',
  'help/answer-lines',
  'help/privacy',
  'help/write-context',
  'help/review-a-suggestion',
  'help/keep-context-up-to-date',
  'help/when-nothing-is-written-yet',
  'help/decide-a-conflict',
  'help/definitions-and-synonyms',
  'help/publish-without-review',
  'help/domains-and-owners',
  'help/integrations',
  'help/see-what-agents-asked',
  'help/how-agents-use-it',
  'help/tools',
  'reference/connect-by-hand',
  'reference/http-api',
  'where-to-run',
  'use-your-own-data',
  'run-in-production',
  'company-sign-in',
  'agent-sign-in-settings',
  'model-providers',
  'back-up-restore-and-upgrade',
  'watch-the-service',
  'configuration',
  'administration',
  'security',
  'vercel',
  'connectors',
  'connectors/cube',
  'connectors/cube-cloud',
  'connectors/dbt-metricflow',
  'connectors/static-list',
  'connectors/documents',
  'connectors/security',
  'connectors/authoring',
  'help/changelog',
]

/**
 * The pages that moved, by the address they had: the old address forwards to the new one. Get
 * started's place is Try the demo's, the first page a newcomer reads. In the app, which has no
 * Try the demo, it opens Set up your workspace (src/domain/docs.ts). The MCP and API reference,
 * an index of the Reference pages, and The agent tools in detail are now Agent tools. Self-host,
 * Run and operate and Sign in your own agent were split into the pages their sections went to.
 */
export const movedPages: Readonly<Record<string, string>> = {
  'get-started': 'try-the-demo',
  'settle-a-conflict': 'decide-a-conflict',
  reference: 'tools',
  'reference/agent-tools': 'tools',
  'self-hosting': 'try-the-demo',
  operations: 'run-in-production',
  'ai-sign-in': 'agent-sign-in-settings',
}

/**
 * Where the sections of a page that was split went, by its old address and each heading's id, as
 * `page#heading`. A link to one of them opens that heading where it is now; any other link to the
 * old address opens the page `movedPages` names.
 */
export const movedSections: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'self-hosting': {
    install: 'try-the-demo#install-and-start-it',
    'the-demo': 'try-the-demo#look-around',
    'connect-claude-code-to-the-demo': 'try-the-demo#connect-claude-code',
    'from-the-published-images': 'try-the-demo#from-the-published-images',
    'use-your-own-data': 'use-your-own-data',
    'ask-on-a-real-model': 'model-providers#start-on-a-real-model',
    'what-runs': 'try-the-demo#what-runs',
    'if-the-start-goes-wrong': 'try-the-demo#if-the-start-goes-wrong',
    'what-to-back-up': 'back-up-restore-and-upgrade#what-to-back-up',
    'back-up': 'back-up-restore-and-upgrade#back-up',
    'prove-the-backup-restores-the-restore-drill': 'back-up-restore-and-upgrade#the-restore-drill',
    restore: 'back-up-restore-and-upgrade#restore',
    upgrade: 'back-up-restore-and-upgrade#upgrade',
    'roll-back': 'back-up-restore-and-upgrade#roll-back',
    'running-from-source-instead': 'back-up-restore-and-upgrade#elsewhere',
    'the-web-image': 'run-in-production#the-web-image',
  },
  operations: {
    'run-the-service-locally': 'back-up-restore-and-upgrade#elsewhere',
    'check-that-it-runs': 'watch-the-service#check-that-it-runs',
    'run-the-image-in-production-mode': 'run-in-production#run-the-image-in-production-mode',
    'request-limits': 'watch-the-service#request-limits',
    'scheduled-jobs': 'watch-the-service#scheduled-jobs',
    metrics: 'watch-the-service#metrics',
  },
  'ai-sign-in': {
    'connect-your-agent': 'reference/connect-by-hand#sign-in-as-yourself',
    'what-a-sign-in-lasts': 'agent-sign-in-settings#what-a-sign-in-lasts',
    'see-and-end-connections': 'connect-an-agent#the-tools-each-agent-may-call',
    'what-the-agent-can-do': 'reference/connect-by-hand#sign-in-as-yourself',
    'the-login-server-settings': 'agent-sign-in-settings#the-login-server-settings',
    'make-the-keys': 'agent-sign-in-settings#make-the-keys',
    'rotate-the-signing-key': 'agent-sign-in-settings#rotate-the-signing-key',
    'known-limits': 'agent-sign-in-settings#known-limits',
  },
}

/** The files of the site for the content loader, as paths under docs/. */
export const pagePatterns = publishedPages.map((page) => `${page}.md`)

/** A file under docs/ to its address under the site: help/privacy.md is privacy. */
export const slugOf = (entry: string) => entry.replace(/^help\//, '').replace(/\.md$/, '')

export type SitePage = {
  slug: string
  /** Its path in the repository, `docs/help/privacy.md`. */
  file: string
  title: string
  line: string
  group?: SiteGroup
  order: number
}

function readPage(root: string, entry: string): SitePage {
  const file = join('docs', entry)
  const front = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(join(root, file), 'utf8'))
  if (!front) throw new Error(`${file} has no front matter`)
  const { title, line, group, order } = parse(front[1]!) as Omit<SitePage, 'slug' | 'file'>
  return { slug: slugOf(entry), file, title, line, group, order: order ?? 0 }
}

/** Every help page that is not on the list, so that a new one is never left out by accident. */
export function unlistedHelpPages(root = repoRoot): string[] {
  return readdirSync(join(root, 'docs/help'))
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .map((name) => `help/${name.replace(/\.md$/, '')}`)
    .filter((page) => !publishedPages.includes(page))
}

/** Every page of the site: by group and order, and What's new, which has no group, last. */
export function sitePages(root = repoRoot): SitePage[] {
  const place = (page: SitePage) => {
    const at = page.group ? siteGroups.indexOf(page.group) : siteGroups.length
    if (at === -1) throw new Error(`${page.file}: no group "${page.group}"`)
    return at
  }
  return pagePatterns
    .map((entry) => readPage(root, entry))
    .sort((a, b) => place(a) - place(b) || a.order - b.order)
}

/** The groups that have a published page, in order. */
export const shownGroups = (pages: readonly SitePage[]) =>
  siteGroups.filter((group) => pages.some((page) => page.group === group))

/** Starlight's sidebar, from each page's front matter. */
export function sidebar(pages: readonly SitePage[]) {
  return [
    ...shownGroups(pages).map((label) => ({
      label,
      items: pages.filter((page) => page.group === label).map(({ slug }) => ({ slug })),
    })),
    ...pages.filter((page) => !page.group).map(({ slug }) => ({ slug })),
  ]
}
