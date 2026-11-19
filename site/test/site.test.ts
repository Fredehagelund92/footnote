import { describe, expect, it } from 'vitest'
import { siteLinks } from '../lib/site.ts'

const links = siteLinks({ root: '/footnote', ref: 'v0.1.2' })

describe("the landing page's links", () => {
  it('name a page of the docs without a version, so it opens the newest release', () => {
    expect(links.home).toBe('/footnote/')
    expect(links.docs()).toBe('/footnote/docs/')
    expect(links.docs('get-started')).toBe('/footnote/docs/get-started/')
    expect(links.docs('reference/agent-tools#ask')).toBe(
      '/footnote/docs/reference/agent-tools/#ask',
    )
  })

  it('stop the build on a page the docs do not have', () => {
    expect(() => links.docs('contributing/internals')).toThrow('no page "contributing/internals"')
  })

  it("open a file of the repository at the build's reference, and stop on one it does not have", () => {
    expect(links.repo('tests/integration/mcp.test.ts')).toBe(
      'https://github.com/Fredehagelund92/footnote/blob/v0.1.2/tests/integration/mcp.test.ts',
    )
    expect(links.repo('docs/templates')).toBe(
      'https://github.com/Fredehagelund92/footnote/tree/v0.1.2/docs/templates',
    )
    expect(() => links.repo('tests/gone.test.ts')).toThrow('tests/gone.test.ts')
  })
})
