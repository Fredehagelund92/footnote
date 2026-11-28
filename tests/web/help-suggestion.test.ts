// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { HelpBar, HelpSuggestion, HelpWorkingStrip } from '@/components/footnote/agent-change'

// Writing help in the draft itself (Route 3): its words for a field the person is writing in, as
// one line under the field to use or dismiss; the strip while a turn runs; its door on a phone.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  document.body.innerHTML = ''
})

function render(node: React.ReactNode) {
  root = createRoot(document.body.appendChild(document.createElement('div')))
  act(() => root!.render(node))
}
const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name,
  )!

describe('writing help’s suggestion under a field', () => {
  it('says whose words they are and for which field, with Use it and Dismiss', () => {
    const onUse = vi.fn()
    const onDismiss = vi.fn()
    render(
      React.createElement(HelpSuggestion, {
        field: 'Title',
        onUse,
        onDismiss,
        children: 'Webshop sales to Norway stopped on 4 August 2026',
      }),
    )
    const group = document.querySelector('[role=group]')!
    expect(group.getAttribute('aria-label')).toBe("Writing help's suggestion for Title")
    expect(group.textContent).toContain(
      'Writing help suggests: Webshop sales to Norway stopped on 4 August 2026',
    )
    act(() => button('Use it').click())
    expect(onUse).toHaveBeenCalledTimes(1)
    act(() => button('Dismiss').click())
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('cuts a text of several paragraphs after a few lines, under the line’s first words', () => {
    render(
      React.createElement(HelpSuggestion, {
        field: 'Text',
        block: true,
        onUse: () => undefined,
        onDismiss: () => undefined,
        children: React.createElement(
          'p',
          null,
          'A new customs rule stopped all online sales to Norway.',
        ),
      }),
    )
    const text = document.querySelector('p')!.parentElement!
    expect(text.className).toContain('line-clamp-4')
  })
})

describe('the strip while a turn runs', () => {
  it('says what writing help is doing, with Stop', () => {
    const onStop = vi.fn()
    render(
      React.createElement(HelpWorkingStrip, {
        words: 'Writing help is reading your message and 1 link.',
        onStop,
      }),
    )
    const strip = document.querySelector('section[aria-label="Writing help is working"]')!
    expect(strip.textContent).toContain('Writing help is reading your message and 1 link.')
    act(() => button('Stop').click())
    expect(onStop).toHaveBeenCalledTimes(1)
  })
})

describe('writing help’s door on a phone', () => {
  it('is one button above the draft’s foot that opens the chat', () => {
    const onOpen = vi.fn()
    render(React.createElement(HelpBar, { open: false, onOpen }))
    act(() => button('Ask writing help for a change').click())
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('takes the keyboard back when the chat closes with the focus nowhere', () => {
    render(React.createElement(HelpBar, { open: true, onOpen: () => undefined }))
    const door = button('Ask writing help for a change')
    ;(document.activeElement as HTMLElement | null)?.blur()
    act(() => root!.render(React.createElement(HelpBar, { open: false, onOpen: () => undefined })))
    expect(document.activeElement).toBe(door)
  })

  it('leaves the keyboard where the person put it', () => {
    const elsewhere = document.body.appendChild(document.createElement('input'))
    render(React.createElement(HelpBar, { open: true, onOpen: () => undefined }))
    elsewhere.focus()
    act(() => root!.render(React.createElement(HelpBar, { open: false, onOpen: () => undefined })))
    expect(document.activeElement).toBe(elsewhere)
  })
})
