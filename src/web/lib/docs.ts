import MiniSearch from 'minisearch'
import docs, { version } from 'virtual:help-docs'
import { DOCS_URL } from '@domain/brand'
import { docGroups, llmsTxt as indexOf, type DocChangelog, type DocPage } from '@domain/docs'
import { DOCS_HOME } from '@/lib/doc-links'

// The documentation's pages (docs/help), read at build time (scripts/docs-plugin.ts). The app's
// Docs area, the static docs site and Help read them from here; a link to a page from elsewhere
// in the app reads lib/doc-links.ts.

export type { DocPage } from '@domain/docs'
export { CHANGELOG_SLUG, DOCS_HOME, docHref } from '@/lib/doc-links'

export const DOC_GROUPS = docGroups
export const DOC_PAGES: DocPage[] = docs.pages
export const CHANGES: DocChangelog = docs.changelog

export const docPage = (slug: string | undefined) => DOC_PAGES.find((p) => p.slug === slug)

/**
 * The release these pages describe, as the public docs name their versions: `0.1` for every
 * 0.1.x, the folder that release's pages have on the site (site/README.md).
 */
export const DOCS_VERSION = version.split('.').slice(0, 2).join('.')

/**
 * The same page in the public docs, which always show the newest release's pages: the docs' home
 * without a slug. The site gives every page of the app's docs the same slug.
 */
export const webDocHref = (slug: string | undefined) => `${DOCS_URL}/${slug ? `${slug}/` : ''}`

/** The plain-text index an agent can read at /docs/llms.txt: every page with its one line. */
export const llmsTxt = () => indexOf(docs, DOCS_HOME)

export type DocHit = { slug: string; title: string; heading: string; id: string; group: string }

let index: MiniSearch<DocHit & { key: string; text: string }> | undefined

/**
 * The pages' parts that best match a search, by their words: a page's title and line, each
 * heading and the words under it, at most eight. A word matches its start and one typo, so
 * "synonim" finds synonyms. Built the first time the search opens.
 */
export function searchDocs(query: string): DocHit[] {
  index ??= (() => {
    const built = new MiniSearch<DocHit & { key: string; text: string }>({
      idField: 'key',
      fields: ['title', 'heading', 'text'],
      storeFields: ['slug', 'title', 'heading', 'id', 'group'],
      searchOptions: { boost: { title: 3, heading: 2 }, prefix: true, fuzzy: 0.2 },
    })
    built.addAll(
      DOC_PAGES.flatMap((p) =>
        p.sections.map((s) => ({
          key: `${p.slug}#${s.id}`,
          slug: p.slug,
          title: p.title,
          heading: s.heading,
          id: s.id,
          group: p.group,
          text: s.id ? s.text : `${p.line}\n${s.text}`,
        })),
      ),
    )
    return built
  })()
  if (!query.trim()) return []
  // Every word first; when no part has them all, any of them.
  const all = index.search(query, { combineWith: 'AND' })
  const hits = all.length ? all : index.search(query)
  return hits.slice(0, 8).map((hit) => ({
    slug: hit.slug as string,
    title: hit.title as string,
    heading: hit.heading as string,
    id: hit.id as string,
    group: hit.group as string,
  }))
}
