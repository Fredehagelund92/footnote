import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkReviewed } from '../lib/reviewed.ts'

let root: string
const today = new Date('2026-11-20T12:00:00Z')

function write(path: string, text: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

const page = (reviewed: string, body: string) =>
  `---\ntitle: Privacy\nreviewed: ${reviewed}\nopen:\n  label: Open Settings\n  href: /settings/general\n---\n\n${body}\n`

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'footnote-reviewed-'))
  write('src/server/config/env.ts', 'export const env = { FOOTNOTE_AUTH: z.string() }\n')
  write('compose.yaml', 'environment:\n  FOOTNOTE_WEB_PORT: 5410\n')
  write(
    'src/web/routeTree.gen.ts',
    "export interface FileRoutesByTo {\n  '/inbox': typeof InboxRoute\n  '/settings/$section': typeof SettingsRoute\n}\n",
  )
})
afterEach(() => rmSync(root, { recursive: true }))

describe('a page due for a check', () => {
  it('is not reported while its check is at most 90 days old', () => {
    write('docs/help/privacy.md', page('2026-08-22', 'Set FOOTNOTE_GONE. Open [it](/gone).'))
    expect(
      checkReviewed([{ file: 'docs/help/privacy.md', reviewed: '2026-08-22' }], today, root),
    ).toEqual({ warnings: [], problems: [] })
  })

  it('is named, as a warning, once its check is older', () => {
    write(
      'docs/help/privacy.md',
      page('2026-08-21', 'Set FOOTNOTE_AUTH and FOOTNOTE_WEB_PORT, and open [the Inbox](/inbox/).'),
    )
    expect(
      checkReviewed([{ file: 'docs/help/privacy.md', reviewed: '2026-08-21' }], today, root),
    ).toEqual({
      warnings: [
        'docs/help/privacy.md: checked 91 days ago (reviewed: 2026-08-21): check it against the app and set reviewed to the day you do',
      ],
      problems: [],
    })
  })

  it('fails when it names a setting no code reads, or a screen the app does not have', () => {
    write(
      'docs/help/privacy.md',
      page('2026-01-02', 'Set FOOTNOTE_GONE, the FOOTNOTE_ settings, and open [Old](/old#top).'),
    )
    expect(
      checkReviewed([{ file: 'docs/help/privacy.md', reviewed: '2026-01-02' }], today, root)
        .problems,
    ).toEqual([
      'docs/help/privacy.md: names the setting FOOTNOTE_GONE, which no code reads any more',
      'docs/help/privacy.md: links to the screen /old#top, which the app no longer has',
    ])
  })

  it('reads the screen its front matter opens too', () => {
    write(
      'docs/help/privacy.md',
      page('2026-01-02', 'Words.').replace('/settings/general', '/gone'),
    )
    expect(
      checkReviewed([{ file: 'docs/help/privacy.md', reviewed: '2026-01-02' }], today, root)
        .problems,
    ).toEqual(['docs/help/privacy.md: links to the screen /gone, which the app no longer has'])
  })

  it('fails when a page does not say when it was checked', () => {
    expect(checkReviewed([{ file: 'docs/help/privacy.md' }], today, root).problems).toEqual([
      'docs/help/privacy.md: say in its front matter when it was last checked, reviewed:',
    ])
  })
})
