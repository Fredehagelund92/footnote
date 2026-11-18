import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

/*
  The README's Quick start says what a stranger gets. `docker compose up` builds the images from
  this checkout, so it is what the page describes. The published images (compose.images.yaml) are
  a release, which can be far behind the page. The README names no version of it: release-please
  writes the version into compose.images.yaml, and a version written by hand here would be wrong
  from the next release, or in the release pull request before its images are published.
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

const quickStart = section('Quick start')
const images = parse(read('compose.images.yaml')) as { services: Record<string, Service> }

describe("the README's Quick start", () => {
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
    expect(joined(quickStart), 'the Quick start names no release by hand').not.toMatch(
      /release \d+\.\d+\.\d+/,
    )
    for (const [name, repo] of Object.entries({ footnote: 'footnote', web: 'footnote-web' })) {
      expect(images.services[name]?.image, `compose.images.yaml pins ${name} to a version`).toMatch(
        new RegExp(`^ghcr\\.io/fredehagelund92/${repo}:\\d+\\.\\d+\\.\\d+$`),
      )
    }
  })
})
