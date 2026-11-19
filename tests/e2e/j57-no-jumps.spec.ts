import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// A page that moves after it has drawn makes people wait before they dare to read or click. The
// browser's own layout-shift entries, from a fresh visit with no input, must add up to next to
// nothing: the web font arriving may nudge a line or a button (Ask, 0.0003 here and 0.0013 on CI's
// slower runners), a panel taking its place may not (those were 0.1, 0.027 and 0.016).

type Shift = { v: number; t: number; src: string }

async function shifts(page: Page, route: string, drawn?: string) {
  await page.addInitScript(() => {
    const seen: Shift[] = []
    ;(window as unknown as { __shifts: Shift[] }).__shifts = seen
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as {
        value: number
        startTime: number
        hadRecentInput: boolean
        sources?: { node?: Element; previousRect: DOMRect; currentRect: DOMRect }[]
      }[]) {
        if (e.hadRecentInput) continue
        const s = (e.sources ?? [])
          .map(
            (x) =>
              `${x.node?.nodeName} ${String((x.node as HTMLElement | undefined)?.className ?? '').slice(0, 60)} y ${Math.round(x.previousRect.y)}>${Math.round(x.currentRect.y)} x ${Math.round(x.previousRect.x)}>${Math.round(x.currentRect.x)} w ${Math.round(x.previousRect.width)}>${Math.round(x.currentRect.width)}`,
          )
          .join(' | ')
        seen.push({ v: e.value, t: Math.round(e.startTime), src: s })
      }
    }).observe({ type: 'layout-shift', buffered: true })
  })
  await go(page, route)
  // On the service a page can take longer than the wait below to draw: a list that has not drawn yet
  // cannot be seen to move.
  if (drawn) await page.getByRole('list', { name: drawn }).getByRole('listitem').first().waitFor()
  await page.waitForTimeout(1800)
  return page.evaluate(() => (window as unknown as { __shifts: Shift[] }).__shifts)
}

const pages: [name: string, route: string, drawn?: string][] = [
  ['a review', '/inbox/sug-ines-link/review'],
  ['Ask', '/ask'],
  ['Observability', '/observability'],
  ['Settings, People', '/settings/people', 'People'],
  ['Settings, Agents', '/settings/agents', 'Connected agents'],
]

for (const [name, route, drawn] of pages) {
  test(`${name} does not move once it has drawn`, async ({ page }) => {
    const found = await shifts(page, route, drawn)
    expect(
      found.reduce((n, s) => n + s.v, 0),
      JSON.stringify(found),
    ).toBeLessThan(0.005)
  })
}
