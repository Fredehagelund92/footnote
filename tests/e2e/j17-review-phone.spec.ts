import { devices } from '@playwright/test'
import { claimsToCheck, cardIn, expect, go, place, test } from './go.ts'

// J17, the review on a phone: the decision bar says the state in words and where you are, its
// actions are 44px, nothing you can press has a tap area under 44px, and the source and its
// preview are both in reach. The header's buttons are drawn 28px, as on every page, and a link in
// a line of words keeps its size: their tap areas grow instead. A tap on a line of the text offers
// to comment on it there (J33). The comparison stacks: a field's values one under the other, the
// text now above suggested, nothing cut and nothing sideways (K4).

test.use({ ...devices['iPhone 13'], browserName: 'chromium' })

test('the bar says the state and the place, with full-size actions', async ({ page }) => {
  await go(page, '/inbox/sug-agent/review')
  const publish = page.getByRole('button', { name: 'Publish anyway' }).last()
  await expect(publish).toBeVisible()
  await expect(
    page.getByText(`${claimsToCheck('sug-agent')} details to compare with the source`).last(),
  ).toBeVisible()
  await expect(page.getByText(place('sug-agent')).last()).toBeVisible()
  expect((await publish.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await page.getByRole('button', { name: 'Next suggestion' }).click()
  await expect(page).toHaveURL(new RegExp(cardIn('sug-sofia-clash')))
})

test('the source and its preview are both in reach', async ({ page }) => {
  await go(page, '/inbox/sug-ines/review')
  await expect(page.getByRole('region', { name: 'The source' })).toBeVisible()
  await page.getByRole('button', { name: 'Show the preview' }).click()
  await expect(page.getByRole('region', { name: 'Preview' })).toBeVisible()
})

test('a tap on a line offers to comment on it', async ({ page }) => {
  await go(page, '/inbox/sug-ines/review')
  const text = page.getByRole('region', { name: 'Text' })
  await text.getByText('Units sold in Norway leaves out the').last().tap()
  const offer = text.getByRole('button', { name: 'Comment on line 1' })
  await expect(offer).toBeVisible()
  expect((await offer.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await offer.tap()
  await expect(text.getByRole('textbox', { name: 'Comment on line 1' })).toBeFocused()
  await page.keyboard.type('On the phone')
  await text.getByRole('button', { name: 'Comment', exact: true }).tap()
  await expect(
    text.getByRole('region', { name: "Line 1: Jon Abara's comment, open" }),
  ).toContainText('On the phone')
})

test('no control has a tap area under 44px', async ({ page }) => {
  for (const route of [
    '/inbox/sug-lars-retire/review',
    '/inbox/sug-ines-long/review',
    '/inbox?card=sug-agent',
  ]) {
    await go(page, route)
    await page.waitForTimeout(400)
    const small = await page.locator('button, a[href], input').evaluateAll((els: Element[]) =>
      els
        .filter((e) => !e.textContent?.includes('Skip to the content'))
        // A switch's own checkbox is hidden from everyone: the switch is the control.
        .filter((e) => e.getAttribute('aria-hidden') !== 'true')
        .map((e) => {
          // What a finger can hit: the control's own box, or the tap area it grows around it.
          const box = e.getBoundingClientRect()
          const area = getComputedStyle(e, '::after')
          const grown = area.content !== 'none' && area.position === 'absolute'
          return {
            e,
            shown: box.width > 0 && box.height > 0,
            width: Math.max(box.width, grown ? parseFloat(area.width) : 0),
            height: Math.max(box.height, grown ? parseFloat(area.height) : 0),
          }
        })
        .filter((t) => t.shown && (t.width < 44 || t.height < 44))
        .map(
          ({ e, width, height }) =>
            `${(e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 30)} ${Math.round(width)}x${Math.round(height)}`,
        ),
    )
    expect(small, route).toEqual([])
  }
})

test("the header's buttons are drawn 28px, and a link in the words keeps its line", async ({
  page,
}) => {
  await go(page, '/inbox/sug-lars-retire/review')
  const header = page.locator('[data-site-header]')
  await expect(header.getByRole('button', { name: 'More' })).toBeVisible()
  const drawn = await header.locator('button, a[href]').evaluateAll((els: Element[]) =>
    els
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.width > 0)
      .map((r) => `${r.width}x${r.height}`),
  )
  // The way back, the preview and More: three icon buttons, none grown to 44px.
  expect(drawn).toEqual(['28x28', '28x28', '28x28'])
  // The source's address is a line of words, not a 44px box with a hole under it.
  const source = page.getByRole('link', { name: /wiki\.example/ }).first()
  await expect(source).toBeVisible()
  expect((await source.boundingBox())!.height).toBeLessThan(28)
})

test('the comparison stacks, with nothing cut and nothing sideways', async ({ page }) => {
  for (const id of [
    'sug-ines',
    'sug-ines-format',
    'sug-ines-order',
    'sug-ines-link',
    'sug-ines-long',
    'sug-lars-retire',
    'gap-spain',
  ]) {
    await go(page, `/inbox/${id}/review`)
    const source = page.getByRole('region', { name: 'The source' })
    const text = source.getByRole('region', { name: 'Text' })
    await expect(text).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const problems = await source.evaluate((root) => {
      const edge = root.getBoundingClientRect().right + 0.5
      const out: string[] = []
      if (document.documentElement.scrollWidth > window.innerWidth)
        out.push('the page scrolls sideways')
      // Words for a screen reader only are clipped on purpose.
      const hidden = (el: Element | null): boolean =>
        !!el &&
        el !== root &&
        (getComputedStyle(el).clipPath.startsWith('inset') || hidden(el.parentElement))
      for (const el of root.querySelectorAll<HTMLElement>('*')) {
        const r = el.getBoundingClientRect()
        if (!r.width || !r.height || hidden(el)) continue
        const name = `${el.tagName} "${(el.textContent ?? '').trim().slice(0, 30)}"`
        if (r.right > edge) out.push(`${name} ends past the edge`)
        const style = getComputedStyle(el)
        // A mention's chip shortens a long name by design, with an ellipsis.
        if (
          ['hidden', 'clip'].includes(style.overflowX) &&
          el.scrollWidth > el.clientWidth + 1 &&
          style.textOverflow !== 'ellipsis'
        )
          out.push(`${name} is cut`)
      }
      return out
    })
    expect(problems, id).toEqual([])
    // Now above Suggested: in each changed passage, and for a text only one side has.
    const order = await text.evaluate((region) => {
      const top = (scope: Element, label: string) =>
        [...scope.querySelectorAll('span, p')]
          .filter((e) => e.textContent === label && e.getBoundingClientRect().height > 0)
          .filter((e) => getComputedStyle(e).clipPath === 'none')[0]
          ?.getBoundingClientRect().top
      const scopes = [...region.querySelectorAll('[data-review-change]')]
      const pairs = (scopes.length ? scopes : [region]).map((x) => [
        top(x, 'Now'),
        top(x, 'Suggested'),
      ])
      return pairs.filter(([now, suggested]) => now !== undefined && suggested !== undefined)
    })
    // A move alone has a passage on one side only, where it was and where it goes, and a text
    // that stays the same is shown once.
    if (!['sug-ines-order', 'sug-ines-link'].includes(id))
      expect(order.length, id).toBeGreaterThan(0)
    for (const [now, suggested] of order) expect(now, id).toBeLessThan(suggested!)
  }
})
