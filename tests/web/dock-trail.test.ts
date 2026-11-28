import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDock, trailTo } from '@/lib/dock'
import { SHORTCUTS } from '@/lib/help-content'
import { GO_TO } from '@/lib/keys'

// The side panel's way back (lib/dock.ts): a panel opened from another panel keeps where it came
// from, with the history entry it was on, so Back goes one step to it and the browser's Back button
// walks the same entries.

describe('the trail of a panel', () => {
  it('names the panel it came from and the entry it was on', () => {
    expect(trailTo('context.itm_a', 'def.Webshop', 4)).toEqual({
      dockFrom: 'context.itm_a',
      dockAt: 4,
    })
  })

  it('goes back one place per press, whatever the chain is', () => {
    // Item, then a definition, then another item: each keeps its own predecessor, not the first.
    const toDef = trailTo('context.itm_a', 'def.Webshop', 4)!
    const toItem = trailTo('def.Webshop', 'context.itm_b', 5)!
    expect(toDef).toEqual({ dockFrom: 'context.itm_a', dockAt: 4 })
    expect(toItem).toEqual({ dockFrom: 'def.Webshop', dockAt: 5 })
    expect(toItem.dockAt - 6).toBe(-1)
  })

  it('is none when no panel was open, so the panel from the page has no Back', () => {
    expect(trailTo(null, 'context.itm_a', 2)).toBeUndefined()
  })

  it('is none when the same panel is asked for again', () => {
    expect(trailTo('def.Webshop', 'def.Webshop', 3)).toBeUndefined()
  })

  it('reads a panel from the address, an id with dots in it whole', () => {
    expect(parseDock('def.Webshop')).toEqual({ kind: 'def', id: 'Webshop' })
    expect(parseDock('conflict.itm_a.itm_b')).toEqual({ kind: 'conflict', id: 'itm_a.itm_b' })
    expect(parseDock('ask')).toEqual({ kind: 'ask' })
  })
})

describe('the key for going back in the panel', () => {
  it('is on the keys sheet, and no single key of the sheet claims it twice', () => {
    const rows = SHORTCUTS.flatMap((g) => g.rows)
    expect(rows.some((r) => r.keys.join('') === 'H' && /side panel/.test(r.label))).toBe(true)
    // Not a go-to key, which is G then its letter.
    expect(GO_TO.map((g) => g.key)).not.toContain('H')
    // H is nobody's in the lists, the review or Ask, whose keys are single letters on the same page.
    const single = rows.filter((r) => r.keys.length === 1 && !r.then)
    const claims = single.filter((r) => r.keys[0] === 'H' || r.or?.[0] === 'H')
    expect(claims).toHaveLength(1)
  })
})

describe('opening a panel, against the router', () => {
  const calls: { href: string; state?: unknown }[] = []

  async function load() {
    vi.resetModules()
    calls.length = 0
    vi.doMock('@/lib/router', () => ({
      changeQuery: (changes: Record<string, string | undefined>, opts?: { state?: unknown }) => {
        calls.push({ href: String(changes.dock), state: opts?.state })
        return Promise.resolve()
      },
      entryIndex: () => 3,
      setQuery: () => {},
      stepHistory: () => {},
      useLocationNow: () => ({ state: {} }),
      useRoute: () => ({ query: new URLSearchParams() }),
    }))
    vi.stubGlobal('window', { location: { search: '?dock=context.itm_a' } })
    vi.stubGlobal('document', { activeElement: null })
    return import('@/lib/dock')
  }

  afterEach(() => {
    vi.doUnmock('@/lib/router')
    vi.unstubAllGlobals()
  })

  it('gives a panel opened from another panel a trail', async () => {
    const dock = await load()
    dock.openDock('def', 'Webshop')
    expect(calls[0]!.state).toEqual({ dockFrom: 'context.itm_a', dockAt: 3 })
  })

  it('gives a panel opened by a page button no trail, though a panel is open', async () => {
    const dock = await load()
    dock.openFromButton('share', 'chat_1', null)
    expect(calls[0]).toEqual({ href: 'share.chat_1', state: undefined })
  })

  it('gives Ask opened from a page no trail, though a panel is open', async () => {
    const dock = await load()
    dock.askInDock('What is this?')
    expect(calls[0]).toEqual({ href: 'ask', state: undefined })
  })
})
