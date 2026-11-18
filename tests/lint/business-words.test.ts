import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Sentences an engineer would say, found where a business person reads them (the release judge's
 * product findings and the language audit of 12 November 2026), each with what it says now. None
 * may come back anywhere in the app, its service, its demo data or its seed: each was read on a
 * screen, in Ask's footer, or in the scripted reader's answer.
 */
const retired: readonly [string, string][] = [
  ['you may read', 'you can see'],
  ['found and not listed', 'match and are not shown'],
  ['all Live, checked', 'all published, checked'],
  ['answered Unrelated unless you change', 'Unless you choose, nothing published changes'],
  ['Decide how they relate', "Compare with what's published"],
  ['would not hand it over', 'the site that keeps it did not send it'],
  ['give one under 5 away', 'hidden, to protect small counts'],
  ['is uncovered, reported or suggested', 'No new suggestion, report or unanswered question'],
  ['which are not context yet', 'left out until they are published'],
  ['Agents did not read this answer', 'This answer is only for you'],
  ['the dev server', 'Check your connection, then reload'],
  ['This sign-in has ended', 'This request is no longer open'],
  ['Not checked whether another item disagrees', "it isn't known yet whether one disagrees"],
  ['orders land in', 'orders are split over two weeks'],
  ['so before, no card came', 'no card came until the two were counted together'],
  ['netted off', 'taken off revenue'],
  ["There's no secret store", 'no safe place to keep keys'],
  ['across a month edge', 'across two months'],
  ['Only that was checked', 'Nothing else was looked up'],
  ['model spending reached', 'AI cost'],
  ['did not sync', 'could not be read'],
  ['Ask the data team to start it', 'Ask the person who hosts this app'],
]

const root = fileURLToPath(new URL('../../', import.meta.url))

/** The files people's words come from: the app, its service and the demo world and seed. */
const filesUnder = (dir: string): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(`${dir}/${entry.name}`)
      : /\.(ts|tsx|json)$/.test(entry.name)
        ? [`${dir}/${entry.name}`]
        : [],
  )
const files = ['src', 'db/seed'].flatMap(filesUnder).map((file) => ({
  file,
  // Code comments may still name the old words when they say what changed; strings may not.
  text: readFileSync(join(root, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, ''),
}))

describe('words a business person reads', () => {
  it.each(retired)('never says "%s" (now: "%s")', (before) => {
    const found = files.filter(({ text }) => text.includes(before)).map(({ file }) => file)
    expect(found).toEqual([])
  })
})
