import { readdirSync, readFileSync } from 'node:fs'
import MiniSearch from 'minisearch'
import { parse } from 'yaml'
import type { ActionId } from '../../../domain/actions.ts'
import { docsFolder, type DocFile } from '../../../domain/docs.ts'
import { readDocs } from '../../docs-read.ts'
import { bundled } from '../../bundled.ts'

/*
  Footnote's built-in help, as Ask reads it to answer a question about Footnote itself (FR-719.8):
  the pages of the documentation (docs/help), each cut at its headings into the parts its search
  shows, read once from the files beside the code; the Vercel bundle carries them in (bundled.ts).
*/

/** One part of a help page: the page, its heading and the words under it. */
export type HelpSection = {
  /** The page, by the slug its address takes: `write-context`. */
  slug: string
  /** The heading's anchor on the page; empty for the words above the first heading. */
  id: string
  title: string
  /** The heading; the page's title for the words above the first heading. */
  heading: string
  text: string
  /** The quick actions the part explains, as its page names them (`does:`). */
  does?: ActionId[]
}

const folder = new URL(`../../../../${docsFolder}/`, import.meta.url)

/** The help pages' files, by slug: README.md is about the pages, not one of them. */
export const helpFiles = (): DocFile[] =>
  readdirSync(folder)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort()
    .map((name) => ({
      slug: name.replace(/\.md$/, ''),
      source: readFileSync(new URL(name, folder), 'utf8'),
    }))

/** The help pages' parts, from their files: a page that cannot be read is an error, as at build. */
export function readHelp(files: readonly DocFile[] = helpFiles()): HelpSection[] {
  const read = readDocs(files, (yaml) => parse(yaml))
  if (!read.ok) throw new Error(`${docsFolder}/${read.reason}`)
  return read.value.pages.flatMap((page) =>
    page.sections.map((s) => ({
      slug: page.slug,
      id: s.id,
      title: page.title,
      heading: s.id ? s.heading : page.title,
      text: s.id ? s.text : `${page.line}\n${s.text}`,
      ...(s.does && { does: s.does }),
    })),
  )
}

/** The most parts one help read gives back. */
const HELP_SHOWN = 3
/** The most characters of a part's words one read gives back. */
const HELP_TEXT = 1500

let index: MiniSearch<HelpSection & { key: string }> | undefined

/** The help's search index, built on its first use. */
function helpIndex() {
  index ??= (() => {
    const built = new MiniSearch<HelpSection & { key: string }>({
      idField: 'key',
      fields: ['title', 'heading', 'text'],
      storeFields: ['slug', 'id', 'title', 'heading', 'text', 'does'],
      searchOptions: {
        boost: { title: 3, heading: 2 },
        // A word of three letters or more matches the start of a longer one too, and one of four
        // or more a word one typo away; a shorter word only itself. As a start, "a" matched every
        // word that begins with an a, and with a typo "add" matched "and": the part with the most
        // of those came first, and an answer showed it as its source.
        prefix: (term: string) => term.length >= 3,
        fuzzy: (term: string) => (term.length >= 4 ? 0.2 : false),
      },
    })
    built.addAll((bundled?.help ?? readHelp()).map((s) => ({ ...s, key: `${s.slug}#${s.id}` })))
    return built
  })()
  return index
}

/**
 * Builds the help's search index now: the service does it as it starts, so the first question
 * about Footnote, often a new install's first greeting, does not wait for it (1.4 s on a busy
 * machine, 2.7 s under load). Says how many parts it holds.
 */
export const readyHelp = (): number => helpIndex().documentCount

/**
 * The help's parts that best match some words, best first, at most three: a page's title, each
 * heading and the words under it, much as the docs' own search finds them (src/web/lib/docs.ts),
 * but for any of the words, and a short word only as itself.
 */
export function searchHelp(words: string): HelpSection[] {
  if (!words.trim()) return []
  return helpIndex()
    .search(words)
    .slice(0, HELP_SHOWN)
    .map((hit) => ({
      slug: hit.slug as string,
      id: hit.id as string,
      title: hit.title as string,
      heading: hit.heading as string,
      text: (hit.text as string).slice(0, HELP_TEXT),
      ...(hit.does ? { does: hit.does as ActionId[] } : {}),
    }))
}
