import { describe, expect, it } from 'vitest'
import { axisTicks, xLabels } from '@/components/obs/charts'

// The axes every Observability chart draws: round ticks that never repeat ("0, 1, 1, 2" was a
// trend's axis), and labels under the plot that never run into each other ("9 Nov16 Nov").

describe('axisTicks', () => {
  it('counts in whole, round steps from 0, at or over the highest value', () => {
    expect(axisTicks(2)).toEqual([0, 1, 2])
    expect(axisTicks(9)).toEqual([0, 5, 10])
    expect(axisTicks(158)).toEqual([0, 50, 100, 150, 200])
    expect(axisTicks(1234)).toEqual([0, 500, 1000, 1500])
    expect(axisTicks(0)).toEqual([0, 1])
  })

  it('never has a tick twice, a tick that is not whole, or more steps than asked', () => {
    for (let max = 0; max <= 5000; max += 7)
      for (const most of [3, 4]) {
        const ticks = axisTicks(max, most)
        expect(new Set(ticks).size).toBe(ticks.length)
        expect(ticks.every(Number.isInteger)).toBe(true)
        expect(ticks.at(-1)!).toBeGreaterThanOrEqual(max)
        expect(ticks.length - 1).toBeLessThanOrEqual(most)
      }
  })
})

describe('xLabels', () => {
  // A label as wide as 7 px a character, as the fallback measure works it out.
  const width = (l: string) => l.length * 7
  const weeks = Array.from({ length: 13 }, (_, i) => `${i + 1} Nov`)

  it('shows every label when there is room for all of them', () => {
    const xs = weeks.map((_, i) => 40 + i * 80)
    expect(xLabels(xs, weeks, 0, 1100, width).map((l) => l.index)).toEqual(weeks.map((_, i) => i))
  })

  it('on a narrow chart, shows every second or third, always the last, and none overlap', () => {
    for (const span of [300, 340, 390, 600]) {
      const xs = weeks.map((_, i) => 30 + (i / 12) * (span - 50))
      const shown = xLabels(xs, weeks, 0, span, width)
      expect(shown.at(-1)!.index).toBe(12)
      for (let j = 1; j < shown.length; j++) {
        const a = shown[j - 1]!
        const b = shown[j]!
        expect(a.x + width(weeks[a.index]!) / 2).toBeLessThan(b.x - width(weeks[b.index]!) / 2)
      }
      // Evenly spaced: one step between all of them.
      const steps = new Set(shown.slice(1).map((l, j) => l.index - shown[j]!.index))
      expect(steps.size).toBeLessThanOrEqual(1)
    }
  })

  it('moves a label at an edge inside the drawing', () => {
    const shown = xLabels([0, 50, 100], ['28 Sept', '5 Oct', '12 Oct'], 0, 100, width)
    for (const l of shown) {
      const w = width(['28 Sept', '5 Oct', '12 Oct'][l.index]!)
      expect(l.x - w / 2).toBeGreaterThanOrEqual(0)
      expect(l.x + w / 2).toBeLessThanOrEqual(100)
    }
  })
})
