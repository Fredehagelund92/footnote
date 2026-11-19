import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Page } from '@playwright/test'
import sharp from 'sharp'

/*
  Takes the landing page's pictures of the app again, from a running web build on the demo data,
  and writes them to landing/captures, where the page reads them (site/README.md, "The pictures").
  In the repository's root: `npx vite build && npx vite preview --port 5517`; then here:

    npm run capture                      # or BASE=http://localhost:5517 npm run capture

  Each picture is taken in English, in light and dark, at 1280 x 800 for wide screens and at
  390 x 780 for phones, both at twice the pixels, with motion reduced.
*/

const base = process.env.BASE ?? 'http://localhost:5517'
const out = join(import.meta.dirname, '../landing/captures')
mkdirSync(out, { recursive: true })

type Shot = {
  name: string
  path: string
  ready: (page: Page) => Promise<unknown>
  prepare?: (page: Page) => Promise<unknown>
  /** On wide screens, the part of the screen to keep; a phone keeps all of it. */
  clip: (page: Page) => Promise<{ x: number; y: number; width: number; height: number }>
}

const shots: Shot[] = [
  {
    name: 'item',
    path: '/context/itm_norway_stop',
    ready: (page) =>
      page.getByText('Parcels from webshops outside Norway', { exact: false }).waitFor(),
    prepare: async (page) => {
      const fold = page.getByRole('button', { name: 'Fold the panel' })
      if (await fold.isVisible().catch(() => false)) await fold.click()
    },
    // The item's sheet: from just left of its title to the folded panel's rail.
    clip: async (page) => {
      const box = (await page.getByRole('heading', { level: 1 }).first().boundingBox())!
      const x = Math.max(0, Math.round(box.x - 72))
      return { x, y: 48, width: 1280 - 48 - x, height: 752 }
    },
  },
  {
    name: 'observability',
    path: '/observability',
    ready: (page) => page.getByRole('heading', { level: 1 }).waitFor(),
    // The page without the app's sidebar.
    clip: async (page) => {
      const box = (await page.locator('main').first().boundingBox())!
      return { x: Math.round(box.x), y: 0, width: Math.round(1280 - box.x), height: 800 }
    },
  },
]

const sizes = [
  { suffix: '', viewport: { width: 1280, height: 800 }, phone: false, width: 1600 },
  { suffix: '-phone', viewport: { width: 390, height: 780 }, phone: true, width: 780 },
]

const browser = await chromium.launch()
try {
  for (const size of sizes)
    for (const colorScheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({
        viewport: size.viewport,
        deviceScaleFactor: 2,
        isMobile: size.phone,
        hasTouch: size.phone,
        locale: 'en-GB',
        timezoneId: 'Europe/London',
        colorScheme,
        reducedMotion: 'reduce',
      })
      for (const shot of shots) {
        const page = await context.newPage()
        await page.goto(base + shot.path)
        await shot.ready(page)
        await shot.prepare?.(page)
        await page.mouse.move(0, size.viewport.height - 1)
        await page.waitForTimeout(1200)
        const png = await page.screenshot({ clip: size.phone ? undefined : await shot.clip(page) })
        const name = `${shot.name}-${colorScheme}${size.suffix}.webp`
        await sharp(png).resize({ width: size.width }).webp({ quality: 78 }).toFile(join(out, name))
        console.log('took', name)
        await page.close()
      }
      await context.close()
    }
} finally {
  await browser.close()
}
