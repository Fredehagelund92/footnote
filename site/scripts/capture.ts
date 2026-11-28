import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Page } from '@playwright/test'
import sharp from 'sharp'

/*
  Takes the pictures of the app again, from a running web build on the demo data: the landing
  page's, into landing/captures, the README's, into docs/images, and the docs' pictures of screens,
  into docs/images/docs (site/README.md, "The pictures"). In the repository's root:
  `npx vite build && npx vite preview --port 5517`; then here:

    npm run capture                      # or BASE=http://localhost:5517 npm run capture
    npm run capture -- landing           # only the landing page's; `-- readme` or `-- docs` the same

  The landing page's are taken in English, in light and dark, at 1280 x 800 and twice the pixels,
  with motion reduced; its tour shows three of the docs' beside them. The README's is one wide
  picture in light, as GitHub shows a README on white. The docs' are wide, in light and dark, each
  cropped to the part of the screen its page is about. The web build's demo is the invented
  company's, and no picture may show the line that says the build is a design preview.
*/

const base = process.env.BASE ?? 'http://localhost:5517'
const out = join(import.meta.dirname, '../landing/captures')
mkdirSync(out, { recursive: true })
const readmePicture = join(import.meta.dirname, '../../docs/images/answer.png')
const docsOut = join(import.meta.dirname, '../../docs/images/docs')
const only = process.argv[2]
if (only && only !== 'landing' && only !== 'readme' && only !== 'docs')
  throw new Error(`Take "landing", "readme", "docs" or, with nothing named, all: not "${only}".`)
const takes = (set: string) => !only || only === set

type Shot = {
  name: string
  path: string
  ready: (page: Page) => Promise<unknown>
  prepare?: (page: Page) => Promise<unknown>
  /** The part of the screen to keep. */
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

type Box = { x: number; y: number; width: number; height: number }

/** A part of the screen, with some room around it, kept inside the 1280 x 800 screen. */
async function around(page: Page, selector: string, room = 24): Promise<Box> {
  const box = (await page.locator(selector).first().boundingBox())!
  const x = Math.max(0, Math.round(box.x - room))
  const y = Math.max(0, Math.round(box.y - room))
  return {
    x,
    y,
    width: Math.min(1280, Math.round(box.x + box.width + room)) - x,
    height: Math.min(800, Math.round(box.y + box.height + room)) - y,
  }
}

/** The page under its header, without the app's sidebar. */
async function underHeader(page: Page): Promise<Box> {
  const box = (await page.locator('main').first().boundingBox())!
  return { x: Math.round(box.x), y: 48, width: Math.round(1280 - box.x), height: 752 }
}

/** The pictures of the docs' pages (docs/help/README.md, "Pictures"), each named for its page. */
const docsShots: Shot[] = [
  {
    name: 'setup',
    path: '/inbox?demo=setup',
    ready: (p) => p.getByText('Publish your names').waitFor(),
    clip: (p) => around(p, '[data-slot="card"]'),
  },
  {
    name: 'names',
    path: '/inbox?demo=names',
    ready: (p) => p.locator('#inbox-detail section').first().waitFor(),
    clip: (p) => around(p, '#inbox-detail', 0),
  },
  {
    name: 'ask-answer',
    path: '/ask?example=grounded',
    ready: (p) => p.getByText('Read as').waitFor(),
    prepare: (p) => p.getByRole('button', { name: 'Hide history' }).click(),
    // From under the header to just below the answer's buttons, without the box to ask in.
    clip: async (p) => {
      const box = await around(p, '[aria-label="Questions and answers"]')
      return until(p, { ...box, y: 48, height: 752 }, '[aria-label="Ask again"]', 'end')
    },
  },
  {
    name: 'item',
    path: '/context/itm_norway_stop',
    ready: (p) => p.getByText('Parcels from webshops outside Norway', { exact: false }).waitFor(),
    clip: underHeader,
  },
  {
    name: 'editor',
    path: '/context/new',
    // Write context opens on the empty form with writing help beside it: the picture is the form.
    ready: (p) => p.locator('[aria-label="Properties"]').waitFor(),
    prepare: async (p) => {
      const dock = p.getByRole('region', { name: 'Writing help' })
      await dock.getByRole('button', { name: 'Close the panel' }).click()
      await dock.waitFor({ state: 'detached' })
    },
    clip: underHeader,
  },
  {
    name: 'review',
    path: '/inbox/sug-ines/review',
    ready: (p) => p.locator('[aria-label="The source"]').waitFor(),
    clip: underHeader,
  },
  {
    name: 'inbox',
    path: '/inbox?card=sug-ines',
    ready: (p) => p.locator('#inbox-detail section').first().waitFor(),
    clip: (p) => around(p, '#inbox', 0),
  },
  {
    name: 'compare',
    path: '/context/conflicts/itm_france_switch_12.itm_france_switch_21',
    ready: (p) => p.getByRole('button', { name: 'Keep both' }).waitFor(),
    // The two items side by side, down to what can be done with each.
    clip: async (p) => until(p, await underHeader(p), 'button:has-text("Keep this one")', 'end', 8),
  },
  {
    name: 'agents',
    path: '/settings/agents',
    ready: (p) => p.getByRole('button', { name: 'Copy prompt' }).waitFor(),
    // The prompt and the line that waits for the agent, above the quick ways in.
    clip: async (p) =>
      until(p, await underHeader(p), 'text="Or start from your agent"', 'start', 12),
  },
  {
    name: 'approve',
    path: '/connect/approve?request=demo-agent-sign-in-waiting-for-your-answer0',
    ready: (p) => p.getByRole('button', { name: 'Allow', exact: true }).waitFor(),
    // The card with the logo above it.
    clip: async (p) => {
      const box = await around(p, '[data-slot="card"]', 32)
      return { ...box, y: 24, height: box.y + box.height - 24 }
    },
  },
  {
    name: 'integrations',
    path: '/settings/integrations',
    ready: (p) => p.getByRole('heading', { level: 1 }).waitFor(),
    // Connected and Available, above the last row's card.
    clip: async (p) =>
      until(
        p,
        await underHeader(p),
        '[data-slot="page-scroll"] >> text=Request an integration',
        'start',
        64,
      ),
  },
  {
    name: 'observability',
    path: '/observability',
    ready: (p) => p.getByRole('heading', { name: 'Questions per day' }).waitFor(),
    clip: underHeader,
  },
  {
    name: 'inbox-due',
    path: '/inbox?card=check-returns',
    ready: (p) => p.getByRole('button', { name: /^Still true/ }).waitFor(),
    clip: (p) => around(p, '#inbox-detail', 0),
  },
  {
    name: 'inbox-nothing-written',
    path: '/inbox?card=gap-spain',
    ready: (p) => p.getByText('After you publish', { exact: true }).first().waitFor(),
    clip: (p) => around(p, '#inbox-detail', 0),
  },
]

/** A part of the screen cut off where something on it ends, or just above where it starts. */
async function until(page: Page, box: Box, selector: string, at: 'end' | 'start', room = 24) {
  const mark = (await page.locator(selector).filter({ visible: true }).first().boundingBox())!
  const y = at === 'end' ? mark.y + mark.height + room : mark.y - room
  return { ...box, height: Math.round(Math.min(800, y) - box.y) }
}

/** The docs' pictures: wide, in light and dark, at most 1440 pixels across. */
async function takeDocsPictures() {
  mkdirSync(docsOut, { recursive: true })
  for (const colorScheme of ['light', 'dark'] as const) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
      locale: 'en-GB',
      timezoneId: 'Europe/London',
      colorScheme,
      reducedMotion: 'reduce',
    })
    for (const shot of docsShots) {
      const page = await context.newPage()
      await page.goto(base + shot.path)
      await shot.ready(page)
      await shot.prepare?.(page)
      await page.mouse.move(0, 799)
      await page.waitForTimeout(1200)
      if (await page.getByText('A design preview').filter({ visible: true }).count())
        throw new Error(`${shot.path} shows that the build is a design preview`)
      const png = await page.screenshot({ clip: await shot.clip(page) })
      const name = `${shot.name}-${colorScheme}.webp`
      await sharp(png)
        .resize({ width: 1440, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(join(docsOut, name))
      console.log('took', name)
      await page.close()
    }
    await context.close()
  }
}

const screen = { width: 1280, height: 800 }

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
  if (takes('landing'))
    for (const colorScheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({
        viewport: screen,
        deviceScaleFactor: 2,
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
        await page.mouse.move(0, screen.height - 1)
        await page.waitForTimeout(1200)
        const png = await page.screenshot({ clip: await shot.clip(page) })
        const name = `${shot.name}-${colorScheme}.webp`
        await sharp(png).resize({ width: 1600 }).webp({ quality: 78 }).toFile(join(out, name))
        console.log('took', name)
        await page.close()
      }
      await context.close()
    }
  if (takes('readme')) await takeReadmePicture()
  if (takes('docs')) await takeDocsPictures()
} finally {
  await browser.close()
}
