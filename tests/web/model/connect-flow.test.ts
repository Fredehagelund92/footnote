import { describe, expect, it } from 'vitest'
import {
  canSave,
  flow,
  opening,
  startChoices,
  type Choices,
  type FlowEvent,
  type FlowState,
} from '@/model/connect-flow'
import type { ConnectForm, ConnectScope, ConnectTest } from '@/model/integrations'

// The connect flow's one reducer, a transition at a time: what is chosen outlives a new test, a
// late answer is dropped, and a save someone else got to first has a way on.

const form: ConnectForm = {
  connector: 'cube',
  source: { id: 'cube', revision: 3 },
  fields: [
    {
      key: 'ref',
      kind: 'ref',
      label: 'Branch',
      description: '',
      required: true,
      advanced: false,
      value: 'main',
    },
  ],
  secrets: [],
  every: 'every hour',
  staleAfter: '6 hours',
  perDay: null,
  chosen: [],
  readsAll: true,
  secretStore: true,
}

const view = (id: string): ConnectScope => ({ id, title: id, detail: '' })
const found = (...ids: string[]): ConnectTest => ({ ok: true, steps: [], scopes: ids.map(view) })
const startOf = (test: ConnectTest): Choices =>
  startChoices(form, test.scopes, { definitions: true, why: '', domains: new Set() })

const run = (state: FlowState, ...events: FlowEvent[]) =>
  events.reduce<FlowState>((s, e) => flow(s, e), state)
const tested = (s: FlowState, test: ConnectTest): FlowState =>
  run(
    s,
    { type: 'test', of: 'k' },
    { type: 'tested', run: s.test.run + 1, result: test, start: startOf(test) },
  )

const picked = (s: FlowState) => s.choices?.picked.ids
const ready = tested(opening(form), found('orders', 'basket'))
const chosen = run(
  ready,
  { type: 'readsAll', on: false },
  { type: 'pick', update: (p) => ({ ...p, ids: ['orders'] }) },
  { type: 'why', text: 'Only orders' },
)

describe('the connect flow', () => {
  it('opens on the revision the form read, with nothing chosen before a test', () => {
    const s = opening(form)
    expect(s.revision).toBe(3)
    expect(s.choices).toBeNull()
    expect(s.values.config).toEqual({ ref: 'main' })
  })

  it('starts the choices from the first test that could read', () => {
    expect(picked(ready)).toEqual(['orders', 'basket'])
    expect(ready.choices?.readsAll).toBe(true)
  })

  it('keeps the choices across a changed setting and a new test', () => {
    const s = tested(
      run(chosen, { type: 'field', key: 'ref', value: 'release' }),
      found('orders', 'basket', 'kiosk'),
    )
    expect(picked(s)).toEqual(['orders'])
    expect(s.choices?.why).toBe('Only orders')
    expect(s.choices?.map).toHaveProperty('kiosk')
  })

  it('ticks a view a new test finds while every view is read', () => {
    expect(picked(tested(ready, found('orders', 'basket', 'kiosk')))).toEqual([
      'orders',
      'basket',
      'kiosk',
    ])
  })

  it('drops the answer of a test a newer one replaced', () => {
    const s = run(chosen, { type: 'test', of: 'a' }, { type: 'test', of: 'b' })
    const late = flow(s, {
      type: 'tested',
      run: s.test.run - 1,
      result: found(),
      start: startOf(found()),
    })
    expect(late).toBe(s)
    expect(flow(s, { type: 'testFailed', run: s.test.run - 1, error: 'x' })).toBe(s)
  })

  it('keeps the choices when a test fails', () => {
    const s = tested(chosen, { ok: false, steps: [], scopes: [] })
    expect(picked(s)).toEqual(['orders'])
  })

  it('saves, and holds the choices while the save is on its way', () => {
    const saving = flow(chosen, { type: 'save' })
    expect(saving.save.kind).toBe('saving')
    expect(flow(saving, { type: 'why', text: 'other' })).toBe(saving)
    expect(flow(saving, { type: 'save' })).toBe(saving)
    expect(flow(saving, { type: 'saved' }).save.kind).toBe('saved')
    expect(flow(saving, { type: 'failed' }).save.kind).toBe('idle')
  })

  it('is refused as a conflict, then goes on from the latest revision with the choices kept', () => {
    const refused = run(
      chosen,
      { type: 'save' },
      { type: 'refused', failure: 'Someone changed it.' },
    )
    expect(refused.save).toEqual({ kind: 'conflict', failure: 'Someone changed it.' })
    expect(flow(refused, { type: 'save' })).toBe(refused)
    const latest = flow(refused, { type: 'reloaded', revision: 4 })
    expect(latest.revision).toBe(4)
    expect(latest.save.kind).toBe('idle')
    expect(latest.choices).toBe(chosen.choices)
    expect(flow(chosen, { type: 'reloaded', revision: 9 })).toBe(chosen)
  })
})

describe('canSave', () => {
  const ok = { tested: true, chosen: 1, mapped: 0, definitions: true }

  it('asks for the whole state: a test, something chosen, a reason, nothing on its way', () => {
    expect(canSave(chosen, ok)).toBe(true)
    expect(canSave(chosen, { ...ok, tested: false })).toBe(false)
    expect(canSave(chosen, { ...ok, chosen: 0 })).toBe(false)
    expect(canSave(run(chosen, { type: 'why', text: ' ' }), ok)).toBe(false)
    expect(canSave(flow(chosen, { type: 'save' }), ok)).toBe(false)
    expect(canSave(run(chosen, { type: 'save' }, { type: 'refused', failure: '' }), ok)).toBe(false)
  })

  it('asks a content tool for a domain for every folder', () => {
    expect(canSave(chosen, { ...ok, definitions: false, chosen: 2, mapped: 1 })).toBe(false)
    expect(canSave(chosen, { ...ok, definitions: false, chosen: 2, mapped: 2 })).toBe(true)
  })
})
