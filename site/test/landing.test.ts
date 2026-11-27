import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { demoDefinitions } from '../../db/seed/fixtures/cube-model.ts'
import { storyFacts } from '../../db/seed/fixtures/story-facts.ts'
import { ANSWER_LINES } from '../../src/domain/answer-state.ts'
import { answers, lines } from '../landing/demo.ts'
import { metrics } from '../landing/definitions.ts'
import { repoRoot } from '../lib/pages.ts'

/*
  The landing page promises that what it shows of the demo is the demo's own. These hold it to the
  data the demo is made of, imported and compared by value (the answer lines, the hand-written
  story facts, the Cube model's definitions).
  db/seed/story.ts cannot be imported here: it pulls in the server, Fastify, pg and the MCP
  clients. So the notes only it publishes (the Norway note and the two United Kingdom notes) are
  held to docs/design/demo-world.md, the demo's design: their titles and the names beside them.
  Their quote, source, don't-conclude line and wording are not checked here.
  What the page shows was asked of a fresh install of the demo through get_context on 26 Nov 2026
  (landing/demo.ts).
*/

const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8')
/** The words of a file as a reader sees them: no Markdown marks, one space between words. */
const words = (path: string) =>
  read(path)
    .replace(/`|\*\*/g, '')
    .replace(/\s+/g, ' ')

const world = words('docs/design/demo-world.md')

describe("the first screen's questions", () => {
  it('name notes and people the demo holds', () => {
    for (const answer of answers)
      for (const note of answer.notes) {
        expect(world.includes(note.title), note.title).toBe(true)
        for (const who of note.who) expect(world.includes(who.name), who.name).toBe(true)
      }
  })

  it("quote Germany's note as the demo's story fact holds it", () => {
    const germany = answers.find((answer) => answer.key === 'germany')!
    const fact = storyFacts['itm_0tmqp7o1']!
    const [said] = germany.says as readonly { text: string }[]
    const [note] = germany.notes
    expect(fact.summary).toBe(`${said!.text} ${germany.next}`)
    expect(fact.notToConclude).toBe(note!.dont)
    expect(fact.source.quote).toBe(note!.quote!.text)
    expect(fact.source.url).toBe(`https://${note!.quote!.source}`)
  })

  it('start with the answer lines the app gives, in its words', () => {
    for (const { label, says } of Object.values(lines)) {
      const line = ANSWER_LINES.find((candidate) => candidate.label === label)
      expect(line, label).toBeDefined()
      expect(`${says}.`, label).toBe(line!.sentence)
    }
  })
})

describe('the definitions window', () => {
  const demo = (key: string) =>
    demoDefinitions.find((definition) => definition.name.endsWith(`.${key}`))

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
      const definition = demo(metric.key)
      expect(definition, metric.key).toBeDefined()
      expect(
        definition!.builtFrom?.refs ?? [],
        `${metric.key} is built from other metrics`,
      ).toEqual([])
      expect(metric.columns, metric.key).toEqual(definition!.builtFrom?.columns ?? [])
    }
  })

  it("gives each definition as the demo's Cube model words it", () => {
    for (const metric of metrics)
      expect(metric.definition, metric.key).toBe(demo(metric.key)!.descriptionCopy)
  })

  it('names notes the demo holds', () => {
    for (const metric of metrics)
      for (const note of metric.notes) expect(world.includes(note.title), note.title).toBe(true)
  })
})
