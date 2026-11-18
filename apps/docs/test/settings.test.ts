import { describe, expect, it } from 'vitest'
import { basePath, readSettings } from '../lib/settings.ts'

describe('the build settings', () => {
  it('serve a build with none at the root of its host', () => {
    const settings = readSettings({})
    expect(basePath(settings)).toBe('')
    expect(settings).toMatchObject({ site: '', ref: 'main', product: 'Footnote' })
  })

  it('put a version in its folder under the root', () => {
    expect(basePath(readSettings({ DOCS_ROOT: '/footnote/', DOCS_VERSION: 'v0.1' }))).toBe(
      '/footnote/v0.1',
    )
    expect(basePath(readSettings({ DOCS_VERSION: 'next' }))).toBe('/next')
  })

  it('refuse a version folder that is neither a minor nor next', () => {
    expect(() => readSettings({ DOCS_VERSION: 'v0.1.2' })).toThrow('vMAJOR.MINOR or next')
  })
})
