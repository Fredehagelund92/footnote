import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/errors'

const toast = vi.hoisted(() => ({ error: vi.fn(), dismiss: vi.fn(), say: vi.fn(() => 'id') }))
vi.mock('@/lib/toast', () => ({ toast: Object.assign(toast.say, toast), SAID_MS: 4000 }))

import {
  forget,
  forgetAll,
  heldFor,
  heldWords,
  LASTING_TOAST_MS,
  rememberOffer,
  rememberSending,
  showOffer,
  takeBackBy,
  undoLast,
} from '@/lib/undo'

beforeEach(() => {
  toast.error.mockClear()
  toast.dismiss.mockClear()
  toast.say.mockClear()
  forgetAll()
})

describe('an Undo the service refuses', () => {
  it('says why, and reports that nothing was taken back', async () => {
    const late = new ApiError(
      'conflict',
      'It is too late to undo this decision. Decide again instead.',
    )
    expect(await takeBackBy(() => Promise.reject(late))).toBe(false)
    expect(toast.error).toHaveBeenCalledWith("Couldn't undo it", {
      description: 'It is too late to undo this decision. Decide again instead.',
    })
  })

  it('says nothing when it was taken back', async () => {
    expect(await takeBackBy(() => Promise.resolve())).toBe(true)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('leaves a session that ended to the app, which opens sign-in', async () => {
    const out = new ApiError('signed-out', 'Sign in again.')
    expect(await takeBackBy(() => Promise.reject(out))).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('how long an Undo holds', () => {
  const at = Date.parse('2026-11-16T09:00:00Z')
  const offer = (until: string | null) => ({ token: 'change:1', until })

  it('is the window the service gave, never a number of its own', () => {
    // An admin set 6 seconds: the toast says 6, not 10.
    expect(heldWords(offer('2026-11-16T09:00:06Z'), at)).toBe('6 seconds')
    expect(heldFor(offer('2026-11-16T09:00:06Z'), at)).toBe(6000)
    expect(heldWords(offer('2026-11-16T09:00:01Z'), at)).toBe('1 second')
  })

  it('holds nothing once it ended, and for good when the service takes it at any time', () => {
    expect(heldFor(offer('2026-11-16T08:59:59Z'), at)).toBe(0)
    expect(heldFor(offer(null), at)).toBe(Infinity)
    expect(heldWords(offer(null), at)).toBeNull()
  })
})

describe('the toast of an Undo', () => {
  const at = Date.parse('2026-11-16T09:00:00Z')
  const taken = () => Promise.resolve(true)
  const said = () => toast.say.mock.calls[0] as unknown as [string, Record<string, unknown>]

  it('goes when the window ends, even while it is pointed at', () => {
    showOffer('Closed', { token: 't', until: '2026-11-16T09:00:15Z' }, taken, {}, at)
    expect(said()[1]).toMatchObject({ duration: 15_000, firm: true, action: { label: 'Undo' } })
  })

  it('goes by itself when the service takes Undo at any time', () => {
    showOffer('Closed', { token: 't', until: null }, taken, {}, at)
    expect(said()[1]).toMatchObject({
      duration: LASTING_TOAST_MS,
      firm: false,
      action: { label: 'Undo' },
    })
    expect(LASTING_TOAST_MS).toBeLessThanOrEqual(15_000)
  })

  it('keeps no Undo and no endless duration when the window had ended, over a toast that had both', () => {
    showOffer('Closed', { token: 't', until: '2026-11-16T08:59:00Z' }, taken, { id: 'said' }, at)
    const [, options] = said()
    expect(options).toMatchObject({ id: 'said', duration: 4000 })
    // An explicit undefined, which replaces the action the toast was first shown with.
    expect('action' in options && options.action).toBeUndefined()
    expect('action' in options).toBe(true)
  })
})

describe('Command and Z: the last decision, from any screen', () => {
  const at = Date.parse('2026-11-16T09:00:00Z')
  const held = { token: 'review:2', until: '2026-11-16T09:00:15Z' }
  const said = () => toast.say.mock.calls.map((c) => (c as unknown[]).slice(0, 2))

  it('takes back the last offer, closes its toast and says what it undid', async () => {
    const takeBack = vi.fn(() => Promise.resolve(true))
    const onUndone = vi.fn()
    showOffer('Published “Sales targets”', held, takeBack, { onUndone }, at)
    toast.say.mockClear()
    expect(await undoLast(at + 1000)).toBe(true)
    expect(takeBack).toHaveBeenCalledWith(held)
    expect(toast.dismiss).toHaveBeenCalledWith('id')
    expect(said()).toEqual([['Undone', { description: 'Published “Sales targets”' }]])
    expect(onUndone).toHaveBeenCalledOnce()
    // One last action, never a history: there is nothing left to take back.
    toast.say.mockClear()
    expect(await undoLast(at + 2000)).toBe(false)
    expect(said()).toEqual([['Nothing to undo']])
    expect(takeBack).toHaveBeenCalledOnce()
  })

  it('takes back only the newest of two offers', async () => {
    const first = vi.fn(() => Promise.resolve(true))
    const second = vi.fn(() => Promise.resolve(true))
    showOffer('Published “A”', { token: 'review:1', until: held.until }, first, {}, at)
    showOffer('Published “B”', held, second, {}, at)
    await undoLast(at)
    expect(second).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()
  })

  it('says the words an offer gave for its undo, in place of Undone', async () => {
    rememberOffer('Published 3', held, () => Promise.resolve(true), {
      undone: { title: 'Back: 3 waiting again', description: 'Nothing was published.' },
    })
    await undoLast(at)
    expect(said()).toEqual([['Back: 3 waiting again', { description: 'Nothing was published.' }]])
  })

  it('says it is too late once the service no longer holds it, and takes nothing back', async () => {
    const takeBack = vi.fn(() => Promise.resolve(true))
    rememberOffer('Closed “Churn”', held, takeBack)
    expect(await undoLast(Date.parse('2026-11-16T09:00:16Z'))).toBe(false)
    expect(takeBack).not.toHaveBeenCalled()
    expect(said()).toEqual([["It's too late to undo that", { description: 'Closed “Churn”' }]])
  })

  it('holds an offer the service takes at any time for good', async () => {
    const takeBack = vi.fn(() => Promise.resolve(true))
    rememberOffer('Set aside', { token: 'gap:1', until: null }, takeBack)
    expect(await undoLast(Date.parse('2027-01-01T00:00:00Z'))).toBe(true)
  })

  it('keeps the offer when the service refuses, so nothing says Undone', async () => {
    rememberOffer('Published “A”', held, () => Promise.resolve(false))
    expect(await undoLast(at)).toBe(false)
    expect(said()).toEqual([])
  })

  it('has nothing to take back once the offer was taken back another way', async () => {
    rememberOffer('Published “A”', held, () => Promise.resolve(true), { toast: 'said' })
    forget(held)
    expect(toast.dismiss).toHaveBeenCalledWith('said')
    expect(await undoLast(at)).toBe(false)
    expect(said()).toEqual([['Nothing to undo']])
  })

  it('while a decision is being sent, waits for it instead of taking back the one before', async () => {
    const before = vi.fn(() => Promise.resolve(true))
    rememberOffer('Published “A”', held, before)
    const waiting = rememberSending('Still publishing “B”')
    expect(await undoLast(at)).toBe(false)
    expect(before).not.toHaveBeenCalled()
    expect(said()).toEqual([['Still publishing “B”', { description: 'Undo it once it is done.' }]])
    // It failed: nothing of it to take back, so the one before is the last again.
    waiting.failed()
    expect(await undoLast(at)).toBe(true)
    expect(before).toHaveBeenCalledOnce()
  })

  it('takes back a decision still being saved when its screen can, as its own Undo does', async () => {
    const early = vi.fn()
    rememberSending('Still saving that decision', early)
    expect(await undoLast(at)).toBe(true)
    expect(early).toHaveBeenCalledOnce()
    expect(said()).toEqual([['Undone']])
  })

  it('an offer that arrives replaces the wait; one taken back as it arrived leaves nothing', async () => {
    const waiting = rememberSending('Still publishing “B”')
    const takeBack = vi.fn(() => Promise.resolve(true))
    rememberOffer('Published “B”', held, takeBack)
    // Too late to end the wait: the offer is the last now.
    waiting.failed()
    await undoLast(at)
    expect(takeBack).toHaveBeenCalledOnce()
    const again = rememberSending('Still saving that decision')
    again.undone()
    toast.say.mockClear()
    expect(await undoLast(at)).toBe(false)
    expect(said()).toEqual([['Nothing to undo']])
  })
})
