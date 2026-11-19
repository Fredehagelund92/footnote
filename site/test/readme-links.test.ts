import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DOCS_URL } from '../../src/domain/brand.ts'
import { publishedPages, repoRoot, slugOf } from '../lib/pages.ts'

describe("the README's links to the docs", () => {
  const readme = readFileSync(`${repoRoot}/README.md`, 'utf8')
  const links = [...readme.matchAll(/^\[([\w-]+)\]: (\S+)$/gm)]
    .map(([, name, url]) => ({ name: name!, url: url! }))
    .filter(({ url }) => url.startsWith(`${DOCS_URL}/`))

  it('open a page the site publishes', () => {
    expect(links.length, 'the README links to the docs').toBeGreaterThan(0)
    const slugs = publishedPages.map(slugOf)
    for (const { name, url } of links) {
      const slug = url.slice(DOCS_URL.length + 1).replace(/\/$/, '')
      if (!slug) continue
      expect(slugs, `[${name}] names the docs page "${slug}"`).toContain(slug)
    }
  })
})
