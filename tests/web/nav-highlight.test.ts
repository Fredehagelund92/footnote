// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { SidebarMenu } from '@/components/ui/sidebar'

// The one highlight behind a sidebar menu's places (docs/design/motion.md): it is in the place of
// the place the person is in, the places give up their own grey while it is there, and it travels
// only when a pointer press moved it.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | undefined
let host: HTMLElement | undefined
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

function render(props: { selected?: number; travel?: boolean }) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(React.createElement(SidebarMenu, props, 'places')))
  return host.querySelector('[data-slot="sidebar-menu"]')!
}
const highlight = (menu: Element) => menu.querySelector('.nav-highlight')

describe('the sidebar highlight', () => {
  it('stands in the place of the place the person is in', () => {
    const menu = render({ selected: 2 })
    expect(highlight(menu)?.getAttribute('style')).toBe('--selected: 2;')
    expect(highlight(menu)?.getAttribute('aria-hidden')).toBe('true')
  })

  it('takes the places their own grey while it is there', () => {
    expect(render({ selected: 0 }).getAttribute('data-highlight')).toBe('true')
    expect(render({}).getAttribute('data-highlight')).toBe(null)
  })

  it('is not drawn where there is no highlight, or no place of this menu is the one', () => {
    expect(highlight(render({}))).toBe(null)
    expect(highlight(render({ selected: -1 }))).toBe(null)
  })

  it('travels only when a pointer press moved it', () => {
    expect(highlight(render({ selected: 1, travel: true }))?.getAttribute('data-travel')).toBe(
      'true',
    )
    expect(highlight(render({ selected: 1 }))?.getAttribute('data-travel')).toBe(null)
  })
})
