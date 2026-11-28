import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { demoDefinitions } from '../../db/seed/fixtures/cube-model.ts'
import { storyFacts } from '../../db/seed/fixtures/story-facts.ts'
import { ANSWER_LINES } from '../../src/domain/answer-state.ts'
import { contextSaid, contextVoice } from '../../src/domain/say.ts'
import { answers, lines } from '../landing/demo.ts'
import { metrics } from '../landing/definitions.ts'
import * as meaning from '../landing/meaning.ts'
import { agentDoor, caption, checked, draft, firstBox, thread } from '../landing/said.ts'
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
  The section on a thread that becomes a note (landing/said.ts) is a demonstration with an invented
  story, so it is held to the app's own words instead: the first box, the draft's fields and its
  button, the tools, and the sentence get_context says.
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

describe('the meaning section', () => {
  it("names the demo's Norway note, its writer, its owner and its check date", () => {
    expect(world.includes(meaning.note.title), meaning.note.title).toBe(true)
    for (const name of [meaning.note.writer, meaning.note.checker])
      expect(world.includes(name), name).toBe(true)
    expect(meaning.note.checkedOn).toBe('3 Oct 2026')
  })

  it('puts the stop in the week that takes in Tuesday 4 August 2026', () => {
    expect(meaning.weeks[meaning.stop]!.monday).toBe('2026-08-03')
    expect(meaning.week(meaning.stop).dates).toBe('3 to 9 Aug, takes in 4 Aug')
    expect(meaning.week(meaning.opening).day).toBe('10 Aug 2026')
  })

  it('tells the note only for weeks from the stop on', () => {
    for (let i = 0; i <= meaning.last; i++) {
      const week = meaning.week(i)
      expect(week.applies, week.day).toBe(i >= meaning.stop)
      if (week.applies) expect(week.says, week.day).toContain('stopped on 4 August')
      else expect(week.says, week.day).toContain('Nothing is written about that week.')
    }
  })

  it('shows no figure: each week is said in words, with no number but a date', () => {
    for (let i = 0; i <= meaning.last; i++) {
      const week = meaning.week(i)
      expect(week.move, week.day).not.toMatch(/\d/)
      expect(week.says.replace('4 August', ''), week.day).not.toMatch(/\d/)
    }

describe('the thread that becomes a note', () => {
  const editor = read('src/web/pages/editor.tsx')

  it("shows the first box of a new item in the app's words", () => {
    const door = read('src/web/model/writing-help.ts')
    expect(editor).toContain(`'${firstBox.page}'`)
    expect(editor).toContain(firstBox.question)
    expect(door).toContain(`button: '${firstBox.button}'`)
    expect(door).toContain(`note: '${firstBox.note}'`)
  })

  it("names the draft's fields and its button as the editor does", () => {
    for (const field of draft.fields)
      expect(editor, field.label).toContain(`label="${field.label}"`)
    expect(editor).toContain('to the owner of {domains[form.domain]?.name}')
    expect(draft.send).toBe('Send to the owner of Sales')
    expect(read('src/domain/readiness.ts')).toContain(`title: '${draft.ready}'`)
  })

  it('names tools and a status the agent contract has, and the people who own Sales', () => {
    const schemas = read('src/server/mcp/schemas.ts')
    expect(schemas).toContain(`'${agentDoor.status}'`)
    for (const tool of [agentDoor.tool, checked.tool])
      expect(read('src/server/mcp/tools.ts'), tool).toContain(`'${tool}'`)
    expect(world).toContain(`${checked.owner.name} (owner of Sales`)
  })

  it('says what get_context says for one checked item', () => {
    const said = contextSaid(
      {
        terms: [
          { key: 'orders', name: 'Orders' },
          { key: 'spain', name: 'Spain' },
        ],
      },
      {
        status: 'matched',
        scope: {
          metrics: ['orders'],
          filters: { market: ['spain'] },
          window: { start: '2026-11-14', end: '2026-11-15' },
        },
        issues: [],
        question: checked.question,
        delivered: 1,
        partial: 0,
        cut: 0,
        withheld: [],
        assumed: null,
      },
      contextVoice,
    )
    expect(said.say).toBe(`${checked.line}. ${checked.say}`)
    expect(ANSWER_LINES.some((line) => line.label === checked.line)).toBe(true)
  })

  it('says it is a demonstration with invented people, and shows no chat app control', () => {
    expect(caption).toContain('A demonstration the page plays, not a recording.')
    expect(caption).toContain('invented')
    expect(caption).toContain('Footnote has no Slack app: you copy the thread.')
    // Elena Ruiz and the Spain story are the section's own, not the demo's.
    expect(world).not.toContain('Elena Ruiz')
    expect(world).not.toContain(draft.title)
    expect(thread.messages.filter((m) => m.copied)).toHaveLength(2)
  })
})
