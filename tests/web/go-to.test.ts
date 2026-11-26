// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listenForGoTo } from '@/lib/go-to'
import { navigate } from '@/lib/router'

// G then a letter goes to a place (lib/go-to.ts): the letter alone does nothing, a field keeps its
// keys, and Settings opens on the section that is the person's.

vi.mock('@/lib/router', () => ({ navigate: vi.fn() }))

const admin = { admin: true, owns: [] }
let stop: (() => void) | undefined
afterEach(() => {
  stop?.()
  vi.mocked(navigate).mockClear()
  document.body.innerHTML = ''
})

function press(key: string, on: Element = document.body) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  on.dispatchEvent(e)
  return e.defaultPrevented
}

describe('the go-to keys', () => {
  it('go to a place on G then its letter, and take that letter', () => {
    stop = listenForGoTo(() => admin)
    expect(press('g')).toBe(false)
    expect(press('c')).toBe(true)
    expect(navigate).toHaveBeenCalledWith('/context')
    press('g')
    press('d')
    press('g')
    press('i')
    press('g')
    press('a')
    expect(vi.mocked(navigate).mock.calls.map(([to]) => to)).toEqual([
      '/context',
      '/definitions',
      '/inbox',
      '/ask',
    ])
  })

  it('do nothing on a letter alone, or after G and another key', () => {
    stop = listenForGoTo(() => admin)
    expect(press('c')).toBe(false)
    press('g')
    expect(press('j')).toBe(false)
    press('c')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('leave a field its keys', () => {
    stop = listenForGoTo(() => admin)
    const field = document.createElement('input')
    document.body.append(field)
    press('g', field)
    expect(press('c', field)).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('open Settings where the person may: an admin its first section, an owner their domains', () => {
    const who = { admin: true, owns: [] as string[] }
    stop = listenForGoTo(() => who)
    press('g')
    press('s')
    who.admin = false
    who.owns = ['sales']
    press('g')
    press('s')
    who.owns = []
    press('g')
    press('s')
    expect(vi.mocked(navigate).mock.calls.map(([to]) => to)).toEqual([
      '/settings',
      '/settings/domains',
      '/settings/agents',
    ])
  })
})
