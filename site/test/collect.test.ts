import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collect } from '../scripts/collect.ts'

let scratch: string
let site: string

function write(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

/** One build: the landing page at its root and one version of the docs under docs/. */
function build(words: string, folder: string) {
  const built = join(scratch, `built-${words}`)
  write(join(built, 'index.html'), `landing ${words}`)
  write(join(built, '404.html'), `404 ${words}`)
  write(join(built, '_astro/landing.css'), words)
  const docs = join(built, 'docs', folder)
  write(join(docs, 'index.html'), words)
  write(join(docs, 'privacy/index.html'), `privacy ${words}`)
  write(join(docs, 'reference/agent-tools/index.html'), `tools ${words}`)
  write(join(docs, '_astro/page.js'), words)
  write(join(docs, 'pagefind/pagefind.js'), words)
  write(join(docs, 'llms.txt'), `llms ${words}`)
  return built
}

const versions = () => JSON.parse(read('docs/versions.json')) as unknown
const read = (path: string) => readFileSync(join(site, path), 'utf8')

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'footnote-site-collect-'))
  site = join(scratch, 'site')
  mkdirSync(site)
})
afterEach(() => rmSync(scratch, { recursive: true }))

describe('collecting the versions', () => {
  it('points the docs at the newest release, by number', () => {
    collect(site, build('nine', '0.9'), '0.9')
    collect(site, build('ten', '0.10'), '0.10')
    collect(site, build('main', 'next'), 'next')
    expect(versions()).toEqual({ latest: '0.10', versions: ['0.10', '0.9', 'next'] })
    expect(read('docs/index.html')).toContain('url=0.10/')
    expect(read('docs/llms.txt')).toBe('llms ten')
  })

  it('points the docs at next until there is a release', () => {
    collect(site, build('main', 'next'), 'next')
    expect(versions()).toEqual({ latest: 'next', versions: ['next'] })
    expect(read('docs/index.html')).toContain('url=next/')
  })

  it("forwards every page without a version to the newest release's", () => {
    collect(site, build('main', 'next'), 'next')
    collect(site, build('one', '0.1'), '0.1')
    expect(read('docs/privacy/index.html')).toContain("location.replace('../0.1/privacy/'")
    expect(read('docs/reference/agent-tools/index.html')).toContain(
      'url=../../0.1/reference/agent-tools/',
    )
    expect(existsSync(join(site, 'docs/_astro'))).toBe(false)
    expect(existsSync(join(site, 'docs/pagefind'))).toBe(false)
  })

  it('takes the landing page from main, and from a release only while there is none', () => {
    collect(site, build('one', '0.1'), '0.1')
    expect(read('index.html')).toBe('landing one')
    collect(site, build('main', 'next'), 'next')
    collect(site, build('two', '0.2'), '0.2')
    expect(read('index.html')).toBe('landing main')
    expect(read('404.html')).toBe('404 main')
    expect(read('_astro/landing.css')).toBe('main')
  })

  it('lets a patch overwrite its minor, and leaves every other folder alone', () => {
    collect(site, build('first', '0.1'), '0.1')
    writeFileSync(join(site, 'docs/0.1/old-file.html'), 'old')
    collect(site, build('other', '0.2'), '0.2')
    writeFileSync(join(site, 'docs/0.2/kept.html'), 'kept')
    collect(site, build('patch', '0.1'), '0.1')
    expect(read('docs/0.1/index.html')).toBe('patch')
    expect(existsSync(join(site, 'docs/0.1/old-file.html'))).toBe(false)
    expect(read('docs/0.2/kept.html')).toBe('kept')
    expect(versions()).toEqual({ latest: '0.2', versions: ['0.2', '0.1'] })
  })

  it("keeps a maintainer's custom domain and the branch's own files", () => {
    writeFileSync(join(site, 'CNAME'), 'docs.example.com\n')
    writeFileSync(join(site, '.git'), 'gitdir: elsewhere\n')
    writeFileSync(join(site, 'stale.html'), 'stale')
    collect(site, build('main', 'next'), 'next')
    expect(read('CNAME')).toBe('docs.example.com\n')
    expect(read('.git')).toBe('gitdir: elsewhere\n')
    expect(existsSync(join(site, 'stale.html'))).toBe(false)
  })

  it('keeps GitHub Pages from running Jekyll, which would drop _astro', () => {
    collect(site, build('first', '0.1'), '0.1')
    expect(existsSync(join(site, '.nojekyll'))).toBe(true)
    expect(read('docs/0.1/_astro/page.js')).toBe('first')
  })

  it('refuses any other folder', () => {
    expect(() => collect(site, build('first', '0.1'), '../0.1')).toThrow('no version folder')
    expect(() => collect(site, build('first', 'v0.1'), 'v0.1')).toThrow('no version folder')
  })
})
