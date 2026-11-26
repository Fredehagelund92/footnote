import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { answers, lines } from '../landing/demo.ts'
import { metrics } from '../landing/definitions.ts'
import { footnotes } from '../landing/footnotes.ts'
import { repoRoot, sitePages } from '../lib/pages.ts'

/*
  The landing page promises that what it shows of the demo is the demo's own, and that each
  footnote is its source's own sentence. These hold it to the files they come from, so a change to
  the demo or to a page of the docs that leaves the landing page saying something else fails here.
  What the page shows was asked of a fresh install of the demo through get_context on 26 Nov 2026
  (landing/demo.ts).
*/

const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8')
/** The words of a file as a reader sees them: no Markdown marks, one space between words. */
const words = (path: string) =>
  read(path)
    .replace(/`|\*\*/g, '')
    .replace(/\s+/g, ' ')

const story = read('db/seed/story.ts')
const storyFacts = read('db/seed/fixtures/story-facts.ts')
const world = words('docs/design/demo-world.md')
const cubeModel = read('db/seed/fixtures/cube-model.ts')
const answerLines = read('src/domain/answer-state.ts')
/** Text the demo's seed holds, in a TypeScript string, where an apostrophe may be escaped. */
const seeded = (text: string) =>
  [story, storyFacts].some((file) => file.replace(/\\'/g, "'").includes(text))

describe("the first screen's questions", () => {
  it('quote the notes the demo holds, word for word', () => {
    for (const answer of answers)
      for (const note of answer.notes) {
        expect(seeded(note.title), note.title).toBe(true)
        if (note.quote) {
          expect(seeded(note.quote.text), note.quote.text).toBe(true)
          expect(seeded(`https://${note.quote.source}`), note.quote.source).toBe(true)
        }
        if (note.dont) expect(seeded(note.dont), note.dont).toBe(true)
        for (const who of note.who) expect(world.includes(who.name), who.name).toBe(true)
      }
  })

  it("say each answer in its note's own words", () => {
    for (const answer of answers)
      if (Array.isArray(answer.says) && answer.line !== 'conflict')
        for (const said of answer.says) expect(seeded(said.text), said.text).toBe(true)
    for (const answer of answers)
      if (answer.next && answer.line !== 'conflict' && answer.line !== 'missing')
        expect(seeded(answer.next), answer.next).toBe(true)
  })

  it('start with the answer lines the app gives, in its words', () => {
    for (const { label, says } of Object.values(lines)) {
      expect(answerLines.includes(`label: '${label}'`), `label: '${label}'`).toBe(true)
      expect(answerLines.includes(`sentence: '${says}.'`), `sentence: '${says}.'`).toBe(true)
    }
  })
})

describe('the definitions window', () => {
  it("shows the demo's own metrics: name, group, other name and definition", () => {
    for (const metric of metrics) {
      expect(
        world.includes(`${metric.key} ${metric.name} | ${metric.group} | ${metric.definition}`),
        `${metric.key} ${metric.name} | ${metric.group} | ${metric.definition}`,
      ).toBe(true)
      if (metric.aka)
        expect(
          world.includes(`${metric.aka} | ${metric.name} |`),
          `${metric.aka} | ${metric.name} |`,
        ).toBe(true)
    }
  })

  it("shows what the demo's Cube model says each is built from, and no tree it does not declare", () => {
    for (const metric of metrics) {
      const entry = cubeModel
        .split(`ref: 'cube:`)
        .find((part) => /^\w+\.(\w+)'/.exec(part)?.[1] === metric.key)
      expect(entry, metric.key).toBeDefined()
      const built = /builtFrom: \{ refs: \[(.*?)\], columns: \[(.*?)\] \}/.exec(entry!)
      expect(built?.[1] ?? '', `${metric.key} is built from other metrics`).toBe('')
      const columns = [...(built?.[2] ?? '').matchAll(/'(\w+)'/g)].map((match) => match[1])
      expect(metric.columns, metric.key).toEqual(columns)
    }
  })

  it('names notes the demo holds', () => {
    for (const metric of metrics)
      for (const note of metric.notes) expect(seeded(note.title), note.title).toBe(true)
  })
})

describe("the page's footnotes", () => {
  const pages = new Map(sitePages().map((page) => [page.slug, page]))

  it("quote each source's own sentence", () => {
    for (const [i, note] of footnotes.entries()) {
      const file = 'file' in note.source ? note.source.file : pages.get(note.source.page)?.file
      expect(file, `footnote ${i + 1}`).toBeDefined()
      if (note.quote) expect(words(file!).includes(note.quote), `footnote ${i + 1}`).toBe(true)
    }
  })
})
