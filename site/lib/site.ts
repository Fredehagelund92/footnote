import { kindOf } from './links.ts'
import { repository } from './repository.ts'
import { publishedPages, slugOf } from './pages.ts'
import type { Settings } from './settings.ts'

/*
  The addresses the landing page and the header and footer link to. A page of the docs is named by
  its address without a version: /docs/try-the-demo/ opens it in the newest release's docs, which
  the published site forwards to (scripts/collect.ts). A page or a file that does not exist stops
  the build, so a renamed page never leaves the landing page pointing nowhere.
*/

export function siteLinks({ root, ref }: Pick<Settings, 'root' | 'ref'>) {
  const pages = new Set(publishedPages.map((page) => slugOf(`${page}.md`)))
  return {
    repository,
    home: `${root}/`,
    docs(page = '') {
      const [slug = '', hash] = page.split('#')
      if (slug && !pages.has(slug)) throw new Error(`The docs have no page "${slug}".`)
      return `${root}/docs/${slug ? `${slug}/` : ''}${hash ? `#${hash}` : ''}`
    },
    repo(path: string) {
      const kind = kindOf(path)
      if (!kind) throw new Error(`A link to ${path}, which the repository does not have.`)
      return `${repository}/${kind}/${ref}/${path}`
    },
  }
}
