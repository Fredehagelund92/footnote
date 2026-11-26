import { expect, go, test } from './go.ts'

// J124, Context by time at 5,000 items over 40 markets (the mock's ?demo=many adds them to the
// demo's own). Groups start folded to one line each. With every group open the page still draws
// only the rows and the stretch of time near the screen, so a few hundred bars stand in for
// thousands, and the last group is a scroll away. A metric and a channel narrow it to a few.

test('By time holds 5,000 items: folded groups, a bounded drawing, filters that narrow', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await go(page, '/context?demo=many&view=time')
  const time = page.getByRole('region', { name: /^Items by time/ })
  await expect(page.getByText(/^[1-5],\d{3} context items$/)).toBeVisible()

  // Many items: every group starts folded.
  const sales = time.getByRole('button', { name: /^Sales [\d,]+$/ })
  await expect(sales).toHaveAttribute('aria-expanded', 'false')

  // By market: 40 groups, Every value first, A to Z after it.
  await page.getByRole('button', { name: 'Domain', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Market' }).click()
  await expect(time.getByRole('button', { name: /^Every value [\d,]+$/ })).toBeVisible()

  // Every group open: thousands of bars, of which only those near the screen are drawn.
  await time.click({ position: { x: 600, y: 10 } })
  const opened = await page.evaluate(() => performance.now())
  await page.keyboard.press(']')
  await expect(time.getByRole('button', { name: /^Every value [\d,]+$/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  const took = (await page.evaluate(() => performance.now())) - opened
  expect(took).toBeLessThan(3000)
  const drawn = await time.locator('[data-item]').count()
  expect(drawn).toBeGreaterThan(20)
  expect(drawn).toBeLessThan(1500)

  // The last group, United States, is a scroll away, and the drawing stays as small there.
  await time.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
  await expect(time.getByRole('button', { name: / in United States/ }).last()).toBeInViewport()
  expect(await time.locator('[data-item]').count()).toBeLessThan(1500)

  // A metric and a channel: Orders sold through the marketplace, a handful of 5,000.
  await page.keyboard.press('f')
  await page.getByRole('menuitem', { name: 'Metric' }).click()
  await page.getByRole('menuitemcheckbox', { name: /^Orders/ }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('menuitem', { name: 'Channel' }).click()
  await page.getByRole('menuitemcheckbox', { name: /^Marketplace/ }).click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.getByText('Metric is Orders')).toBeVisible()
  await expect(page.getByText('Channel is Marketplace')).toBeVisible()
  await expect(page.getByText(/^\d{1,3} of [1-5],\d{3} context items$/)).toBeVisible()
})
