import { dirname, relative, resolve } from 'node:path'
import type {
  BlockContent,
  Image,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Table,
} from 'mdast'
import { SKIP, visit } from 'unist-util-visit'
import type { VFile } from 'vfile'
import { drawnWidth, pictureSize } from '../../scripts/picture-size.ts'
import { resolveLink, type LinkContext } from './links.ts'
import { repoRoot } from './pages.ts'

/*
  What the pages write that Markdown alone does not draw as the docs do: links as lib/links.ts
  resolves them, a note (a quote whose first words are its title in bold) as a note, tables a
  keyboard can scroll and whose cells know their column, a picture in the reader's theme, tabs,
  and an include's markers as one element that holds what stands between them: the list as
  Markdown, so the page reads as it is, marked as the app's Docs area marks it, so the check of the
  two (scripts/check-app-docs.ts) can tell the app's own lists apart.
*/

const tabsOpen = /^<!--\s*tabs\s*-->$/
const tabsClose = /^<!--\s*\/tabs\s*-->$/

/** A node mdast-util-to-hast draws as the element its data names. */
const element = (
  hName: string,
  hProperties: Record<string, unknown>,
  children: RootContent[],
): RootContent => ({ type: 'paragraph', data: { hName, hProperties }, children }) as never

/**
 * The `###` sections between `<!-- tabs -->` and `<!-- /tabs -->` as tabs, one a section, named by
 * its heading (site/README.md, "Tabs"). The page's script (Tabs.astro) shows one at a time; with no
 * script every section shows under its name, as on GitHub.
 */
function drawTabs(tree: Root) {
  for (let at = 0; at < tree.children.length; at++) {
    const open = tree.children[at]!
    if (open.type !== 'html' || !tabsOpen.test(open.value.trim())) continue
    const end = tree.children.findIndex(
      (node, i) => i > at && node.type === 'html' && tabsClose.test(node.value.trim()),
    )
    if (end === -1) throw new Error('<!-- tabs --> is not closed')
    const inside = tree.children.slice(at + 1, end)
    const tabs: { name: string; body: RootContent[] }[] = []
    for (const node of inside) {
      if (node.type === 'heading' && node.depth === 3)
        tabs.push({ name: wordsOf(node.children).trim(), body: [] })
      else if (tabs.length) tabs.at(-1)!.body.push(node)
      else throw new Error('<!-- tabs --> holds ### sections, each a tab')
    }
    const id = (name: string) =>
      `tab-${name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')}`
    const list = element(
      'div',
      { role: 'tablist', className: ['footnote-tablist'], hidden: true },
      tabs.map(({ name }, i) =>
        element(
          'button',
          {
            type: 'button',
            role: 'tab',
            id: id(name),
            ariaControls: `${id(name)}-panel`,
            ariaSelected: i === 0 ? 'true' : 'false',
            tabIndex: i === 0 ? 0 : -1,
          },
          [{ type: 'text', value: name } as never],
        ),
      ),
    )
    const panels = tabs.map(({ name, body }) =>
      element(
        'div',
        {
          role: 'tabpanel',
          id: `${id(name)}-panel`,
          ariaLabelledby: id(name),
          className: ['footnote-tabpanel'],
          tabIndex: 0,
        },
        [
          element('p', { className: ['footnote-tab-name'] }, [
            { type: 'text', value: name } as never,
          ]),
          ...body,
        ],
      ),
    )
    tree.children.splice(
      at,
      end - at + 1,
      element('footnote-tabs', { className: ['footnote-tabs'] }, [list, ...panels]),
    )
  }
}

/** A picture the page names by its light file, `../images/docs/inbox-light.webp` (docs/help/README.md). */
const lightPicture = /^((?:.*\/)?images\/docs\/[a-z0-9-]+)-light\.(webp|svg)$/

/** A picture alone in its paragraph, named by its light file, or undefined. */
function pictureOf(node: Paragraph): Image | undefined {
  const parts = node.children.filter((c) => c.type !== 'text' || c.value.trim())
  const image = parts.length === 1 && parts[0]!.type === 'image' ? parts[0] : undefined
  return image && lightPicture.test(image.url) ? image : undefined
}

/** The paragraph becomes a figure that holds both files; the theme shows one (Starlight's utilities). */
function drawPicture(node: Paragraph, image: Image, from: string) {
  const [, name, kind] = lightPicture.exec(image.url)!
  const dark: Image = { ...image, url: `${name}-dark.${kind}` }
  image.data = { hProperties: { className: ['dark:sl-hidden'] } }
  dark.data = { hProperties: { className: ['light:sl-hidden'] } }
  node.children = [image, dark]
  const file = resolve(dirname(from), image.url)
  const drawn = drawnWidth(file, pictureSize(file).width)
  node.data = {
    hName: 'figure',
    hProperties: {
      className: ['footnote-picture'],
      ...(drawn ? { style: `max-width: ${drawn}px` } : {}),
    },
  }
}

const includeOpen = /^<!--\s*include\s+([a-z-]+)(?::.*?)?\s*-->$/
const includeClose = /^<!--\s*\/include\s*-->$/

/** Each include's region, between its two markers, as one element named for the list it holds. */
function drawIncludes(tree: Root) {
  for (let at = 0; at < tree.children.length; at++) {
    const open = tree.children[at]!
    const name = open.type === 'html' ? includeOpen.exec(open.value.trim())?.[1] : undefined
    if (!name) continue
    const end = tree.children.findIndex(
      (node, i) => i > at && node.type === 'html' && includeClose.test(node.value.trim()),
    )
    if (end === -1) throw new Error(`<!-- include ${name} --> is not closed`)
    const inside = tree.children.slice(at + 1, end)
    tree.children.splice(at, end - at + 1, element('div', { dataInclude: name }, inside))
  }
}

const isNote = (node: BlockContent | RootContent | undefined) => {
  const lead = node?.type === 'paragraph' ? (node as Paragraph).children[0] : undefined
  const last = lead?.type === 'strong' ? lead.children.at(-1) : undefined
  return last?.type === 'text' && last.value.endsWith('.')
}

const wordsOf = (nodes: readonly PhrasingContent[]): string =>
  nodes
    .map((node) =>
      'value' in node ? node.value : 'children' in node ? wordsOf(node.children) : '',
    )
    .join('')

/** Each cell's column heading, which a phone shows beside it, as it has no heading row there. */
function labelCells({ children: [heading, ...rows] }: Table) {
  const labels = heading?.children.map((cell) => wordsOf(cell.children).trim()) ?? []
  for (const row of rows)
    row.children.forEach((cell, column) => {
      if (labels[column]) cell.data = { hProperties: { dataLabel: labels[column] } }
    })
}

export function remarkFootnoteDocs(context: LinkContext) {
  return (tree: Root, file: VFile) => {
    const from = relative(repoRoot, file.path)
    drawTabs(tree)
    drawIncludes(tree)
    visit(tree, (node, index, parent) => {
      if (node.type === 'link' && parent && index != null) {
        const url = resolveLink(node.url, from, context)
        if (url !== undefined) node.url = url
        else {
          parent.children.splice(index, 1, ...node.children)
          return [SKIP, index]
        }
      }
      // A wide table scrolls on a phone, so the keyboard has to be able to reach it.
      if (node.type === 'table') {
        node.data = { hProperties: { tabIndex: 0 } }
        labelCells(node)
      }
      if (node.type === 'paragraph') {
        const image = pictureOf(node)
        if (image) drawPicture(node, image, file.path)
      }
      if (node.type === 'blockquote' && isNote(node.children[0]))
        node.data = { hName: 'div', hProperties: { className: ['footnote-note'], role: 'note' } }
      return undefined
    })
  }
}
