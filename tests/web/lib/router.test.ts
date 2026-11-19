import { describe, expect, it } from 'vitest'
import { href } from '@/lib/router'
import { contextSearch, inboxSearch, rootSearch, settingsSearch, shellSearch } from '@/lib/search'

describe('addresses the app writes', () => {
  it('keep only the values that were given, as plain text', () => {
    expect(href('/ask', { example: 'missing', q: undefined })).toBe('/ask?example=missing')
    expect(href('/inbox')).toBe('/inbox')
  })
})

describe('search params', () => {
  it('drop a value a place does not know, and keep the rest', () => {
    expect(inboxSearch({ tab: 'all', card: 'x', decide: 'maybe' })).toEqual({
      tab: 'all',
      card: 'x',
      decide: undefined,
    })
    expect(settingsSearch({ step: '3' })).toEqual({ step: '3' })
    expect(settingsSearch({ step: 'three' })).toEqual({ step: undefined })
    expect(rootSearch({ theme: 'dark', demo: 'week', open: 'nothing' })).toEqual({
      theme: 'dark',
      demo: 'week',
      open: undefined,
    })
  })

  it("know the dock's kinds", () => {
    expect(shellSearch({ dock: 'context.itm_1' }).dock).toBe('context.itm_1')
    expect(shellSearch({ dock: 'ask' }).dock).toBe('ask')
    expect(shellSearch({ dock: 'sidebar.x' }).dock).toBeUndefined()
  })

  it('know the Context list filtered to conflicts, and drop any other view', () => {
    expect(contextSearch({ show: 'conflicts', domain: 'sales' })).toEqual({
      show: 'conflicts',
      domain: 'sales',
    })
    expect(contextSearch({ show: 'mine' })).toEqual({ show: undefined })
  })

  it("never touch another place's params", () => {
    expect(inboxSearch({ q: 'refunds' })).toEqual({})
  })
})
