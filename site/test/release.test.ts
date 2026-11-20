import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { released, releaseWords } from '../landing/release.ts'
import { repoRoot } from '../lib/pages.ts'

/*
  The landing page's release switch (landing/release.ts): one constant in the page's frontmatter
  picks one set of words. Before the release the page says only what is true of a checkout; at the
  release it says the 0.1.0 words. The built page is checked too, in e2e/landing.spec.ts.
*/

const all = (isReleased: boolean) => Object.values(releaseWords(isReleased)).flat().join('\n')

describe('the release switch', () => {
  it('before the release, says to build from the checkout and claims no published images', () => {
    const words = all(false)
    expect(releaseWords(false).startCommands.at(-1)).toBe('docker compose up')
    expect(words).toContain('builds Footnote from the code you cloned')
    expect(words).toContain('It can take ten minutes.')
    expect(words).toContain('Not released yet')
    for (const claim of ['0.1.0', 'two minutes', 'pulls', 'published images', 'compose.images'])
      expect(words).not.toContain(claim)
  })

  it('at the release, says the 0.1.0 words: the first start pulls the published images', () => {
    const words = all(true)
    expect(releaseWords(true).startCommands.at(-1)).toBe(
      'docker compose -f compose.yaml -f compose.images.yaml up',
    )
    expect(words).toContain('The first start pulls the 0.1.0 images')
    expect(words).toContain('Give it about two minutes.')
    expect(words).toContain('The first release is v0.1.0')
    expect(words).not.toContain('Not released yet')
  })

  it('changes the same lines in both positions', () => {
    expect(Object.keys(releaseWords(true))).toEqual(Object.keys(releaseWords(false)))
  })
})

describe('the release words elsewhere', () => {
  const read = (file: string) => readFileSync(`${repoRoot}/${file}`, 'utf8').replace(/\s+/g, ' ')

  it('tell the same story as the switch: until the first release, nothing is released', () => {
    expect(released, 'flip these words with the switch').toBe(false)
    expect(read('README.md')).toContain('Footnote has not had its first release yet.')
    expect(read('docs/try-the-demo.md')).toContain('Footnote has not had its first release yet')
    expect(read('docs/self-hosting.md')).toContain(
      'The images are not published until the first release',
    )
  })
})
