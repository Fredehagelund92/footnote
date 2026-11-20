import { describe, expect, it } from 'vitest'
import { linkContext, resolveLink } from '../lib/links.ts'
import {
  movedPages,
  movedSections,
  publishedPages,
  shownGroups,
  sidebar,
  siteGroups,
  sitePages,
  slugOf,
  unlistedHelpPages,
} from '../lib/pages.ts'

describe('the pages of the site', () => {
  const pages = sitePages()

  it('are the published list and no other', () => {
    expect(pages.map((page) => page.file).sort()).toEqual(
      publishedPages.map((page) => `docs/${page}.md`).sort(),
    )
  })

  it('leave no help page off the list', () => {
    expect(unlistedHelpPages()).toEqual([])
  })

  it('leave out the README of the help pages', () => {
    expect(pages.map((page) => page.slug)).not.toContain('README')
  })

  it('sit in the sidebar by group and order, with What is new last', () => {
    const groups = sidebar(pages)
    expect(groups.slice(0, -1).map((group) => 'label' in group && group.label)).toEqual(
      shownGroups(pages),
    )
    for (const group of groups) if ('items' in group) expect(group.items.length).toBeGreaterThan(0)
    expect(groups[0]).toMatchObject({
      items: [
        { slug: 'try-the-demo' },
        { slug: 'set-up-your-workspace' },
        { slug: 'connect-an-agent' },
        { slug: 'words' },
      ],
    })
    expect(groups.at(-1)).toEqual({ slug: 'changelog' })
  })

  it('skip a group that has no published page', () => {
    expect(shownGroups(pages)).toEqual(siteGroups)
    const onlyHelp = pages.filter((page) => page.file.startsWith('docs/help/'))
    expect(shownGroups(onlyHelp)).toEqual([
      'Start',
      'Ask',
      'Write and review',
      'Set up',
      'How it works',
      'Reference',
    ])
    const labels = sidebar(onlyHelp).map((group) => 'label' in group && group.label)
    expect(labels).not.toContain('Run the service')
    expect(labels).not.toContain('Connectors')
  })

  it('open a page that is not published on GitHub, at the build reference', () => {
    const context = linkContext(pages, '/docs/0.1', 'v0.1.1')
    expect(resolveLink('../contributing/api.md#alerts', 'docs/help/tools.md', context)).toBe(
      'https://github.com/Fredehagelund92/footnote/blob/v0.1.1/docs/contributing/api.md#alerts',
    )
    expect(resolveLink('privacy.md', 'docs/help/tools.md', context)).toBe('/docs/0.1/privacy/')
  })

  it('forward an old address, and each heading of a split page, to a published page', () => {
    const slugs = pages.map((page) => page.slug)
    for (const [from, to] of Object.entries(movedPages)) {
      expect(slugs, `${from} is no longer a page`).not.toContain(from)
      expect(slugs, `${from} forwards to a page`).toContain(to)
    }
    for (const [from, sections] of Object.entries(movedSections)) {
      expect(movedPages, `${from} moved`).toHaveProperty([from])
      for (const target of Object.values(sections)) expect(slugs).toContain(target.split('#')[0])
    }
  })

  it('forward every heading of the deleted pages', () => {
    const old: Record<string, string[]> = {
      'self-hosting': [
        'install',
        'the-demo',
        'connect-claude-code-to-the-demo',
        'from-the-published-images',
        'use-your-own-data',
        'ask-on-a-real-model',
        'what-runs',
        'if-the-start-goes-wrong',
        'what-to-back-up',
        'back-up',
        'prove-the-backup-restores-the-restore-drill',
        'restore',
        'upgrade',
        'roll-back',
        'running-from-source-instead',
        'the-web-image',
      ],
      operations: [
        'run-the-service-locally',
        'check-that-it-runs',
        'run-the-image-in-production-mode',
        'request-limits',
        'scheduled-jobs',
        'metrics',
      ],
      'ai-sign-in': [
        'connect-your-agent',
        'what-a-sign-in-lasts',
        'see-and-end-connections',
        'what-the-agent-can-do',
        'the-login-server-settings',
        'make-the-keys',
        'rotate-the-signing-key',
        'known-limits',
      ],
    }
    for (const [from, headings] of Object.entries(old)) {
      for (const heading of headings)
        expect(movedSections[from], `${from}#${heading}`).toHaveProperty([heading])
    }
  })

  it('keep their address from their file', () => {
    expect(slugOf('help/privacy.md')).toBe('privacy')
    expect(slugOf('connectors/cube.md')).toBe('connectors/cube')
  })
})
