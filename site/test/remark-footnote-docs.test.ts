import { join } from 'node:path'
import type { Blockquote, Paragraph, Root, Table } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { describe, expect, it } from 'vitest'
import { VFile } from 'vfile'
import type { LinkContext } from '../lib/links.ts'
import { repoRoot } from '../lib/pages.ts'
import { remarkFootnoteDocs } from '../lib/remark-footnote-docs.ts'

const context: LinkContext = {
  pages: new Map([['docs/help/tools.md', 'tools']]),
  base: '/docs/0.1',
  ref: 'main',
  kind: () => 'blob',
}

/** What a node tells mdast-util-to-hast to draw it as. */
const drawn = (node: { data?: unknown } | undefined) =>
  node?.data as { hName?: string; hProperties?: Record<string, unknown> } | undefined

function read(markdown: string): Root {
  const tree = fromMarkdown(markdown)
  remarkFootnoteDocs(context)(tree, new VFile({ path: join(repoRoot, 'docs/help/privacy.md') }))
  return tree
}

describe('the remark plugin', () => {
  it('points a link at its address', () => {
    const paragraph = read('See [the tools](tools.md#send).').children[0] as Paragraph
    expect(paragraph.children[1]).toMatchObject({ type: 'link', url: '/docs/0.1/tools/#send' })
  })

  it('keeps the words of a link to a screen of the app', () => {
    const paragraph = read('Open [Agents](/settings/agents) now.').children[0] as Paragraph
    expect(paragraph.children.map((node) => node.type)).toEqual(['text', 'text', 'text'])
  })

  it('draws a quote that opens with a bold title as a note, and no other quote', () => {
    const [note, quote] = read(
      '> **Revoking.** Revoke it.\n\n---\n\n> Plain words.',
    ).children.filter((node) => node.type === 'blockquote') as Blockquote[]
    expect(note!.data).toMatchObject({ hName: 'div', hProperties: { role: 'note' } })
    expect(quote!.data).toBeUndefined()
  })

  it('tells each cell of a table its column, for a phone, which has no heading row', () => {
    const tree = fromMarkdown('| Job | When |\n| --- | ---- |\n| `a.b` | Daily |', {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    })
    remarkFootnoteDocs(context)(tree, new VFile({ path: join(repoRoot, 'docs/help/privacy.md') }))
    const [, row] = (tree.children[0] as Table).children
    expect(row!.children.map((cell) => cell.data)).toEqual([
      { hProperties: { dataLabel: 'Job' } },
      { hProperties: { dataLabel: 'When' } },
    ])
  })

  it('lets the keyboard reach a table, which scrolls on a phone', () => {
    const tree = fromMarkdown('| A |\n| - |\n| b |', {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    })
    remarkFootnoteDocs(context)(tree, new VFile({ path: join(repoRoot, 'docs/help/privacy.md') }))
    expect(tree.children[0]?.data).toMatchObject({ hProperties: { tabIndex: 0 } })
  })

  it('draws a picture as a figure with its light and its dark file, at its screen size', () => {
    const figure = read('![The card.](../images/docs/inbox-due-light.webp)')
      .children[0] as Paragraph
    expect(figure.data).toEqual({
      hName: 'figure',
      hProperties: { className: ['footnote-picture'], style: 'max-width: 564px' },
    })
    expect(figure.children).toMatchObject([
      {
        url: '../images/docs/inbox-due-light.webp',
        data: { hProperties: { className: ['dark:sl-hidden'] } },
      },
      {
        url: '../images/docs/inbox-due-dark.webp',
        data: { hProperties: { className: ['light:sl-hidden'] } },
      },
    ])
  })

  it('draws the ### sections between tabs markers as tabs, each section a panel under its name', () => {
    const tree = read(
      'Before.\n\n<!-- tabs -->\n\n### Claude Code\n\nRun it.\n\n### VS Code\n\nStart it.\n\n<!-- /tabs -->',
    )
    expect(tree.children.map((node) => drawn(node)?.hName ?? node.type)).toEqual([
      'paragraph',
      'footnote-tabs',
    ])
    const [list, ...panels] = (tree.children[1] as Paragraph).children as unknown as Paragraph[]
    expect(drawn(list)?.hProperties).toMatchObject({ role: 'tablist', hidden: true })
    expect(list!.children.map((tab) => drawn(tab)?.hProperties)).toMatchObject([
      { role: 'tab', id: 'tab-claude-code', ariaSelected: 'true', tabIndex: 0 },
      { role: 'tab', id: 'tab-vs-code', ariaSelected: 'false', tabIndex: -1 },
    ])
    expect(panels.map((panel) => drawn(panel)?.hProperties)).toMatchObject([
      { role: 'tabpanel', id: 'tab-claude-code-panel', ariaLabelledby: 'tab-claude-code' },
      { role: 'tabpanel', id: 'tab-vs-code-panel', ariaLabelledby: 'tab-vs-code' },
    ])
    expect(() => read('<!-- tabs -->\n\n### One\n\nOpen.')).toThrow('is not closed')
  })

  it('drops include markers and keeps what stands between them', () => {
    const tree = read('<!-- include words -->\n\nThe words.\n\n<!-- /include -->\n\nAfter.')
    expect(tree.children.map((node) => node.type)).toEqual(['paragraph', 'paragraph'])
  })
})
