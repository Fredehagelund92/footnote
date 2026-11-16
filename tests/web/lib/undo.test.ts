import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/errors'

const toast = vi.hoisted(() => ({ error: vi.fn(), dismiss: vi.fn(), say: vi.fn(() => 'id') }))
vi.mock('sonner', () => ({ toast: Object.assign(toast.say, toast) }))

import { heldFor, heldWords, LASTING_TOAST_MS, showOffer, takeBackBy } from '@/lib/undo'

beforeEach(() => {
  toast.error.mockClear()
  toast.dismiss.mockClear()
  toast.say.mockClear()
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

  it('goes when the window ends', () => {
    vi.useFakeTimers({ now: at })
    showOffer('Closed', { token: 't', until: '2026-11-16T09:00:15Z' }, taken, {}, at)
    expect(said()[1]).toMatchObject({ duration: 15_000, action: { label: 'Undo' } })
    vi.advanceTimersByTime(15_000)
    expect(toast.dismiss).toHaveBeenCalledWith('id')
    vi.useRealTimers()
  })

  it('goes by itself when the service takes Undo at any time', () => {
    showOffer('Closed', { token: 't', until: null }, taken, {}, at)
    expect(said()[1]).toMatchObject({ duration: LASTING_TOAST_MS, action: { label: 'Undo' } })
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
