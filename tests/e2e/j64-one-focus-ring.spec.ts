import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J64: keyboard focus looks one way (second design audit, F10). Whatever the Tab key reaches shows
// the 3 px ring at 50 percent of the ring colour, drawn as a ring (box-shadow) or, for a text
// button or link that sets none, as the same-looking outline of the base style. Never the 1 px
// outline, the 2 px ring or the 2 px 40 percent outline of the audit, and never nothing. A row or
// card draws it on itself or on the row around it, inside.

const pages = [
  '/inbox',
  '/context',
  '/context/itm_norway_stop',
  '/context/itm_norway_stop/edit',
  '/definitions',
  '/ask',
  '/observability',
  '/observability/questions',
  '/settings/people',
  '/settings/agents',
  '/settings/integrations',
  '/help',
  '/inbox/sug-ines-link/review',
]

type Stop = { what: string; looks: string[] }

/** Tab through the page and read what each stop draws (itself, or the row or card around it). */
async function walk(page: Page, stops: number): Promise<Stop[]> {
  const found: Stop[] = []
  for (let i = 0; i < stops; i++) {
    await page.keyboard.press('Tab')
    // The ring fades in over a transition; read again until it has (a loaded machine is slow).
    let stop: Stop | null = null
    for (let tries = 0; tries < 8; tries++) {
      await page.waitForTimeout(150)
      stop = await read(page)
      if (!stop || stop.looks.some((l) => /^(ring|outline) 3px /.test(l))) break
    }
    if (stop) found.push(stop)
  }
  return found
}

const read = (page: Page) =>
  page.evaluate((): Stop | null => {
    const el = document.activeElement as HTMLElement | null
    // A heading focused by a script (tabindex -1) is a landing place, not a control to see.
    if (!el || el === document.body || el.tabIndex < 0) return null
    const looks = (e: Element, pseudo?: string) => {
      const cs = getComputedStyle(e, pseudo)
      const out: string[] = []
      if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0)
        out.push(`outline ${cs.outlineWidth} ${cs.outlineColor}`)
      for (const s of cs.boxShadow.split(/,(?![^(]*\))/)) {
        const m = s
          .trim()
          .match(
            /^(color\(.+?\)|rgba?\(.+?\)|oklab\(.+?\)|oklch\(.+?\)|#\w+)\s+0px 0px 0px (\d+)px(\s+inset)?$/,
          )
        if (m && Number(m[2]) >= 1) out.push(`ring ${m[2]}px ${m[1]}${m[3] ?? ''}`)
      }
      return out
    }
    // A section header's chevron draws the ring on its ::after, over the whole header row.
    const own = [...looks(el), ...looks(el, '::after')]
    // The row, card or box around it (a field inside a ringed box shows the box's ring).
    const around: Element[] = []
    for (let up = el.parentElement; up && around.length < 8; up = up.parentElement) around.push(up)
    const aroundLooks = around.flatMap((x) => looks(x))
    const label = `${el.tagName.toLowerCase()} ${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}`
    return { what: label, looks: own.length ? own : aroundLooks }
  })

/** The alpha of a computed colour: "oklab(0.5 0 0 / 0.5)" or "rgba(44, 93, 189, 0.5)". */
const alphaOf = (look: string) => {
  const slash = look.match(/\/\s*([\d.]+%?)\s*\)/)
  if (slash) return slash[1].endsWith('%') ? parseFloat(slash[1]) / 100 : parseFloat(slash[1])
  const rgba = look.match(/rgba\(([^)]+)\)/)
  return rgba ? parseFloat(rgba[1].split(',')[3]) : 1
}

for (const path of pages) {
  test(`${path}: every Tab stop draws the one ring`, async ({ page }) => {
    test.setTimeout(120_000)
    await go(page, path)
    const stops = await walk(page, 24)
    expect(stops.length, 'the page has something to Tab to').toBeGreaterThan(2)
    for (const stop of stops) {
      const rings = stop.looks.filter((l) => /^(ring|outline) 3px /.test(l))
      expect(rings.length, `${stop.what}: ${stop.looks.join(' | ') || 'nothing'}`).toBeGreaterThan(
        0,
      )
      // And none of the others besides the 3 px ones (a row's own 1 px divider is not a ring here).
      const odd = stop.looks.filter(
        (l) => /^(ring|outline) [124]px /.test(l) && !/^ring 1px/.test(l),
      )
      expect(odd, stop.what).toEqual([])
      // One ring, not two laid over each other.
      expect(rings.length, `${stop.what}: ${rings.join(' | ')}`).toBe(1)
      // 50 percent; a field's box takes the calmer 25 percent (design contract 2.6).
      const a = alphaOf(rings[0]!)
      expect(
        [0.5, 0.25].some((v) => Math.abs(a - v) < 0.02),
        `${stop.what}: ${rings[0]}`,
      ).toBe(true)
    }
  })
}
