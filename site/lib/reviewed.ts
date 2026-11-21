import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { settingsSectionIds } from '../../src/web/lib/settings-access.ts'
import { repoRoot, type SitePage } from './pages.ts'

/*
  Pages due for a check (site/README.md, "Due for a check"). Every published page says in its front
  matter the day someone last checked it against the app, `reviewed`. One checked more than 90 days
  ago is reported by name, as a warning: the app may have moved on under it. Such a page fails only
  when it names what the app no longer has, as far as a cheap read can tell: a setting, FOOTNOTE_
  and a name, that no code reads any more, or a link to a screen the app's router no longer has.
  Tools are not read: the pages also name Ask's own steps, which look like tools.
*/

/** How old a page's check may be before it is reported. */
export const REVIEW_DAYS = 90

const DAY = 24 * 60 * 60 * 1000

/** The folders and files whose code may read a setting, under the repository. */
const codePlaces = [
  'src',
  'scripts',
  'db',
  'docker',
  'site/lib',
  'site/scripts',
  'site/astro.config.ts',
  'Dockerfile',
  'compose.yaml',
  'compose.images.yaml',
  'vite.config.ts',
  'vite.docs.config.ts',
  'vercel.json',
  '.env.example',
]

/** Every setting some code names, read once a run: the FOOTNOTE_ names in the repository's code. */
function settingsInCode(root: string): Set<string> {
  const names = new Set<string>()
  const read = (path: string) => {
    let stat
    try {
      stat = statSync(path)
    } catch {
      return
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path))
        if (entry !== 'node_modules' && !entry.startsWith('.')) read(join(path, entry))
      return
    }
    if (stat.size > 2_000_000) return
    for (const [name] of readFileSync(path, 'utf8').matchAll(/FOOTNOTE_[A-Z0-9_]*[A-Z0-9]/g))
      names.add(name)
  }
  for (const place of codePlaces) read(join(root, place))
  return names
}

/** The app's addresses as patterns, from its router: `/settings/$section` matches `/settings/agents`, not `/settings/gone`. */
function screensOf(root: string): RegExp[] {
  const routes = readFileSync(join(root, 'src/web/routeTree.gen.ts'), 'utf8')
    .split('export interface FileRoutesByTo {')[1]!
    .split('}')[0]!
  return [...routes.matchAll(/'(\/[^']*)'/g)]
    .map((match) => match[1]!)
    .filter((path) => path !== '/$')
    .map(
      (path) =>
        new RegExp(
          `^${path.replace(/\$(\w+)/g, (_, name: string) =>
            name === 'section' ? `(?:${settingsSectionIds.join('|')})` : '[^/]+',
          )}$`,
        ),
    )
}

/** The addresses of a page's links to the app's screens, and of the screen its front matter opens. */
function screenLinks(source: string): string[] {
  const links = [...source.matchAll(/\]\((\/(?!\/)[^)\s]*)\)/g)].map((match) => match[1]!)
  const open = /^\s+href:\s*(\/\S*)\s*$/m.exec(source.split('\n---')[0] ?? '')?.[1]
  return [...links, ...(open ? [open] : [])]
}

export type Review = { warnings: string[]; problems: string[] }

/** The pages checked more than 90 days before `today`, and those that name what the app lost. */
export function checkReviewed(
  pages: readonly Pick<SitePage, 'file' | 'reviewed'>[],
  today: Date,
  root = repoRoot,
): Review {
  const review: Review = { warnings: [], problems: [] }
  const thisDay = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`)
  let settings: Set<string> | undefined
  let screens: RegExp[] | undefined
  for (const { file, reviewed } of pages) {
    const day = reviewed ? Date.parse(`${reviewed}T00:00:00Z`) : NaN
    if (Number.isNaN(day) || new Date(day).toISOString().slice(0, 10) !== reviewed) {
      review.problems.push(
        `${file}: say in its front matter the day it was last checked, as a real YYYY-MM-DD day, reviewed:`,
      )
      continue
    }
    if (day > thisDay) {
      review.problems.push(`${file}: reviewed: ${reviewed} is a day that has not come yet`)
      continue
    }
    const age = Math.floor((thisDay - day) / DAY)
    if (age <= REVIEW_DAYS) continue
    review.warnings.push(
      `${file}: checked ${age} days ago (reviewed: ${reviewed}): check it against the app and set reviewed to the day you do`,
    )
    const source = readFileSync(join(root, file), 'utf8')
    settings ??= settingsInCode(root)
    screens ??= screensOf(root)
    const named = new Set(source.match(/FOOTNOTE_[A-Z0-9_]*[A-Z0-9]/g) ?? [])
    for (const name of named)
      if (!settings.has(name))
        review.problems.push(`${file}: names the setting ${name}, which no code reads any more`)
    for (const address of new Set(screenLinks(source))) {
      const path = address.split(/[?#]/)[0]!.replace(/(.)\/$/, '$1')
      if (!screens.some((pattern) => pattern.test(path)))
        review.problems.push(`${file}: links to the screen ${address}, which the app no longer has`)
    }
  }
  return review
}
