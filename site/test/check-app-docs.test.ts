import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SitePage } from '../lib/pages.ts'
import { checkAppDocs, wordsOf, type DocsBuild } from '../scripts/check-app-docs.ts'

let root: string
let app: DocsBuild
let site: DocsBuild
const pages = [
  { slug: 'privacy', file: 'docs/help/privacy.md', title: 'Privacy' },
  { slug: 'words', file: 'docs/help/words.md', title: 'Words' },
  // A page only the site has, which the app's Docs area does not carry.
  { slug: 'security', file: 'docs/security.md', title: 'Security' },
] as SitePage[]

function write(path: string, text: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

/** A page as the app's Docs area draws it, around its lead and body. */
const appPage = (title: string, lead: string, body: string) =>
  `<html><body><nav aria-label="Pages"><a href="/docs/gone">Gone</a></nav><main><article>` +
  `<h1 class="text-3xl">${title}</h1><p class="mt-3" data-docs="lead">${lead}</p>` +
  `<details><summary>On this page</summary></details>` +
  `<div class="flex" data-docs="body">${body}</div>` +
  `<a href="/docs/words">Next</a></article></main></body></html>`

/** A page as Starlight draws it. */
const sitePage = (title: string, content: string) =>
  `<html><body><h1 id="_top" data-astro-cid-x>${title}</h1>` +
  `<div class="sl-markdown-content">${content}</div><footer><a href="/docs/gone/">Gone</a></footer></body></html>`

const privacyBody =
  '<h2 id="kept">What is kept</h2><p>Each question&#x27;s words, for <strong>30</strong> days.</p>' +
  '<ol><li class="flex"><span class="mt-1">1</span><span>Open <a href="/docs/words#context">Words</a>.</span></li></ol>' +
  '<div class="contents" data-include="words"><dl><dt>Owner</dt><dd>The app’s own list.</dd></dl></div>' +
  '<figure><img alt="The Privacy screen." src="/docs/assets/privacy-light-DMU6m0g5.webp" class="dark:hidden"/>' +
  '<img alt="The Privacy screen." src="/docs/assets/privacy-dark-CyDKbjwF.webp" class="hidden dark:block"/></figure>' +
  '<figure><figcaption>The prompt<button>Copy</button></figcaption><pre>npm run seed</pre></figure>'
const privacyContent =
  '<p>What is kept, and for how long.</p>' +
  '<h2 id="kept">What is kept</h2><p>Each question’s words, for <strong>30</strong> days.</p>' +
  '<ol><li>Open <a href="/docs/words/#context">Words</a>.</li></ol>' +
  '<div data-include="words"><table><tr><td>Owner</td><td>The list as Markdown</td></tr></table></div>' +
  '<figure class="footnote-picture"><img class="dark:sl-hidden" alt="The Privacy screen." src="/docs/_astro/privacy-light.DMU6m0g5_mJ68c.webp">' +
  '<img class="light:sl-hidden" alt="The Privacy screen." src="/docs/_astro/privacy-dark.CyDKbjwF_5NdUn.webp"></figure>' +
  '<div class="expressive-code"><script type="module" src="/docs/_astro/ec.js"></script><figure class="frame"><figcaption class="header"><span class="title">The prompt</span></figcaption>' +
  '<pre><code><div class="ec-line"><div class="code"><span>npm run seed</span></div></div></code></pre>' +
  '<div class="copy"><button title="Copy to clipboard"><div></div></button></div></figure></div>'

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'footnote-app-docs-'))
  app = {
    dist: join(root, 'app'),
    base: '/docs',
    fileOf: (slug) => join(root, 'app', `${slug}.html`),
  }
  site = {
    dist: join(root, 'site'),
    base: '/docs',
    fileOf: (slug) => join(root, 'site', slug, 'index.html'),
  }
  write(
    'app/llms.txt',
    '# Documentation\n\n- [Privacy](/docs/privacy): What is kept.\n- [Words](/docs/words): The words.\n',
  )
  write('app/privacy.html', appPage('Privacy', 'What is kept, and for how long.', privacyBody))
  write(
    'app/words.html',
    appPage('Words', 'The words.', '<h2 id="context">Context</h2><p>A word.</p>'),
  )
  write('app/assets/privacy-light-DMU6m0g5.webp', '')
  write('app/assets/privacy-dark-CyDKbjwF.webp', '')
  write('site/privacy/index.html', sitePage('Privacy', privacyContent))
  write(
    'site/words/index.html',
    sitePage('Words', '<p>The words.</p><h2 id="context">Context</h2><p>A word.</p>'),
  )
  write('site/_astro/privacy-light.DMU6m0g5_mJ68c.webp', '')
  write('site/_astro/privacy-dark.CyDKbjwF_5NdUn.webp', '')
})
afterEach(() => rmSync(root, { recursive: true }))

describe("the app's Docs area and the site", () => {
  it('agree when they say the same, however each renderer draws it', () => {
    expect(checkAppDocs(app, site, pages)).toEqual([])
  })

  it('read the words a reader reads, with plain quotes and dashes', () => {
    expect(wordsOf('<p>It’s “one” – <code>two</code>s<!-- --> .</p><button>Copy</button>')).toBe(
      `It's "one" - twos.`,
    )
  })

  it('fail on a page only one of them has', () => {
    write('app/llms.txt', '- [Privacy](/docs/privacy): What is kept.\n- [Ask](/docs/ask): Ask.\n')
    expect(checkAppDocs(app, site, pages)).toEqual([
      "ask: the app's Docs area has this page, the site not",
      "words: the site has this page, the app's Docs area not",
      // And Privacy's link to it goes nowhere in the app.
      "privacy: the app's Docs area links to words, which it does not have",
    ])
  })

  it('fail on a title, a heading or a word that differs', () => {
    write(
      'site/words/index.html',
      sitePage('Word list', '<p>The words.</p><h2 id="terms">Context</h2><p>Two words.</p>'),
    )
    expect(checkAppDocs(app, site, pages)).toEqual([
      `words: the app's Docs area calls it "Words", the site "Word list"`,
      `words: the app's Docs area has heading "h2#context Context", the site not`,
      `words: the site has heading "h2#terms Context", the app's Docs area not`,
      `words: the words differ: the app has "The words. Context A word.", the site "The words. Context Two words."`,
    ])
  })

  it('leave the app’s own lists out, but not the words around them', () => {
    write(
      'site/privacy/index.html',
      sitePage('Privacy', privacyContent.replace('The list as Markdown', 'Changed')),
    )
    expect(checkAppDocs(app, site, pages)).toEqual([])
    write('site/privacy/index.html', sitePage('Privacy', privacyContent.replace('30', '31')))
    expect(checkAppDocs(app, site, pages)[0]).toMatch(/^privacy: the words differ/)
  })

  it('fail on a picture that differs or whose file is missing from either build', () => {
    rmSync(join(root, 'app/assets/privacy-dark-CyDKbjwF.webp'))
    rmSync(join(root, 'site/_astro/privacy-light.DMU6m0g5_mJ68c.webp'))
    write(
      'site/privacy/index.html',
      sitePage('Privacy', privacyContent.replaceAll('The Privacy screen.', 'A screen.')),
    )
    expect(checkAppDocs(app, site, pages)).toEqual([
      `privacy: the app's Docs area has picture "The Privacy screen. privacy-light.webp", the site not`,
      `privacy: the app's Docs area has picture "The Privacy screen. privacy-dark.webp", the site not`,
      `privacy: the site has picture "A screen. privacy-light.webp", the app's Docs area not`,
      `privacy: the site has picture "A screen. privacy-dark.webp", the app's Docs area not`,
      "privacy: the app's Docs area shows /docs/assets/privacy-dark-CyDKbjwF.webp, which its build does not have",
      'privacy: the site shows /docs/_astro/privacy-light.DMU6m0g5_mJ68c.webp, which its build does not have',
    ])
  })

  it("fail on a link of the app's that goes nowhere, or that the site sends elsewhere", () => {
    write(
      'app/privacy.html',
      appPage(
        'Privacy',
        'What is kept, and for how long.',
        privacyBody.replace('words#context', 'words#gone'),
      ),
    )
    expect(checkAppDocs(app, site, pages)).toEqual([
      `privacy: the app's Docs area has link "words#gone", the site not`,
      `privacy: the site has link "words#context", the app's Docs area not`,
      "privacy: the app's Docs area links to words#gone, a heading words does not have",
    ])
  })

  it('say to build the app’s docs when there are none', () => {
    rmSync(join(root, 'app'), { recursive: true })
    expect(checkAppDocs(app, site, pages)).toEqual([
      `${app.dist} has no docs: run npm run docs:build in the repository`,
    ])
  })
})
