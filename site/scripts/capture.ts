import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Page } from '@playwright/test'
import sharp from 'sharp'

/*
  Takes the pictures of the app again, from a running web build on the demo data: the landing
  page's, into landing/captures, and the README's, into docs/images (site/README.md, "The
  pictures"). In the repository's root: `npx vite build && npx vite preview --port 5517`; then here:

    npm run capture                      # or BASE=http://localhost:5517 npm run capture
    npm run capture -- landing           # only the landing page's, or `-- readme` only the README's

  The landing page's are taken in English, in light and dark, at 1280 x 800 for wide screens and
  at 390 x 780 for phones, both at twice the pixels, with motion reduced. The README's is one wide
  picture in light, as GitHub shows a README on white.
*/

const base = process.env.BASE ?? 'http://localhost:5517'
const out = join(import.meta.dirname, '../landing/captures')
mkdirSync(out, { recursive: true })
const readmePicture = join(import.meta.dirname, '../../docs/images/answer.png')
const only = process.argv[2]
if (only && only !== 'landing' && only !== 'readme')
  throw new Error(`Take "landing", "readme" or, with nothing named, both: not "${only}".`)

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

/**
 * The README's picture: Ask's answer on the demo, with the panel that shows where its first
 * sentence comes from, who checked that item and when. History is hidden, so the answer has room.
 */
async function takeReadmePicture() {
  const context = await browser.newContext({
    viewport: { width: 1180, height: 660 },
    deviceScaleFactor: 2,
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  await page.goto(`${base}/ask`)
  const box = page.getByRole('textbox', { name: /Ask/ }).first()
  await box.waitFor()
  await page.getByRole('button', { name: 'Hide history' }).click()
  await box.fill('Why did orders in Norway drop in August?')
  await box.press('Enter')
  // The answer's first sentence opens where it says that: the item, who checked it, the source.
  await page
    .getByRole('button', { name: /^Online sales to Norway stopped on 4 August 2026 under/ })
    .click()
  await page.getByText('In the context item, checked by Jon Abara').waitFor()
  await page.mouse.move(0, 659)
  await page.waitForTimeout(1200)
  // A hairline frame, so the white app keeps its edges on GitHub's white page.
  await sharp(await page.screenshot())
    .extend({ top: 2, bottom: 2, left: 2, right: 2, background: '#d0d4da' })
    .png({ palette: true, quality: 90 })
    .toFile(readmePicture)
  console.log('took', readmePicture)
  await context.close()
}

const browser = await chromium.launch()
try {
  for (const size of only === 'readme' ? [] : sizes)
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
  if (only !== 'landing') await takeReadmePicture()
} finally {
  await browser.close()
}
