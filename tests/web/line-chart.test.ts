// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { LineChart } from '@/components/obs/charts'

// Usage's speed chart (S2 of the Observability audit): its top comes from the data, so a slow day
// is drawn inside the frame, never above it, and a day with no reply timed is a gap, not 0 ms.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

let root: Root | undefined
let host: HTMLElement | undefined
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

/** The demo week's replies, in milliseconds: Mon 16 is 158 ms, and Sun 15 had none timed. */
const labels = ['Wed 11', 'Thu 12', 'Fri 13', 'Sat 14', 'Sun 15', 'Mon 16', 'Tue 17']
const median = [12, 13, 14, 11, null, 15, 12]
const p95 = [49, 60, 153, 54, null, 158, 103]

/** Every point of every drawn line, as "x,y". */
function linePoints(svg: SVGElement) {
  return [...svg.querySelectorAll('path[fill="none"]')].flatMap((p) =>
    p.getAttribute('d')!.slice(2).split(' L '),
  )
}

function draw(values: { median: (number | null)[]; p95: (number | null)[] } = { median, p95 }) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() =>
    root!.render(
      React.createElement(LineChart, {
        series: [
          { name: 'Median', values: values.median, color: 'var(--primary)' },
          { name: '95 of 100', values: values.p95, color: 'var(--chart-2)' },
        ],
        labels,
        height: 210,
        format: (v: number) => `${v} ms`,
        missing: 'No reply timed',
        caption: 'How long a reply took, by day, in milliseconds',
      }),
    ),
  )
  return host.querySelector('svg')!
}

it('draws every point inside the plot when a day takes 158 ms', () => {
  const svg = draw()
  const lines = [...svg.querySelectorAll('line')].map((l) => Number(l.getAttribute('y1')))
  const top = Math.min(...lines)
  const bottom = Math.max(...lines)
  const ys = [
    ...linePoints(svg).map((pt) => Number(pt.split(',')[1])),
    ...[...svg.querySelectorAll('circle')].map((c) => Number(c.getAttribute('cy'))),
  ]
  expect(ys.length).toBeGreaterThan(0)
  for (const y of ys) {
    expect(y).toBeGreaterThanOrEqual(top)
    expect(y).toBeLessThanOrEqual(bottom)
  }
  // The axis is round, in four steps, up to the first round number over the slowest day.
  const ticks = [...svg.querySelectorAll('text:not([data-x-label])')].map((t) => t.textContent)
  expect(ticks).toEqual(['0 ms', '50 ms', '100 ms', '150 ms', '200 ms'])
})

it('leaves a gap for a day with no reply timed, never a point at 0 ms', () => {
  const svg = draw()
  // Each series breaks at Sun 15: two runs of shown days, and no point on the floor.
  expect(svg.querySelectorAll('path[fill="none"]')).toHaveLength(4)
  const floor = Math.max(
    ...[...svg.querySelectorAll('line')].map((l) => Number(l.getAttribute('y1'))),
  )
  const points = linePoints(svg)
  expect(points.some((pt) => Number(pt.split(',')[1]) === floor)).toBe(false)
  const sunday = [...host!.querySelectorAll('tbody tr')].find((r) =>
    r.textContent?.startsWith('Sun 15'),
  )
  expect(sunday?.textContent).toBe('Sun 15No reply timedNo reply timed')
})

it('labels whole numbers on every gridline when the slowest day is just under 10 ms', () => {
  const svg = draw({ median: [3, 4, 5, 4, 3, 4, 5], p95: [6, 7, 9, 8, 7, 9, 8] })
  const ticks = [...svg.querySelectorAll('text:not([data-x-label])')].map((t) => t.textContent)
  expect(ticks).toEqual(['0 ms', '5 ms', '10 ms'])
})
