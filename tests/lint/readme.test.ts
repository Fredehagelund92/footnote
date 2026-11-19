import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { DOCS_URL } from '../../src/domain/brand.ts'

/*
  The README is the front door, so what it says must hold.

  Try it says what a stranger gets. `docker compose up` builds the images from this checkout, so
  it is what the page describes. The published images (compose.images.yaml) are a release, which
  can be far behind the page. The README names no version of it: release-please writes the version
  into compose.images.yaml, and a version written by hand here would be wrong from the next
  release, or in the release pull request before its images are published.

  Everything technical is on the docs site. Its address is DOCS_URL, written once in the README's
  link definitions at the end, and each link names a page the site publishes.
*/

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
const readme = read('README.md')

/** The text of a `## ` section, up to the next one. */
function section(title: string) {
  const start = readme.indexOf(`\n## ${title}\n`)
  if (start === -1) throw new Error(`The README has no "## ${title}" section`)
  const end = readme.indexOf('\n## ', start + 1)
  return readme.slice(start, end === -1 ? undefined : end)
}
/** Lines run together, so a sentence the formatter wrapped reads as one. */
const joined = (text: string) => text.replace(/\s+/g, ' ')

type Service = { build?: { context?: string }; image?: string }
const compose = parse(read('compose.yaml')) as { services: Record<string, Service> }

const tryIt = section('Try it')
const images = parse(read('compose.images.yaml')) as { services: Record<string, Service> }

describe("the README's Try it", () => {
  it('starts the demo with plain docker compose up', () => {
    expect(tryIt).toMatch(/^ {3}docker compose up$/m)
    expect(tryIt, 'Try it pulls no published images').not.toContain('compose.images.yaml')
  })

  it('builds both images from this checkout, as plain docker compose up does', () => {
    for (const name of ['footnote', 'web']) {
      expect(compose.services[name]?.build?.context, `compose.yaml builds ${name} here`).toBe('.')
      expect(
        compose.services[name]?.image,
        `compose.yaml pulls no image for ${name}`,
      ).toBeUndefined()
    }
  })

  it('names no version of the published images, which compose.images.yaml pins to a release', () => {
    expect(joined(tryIt), 'Try it names no release by hand').not.toMatch(/release \d+\.\d+\.\d+/)
    for (const [name, repo] of Object.entries({ footnote: 'footnote', web: 'footnote-web' })) {
      expect(images.services[name]?.image, `compose.images.yaml pins ${name} to a version`).toMatch(
        new RegExp(`^ghcr\\.io/fredehagelund92/${repo}:\\d+\\.\\d+\\.\\d+$`),
      )
    }
  })

  it('asks a question the demo questions test asks of the images in a browser', () => {
    const question = /_([^_]+\?)_/.exec(tryIt)?.[1]
    expect(question, 'Try it names a question to ask').toBeDefined()
    expect(read('tests/e2e-seed/demo-questions.spec.ts')).toContain(`question: '${question}'`)
  })
})

describe("the README's links to the docs", () => {
  const definitions = [...readme.matchAll(/^\[([\w-]+)\]: (\S+)$/gm)].map(([, name, url]) => ({
    name: name!,
    url: url!,
  }))
  const docsLinks = definitions.filter(({ url }) => url.startsWith(`${DOCS_URL}/`))
  const host = new URL(DOCS_URL).host

  it('write the address only in the link definitions', () => {
    expect(docsLinks.length, 'the README links to the docs').toBeGreaterThan(0)
    const elsewhere = readme
      .split('\n')
      .filter((line) => line.includes(host) && !/^\[[\w-]+\]: /.test(line))
    expect(elsewhere, `the docs' address outside the link definitions`).toEqual([])
    expect(
      definitions.filter(({ url }) => url.includes(host) && !url.startsWith(`${DOCS_URL}/`)),
      'every link to the docs starts with DOCS_URL',
    ).toEqual([])
  })

  it('open a page the site publishes', () => {
    for (const { name, url } of docsLinks) {
      const page = url.slice(DOCS_URL.length + 1).replace(/\/$/, '')
      if (!page) continue
      const file = [`docs/${page}.md`, `docs/help/${page}.md`].find((path) =>
        existsSync(new URL(`../../${path}`, import.meta.url)),
      )
      expect(file, `[${name}] names the docs page "${page}"`).toBeDefined()
      expect(read('site/lib/pages.ts'), `${file} is on the site`).toContain(
        `'${file!.replace(/^docs\//, '').replace(/\.md$/, '')}'`,
      )
    }
  })
})
