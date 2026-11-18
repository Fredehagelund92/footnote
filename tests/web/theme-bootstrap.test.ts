// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { storageKey } from '@/lib/brand'

// The theme before the first paint (src/web/theme-bootstrap.js). vite.config.ts inlines it with
// the storage key of lib/brand.ts in place of THEME_KEY, the key lib/theme.tsx saves under; here
// THEME_KEY is that key as a global.

async function run({
  prefix = storageKey(''),
  saved,
  search = '',
  systemDark = false,
  before = () => {},
}: {
  prefix?: string
  saved?: string
  search?: string
  systemDark?: boolean
  /** What the browser held before the page loaded. */
  before?: () => void
}) {
  document.documentElement.className = ''
  window.localStorage.clear()
  window.sessionStorage.clear()
  if (saved) window.localStorage.setItem(storageKey('theme'), saved)
  before()
  window.history.replaceState(null, '', `/inbox${search}`)
  window.matchMedia = ((query: string) => ({
    matches: query.includes('dark') && systemDark,
    media: query,
  })) as unknown as typeof window.matchMedia
  vi.stubGlobal('THEME_KEY', `${prefix}theme`)
  vi.stubGlobal('STORAGE_PREFIX', prefix)
  // The bootstrap is an inline <head> script with side effects, so import a fresh copy each time.
  vi.resetModules()
  await import('@/theme-bootstrap.js')
  return document.documentElement.classList.contains('dark')
}

afterEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  vi.unstubAllGlobals()
})

describe('the theme bootstrap', () => {
  it("applies the saved choice, or the system's", async () => {
    expect(await run({ saved: 'dark' })).toBe(true)
    expect(await run({ saved: 'light', systemDark: true })).toBe(false)
    expect(await run({ saved: 'system', systemDark: true })).toBe(true)
    expect(await run({ systemDark: true })).toBe(true)
    expect(await run({})).toBe(false)
  })

  it('lets ?theme= in the address win, for a screenshot', async () => {
    expect(await run({ saved: 'light', search: '?theme=dark' })).toBe(true)
    expect(await run({ saved: 'dark', search: '?theme=light' })).toBe(false)
    expect(await run({ saved: 'dark', search: '?theme=sepia' })).toBe(true)
  })

  it('moves what the browser kept before the rename to Footnote, once', async () => {
    const dark = await run({
      before: () => {
        window.localStorage.setItem('heed-theme', 'dark')
        window.localStorage.setItem('heed.ask.chats.per_jon', '[{"id":"c1"}]')
        window.sessionStorage.setItem('heed-pane:inbox', '420')
        window.localStorage.setItem('heed-emoji-recent', '["old"]')
        window.localStorage.setItem(storageKey('emoji-recent'), '["new"]')
      },
    })
    expect(dark).toBe(true)
    expect(window.localStorage.getItem(storageKey('theme'))).toBe('dark')
    expect(window.localStorage.getItem('footnote.ask.chats.per_jon')).toBe('[{"id":"c1"}]')
    expect(window.sessionStorage.getItem(`${storageKey('pane')}:inbox`)).toBe('420')
    // A key saved under the new name already wins; the old one goes either way.
    expect(window.localStorage.getItem(storageKey('emoji-recent'))).toBe('["new"]')
    const left = [window.localStorage, window.sessionStorage].flatMap((store) =>
      Array.from({ length: store.length }, (_, i) => store.key(i)),
    )
    expect(left.filter((key) => key?.startsWith('heed'))).toEqual([])
  })

  it('leaves its own keys alone when the product slug itself starts with heed', async () => {
    const dark = await run({
      prefix: 'heed-ai-',
      before: () => {
        window.localStorage.setItem('heed-ai-theme', 'dark')
        window.localStorage.setItem('heed-ai-pane:inbox', '420')
        window.localStorage.setItem('footnote.ask.chats.per_jon', '[]')
      },
    })
    expect(dark).toBe(true)
    expect(window.localStorage.getItem('heed-ai-theme')).toBe('dark')
    expect(window.localStorage.getItem('heed-ai-pane:inbox')).toBe('420')
    expect(window.localStorage.getItem('footnote.ask.chats.per_jon')).toBe('[]')
    expect(window.localStorage.length).toBe(3)
  })

  it("keeps the key in the product's name, as every key the app stores", () => {
    expect(storageKey('theme')).toMatch(/^[a-z0-9 ]+-theme$/)
  })
})
