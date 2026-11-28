import type { Page } from '@playwright/test'
import { expect, go, onMockOnly, signInAs, test } from './go.ts'

// J146, Write with your agent (Route 1, slice R1c): the editor's More menu offers the person's own
// agent. Claude's app opens on a new chat with the prompt ready, which names what the item is about
// and never a question's words; without an agent that may write a draft, it offers to connect one.
// The same button sits under a Not found answer, for an owner of its domain.

/** The words a claude:// link puts in Claude's box. */
const promptOf = (href: string | null) => new URL(href ?? '').searchParams.get('q') ?? ''

/** Write context, then the editor's More menu. */
const opened = async (page: Page) => {
  await page.getByRole('link', { name: 'Context' }).first().click()
  await page.getByRole('button', { name: 'Write context' }).first().click()
  await expect(page.getByRole('textbox', { name: 'Title' })).toBeVisible()
  await page.getByRole('button', { name: 'More' }).click()
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
})

test("Write with Claude opens Claude's app with the prompt, and the editor names what it is about", async ({
  page,
}) => {
  await onMockOnly('Ines Duarte, with Claude connected', async () => {
    await signInAs(page, 'Ines Duarte')
    await opened(page)
    const claude = page.getByRole('menuitem', { name: 'Write with Claude' })
    const start = promptOf(await claude.getAttribute('href'))
    expect(start).toMatch(/^Write a context item with me\. Ask me what happened/)
    expect(start).toContain('save it as my draft with write_draft')
    expect(start).toContain("Don't send it")

    // Once the form says what it applies to and when, the prompt names it.
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'More' }).click()
    await page.getByRole('menuitem', { name: 'Draft from text' }).click()
    await page
      .getByRole('textbox', { name: 'Draft from text' })
      .fill(
        'Online sales to Norway stopped on 4 August 2026, because a new customs rule holds parcels at the border.',
      )
    await page.getByRole('button', { name: 'Fill it in' }).click()
    await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(/Norway/)
    await page.getByRole('button', { name: 'More' }).click()
    const item = page.getByRole('menuitem', { name: 'Write with Claude' })
    expect(promptOf(await item.getAttribute('href'))).toMatch(
      /^Write a context item with me about Orders in Norway, from 4 Aug 2026, still going on\. Ask me/,
    )
  })
})

test('without an agent that may write a draft, it offers to connect one, here and under Not found', async ({
  page,
}) => {
  // Jon's one agent, Cursor, may only read.
  await go(page, '/context')
  await opened(page)
  await page.getByRole('menuitem', { name: 'Write with your agent' }).click()
  const connect = page.getByRole('dialog', { name: 'Connect an agent' })
  await expect(connect).toBeVisible()
  await connect.getByRole('button', { name: 'Done' }).click()
  await expect(connect).toHaveCount(0)

  await onMockOnly('Not found answer', async () => {
    await go(page, '/ask?example=loop-missing')
    const gap = page.getByRole('log').getByRole('region', {
      name: 'Not written yet: Orders in Poland',
    })
    await expect(
      gap.getByRole('button', { name: 'Write context for Orders in Poland' }),
    ).toBeVisible()
    await expect(gap.getByRole('button', { name: 'Write with your agent' })).toBeVisible()
  })
})
