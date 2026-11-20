import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SitePage } from '../lib/pages.ts'
import { checkIslands, checkSite } from '../scripts/check-site.ts'

let dist: string
const pages = [{ slug: 'privacy', title: 'Privacy' }] as SitePage[]
const settings = { root: '/footnote', version: '0.1' }

function write(path: string, text: string) {
  mkdirSync(dirname(join(dist, path)), { recursive: true })
  writeFileSync(join(dist, path), text)
}

const body = (html: string) =>
  `<html><body><div class="sl-markdown-content">${html}</div></body></html>`

beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'footnote-site-check-'))
  write('index.html', body('<a href="/footnote/docs/privacy/">Privacy</a>'))
  write('404.html', body('<a href="/footnote/">Home</a>'))
  write('docs/0.1/privacy/index.html', body('<h2 id="kept">Kept</h2>'))
  write('docs/0.1/llms.txt', '- [Privacy](/footnote/docs/0.1/privacy/): what is kept')
  write('docs/0.1/llms-full.txt', 'Privacy')
  write('docs/0.1/pagefind/pagefind.js', '')
})
afterEach(() => rmSync(dist, { recursive: true }))

describe('the built site', () => {
  it('passes when every link goes somewhere', () => {
    write(
      'docs/0.1/index.html',
      body(
        '<a href="/footnote/docs/0.1/privacy/#kept">Kept</a> <a href="https://example.com">Out</a>',
      ),
    )
    expect(checkSite(dist, settings, pages)).toEqual([])
  })

  it("opens a page of the docs without a version in this build's version", () => {
    write('index.html', body('<a href="/footnote/docs/">Docs</a>'))
    write('docs/0.1/index.html', body('Docs'))
    expect(checkSite(dist, settings, pages)).toEqual([])
  })

  it('fails on a page that is not there', () => {
    write('docs/0.1/index.html', body('<a href="/footnote/docs/0.1/gone/">Gone</a>'))
    expect(checkSite(dist, settings, pages)).toEqual([
      'docs/0.1/index.html: "/footnote/docs/0.1/gone/" opens nothing',
    ])
  })

  it('fails on a heading that is not there', () => {
    write('index.html', body('<a href="/footnote/docs/privacy/#gone">Gone</a>'))
    expect(checkSite(dist, settings, pages)[0]).toContain('names no heading there')
  })

  it("fails on a link outside the site's path", () => {
    write('index.html', body('<a href="/privacy/">Wrong</a>'))
    expect(checkSite(dist, settings, pages)[0]).toContain("outside the site's path")
  })

  it('fails on anything loaded from another host', () => {
    write('index.html', body('<script src="https://cdn.example.com/a.js"></script>'))
    expect(checkSite(dist, settings, pages)[0]).toContain('from another host')
    write('index.html', body('<link rel="stylesheet" href="https://fonts.example.com/a.css">'))
    expect(checkSite(dist, settings, pages)[0]).toContain('from another host')
  })

  it('fails on a stylesheet or a script the build does not have', () => {
    write('docs/0.1/_astro/page.css', '')
    write(
      'docs/0.1/index.html',
      body(
        '<link rel="stylesheet" href="/footnote/docs/0.1/_astro/page.css"><script src="/footnote/docs/0.1/_astro/gone.js"></script>',
      ),
    )
    expect(checkSite(dist, settings, pages)).toEqual([
      'docs/0.1/index.html: loads /footnote/docs/0.1/_astro/gone.js, which the build does not have',
    ])
  })

  it('fails on a <title> tag in the body of a page', () => {
    write('index.html', body('<p>Open in Footnote -</p><title>: <url></title>'))
    expect(checkSite(dist, settings, pages)[0]).toContain('<title> tag')
  })

  it('fails without the landing page or the 404 page', () => {
    rmSync(join(dist, 'index.html'))
    rmSync(join(dist, '404.html'))
    expect(checkSite(dist, settings, pages)).toEqual(['no landing page', 'no 404 page'])
  })

  it('fails on a page missing from the docs or from llms.txt', () => {
    rmSync(join(dist, 'docs/0.1/privacy'), { recursive: true })
    write('index.html', body('Home'))
    write('docs/0.1/llms.txt', 'nothing')
    expect(checkSite(dist, settings, pages)).toEqual([
      'privacy: the page was not built',
      'privacy: llms.txt does not list Privacy',
    ])
  })
})

describe('the links between the pages of the docs', () => {
  const three = [
    { slug: 'privacy', title: 'Privacy' },
    { slug: 'words', title: 'Words' },
    { slug: 'tools', title: 'Agent tools' },
  ] as SitePage[]
  /** A page whose words link to some pages, and whose sidebar and footer link to every page. */
  const page = (slug: string, links: string[]) =>
    write(
      `docs/0.1/${slug}/index.html`,
      `<html><body><nav><a href="/footnote/docs/0.1/tools/">Agent tools</a></nav><div class="sl-markdown-content">${links
        .map((to) => `<a href="/footnote/docs/0.1/${to}/#a">${to}</a>`)
        .join(
          ' ',
        )}</div><footer><a href="/footnote/docs/0.1/tools/">Next</a></footer></body></html>`,
    )

  it('pass when every page links to another and another links to it', () => {
    page('privacy', ['words'])
    page('words', ['tools'])
    page('tools', ['privacy', 'tools'])
    expect(checkIslands(dist, settings, three)).toEqual([])
  })

  it('fail on a page with no link out or no link in, counting only the words of a page', () => {
    page('privacy', ['words', 'privacy'])
    page('words', ['privacy'])
    page('tools', [])
    expect(checkIslands(dist, settings, three)).toEqual([
      'tools: Agent tools links to no other page of the docs',
      'tools: no other page of the docs links to Agent tools',
    ])
  })
})
