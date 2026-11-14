/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { byPointer, inSight, moveRows } from '../../../src/web/lib/list-motion'

// The motion rules as checks (docs/design/motion.md): every duration and easing comes from the tokens in
// index.css, so reduced motion is one rule there, not an override on each component.

const ROOT = fileURLToPath(new URL('../../../src/web', import.meta.url))
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
const source = files(ROOT).map((path) => ({
  file: relative(ROOT, path),
  text: readFileSync(path, 'utf8'),
}))

function hits(re: RegExp, allowed: (line: string, file: string) => boolean = () => false) {
  return source.flatMap(({ file, text }) =>
    text.split('\n').flatMap((line, i) => {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
      return [...line.matchAll(g)]
        .filter(() => !allowed(line, file))
        .map((m) => `${file}:${i + 1} ${m[0]}`)
    }),
  )
}

describe('motion tokens', () => {
  it('uses the duration tokens, never a raw duration', () => {
    expect(hits(/\b(duration|delay)-\d+\b/)).toEqual([])
  })
  it('never transitions everything, never eases in, never scales from nothing', () => {
    expect(hits(/\btransition-all\b|\bease-in\b(?!-)|\bscale-0\b|\bease-\[/)).toEqual([])
  })
  it('keeps linear for loops and progress, never for movement', () => {
    expect(hits(/\bease-linear\b/)).toEqual([])
  })
  it('lets the tokens carry reduced motion, with no transition overrides of their own', () => {
    expect(hits(/motion-reduce:transition-none|motion-reduce:shimmer-none/)).toEqual([])
    // An animate-none override is only for a component's own keyframes.
    expect(hits(/motion-reduce:animate-none/, (line) => line.includes('animate-['))).toEqual([])
  })
  it('counts a number and moves a bar in CSS, never in a frame-by-frame script', () => {
    // Overview's numbers and bars move on the tokens (count-up, bar-move), so reduced motion
    // reaches them through the one block in the token file.
    expect(
      hits(
        /requestAnimationFrame/,
        (_, file) => !/^(components\/obs|pages\/observability)\//.test(file),
      ),
    ).toEqual([])
    expect(
      hits(/requestAnimationFrame/, (_, file) => file !== 'components/heed/count-up.tsx'),
    ).toEqual([])
  })
  it('runs its own keyframes only for the countdown and the read fill', () => {
    expect(hits(/animate-\[(?!countdown_|readfill_)[^\]]*\]/)).toEqual([])
  })
})

describe('list motion', () => {
  const dataset: Record<string, string> = {}
  let ran: (() => Promise<void>) | null
  let finish: () => void
  let starts: number

  beforeEach(() => {
    for (const k of Object.keys(dataset)) delete dataset[k]
    starts = 0
    ran = null
    vi.stubGlobal('document', {
      documentElement: { dataset },
      querySelectorAll: () => [],
      startViewTransition: (update: () => Promise<void>) => {
        starts++
        ran = update
        return { finished: new Promise<void>((done) => (finish = done)) }
      },
    })
    vi.stubGlobal('window', { innerHeight: 800 })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('changes at once, with no transition, when instant', () => {
    const change = vi.fn()
    moveRows(change, true)
    expect(change).toHaveBeenCalledOnce()
    expect(starts).toBe(0)
    expect(dataset.vt).toBeUndefined()
  })

  it('changes at once when the browser has no view transitions', () => {
    vi.stubGlobal('document', { documentElement: { dataset } })
    const change = vi.fn()
    moveRows(change, false)
    expect(change).toHaveBeenCalledOnce()
  })

  it('makes the change inside one transition, marked for its duration', async () => {
    const change = vi.fn()
    moveRows(change, false)
    expect(starts).toBe(1)
    expect(change).not.toHaveBeenCalled()
    expect(dataset.vt).toBe('filters')
    await ran?.()
    expect(change).toHaveBeenCalledOnce()
    expect(dataset.vt).toBe('filters')
    finish()
    await vi.waitFor(() => expect(dataset.vt).toBeUndefined())
  })

  it('makes a change at once while a transition runs', async () => {
    moveRows(vi.fn(), false)
    const second = vi.fn()
    moveRows(second, false)
    expect(starts).toBe(1)
    expect(second).toHaveBeenCalledOnce()
    finish()
    await vi.waitFor(() => expect(dataset.vt).toBeUndefined())
  })

  it('waits for a change that returns a promise', async () => {
    let settled = false
    moveRows(
      () =>
        new Promise<void>((done) =>
          setTimeout(() => {
            settled = true
            done()
          }, 20),
        ),
      false,
    )
    await ran?.()
    expect(settled).toBe(true)
    finish()
    await vi.waitFor(() => expect(dataset.vt).toBeUndefined())
  })

  it('counts a click with clicks as a pointer, and the keys and no press as not', () => {
    expect(byPointer({ detail: 1 })).toBe(true)
    expect(byPointer({ detail: 0 })).toBe(false)
    expect(byPointer(null)).toBe(false)
    expect(byPointer(undefined)).toBe(false)
  })

  it('marks only the rows whose box is on the screen', () => {
    const el = (top: number, bottom: number) => ({
      dataset: {} as Record<string, string>,
      getBoundingClientRect: () => ({ top, bottom }),
    })
    const shown = el(100, 140)
    const below = el(900, 940)
    const above = el(-60, -10)
    const was = el(900, 940)
    was.dataset.vtSeen = ''
    vi.stubGlobal('document', {
      querySelectorAll: () => [shown, below, above, was],
    })
    inSight()
    expect(shown.dataset.vtSeen).toBe('')
    expect(below.dataset.vtSeen).toBeUndefined()
    expect(above.dataset.vtSeen).toBeUndefined()
    expect(was.dataset.vtSeen).toBeUndefined()
  })
})
