import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { parse } from 'yaml'
import {
  docsFolder,
  type DocBlock,
  type DocFile,
  type DocPicture,
  type Docs,
} from '../src/domain/docs.ts'
import { drawnWidth, pictureSize } from './picture-size.ts'
import { readDocs } from './docs-read.ts'

/*
  The documentation's pages (docs/help) for the app, the static docs site and their tests, read
  once at build time into the page model (src/domain/docs.ts), so neither carries a Markdown
  reader. `import docs from 'virtual:help-docs'` gives the pages and What's new; a page that
  cannot be read fails the build with its reason. `import titles from 'virtual:help-docs-titles'`
  gives only each page's title by its slug, for a link to a page from the app's first load, which
  does not carry the pages themselves. A page's pictures are the build's own files, so each one
  gets its hashed address, and its size, so the page does not move as it loads.
*/

const id = 'virtual:help-docs'
const resolved = `\0${id}`
const titlesId = 'virtual:help-docs-titles'
const titlesResolved = `\0${titlesId}`
const folder = fileURLToPath(new URL(`../${docsFolder}/`, import.meta.url))
const root = fileURLToPath(new URL('../', import.meta.url))

/** Every picture of some blocks, in notes and lists too. */
export function picturesOf(blocks: readonly DocBlock[]): DocPicture[] {
  return blocks.flatMap((block) =>
    block.type === 'picture'
      ? [block]
      : block.type === 'list'
        ? block.items.flatMap(picturesOf)
        : block.type === 'note'
          ? picturesOf(block.children)
          : [],
  )
}

/**
 * The pages as a module: each picture's file is imported, so the build gives it its address, and
 * the picture carries its size.
 */
function docsModule(docs: Docs): string {
  const files = new Map<string, string>()
  const name = (path: string) => {
    if (!files.has(path)) files.set(path, `picture${files.size}`)
    return files.get(path)!
  }
  for (const picture of [
    ...docs.pages.flatMap((p) => picturesOf(p.blocks)),
    ...docs.changelog.changes.flatMap((c) => picturesOf(c.children)),
  ]) {
    const size = pictureSize(join(root, picture.light))
    Object.assign(picture, size)
    const drawn = drawnWidth(picture.light, size.width)
    if (drawn) picture.drawnWidth = drawn
    picture.light = `\0${name(picture.light)}\0`
    picture.dark = `\0${name(picture.dark)}\0`
  }
  const imports = [...files].map(
    ([path, id]) => `import ${id} from ${JSON.stringify(join(root, path))}`,
  )
  const body = JSON.stringify(docs).replace(/"\\u0000(picture\d+)\\u0000"/g, '$1')
  return [...imports, `export default ${body}`].join('\n')
}

/** Every page's file, by its slug. README.md is about the pages, not one of them. */
export function docFiles(): DocFile[] {
  return readdirSync(folder)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort()
    .map((name) => ({
      slug: name.replace(/\.md$/, ''),
      source: readFileSync(join(folder, name), 'utf8'),
    }))
}

export function loadDocs(files = docFiles()): Docs {
  const read = readDocs(files, (yaml) => parse(yaml))
  if (!read.ok) throw new Error(`${docsFolder}/${read.reason}`)
  return read.value
}

export function helpDocs(): Plugin {
  return {
    name: 'footnote:help-docs',
    resolveId: (source) =>
      source === id ? resolved : source === titlesId ? titlesResolved : undefined,
    load(module) {
      if (module !== resolved && module !== titlesResolved) return
      for (const file of readdirSync(folder)) this.addWatchFile(join(folder, file))
      const docs = loadDocs()
      if (module === resolved) return docsModule(docs)
      const titles = Object.fromEntries(docs.pages.map((p) => [p.slug, p.title]))
      return `export default ${JSON.stringify(titles)}`
    },
    // A page saved while the app runs shows at once.
    configureServer(server) {
      server.watcher.add(folder)
      const reload = (path: string) => {
        if (!path.startsWith(folder)) return
        const modules = [resolved, titlesResolved].map((m) => server.moduleGraph.getModuleById(m))
        if (!modules.some(Boolean)) return
        for (const module of modules) if (module) server.moduleGraph.invalidateModule(module)
        server.ws.send({ type: 'full-reload' })
      }
      server.watcher.on('change', reload)
      server.watcher.on('add', reload)
      server.watcher.on('unlink', reload)
    },
  }
}
