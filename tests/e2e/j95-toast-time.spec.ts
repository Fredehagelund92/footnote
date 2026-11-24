import { card, expect, go, test } from './go.ts'
import type { Locator, Page } from '@playwright/test'

// J95: a toast shows its time and really leaves. A bar along its foot empties as its time runs out
// and stands still while the pointer is over it or it holds focus; then it slides out past the
// window's right edge, as Close and Escape do. A finger that tapped it does not hold it for good
// (it used to stay until the next tap elsewhere), and with reduced motion it goes at once, with no
// bar. Closing a gap says so in a toast with Undo the service takes at any time: 10 seconds.

/** The page's clock stands still from the start, and moves only as far as the journey runs it. */
async function stillClock(page: Page) {
  await page.clock.install()
  await page.clock.pauseAt(Date.now() + 1000)
}

/** Runs the clock in small steps until the toast's time has started (the save behind it is in). */
async function untilTimed(page: Page, toast: Locator) {
  await expect
    .poll(
      async () => {
        await page.clock.runFor(50)
        return toast.locator('[data-timed]').count()
      },
      { intervals: [50], timeout: 15_000 },
    )
    .toBe(1)
}

/** Closes the gap; its toast, once the close is saved and its time has started. */
async function closeGap(page: Page) {
  await stillClock(page)
  await go(page, `/inbox?card=${card('gap-spain')}`)
  await page.getByRole('button', { name: 'Not something we write down' }).first().click()
  // The pointer that clicked is not over the toast.
  await page.mouse.move(2, 2)
  const toast = page.locator('[data-sonner-toast]')
  await untilTimed(page, toast)
  return toast
}

const bar = (toast: Locator) => toast.locator('[data-slot=toast-time]')
const held = (toast: Locator) => toast.locator('[data-slot=toast]')

/**
 * Watches a toast leave: when its slide out ends, how far its left edge is past the window's right
 * edge (positive once it is out of the window). The slide is a real CSS transition.
 */
const watchLeaving = (page: Page) =>
  page.evaluate(() => {
    document.addEventListener(
      'transitionend',
      (e) => {
        const el = e.target as HTMLElement
        if (e.propertyName === 'transform' && el.matches('[data-sonner-toast][data-removed=true]'))
          (window as { outBy?: number }).outBy = Math.round(
            el.getBoundingClientRect().left - window.innerWidth,
          )
      },
      true,
    )
  })
const outBy = (page: Page) => page.evaluate(() => (window as { outBy?: number }).outBy ?? null)

/**
 * The toast is leaving, then gone. Sonner takes it away 200ms after it starts to leave, on a timer
 * it sets once React has drawn the leaving, which is after the clock was last run.
 */
async function leaves(page: Page, toast: Locator) {
  await expect(toast).toHaveAttribute('data-removed', 'true')
  await page.clock.runFor(300)
  await expect(toast).toHaveCount(0)
}

test('a toast goes by itself after its time, sliding out past the right edge', async ({ page }) => {
  const toast = await closeGap(page)
  await expect(bar(toast)).toBeVisible()
  await watchLeaving(page)
  await page.clock.runFor(9800)
  await expect(toast).toHaveCount(1)
  await page.clock.runFor(300)
  // It leaves to the right, out of the window, not fading where it stood.
  await expect.poll(() => outBy(page)).toBeGreaterThan(0)
  await leaves(page, toast)
})

test('the bar empties, and stands still while the pointer is over the toast', async ({ page }) => {
  const toast = await closeGap(page)
  const width = () => bar(toast).evaluate((el) => el.getBoundingClientRect().width)
  const full = (await toast.boundingBox())!.width
  await expect.poll(width).toBeLessThan(full - 2)

  await toast.hover()
  await expect(held(toast)).toHaveAttribute('data-held', 'true')
  await expect(bar(toast)).toHaveCSS('animation-play-state', 'paused')
  const at = await width()
  await page.clock.runFor(30_000)
  await expect(toast).toHaveCount(1)
  expect(await width()).toBeCloseTo(at, 0)

  // Let go, it runs on from where it stood.
  await page.mouse.move(2, 2)
  await expect(held(toast)).not.toHaveAttribute('data-held')
  await page.clock.runFor(10_500)
  await leaves(page, toast)
})

test('a click on the toast holds it only while the pointer is there', async ({ page }) => {
  const toast = await closeGap(page)
  await toast.getByText('Agents keep saying').click()
  await page.mouse.move(2, 2)
  await expect(held(toast)).not.toHaveAttribute('data-held')
  await page.clock.runFor(10_500)
  await leaves(page, toast)
})

test('Close slides the toast out at once', async ({ page }) => {
  const toast = await closeGap(page)
  await watchLeaving(page)
  await toast.getByRole('button', { name: 'Close' }).click()
  // Sonner starts the leaving on the next frame.
  await page.clock.runFor(50)
  await expect.poll(() => outBy(page)).toBeGreaterThan(0)
  await leaves(page, toast)
})

test('from the keyboard: focus holds the toast, Escape closes it', async ({ page }) => {
  const toast = await closeGap(page)
  // Sonner's own key for the toasts, then into the toast.
  await page.keyboard.press('Alt+KeyT')
  await page.keyboard.press('Tab')
  await expect(held(toast)).toHaveAttribute('data-held', 'true')
  await page.clock.runFor(30_000)
  await expect(toast).toHaveCount(1)
  await page.keyboard.press('Tab')
  await expect(toast.getByRole('button', { name: 'Undo' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(toast.getByRole('button', { name: 'Close' })).toBeFocused()
  await expect(held(toast)).toHaveAttribute('data-held', 'true')
  await watchLeaving(page)
  await page.keyboard.press('Escape')
  // Sonner starts the leaving on the next frame.
  await page.clock.runFor(50)
  await expect.poll(() => outBy(page)).toBeGreaterThan(0)
  await leaves(page, toast)
})

test('a toast whose Undo ends at a moment runs on while pointed at', async ({ page }) => {
  // The demo takes the Undo of a deletion for 15 seconds: its toast goes then, pointed at or not.
  await page.clock.install()
  await go(page, '/context')
  await page.getByRole('button', { name: /^Filter/ }).click()
  await page.getByRole('menuitemcheckbox', { name: /^Draft/ }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('checkbox', { name: 'Select all context shown' }).click()
  await page
    .getByRole('region', { name: 'Selected context' })
    .getByRole('button', { name: /^Delete/ })
    .click()
  await page
    .getByRole('dialog', { name: 'Delete 2 drafts?' })
    .getByRole('button', { name: 'Delete 2 drafts' })
    .click()
  const toast = page.locator('[data-sonner-toast]', { hasText: 'gone for good' })
  await expect(toast.locator('[data-timed]')).toBeVisible()
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  await expect(bar(toast)).toBeVisible()
  await toast.hover()
  await expect(held(toast)).not.toHaveAttribute('data-held')
  await page.clock.runFor(15_000)
  await leaves(page, toast)
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('a toast that was tapped still goes after its time', async ({ page }) => {
    const toast = await closeGap(page)
    await toast.getByText('Agents keep saying').tap()
    await expect(held(toast)).not.toHaveAttribute('data-held')
    await page.clock.runFor(10_500)
    await leaves(page, toast)
  })
})

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('a toast has no bar, still goes after its time, and leaves at once', async ({ page }) => {
    const toast = await closeGap(page)
    await expect(bar(toast)).toHaveCount(0)
    await expect(toast).toHaveCSS('transition-duration', /^0s/)
    await page.clock.runFor(10_500)
    await leaves(page, toast)
  })
})
