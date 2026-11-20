import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHANGELOG, llmsFullTxt, llmsTxt, pageMarkdown } from '../../src/domain/docs.ts'
import { linkContext, withResolvedLinks } from './links.ts'
import { repoRoot, shownGroups, sitePages } from './pages.ts'
import { docsPath, type Settings } from './settings.ts'

/*
  llms.txt and llms-full.txt, from the functions that write the app's, over every page of the
  site. Each version has its own, so an agent reads the pages of the version it was pointed at.
  Each page's own Markdown, which its Copy as Markdown button copies, is the same as there.
*/

/** Every page's Markdown, with its links where the site opens them. */
function siteFiles(settings: Settings) {
  const pages = sitePages()
  const base = `${settings.site}${docsPath(settings)}`
  const context = linkContext(pages, base, settings.ref)
  const files = pages.map(({ slug, file }) => ({
    slug,
    source: withResolvedLinks(readFileSync(join(repoRoot, file), 'utf8'), file, context),
  }))
  return { pages, base, files }
}

let read: { key: string; site: ReturnType<typeof siteFiles> } | undefined

/** A page of the site as Markdown, as llms-full.txt gives it; undefined for no page. */
export function sitePageMarkdown(settings: Settings, slug: string): string | undefined {
  // Read once a build, not once a page.
  const key = JSON.stringify(settings)
  if (read?.key !== key) read = { key, site: siteFiles(settings) }
  const { pages, base, files } = read.site
  const page = pages.find((p) => p.slug === slug)
  return page && pageMarkdown(page, files, base)
}

export function llmsFiles(settings: Settings) {
  const { pages, base, files } = siteFiles(settings)
  const changelog = pages.find((page) => page.slug === CHANGELOG)!
  const index = { pages: pages.filter((page) => page.group), changelog }
  return {
    index: llmsTxt(index, base, {
      summary:
        'Guides for writing context, connecting agents and reviewing suggestions, and for running the service.',
      groups: shownGroups(pages),
      path: (at, slug) => `${at}/${slug}/`,
    }),
    full: llmsFullTxt(index, files, base),
  }
}
