import { describe, expect, it } from 'vitest'
import { slugAt } from '@/docs/place'
import { headOf, render, slugs } from '@/docs/render'
import { DOCS_URL } from '@domain/brand'
import { DOC_PAGES, DOCS_VERSION } from '@/lib/docs'
import pkg from '../../package.json'

// The static docs site (npm run docs:build): which page an address opens, and every page drawn
// ahead of time, so it reads with no script.

describe('the docs site', () => {
  it('opens the page an address names, however the host writes it', () => {
    expect(slugAt('/docs', '/docs')).toBeUndefined()
    expect(slugAt('/docs/', '/docs')).toBeUndefined()
    expect(slugAt('/docs/index.html', '/docs')).toBeUndefined()
    expect(slugAt('/docs/privacy', '/docs')).toBe('privacy')
    expect(slugAt('/docs/privacy/', '/docs')).toBe('privacy')
    expect(slugAt('/docs/privacy.html', '/docs')).toBe('privacy')
    expect(slugAt('/privacy', '')).toBe('privacy')
    expect(slugAt('/elsewhere', '/docs')).toBeUndefined()
  })

  it('draws every page, with its title, its words and the lists it includes', () => {
    expect(slugs).toEqual([
      undefined,
      ...DOC_PAGES.map((p) => p.slug),
      'changelog',
      'get-started',
      'settle-a-conflict',
    ])
    for (const slug of slugs) {
      const html = render(slug)
      expect(html, slug).toContain(`>${headOf(slug).title.replaceAll("'", '&#x27;')}</h1>`)
    }
    expect(render('connect-an-agent')).toContain('claude mcp add --transport http')
    expect(render('answer-lines')).toContain('Nothing published about this yet.')
    expect(render('tools')).toContain('suggest_context')
    expect(render('changelog')).toContain('<time dateTime="2026-10-23"')
    expect(render(undefined)).toContain('Documentation')
  })

  it('draws a page that moved at its old address too, under its new title', () => {
    expect(headOf('settle-a-conflict').title).toBe('Decide a conflict')
    expect(render('settle-a-conflict')).toContain('>Decide a conflict</h1>')
    expect(headOf('get-started').title).toBe('Set up your workspace')
  })

  it('opens every page with its release and a link to the same page on the web', () => {
    expect(DOCS_VERSION).toBe(pkg.version.split('.').slice(0, 2).join('.'))
    for (const [slug, web] of [
      ['privacy', `${DOCS_URL}/privacy/`],
      ['changelog', `${DOCS_URL}/changelog/`],
      [undefined, `${DOCS_URL}/`],
    ] as const) {
      const html = render(slug)
      expect(html, slug).toContain(`Version <!-- -->${DOCS_VERSION}`)
      expect(html, slug).toContain(`href="${web}" target="_blank" rel="noreferrer"`)
      expect(html, slug).toContain('Read the latest on the web')
    }
  })

  it("keeps the theme button's room until the page runs, which knows the reader's choice", () => {
    const html = render('privacy')
    expect(html).not.toContain('aria-label="Theme:')
    expect(html).toMatch(
      /<span class="size-7 shrink-0" aria-hidden="true"><\/span><\/div><\/div><\/header>/,
    )
  })

  it("marks a page's body and the app's own lists, for the check against the public docs", () => {
    const html = render('answer-lines')
    expect(html).toContain('data-docs="lead"')
    expect(html).toContain('data-docs="body"')
    expect(html).toContain('data-include="answer-lines"')
    expect(render('changelog')).toContain('<h2 id="')
  })
})
