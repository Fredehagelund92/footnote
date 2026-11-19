import { describe, expect, it } from 'vitest'
import { docsPath, readSettings } from '../lib/settings.ts'

describe('the build settings', () => {
  it('serve a build with none at the root of its host', () => {
    const settings = readSettings({})
    expect(settings).toMatchObject({ site: '', root: '', ref: 'main', product: 'Footnote' })
    expect(docsPath(settings)).toBe('/docs')
  })

  it('take the host and the path from one address', () => {
    expect(readSettings({ SITE_URL: 'https://fredehagelund92.github.io/footnote/' })).toMatchObject(
      { site: 'https://fredehagelund92.github.io', root: '/footnote' },
    )
    expect(readSettings({ SITE_URL: 'https://footnote.example' })).toMatchObject({
      site: 'https://footnote.example',
      root: '',
    })
  })

  it('put a version of the docs in its folder under /docs', () => {
    const settings = readSettings({ SITE_URL: 'https://example.com/footnote', DOCS_VERSION: '0.1' })
    expect(docsPath(settings)).toBe('/footnote/docs/0.1')
    expect(docsPath(readSettings({ DOCS_VERSION: 'next' }))).toBe('/docs/next')
  })

  it('refuse an address that is not one, and a version that is neither a minor nor next', () => {
    expect(() => readSettings({ SITE_URL: 'footnote.example' })).toThrow('SITE_URL')
    expect(() => readSettings({ SITE_URL: 'https://example.com/?q=1' })).toThrow('SITE_URL')
    expect(() => readSettings({ DOCS_VERSION: '0.1.2' })).toThrow('MAJOR.MINOR or next')
    expect(() => readSettings({ DOCS_VERSION: 'v0.1' })).toThrow('MAJOR.MINOR or next')
  })
})
