import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

/*
  The README's Quick start says what a stranger gets. `docker compose up` builds the images from
  this checkout, so it is what the page describes. The published images (compose.images.yaml) are
  a release, which can be far behind the page, so the README names that release and its date as
  CHANGELOG.md has them. The release is checked against CHANGELOG.md, not the version in
  .release-please-manifest.json: release-please's own pull request moves the version before its
  images are published, and the README must stay true until they are.
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

const months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
/** Each release in CHANGELOG.md, with its date in the README's words: 2 November 2026. */
const releases = new Map(
  [
    ...read('CHANGELOG.md').matchAll(
      /^## \[?(\d+\.\d+\.\d+)\]?(?:\([^)]*\))? \((\d{4})-(\d{2})-(\d{2})\)$/gm,
    ),
  ].map(([, version, year, month, day]) => [
    version!,
    `${Number(day)} ${months[Number(month) - 1]} ${year}`,
  ]),
)

type Service = { build?: { context?: string }; image?: string }
const compose = parse(read('compose.yaml')) as { services: Record<string, Service> }

const quickStart = section('Quick start')
const published = /release (\d+\.\d+\.\d+) of (\d{1,2} [A-Z][a-z]+ \d{4})/.exec(joined(quickStart))

describe("the README's Quick start", () => {
  it('builds both images from this checkout, as plain docker compose up does', () => {
    for (const name of ['heed', 'web']) {
      expect(compose.services[name]?.build?.context, `compose.yaml builds ${name} here`).toBe('.')
      expect(
        compose.services[name]?.image,
        `compose.yaml pulls no image for ${name}`,
      ).toBeUndefined()
    }
  })

  it('says which release the published images are, with its date', () => {
    expect(published, 'the Quick start says "release <version> of <day month year>"').not.toBeNull()
    const [, version, date] = published!
    expect(releases.get(version!), `CHANGELOG.md's date of release ${version}`).toBe(date)
  })
})
