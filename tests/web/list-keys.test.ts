// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { useListKeys, type ListKeys } from '@/lib/list'

// The page's one keymap for every list (lib/list.ts): J and K from page load, the focus following
// the cursor's row unless the step came from the list's panel, Enter on the row on show, Esc from
// anywhere, keys in a dock showing something else left to it, and a list inside another asked first.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollIntoView = () => {}
})

let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})

const IDS = ['a', 'b', 'c', 'd']

const h = React.createElement

/** A list of rows, each opened by its button. */
function Rows({ keys, ids = IDS }: { keys: Omit<ListKeys, 'list'>; ids?: string[] }) {
  const list = React.useRef<HTMLUListElement>(null)
  useListKeys({ ...keys, list })
  return h(
    'ul',
    { ref: list },
    ids.map((id) => h('li', { key: id }, h('button', { type: 'button', 'data-row-open': id }, id))),
  )
}
const rows = (keys: Omit<ListKeys, 'list'>, ids?: string[]) => h(Rows, { keys, ids })
/** The side panel, holding one button. */
const dock = (label: string) =>
  h('div', { 'data-slot': 'dock' }, h('button', { type: 'button' }, label))
const button = (label: string) => h('button', { type: 'button' }, label)

/** Draws the parts side by side, in the order given (a list given later is drawn later). */
function draw(parts: React.ReactElement | React.ReactElement[]) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const all = [parts].flat().map((part, i) => React.cloneElement(part, { key: i }))
  act(() => root!.render(h(React.Fragment, null, all)))
  return host
}

/** Presses a key on whatever has the focus, as a person does; returns whether a list took it. */
function press(key: string, on: Element = document.activeElement ?? document.body) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  act(() => void on.dispatchEvent(e))
  return e.defaultPrevented
}

const focused = () => (document.activeElement as HTMLElement | null)?.dataset.rowOpen

describe('the list keys', () => {
  it('work from page load: J goes to the first row and the focus follows', () => {
    const onMove = vi.fn()
    draw(rows({ onMove }))
    expect(press('j', document.body)).toBe(true)
    expect(focused()).toBe('a')
    press('j')
    press('ArrowDown')
    expect(focused()).toBe('c')
    press('k')
    expect(focused()).toBe('b')
    press('End')
    expect(focused()).toBe('d')
    expect(onMove).toHaveBeenLastCalledWith('d', { panel: false })
  })

  it('step from the row on show, and keep the focus in the panel when stepped from there', () => {
    const onMove = vi.fn()
    const host = draw([rows({ current: 'b', docked: true, onMove }), dock('In the panel')])
    const inPanel = host.querySelector<HTMLElement>('[data-slot=dock] button')!
    inPanel.focus()
    expect(press('j')).toBe(true)
    expect(onMove).toHaveBeenLastCalledWith('c', { panel: true })
    expect(document.activeElement).toBe(inPanel)
  })

  it('leave keys in a dock that shows something else to it', () => {
    const onMove = vi.fn()
    const host = draw([rows({ onMove, onEscape: () => true }), dock('A conflict')])
    host.querySelector<HTMLElement>('[data-slot=dock] button')!.focus()
    expect(press('j')).toBe(false)
    expect(press('Escape')).toBe(false)
    expect(onMove).not.toHaveBeenCalled()
  })

  it('take Esc from anywhere, and Enter on the row on show', () => {
    const onEscape = vi.fn(() => true)
    const onOpen = vi.fn()
    const host = draw([button('Sort'), rows({ current: 'c', onEscape, onOpen })])
    expect(press('Escape', host.querySelector('button')!)).toBe(true)
    expect(onEscape).toHaveBeenCalledOnce()
    // Enter on another row is that row's own: its button opens it.
    host.querySelector<HTMLElement>('[data-row-open=b]')!.focus()
    expect(press('Enter')).toBe(false)
    host.querySelector<HTMLElement>('[data-row-open=c]')!.focus()
    expect(press('Enter')).toBe(true)
    expect(press('Enter', document.body)).toBe(true)
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('never act while someone types', () => {
    const onMove = vi.fn()
    const host = draw([h('input', { 'aria-label': 'Search' }), rows({ onMove })])
    expect(press('j', host.querySelector('input')!)).toBe(false)
    expect(onMove).not.toHaveBeenCalled()
  })

  it('ask a list drawn inside another first, and a list `within` only while it has the focus', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    const host = draw([rows({ onMove: outer }), rows({ onMove: inner, within: true }, ['x', 'y'])])
    press('j', document.body)
    expect(outer).toHaveBeenLastCalledWith('a', { panel: false })
    host.querySelector<HTMLElement>('[data-row-open=x]')!.focus()
    press('j')
    expect(focused()).toBe('y')
    expect(inner).toHaveBeenLastCalledWith('y', { panel: false })
    expect(outer).toHaveBeenCalledOnce()
  })
})
