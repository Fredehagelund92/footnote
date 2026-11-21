/*
  The documentation (docs/help/README.md): Markdown files in docs/help, one per page, read into one
  page model that the app's Docs area, the static docs site (npm run docs:build), its search and
  its index for agents (llms.txt) all draw from. A page names the app's own lists (the answer
  lines, the words, the tools, the prompt) with an include, so a change there changes the page.
  Pure: no input or output, no clock. The build and the service read the files, and
  src/server/docs-read.ts reads them into this model, so neither the app nor the docs site
  carries a Markdown reader.
*/

export const docsFolder = 'docs/help'

/** The groups of the docs' tree, in order. */
export const docGroups = [
  'Start',
  'Ask',
  'Write and review',
  'Set up',
  'How it works',
  'Reference',
] as const
export type DocGroup = (typeof docGroups)[number]

/** The slug of the What's new page, which lists changes rather than explaining one thing. */
export const CHANGELOG = 'changelog'

/** The pages that moved, by the slug they had: a link to the old one opens the page where it is now. */
const movedPages: Readonly<Record<string, string>> = {
  'get-started': 'set-up-your-workspace',
  'settle-a-conflict': 'decide-a-conflict',
}

/** Where a page that moved is now, or undefined for a slug that never moved. */
export const movedTo = (slug: string | undefined): string | undefined =>
  slug !== undefined && Object.hasOwn(movedPages, slug) ? movedPages[slug] : undefined

/** Every slug a page had before it moved. */
export const movedSlugs = Object.keys(movedPages)

/**
 * The app's own lists a page can show where it names them, in the words the app uses (an include,
 * written `<!-- include answer-lines -->` and closed with `<!-- /include -->`). What stands between
 * the two is the list as Markdown, for GitHub and for agents; the docs check keeps it current.
 */
export const docIncludes = [
  'setup-steps',
  'prompt',
  'checks',
  'kinds',
  'word',
  'answer-lines',
  'words',
  'tools',
] as const
export type DocInclude = (typeof docIncludes)[number]

export type DocTarget = { page: string; hash: string } | { screen: string } | { web: string }

export type DocInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: DocInline[] }
  | { type: 'em'; children: DocInline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; to: DocTarget; children: DocInline[] }
  | { type: 'break' }

export type DocBlock =
  | { type: 'heading'; depth: 2 | 3; id: string; text: string }
  | { type: 'paragraph'; children: DocInline[] }
  | { type: 'list'; ordered: boolean; items: DocBlock[][] }
  | { type: 'code'; title: string; text: string }
  | { type: 'note'; title: string; children: DocBlock[] }
  | { type: 'table'; head: DocInline[][]; rows: DocInline[][][] }
  | { type: 'include'; name: DocInclude; arg: string; markdown: string }
  | DocPicture

/**
 * A picture of a screen or a diagram, in light and in dark (docs/images/docs). The page names the
 * light one; the dark one beside it has the same name with -dark. Read, each is the file's path in
 * the repository; the build gives each its address, and its size in pixels.
 */
export type DocPicture = {
  type: 'picture'
  alt: string
  light: string
  dark: string
  width?: number
  height?: number
  /** At most how wide it is drawn, in CSS pixels: a screen, taken at twice the pixels, at half. */
  drawnWidth?: number
}

/** Where the docs' pictures are, and how a page names one: `../images/docs/inbox-light.webp`. */
export const docPictures = 'docs/images/docs'
export const docPictureFile = /^\.\.\/images\/docs\/([a-z0-9]+(?:-[a-z0-9]+)*)-light\.(webp|svg)$/

/** One part of a page for search: its heading and its words, up to the next heading. */
export type DocSection = { id: string; heading: string; text: string }

export type DocPage = {
  slug: string
  title: string
  line: string
  group: DocGroup
  order: number
  minutes: number
  reviewed: string
  open?: { label: string; href: string }
  /** The words above the first heading, which the page opens with. */
  lead: DocInline[]
  blocks: DocBlock[]
  headings: { id: string; text: string; depth: 2 | 3 }[]
  sections: DocSection[]
}

export type DocChange = { date: string; title: string; id: string; children: DocBlock[] }
export type DocChangelog = {
  slug: typeof CHANGELOG
  title: string
  line: string
  reviewed: string
  changes: DocChange[]
}

export type Docs = { pages: DocPage[]; changelog: DocChangelog }
export type DocFile = { slug: string; source: string }
/** The words of inline content, without its formatting. */
export function inlineText(nodes: readonly DocInline[]): string {
  return nodes
    .map((node) =>
      node.type === 'text' || node.type === 'code'
        ? node.text
        : node.type === 'break'
          ? ' '
          : inlineText(node.children),
    )
    .join('')
}

/** The words of blocks, one block a line, as search and an agent read them. */
export function blocksText(blocks: readonly DocBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'heading':
          return block.text
        case 'paragraph':
          return inlineText(block.children)
        case 'list':
          return block.items.map((item) => blocksText(item)).join('\n')
        case 'code':
          return block.text
        case 'note':
          return `${block.title}. ${blocksText(block.children)}`
        case 'table':
          return [block.head, ...block.rows].map((row) => row.map(inlineText).join(' ')).join('\n')
        case 'include':
          return markdownText(block.markdown)
        case 'picture':
          return block.alt
      }
    })
    .join('\n')
}

/** Markdown's words without its marks, for an include's list as search reads it. */
const markdownText = (markdown: string) =>
  markdown
    .replace(/^\s*(?:[-*]|\d+\.)\s+/gm, '')
    .replace(/^\|?\s*:?-{3,}.*$/gm, '')
    .replace(/[|*`]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()

/** Every link of some blocks, for the check that each one goes somewhere. */
export function docLinks(blocks: readonly DocBlock[]): DocTarget[] {
  const fromInline = (nodes: readonly DocInline[]): DocTarget[] =>
    nodes.flatMap((node) =>
      node.type === 'link'
        ? [node.to, ...fromInline(node.children)]
        : 'children' in node
          ? fromInline(node.children)
          : [],
    )
  return blocks.flatMap((block): DocTarget[] => {
    switch (block.type) {
      case 'paragraph':
        return fromInline(block.children)
      case 'list':
        return block.items.flatMap((item) => docLinks(item))
      case 'note':
        return docLinks(block.children)
      case 'table':
        return [...block.head, ...block.rows.flat()].flatMap(fromInline)
      default:
        return []
    }
  })
}

/** Where a page opens on the docs site: `/docs/privacy`, at a heading when there is one. */
export const docPath = (base: string, slug: string, hash = '') =>
  `${base}/${slug}${hash ? `#${hash}` : ''}`

/** What the agents' text reads of the docs: this model, or a site's own list (site). */
export type DocIndex = {
  pages: readonly { slug: string; title: string; line: string; group?: string }[]
  changelog: { title: string; line: string }
}

/** How llms.txt lists a site's pages: its one line, its groups, and where a page opens. */
export type DocListing = {
  summary: string
  groups: readonly string[]
  path: (base: string, slug: string) => string
}

const appListing: DocListing = {
  summary: 'Guides for writing context, connecting agents and reviewing suggestions.',
  groups: docGroups,
  path: docPath,
}

/** The plain-text index an agent reads at llms.txt: every page with its one line. */
export function llmsTxt(docs: DocIndex, base: string, listing = appListing): string {
  return [
    '# Documentation',
    '',
    `> ${listing.summary}`,
    '',
    ...listing.groups.flatMap((group) => [
      `## ${group}`,
      '',
      ...docs.pages
        .filter((p) => p.group === group)
        .map((p) => `- [${p.title}](${listing.path(base, p.slug)}): ${p.line}`),
      '',
    ]),
    '## Optional',
    '',
    `- [${docs.changelog.title}](${listing.path(base, CHANGELOG)}): ${docs.changelog.line}`,
    `- [Every page in one file](${base}/llms-full.txt): the pages above as Markdown, in order.`,
    '',
  ].join('\n')
}

/**
 * One page as Markdown, as an agent or a person who copies it reads it: its title, its line and
 * its body, with its links where the docs site opens them.
 */
export function pageMarkdown(
  page: { slug: string; title: string; line: string },
  files: readonly DocFile[],
  base: string,
): string {
  const source = files.find((f) => f.slug === page.slug)!.source.replace(/\r\n?/g, '\n')
  const body = source
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/^<!--\s*\/?include[^>]*-->\n?/gm, '')
    .replace(
      /\]\((?:\.\/)?([a-z0-9-]+)\.md(#[a-z0-9-]+)?\)/g,
      (_all, slug: string, hash = '') => `](${base}/${slug}${hash})`,
    )
    .replace(/\]\(#([a-z0-9-]+)\)/g, `](${base}/${page.slug}#$1)`)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return `# ${page.title}\n\n> ${page.line}\n\n${body}\n`
}

/** Every page as Markdown in one file, for an agent that reads the docs whole (llms-full.txt). */
export function llmsFullTxt(docs: DocIndex, files: readonly DocFile[], base: string): string {
  return [
    ...docs.pages.map((p) => pageMarkdown(p, files, base)),
    pageMarkdown({ slug: CHANGELOG, ...docs.changelog }, files, base),
  ].join('\n')
}
