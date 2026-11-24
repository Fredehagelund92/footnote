// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DefinitionCard, LoopTurn } from '@contract/answer'
import type { Answer } from '@/model/ask'
import { dimensionHue } from '@domain/ask-nouns'
import { answerLines } from '@domain/words'
import examples from '@/api/mock/data/loop-examples.json'
import { usedTurn } from '@/api/mock/loop-used'
import { openDock } from '@/lib/dock'

/*
  Ask's loop answers as the page draws them (direction C, FR-349, FR-718 to FR-720), in every state
  the service wrote on the demo week (src/web/api/mock/data/loop-examples.json, written by
  tests/web/integration/ask-loop-shapes.test.ts), and on a workspace of teams and sprints: the
  state and its fixed sentence, the words with their chips, the evidence in its fixed order, an
  overview's groups, and every chip a button that says what it is, whose card opens on a press.
*/

const world = vi.hoisted(() => ({
  me: { name: 'Jon Abara', role: 'Owner of Sales, admin', owns: ['area_sales'], admin: true },
  writes: [] as { op: string; input: unknown }[],
  failing: new Set<string>(),
}))
vi.mock('@/lib/workspace', () => ({
  useFacts: () => [],
  useFact: () => undefined,
  useMe: () => world.me,
  useDomains: () => ({
    area_sales: {
      id: 'area_sales',
      name: 'Sales',
      owners: ['Jon Abara'],
      covers: 'Orders.',
      text: '',
    },
    area_customer_value: {
      id: 'area_customer_value',
      name: 'Customer value',
      owners: ['Alex Moreau'],
      covers: 'Churn.',
      text: '',
    },
  }),
  usePeople: () => [world.me, { name: 'Ravi Kapoor', role: 'Admin', owns: [], admin: true }],
}))
vi.mock('@/lib/definitions', () => ({ useDefinitions: () => [] }))
vi.mock('@/api/queries', () => ({
  useWrite: () => (op: string, input: unknown) => {
    world.writes.push({ op, input })
    const word = (input as { word?: string }).word
    if (word && world.failing.has(word)) return Promise.reject(new Error('down'))
    return Promise.resolve({ id: 'g1' })
  },
}))
vi.mock('@/lib/dock', () => ({ openDock: vi.fn(), useDock: () => null }))
// Reading items ahead needs the app's query cache, which a static drawing has not.
vi.mock('@/lib/read-ahead', () => ({ useReadAhead: () => () => ({}), useReadCitedAhead: () => {} }))
vi.mock('@/lib/shown-answers', () => ({ answerKey: () => 'k', keepShown: () => {} }))
vi.mock('@/lib/router', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useRoute: () => ({ path: '/ask', query: new URLSearchParams() }),
}))

const { AskedAtLine, LoopAnswerBody, LoopReadLine } =
  await import('@/components/footnote/loop-answer')
const { loopParts } = await import('@/components/footnote/loop-parts')
const { AnswerActions, ReportLine, SomethingWrong } = await import('@/components/footnote/answer')
// The figure reads the data through the app's query cache: here, where it goes is enough.
const AnswerFigure = ({ answer }: { answer: { metric: string } }) =>
  React.createElement('p', { 'data-figure': answer.metric })
const parts = { ...loopParts, AnswerActions, ReportLine, SomethingWrong, AnswerFigure }
const { loopAnswerOf } = await import('@/api/http-ask')
const turnModule = await import('@/model/ask-turn')
const { doneTurn } = turnModule

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
let root: Root | undefined
let host: HTMLElement | undefined
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})
const names = {
  metric: (k: string) => k,
  value: (k: string) => k,
  metricKey: () => undefined,
  marketKey: () => undefined,
}
function render(turn: LoopTurn, question = 'A question?') {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const answer = loopAnswerOf(turn, question, names)
  act(() =>
    root!.render(
      React.createElement(LoopAnswerBody, { parts, turn: doneTurn(answer), latest: true }),
    ),
  )
  return host
}
const example = (id: keyof typeof examples) => examples[id].turn as unknown as LoopTurn
/** The words on screen: what a screen reader alone hears (`sr-only`) left out. */
const text = (el: Element) => {
  const shown = el.cloneNode(true) as Element
  for (const hidden of shown.querySelectorAll('.sr-only')) hidden.remove()
  return shown.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}
/** A control's name: its label, or what it says, a screen reader's words included. */
const nameOf = (el: Element) => {
  const label = el.getAttribute('aria-label')
  if (label) return label
  const said = el.cloneNode(true) as Element
  for (const hidden of said.querySelectorAll('[aria-hidden="true"]')) hidden.remove()
  return said.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}
const buttons = (el: Element, name: RegExp) =>
  [...el.querySelectorAll('[role="button"], button')].filter((b) =>
    name.test(b.getAttribute('aria-label') ?? b.textContent ?? ''),
  )

describe("Ask's loop answer, state by state", () => {
  it('Checked: no sentence beside the state, the words with chips, then what was used', () => {
    const el = render(example('loop-checked'))
    expect(text(el)).toContain('Checked')
    expect(text(el)).not.toContain('This is written down and checked.')
    expect(buttons(el, /^Orders, metric$/)).toHaveLength(1)
    expect(buttons(el, /, value$/).length).toBeGreaterThan(0)
    // What it rests on, as a chip with its title under the words, without a press.
    const item = example('loop-checked').items.find((i) => i.n === 1)!
    const chips = el.querySelector('[data-sources]')!
    expect(text(chips)).toContain(item.title)
    expect(buttons(chips, /^Source 1: /)).toHaveLength(1)
  })

  it('Not found: one sentence, the closest written counted by value with four rows, the owners, and Write context', () => {
    const el = render(example('loop-missing'))
    expect(text(el)).toContain('Nothing published about this yet.')
    expect(text(el)).toContain('Written nearest about')
    const rows = el.querySelectorAll('li')
    expect(rows.length).toBe(4)
    const more = [...el.querySelectorAll('button')].find((b) => /^Show \d+ more$/.test(text(b)))
    expect(more).toBeDefined()
    act(() => more!.click())
    expect(el.querySelectorAll('li').length).toBe(example('loop-missing').closest!.items.length)
    // The gap card: what is not written, and, to its owner, Write context for it.
    const gap = el.querySelector('[data-gap]')!
    expect(gap.getAttribute('aria-label')).toBe('Not written yet: Orders in Poland')
    expect(text(gap)).toMatch(
      /^Orders in PolandNo published context item covers it yet\. It is yours to write/,
    )
    expect(buttons(gap, /^Write context for Orders in Poland$/)).toHaveLength(1)
    expect(text(el)).toMatch(/^.*0 of 21 published context items you can see apply/)
  })

  it('Stopped: one sentence first, then the plain read with its answer line and evidence', () => {
    const sentence =
      'Ask stopped at its time limit of 30 seconds before it had an answer, so this is what is written, as agents get it.'
    // A stop is a stop: the service gives it no state, and the page says Stopped in its place.
    const el = render({
      ...example('loop-missing'),
      kind: 'stopped',
      text: sentence,
      stopped: 'time',
      state: null,
    })
    const shown = text(el)
    expect(shown.startsWith(`Stopped${sentence}`)).toBe(true)
    expect(shown).not.toMatch(/Not found|Checked|Partial/)
    expect(el.querySelector('[data-gap]')).toBeNull()
    expect(shown).not.toContain('Nothing it wrote was checked')
  })

  const searched = (turn: LoopTurn, question: string) => {
    const el = render(turn, question)
    const search = buttons(el, /^Search for these words$/)
    expect(search).toHaveLength(1)
    // No page of its own, and the words never go into an address.
    expect(search[0]!.getAttribute('href')).toBeNull()
    const opened: unknown[] = []
    const seen = (e: Event) => opened.push((e as CustomEvent).detail)
    window.addEventListener('footnote:open', seen)
    try {
      act(() => (search[0] as HTMLElement).click())
    } finally {
      window.removeEventListener('footnote:open', seen)
    }
    expect(opened).toHaveLength(1)
    return (opened[0] as { overlay: string; words: string }).words
  }
  const nothingRead = { body: [], items: [], sources: [] }

  it('Stopped with nothing read: Search for these words hands over the words Ask read, never an address', () => {
    const words = searched(
      { ...example('loop-stopped'), ...nothingRead },
      'Give me all about orders in poland',
    )
    expect(words).toBe('Orders Poland')
  })

  it('Stopped with nothing read and no metric or market: no Search button, Ask again stays', () => {
    const el = render(
      { ...example('loop-stopped'), ...nothingRead, subject: null },
      'give me everything we know about churn',
    )
    expect(buttons(el, /^Search for these words$/)).toHaveLength(0)
  })

  it('Not found, for a reader who may not write: Tell the owner, which files the subject and says it was sent', async () => {
    const owner = world.me
    world.me = { name: 'Ines Duarte', role: 'Suggests context', owns: [], admin: false }
    world.writes.length = 0
    try {
      const el = render(example('loop-missing'))
      expect(text(el)).not.toMatch(/Write context/)
      const tell = [...el.querySelectorAll('button')].find((b) => text(b) === 'Tell the owner')
      expect(tell).toBeDefined()
      expect(text(el.querySelector('[data-gap]')!)).toContain(
        'Jon Abara and Sofia Brandt, the owners of Sales, can write it.',
      )
      expect(text(el.querySelector('[data-gap]')!)).toContain(
        'Only what it is about is sent, never your words.',
      )
      await act(async () => {
        tell!.click()
        await Promise.resolve()
      })
      // The subject's metric and values, and no date since none was named: nothing of the words.
      expect(world.writes).toEqual([
        { op: 'tellOwner', input: { about: ['metric:orders', 'value:market/poland'] } },
      ])
      // Before: who can write it, by name, and that only what it is about is sent.
      // After: who was told, by name.
      expect(text(el.querySelector('[data-gap]')!)).toContain(
        'Sent to Jon Abara and Sofia Brandt, the owners of Sales. It waits in their Inbox.',
      )
      expect([...el.querySelectorAll('button')].some((b) => text(b) === 'Tell the owner')).toBe(
        false,
      )
    } finally {
      world.me = owner
    }
  })

  const ebitda = (): LoopTurn => ({
    ...example('loop-missing'),
    state: null,
    subject: null,
    owners: [],
    closest: null,
    text: 'Nothing written covers EBITDA, so Ask has no definition of it to give you.',
    body: [
      {
        t: 'p',
        runs: [
          {
            t: 'text',
            text: 'Nothing written covers EBITDA, so Ask has no definition of it to give you.',
          },
        ],
      },
    ],
    unknown: ['EBITDA'],
  })

  it('A word the reads found nothing under: Tell an admin sends the word alone, and says who was told', async () => {
    const owner = world.me
    world.me = { name: 'Ines Duarte', role: 'Suggests context', owns: [], admin: false }
    world.writes.length = 0
    try {
      const el = render(ebitda(), 'What is our EBITDA definition?')
      const gap = el.querySelector('[data-gap]')!
      expect(gap.getAttribute('aria-label')).toBe('Not written yet: “EBITDA”')
      expect(text(gap)).toContain(
        'No published metric, other name or context item uses this word yet. Ravi Kapoor, an admin, can add it.',
      )
      expect(text(gap)).toContain('Only this word is sent, never your question.')
      const tell = buttons(gap, /^Tell an admin$/)
      expect(tell).toHaveLength(1)
      await act(async () => {
        ;(tell[0] as HTMLElement).click()
        await Promise.resolve()
      })
      expect(world.writes).toEqual([{ op: 'tellOwner', input: { about: [], word: 'EBITDA' } }])
      expect(text(gap)).toContain('Sent to Ravi Kapoor, an admin. It waits in their Inbox.')
    } finally {
      world.me = owner
    }
  })

  it('Tell an admin, retried after one word failed, sends only the word that failed', async () => {
    const owner = world.me
    world.me = { name: 'Ines Duarte', role: 'Suggests context', owns: [], admin: false }
    world.writes.length = 0
    world.failing = new Set(['ARR'])
    try {
      const el = render({ ...ebitda(), unknown: ['EBITDA', 'ARR'] }, 'What are our EBITDA and ARR?')
      const gap = el.querySelector('[data-gap]')!
      expect(text(gap)).toContain('uses these words yet. Ravi Kapoor, an admin, can add them.')
      const press = async () => {
        await act(async () => {
          ;(buttons(gap, /^Tell an admin$/)[0] as HTMLElement).click()
          await new Promise((done) => setTimeout(done))
        })
      }
      await press()
      expect(text(gap)).not.toContain('Sent to')
      world.failing = new Set()
      await press()
      expect(world.writes.map((w) => (w.input as { word: string }).word)).toEqual([
        'EBITDA',
        'ARR',
        'ARR',
      ])
      expect(text(gap)).toContain('Sent to')
    } finally {
      world.me = owner
      world.failing = new Set()
    }
  })

  it('A word the reads found nothing under, to an admin: Add it to Definitions, with the word in it', () => {
    const el = render(ebitda(), 'What is our EBITDA definition?')
    const gap = el.querySelector('[data-gap]')!
    expect(text(gap)).toContain('It is yours to add.')
    const [add] = buttons(gap, /^Add “EBITDA” to Definitions$/)
    expect(add!.getAttribute('href')).toBe('/definitions/new?name=EBITDA')
    expect(buttons(gap, /^Tell/)).toHaveLength(0)
  })

  it('A word the reads found nothing under, to an owner who is no admin: Add it to Definitions too, as New term is theirs', () => {
    const admin = world.me
    world.me = { ...admin, role: 'Owner of Sales', admin: false }
    try {
      const gap = render(ebitda(), 'What is our EBITDA definition?').querySelector('[data-gap]')!
      expect(text(gap)).toContain('It is yours to add.')
      expect(buttons(gap, /^Add “EBITDA” to Definitions$/)).toHaveLength(1)
    } finally {
      world.me = admin
    }
  })

  it('Two words the reads found nothing under, to an admin: They are yours to add, each by its own button', () => {
    const el = render({ ...ebitda(), unknown: ['EBITDA', 'ARR'] }, 'What are our EBITDA and ARR?')
    const gap = el.querySelector('[data-gap]')!
    expect(text(gap)).toContain('They are yours to add.')
    expect(buttons(gap, /^Add “.+” to Definitions$/).map((b) => b.getAttribute('href'))).toEqual([
      '/definitions/new?name=EBITDA',
      '/definitions/new?name=ARR',
    ])
  })

  it('makes the chips and the citations the buttons in the words, never a sentence', () => {
    const el = render(example('loop-conflict'))
    const words = el.querySelector('[data-answer-words]')!
    const pressable = [...words.querySelectorAll('[role="button"], button, [tabindex]')]
    expect(pressable.length).toBeGreaterThan(0)
    for (const b of pressable)
      expect(b.getAttribute('aria-label') ?? b.textContent).toMatch(
        /, (?:metric|value|dimension|domain|person)$|^Source \d+: /,
      )
    for (const block of words.querySelectorAll('p, li, span:not([role])'))
      expect([block.getAttribute('role'), block.getAttribute('tabindex')]).toEqual([null, null])
  })

  it('leaves the owners out when the words already name each of them', () => {
    const turn = example('loop-missing')
    const people = turn.owners.flatMap((o) => o.people)
    expect(people.length).toBeGreaterThan(0)
    const named: LoopTurn = {
      ...turn,
      body: [
        ...turn.body,
        {
          t: 'p',
          runs: [
            { t: 'text', text: 'Its owners are ' },
            ...people.map((id) => ({ t: 'noun' as const, id })),
          ],
        },
      ],
    }
    expect(text(render(named)).match(/owned by/g)).toBeNull()
  })

  it('says a domain once to a screen reader when the words after its chip name it (F9)', () => {
    const turn = example('loop-missing')
    const domain = turn.nouns.find((n) => n.id.startsWith('domain:'))!
    const owned = (after: string): LoopTurn => ({
      ...turn,
      body: [
        {
          t: 'p',
          runs: [
            { t: 'text', text: 'Jon Abara owns it in the ' },
            { t: 'noun', id: domain.id },
            { t: 'text', text: after },
          ],
        },
      ],
    })
    // What a screen reader reads: the words shown and those only it hears.
    const heard = (turn: LoopTurn) => render(turn).textContent.replace(/\s+/g, ' ')
    expect(heard(owned(' domain.'))).toContain(`owns it in the ${domain.name} domain.`)
    expect(heard(owned(', which has no rule.'))).toContain(
      `owns it in the ${domain.name}, domain, which has no rule.`,
    )
  })

  it('Conflict: the two that disagree side by side, who decides, and Compare the two', () => {
    const el = render(example('loop-conflict'))
    expect(text(el)).toContain('Two items say different things.')
    expect(text(el)).toContain('These two disagree')
    expect(text(el)).toMatch(/Which one holds is for the owners of Sales and Paid media to decide/)
    expect([...el.querySelectorAll('button')].some((b) => text(b) === 'Compare the two')).toBe(true)
  })

  it('Outdated: the item stays in sight saying it may be out of date, and an admin can mark it still true', () => {
    const el = render(example('loop-stale'))
    expect(text(el)).toContain('Some of this may be old.')
    expect(text(el.querySelector('[data-pinned]')!)).toContain('May be out of date')
    expect([...el.querySelectorAll('button')].some((b) => text(b) === 'Mark it still true')).toBe(
      true,
    )
    // The day a read gave is drawn as a day, never as the model's digits.
    expect(el.querySelector('time')?.getAttribute('dateTime')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('Sources: the first three as chips with their titles, the rest behind +n', () => {
    const turn = usedTurn(5)
    const el = render(turn)
    const chips = el.querySelector('[data-sources]')!
    // A chip's name is what it shows: its number, its title and the day it was checked.
    const named = () => buttons(chips, /^Source \d+: /).map(nameOf)
    expect(named().map((name) => name.replace(/, checked .+$/, ''))).toEqual(
      turn.items.slice(0, 3).map((i) => `Source ${i.n}: ${i.title}`),
    )
    for (const name of named()) expect(name).toMatch(/, checked \d+ \w+ \d{4}$/)
    for (const i of turn.items.slice(0, 3)) expect(text(chips)).toContain(i.title)
    const more = buttons(chips, /^Show 2 more sources$/)
    expect(more).toHaveLength(1)
    expect(text(more[0]!)).toBe('+2')
    act(() => (more[0] as HTMLElement).click())
    expect(named()).toHaveLength(5)
    expect(buttons(chips, /more sources?$/)).toHaveLength(0)
  })

  it('Sources: pointing at a chip lights its marks in the words', () => {
    const el = render(usedTurn(2))
    const chip = buttons(el.querySelector('[data-sources]')!, /^Source 2: /)[0] as HTMLElement
    const marks = () =>
      buttons(el.querySelector('[data-answer-words]')!, /^Source 2: /) as HTMLElement[]
    expect(marks().length).toBeGreaterThan(0)
    expect(marks().every((m) => !m.className.includes('bg-foreground'))).toBe(true)
    act(() => chip.focus())
    expect(marks().every((m) => m.className.includes('bg-foreground'))).toBe(true)
    // Only its own number's marks.
    const first = buttons(el.querySelector('[data-answer-words]')!, /^Source 1: /) as HTMLElement[]
    expect(first.every((m) => !m.className.includes('bg-foreground'))).toBe(true)
    act(() => chip.blur())
    expect(marks().every((m) => !m.className.includes('bg-foreground'))).toBe(true)
  })

  it('Sources: an item due, out of date or archived is never a chip; it stays under them, one line each', () => {
    const base = usedTurn(5)
    const el = render({
      ...base,
      items: base.items.map((i, k) =>
        k === 1
          ? { ...i, status: 'due' as const }
          : k === 2
            ? { ...i, outOfDate: 'its check date has passed' }
            : k === 4
              ? { ...i, status: 'archived' as const }
              : i,
      ),
    })
    const sources = el.querySelector('[data-sources]')!
    const pinned = [...sources.querySelectorAll('[data-pinned] > li')]
    expect(pinned.map((li) => buttons(li, /^Source \d+: /)[0]?.getAttribute('aria-label'))).toEqual(
      [
        expect.stringMatching(/^Source 2: /),
        expect.stringMatching(/^Source 3: /),
        expect.stringMatching(/^Source 5: /),
      ],
    )
    expect(pinned.map(text)).toEqual([
      expect.stringContaining('Due for a check'),
      expect.stringContaining(answerLines.stale.long),
      expect.stringContaining('Archived'),
    ])
    // The live ones are the chips: sources 1 and 4.
    const chips = [...sources.querySelectorAll('ul[aria-label="Sources"] > li')]
    expect(chips.map((li) => nameOf(buttons(li, /^Source \d+: /)[0]!))).toEqual([
      expect.stringMatching(/^Source 1: /),
      expect.stringMatching(/^Source 4: /),
    ])
  })

  it('Sources: each pinned item due for a check has its own Mark it still true, naming its title', () => {
    const base = usedTurn(4, { look: 2 })
    const turn = {
      ...base,
      items: base.items.map((i, k) =>
        k === 2 ? { ...i, status: 'due' as const, outOfDate: null } : i,
      ),
    }
    const el = render(turn)
    const pinned = [...el.querySelectorAll('[data-sources] [data-pinned] > li')]
    expect(pinned).toHaveLength(2)
    const marks = pinned.map((li) => buttons(li, /^Mark it still true/))
    expect(marks.map((b) => b.map((m) => m.getAttribute('aria-label')))).toEqual([
      [`Mark it still true: ${turn.items[1]!.title}`],
      [`Mark it still true: ${turn.items[2]!.title}`],
    ])
    // None is left that does not say which item it marks.
    expect(buttons(el, /^Mark it still true$/)).toHaveLength(0)
    world.writes.length = 0
    act(() => (marks[1]![0] as HTMLElement).click())
    expect(world.writes.map((w) => [w.op, (w.input as { id: string }).id])).toEqual([
      ['editItem', turn.items[2]!.id],
    ])
  })

  it('Sources: an answer whose items are all live pins none', () => {
    const el = render(usedTurn(4))
    expect(el.querySelectorAll('[data-sources] [data-pinned]')).toHaveLength(0)
  })

  it("A list: the count bold with what it is out of, then the read's items as rows", () => {
    const el = render(example('loop-list'))
    const bold = [...el.querySelectorAll('.font-semibold.tabular-nums')].map(text)
    expect(bold.length).toBeGreaterThanOrEqual(2)
    expect(el.querySelectorAll('li').length).toBe(
      example('loop-list').body.find((b) => b.t === 'list')?.t === 'list'
        ? (example('loop-list').body.find((b) => b.t === 'list') as { rows: string[] }).rows.length
        : 0,
    )
    expect(text(el)).toContain('From Footnote')
  })

  it("A long answer: the model's short list as a list, each line with its citation", () => {
    const el = render(example('loop-long'))
    const lines = [...el.querySelectorAll('ul.list-disc > li')]
    expect(lines.length).toBeGreaterThanOrEqual(2)
    for (const line of lines) expect(buttons(line, /^Source \d+: /).length).toBe(1)
  })

  it("From the help, in Markdown: bold labels, links, a numbered list and a table, never the model's asterisks", () => {
    const el = render(example('loop-help-markdown'), 'lets create my first context')
    const words = el.querySelector('[data-answer-words]')!
    expect(text(words)).not.toMatch(/\*\*|~~|\||`/)
    expect([...words.querySelectorAll('li > strong')].map(text)).toEqual([
      'Properties:',
      'Applies to:',
      'Source:',
    ])
    expect(text(words.querySelector('em')!)).toBe('know')
    expect(text(words.querySelector('code')!)).toBe('Definitions')
    expect(text(words.querySelector('s')!)).toBe('about')
    // A help page opens at its part, in a new tab; an address no read gave is words.
    const links = [...words.querySelectorAll('a')]
    expect(links.map((a) => [text(a), a.getAttribute('href')])).toEqual([
      ['Write context', '/docs/write-context#what-to-put-in-it'],
    ])
    expect(text(words)).toContain('such as the customs notice.')
    for (const a of links) {
      expect(a.target).toBe('_blank')
      expect(a.rel).toBe('noreferrer')
      expect(nameOf(a)).toMatch(/ \(opens in a new tab\)$/)
    }
    const steps = words.querySelector('ol')!
    expect(steps.getAttribute('start')).toBe('1')
    expect([...steps.querySelectorAll('li')].map(text)).toEqual([
      'Give it a title that is one plain sentence.',
      'Say what it is about not, if people mix it up.',
      'Publish it.',
    ])
    const table = words.querySelector('table')!
    expect([...table.querySelectorAll('th')].map(text)).toEqual(['Kind', 'When to pick it'])
    const rows = [...table.querySelectorAll('tbody tr')]
    expect(rows.map((tr) => [...tr.querySelectorAll('td')].map(text))).toEqual([
      ['Event', 'Something happened on a date'],
      ['Rule', 'A fixed way to read the numbers'],
    ])
    expect(text(table.querySelector('td strong')!)).toBe('Event')
  })

  it('From the help, how to do something: the screen it explains as an outline button, between the words and the help', () => {
    const el = render(example('loop-help-write'), 'How do I create my first context item?')
    const row = el.querySelector('[data-actions]')!
    const [write] = buttons(row, /^Write context$/)
    expect(write?.getAttribute('href')).toBe('/context/new')
    expect(write?.getAttribute('data-variant') ?? write?.className).toMatch(/outline/)
    // Under the words, above From the help.
    const help = [...el.querySelectorAll('p, span')].find((n) => n.textContent === 'From the help')!
    expect(row.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(text(el)).not.toMatch(/do:/)
  })

  describe('a quick action, by who reads it', () => {
    const asMe = (me: typeof world.me, run: () => void) => {
      const admin = world.me
      world.me = me
      try {
        run()
      } finally {
        world.me = admin
      }
    }
    const member = { name: 'Ines Duarte', role: 'Suggests context', owns: [], admin: false }
    const owner = { name: 'Jon Abara', role: 'Owner of Sales', owns: ['area_sales'], admin: false }
    const family: LoopTurn = {
      ...example('loop-help-write'),
      text: 'An owner of Sales, or an admin, picks the usual variant in its quick view.',
      actions: [
        {
          id: 'pick_usual_variant',
          family: {
            name: 'Revenue',
            domain: 'domain:area_sales',
            owners: ['Jon Abara', 'Sofia Brandt'],
          },
        },
      ],
      nouns: [{ id: 'domain:area_sales', name: 'Sales', of: null, type: null }],
    }

    it('to a member, Write context all the same: what they write goes to the owners as a suggestion', () =>
      asMe(member, () => {
        const row = render(example('loop-help-write')).querySelector('[data-actions]')!
        expect(buttons(row, /^Write context$/)).toHaveLength(1)
      }))

    it("to an owner of the metric's domain, Write context in that domain; to an owner of another, none", () => {
      const unwritten = () => example('loop-definition-unwritten')
      const ownerOf = (owns: string[]) => ({
        name: 'Noor Other',
        role: 'Owner',
        owns,
        admin: false,
      })
      asMe(ownerOf(['area_customer_value']), () => {
        const [write] = buttons(render(unwritten()), /^Write context about Churn rate$/)
        expect(write?.getAttribute('href')).toBe(
          '/context/new?metric=Churn+rate&domain=area_customer_value',
        )
      })
      act(() => root?.unmount())
      host?.remove()
      asMe(ownerOf(['area_sales']), () => {
        expect(buttons(render(unwritten()), /^Write context/)).toHaveLength(0)
      })
    })

    it('to an admin, Invite people opens People', () => {
      const row = render(example('loop-help-invite')).querySelector('[data-actions]')!
      expect(buttons(row, /^Invite people$/)[0]?.getAttribute('href')).toBe('/settings/people')
    })

    it("to an owner who is no admin, Invite people opens their own domain's page", () =>
      asMe(owner, () => {
        const row = render(example('loop-help-invite')).querySelector('[data-actions]')!
        expect(buttons(row, /^Invite people$/)[0]?.getAttribute('href')).toBe(
          '/settings/domains/area_sales',
        )
      }))

    it('to a member, no button: who invites, by name, as their chips', () =>
      asMe(member, () => {
        const row = render(example('loop-help-invite')).querySelector('[data-actions]')!
        expect(buttons(row, /^Invite people$/)).toHaveLength(0)
        expect(text(row)).toBe('Invite people is for admins: Ravi Kapoor')
        expect(row.querySelectorAll('[role="button"]')).toHaveLength(1)
      }))

    it("a family's: to its domain's owner, a button to its quick view; to anyone else, its owners", () => {
      asMe(owner, () => {
        const row = render(family).querySelector('[data-actions]')!
        expect(buttons(row, /^Pick the usual variant$/)[0]?.getAttribute('href')).toBe(
          '/definitions?dock=def.Revenue',
        )
      })
      asMe(member, () => {
        const row = render(family).querySelector('[data-actions]')!
        expect(buttons(row, /^Pick the usual variant$/)).toHaveLength(0)
        expect(text(row)).toBe('The owners of Sales do this: Jon Abara and Sofia Brandt')
      })
    })

    it('Connect an agent opens the Connect dialog, which is no address', () => {
      const el = render({ ...example('loop-help-write'), actions: [{ id: 'connect_agent' }] })
      const [connect] = buttons(el.querySelector('[data-actions]')!, /^Connect an agent$/)
      expect(connect?.tagName).toBe('BUTTON')
      expect(connect?.getAttribute('href')).toBeNull()
    })
  })

  it('Markdown links: only to a web or mail address or a help page that exists; any other is words', () => {
    const turn: LoopTurn = {
      ...example('loop-help-markdown'),
      body: [
        {
          t: 'p',
          runs: [
            { t: 'text', text: 'Not ' },
            { t: 'text', text: 'a script', link: { url: 'javascript:alert(1)' } },
            { t: 'text', text: ', nor ' },
            { t: 'text', text: 'a page', link: { slug: 'no-such-page', id: '' } },
            { t: 'text', text: ', but ' },
            { t: 'text', text: 'mail', link: { url: 'mailto:ada@example.com' } },
            { t: 'text', text: '.' },
          ],
        },
      ],
    }
    const words = render(turn).querySelector('[data-answer-words]')!
    expect(text(words)).toBe('Not a script, nor a page, but mail.')
    expect([...words.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      'mailto:ada@example.com',
    ])
  })

  it('A long paragraph: one sentence a line, five at most, then Show more; no "Nothing is written" once items were found', () => {
    const base = example('loop-checked')
    const turn: LoopTurn = {
      ...base,
      state: 'partial',
      subject: { ...base.subject!, uncovered: ['metric:orders'] },
      body: [
        {
          t: 'p',
          runs: Array.from({ length: 8 }, (_, i) => [
            { t: 'text' as const, text: `Sentence ${i + 1} of the answer` },
            { t: 'cite' as const, n: 1 },
            { t: 'text' as const, text: '. ' },
          ]).flat(),
        },
      ],
    }
    const el = render(turn)
    const lines = () => [...el.querySelectorAll('[data-answer-words] p')]
    expect(lines()).toHaveLength(5)
    expect(text(el)).not.toContain('Nothing is written about')
    const more = [...el.querySelectorAll('button')].find((b) => text(b) === 'Show 3 more')
    expect(more).toBeDefined()
    act(() => more!.click())
    expect(lines()).toHaveLength(8)
    expect(text(el)).not.toMatch(/Show \d+ more/)
  })

  it('Partial, citing nothing: the gap card only of a name no item is about, never over items about it (F3)', () => {
    const base = example('loop-checked')
    const partial = (unwritten: string[]): LoopTurn => ({
      ...base,
      state: 'partial',
      sources: [],
      subject: { ...base.subject!, uncovered: ['metric:net_revenue', ...unwritten], unwritten },
      body: [{ t: 'p', runs: [{ t: 'text', text: 'Net revenue is one figure, in euros.' }] }],
      text: 'Net revenue is one figure, in euros.',
    })
    expect(render(partial([])).querySelector('[data-gap]')).toBeNull()
    act(() => root?.unmount())
    host?.remove()
    // What nothing is written about is the gap card's: Orders, not Net revenue, which items cover.
    const gap = render(partial(['metric:orders'])).querySelector('[data-gap]')
    expect(gap?.getAttribute('aria-label')).toBe('Not written yet: Orders')
  })

  it('The figure: an answer reads the data of its subject, after the evidence; a question back and an overview do not', () => {
    const answer = render(example('loop-checked'))
    expect(answer.querySelector('[data-figure]')).not.toBeNull()
    for (const id of ['loop-question', 'loop-overview'] as const) {
      act(() => root?.unmount())
      host?.remove()
      expect(render(example(id)).querySelector('[data-figure]'), id).toBeNull()
    }
  })

  it('A list asked for: every line of it up to twelve, unfolded, after five sentences of prose at most', () => {
    const base = example('loop-checked')
    const line = (i: number) => [{ t: 'text' as const, text: `Metric ${i + 1}` }]
    const listed = (n: number): LoopTurn => ({
      ...base,
      body: [
        { t: 'p', runs: [{ t: 'text', text: `The domain has ${n} metrics:` }] },
        { t: 'ul', items: Array.from({ length: n }, (_, i) => line(i)) },
      ],
    })
    const all = render(listed(10), 'List the metrics in the Sales domain')
    expect(all.querySelectorAll('[data-answer-words] li')).toHaveLength(10)
    expect(text(all)).not.toMatch(/Show \d+ more/)
    act(() => root?.unmount())
    host?.remove()
    const long = render(listed(14), 'List the metrics in the Sales domain')
    expect(long.querySelectorAll('[data-answer-words] li')).toHaveLength(12)
    expect([...long.querySelectorAll('button')].some((b) => text(b) === 'Show 2 more')).toBe(true)
  })

  it('Definition: the label in place of a state, for an answer that uses no item', () => {
    const el = render(
      {
        ...example('loop-checked'),
        state: null,
        sources: [],
        defined: { names: ['Orders'], tool: 'Cube', cards: [] },
      },
      'What is orders?',
    )
    expect(text(el)).toMatch(/^Definition/)
    expect(text(el)).not.toMatch(/Checked|Partial|Not found/)
  })

  const card = {
    id: 'metric:orders',
    name: 'Orders',
    kind: 'metric' as const,
    words: 'The value of orders customers completed and paid for, in euros.',
    tool: 'Cube',
    member: 'sales.orders',
    group: 'Revenue',
    domain: { id: 'domain:area_sales', name: 'Sales' },
    owners: ['Jon Abara', 'Sofia Brandt'],
    context: { count: 3, items: [] as string[] },
    inWords: true,
  }
  const defining = (
    over: Partial<DefinitionCard>,
    words = 'Orders is the value of paid orders.',
  ) => {
    const base = example('loop-checked')
    return {
      ...base,
      state: null,
      sources: [],
      text: words,
      body: [{ t: 'p' as const, runs: [{ t: 'text' as const, text: words }] }],
      defined: { names: ['Orders'], tool: 'Cube', cards: [{ ...card, ...over }] },
    }
  }

  it('Definition card: the source words, where they come from, its domain and owners, and its context', () => {
    const base = example('loop-checked')
    const listed = base.items.map((i) => i.id)
    const el = render(defining({ context: { count: 5, items: listed } }), 'What is orders?')
    const shown = el.querySelector('[data-definition-card]')!
    expect(shown).not.toBeNull()
    // The words give the definition: the card stands in for them, as the answer.
    expect(text(el)).not.toContain('Orders is the value of paid orders.')
    expect(el.querySelector('[data-answer-words] [data-definition-card]')).not.toBeNull()
    expect(text(shown)).toContain('Metric in the Revenue group')
    expect(text(shown)).toContain(card.words)
    expect(text(shown)).toContain('From Cube, as sales.orders')
    expect(text(shown)).toMatch(/Owned by Jon Abara and Sofia Brandt, in Sales/)
    expect(buttons(shown, /^Open the definition$/)).toHaveLength(1)
    // Its context opens in the card: the rows a read of it returned, and how many more it found.
    const see = buttons(shown, /^See the 5 context items$/)[0] as HTMLElement
    expect(see.getAttribute('aria-expanded')).toBe('false')
    act(() => see.click())
    expect(shown.querySelectorAll('li')).toHaveLength(listed.length)
    expect(text(shown)).toContain(`${5 - listed.length} more were found than listed.`)
  })

  it('Definition card: under the words when they say more than the definition, with no rows to open', () => {
    const el = render(
      defining(
        { inWords: false },
        'Orders counts paid orders, and Net revenue starts from them after returns.',
      ),
      'How do orders differ from net revenue?',
    )
    expect(text(el)).toContain('Orders counts paid orders')
    const shown = el.querySelector('[data-definition-card]')!
    expect(el.querySelector('[data-answer-words] [data-definition-card]')).toBeNull()
    expect(text(shown)).toContain('3 context items about it')
    expect(buttons(shown, /^See the/)).toHaveLength(0)
  })

  it('Definition card: found by the words of its description, not a name, it says which', () => {
    const words =
      '**Orders-CPA** is marketing spend divided by first-time buyers. Distinct from **Returns-CPA**.'
    const el = render(
      defining(
        {
          id: 'metric:cost_per_acquisition',
          name: 'Cost per acquisition',
          words,
          mentions: 'Orders-CPA',
          inWords: false,
        },
        'Orders-CPA divides marketing spend by first-time buyers, and Returns-CPA by those who kept their first order.',
      ),
      'What is the difference between Orders-CPA and Returns-CPA?',
    )
    const shown = el.querySelector('[data-definition-card]')!
    expect(text(shown)).toContain('Its description mentions “Orders-CPA”')
    // A card a name found says nothing of the kind.
    expect(text(render(defining({}), 'What is orders?'))).not.toContain('Its description mentions')
  })

  it('Definition card: the source’s Markdown drawn, its marks never shown as characters', () => {
    const words =
      '**Cost-CPA** is outbound cost per acquired customer (`cost_eur / affiliate_ndcs`), _from totals_. See [the notes](https://wiki.example/cpa) or [this](javascript:alert(1)).'
    const el = render(defining({ words }), 'What is orders?')
    const quote = el.querySelector('[data-definition-card] blockquote')!
    expect(text(quote)).toBe(
      'Cost-CPA is outbound cost per acquired customer (cost_eur / affiliate_ndcs), from totals. See the notes or this.',
    )
    expect(quote.querySelector('strong')?.textContent).toBe('Cost-CPA')
    expect(quote.querySelector('code')?.textContent).toBe('cost_eur / affiliate_ndcs')
    expect(quote.querySelector('em')?.textContent).toBe('from totals')
    // Only a web or mail address is a link; any other stays words.
    expect([...quote.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      'https://wiki.example/cpa',
    ])
  })

  // A family of metrics (invented: Partner fees), as the definitions read gives it to the page.
  const fees = {
    by: ['Currency'],
    variants: 2,
    meaning: 'Fees partners report on referred users in each currency.',
    own: [
      {
        values: ['USD'],
        words: 'Fees partners report on referred users in USD (EUR × row fx_usd).',
      },
    ],
    more: 0,
  }
  const agentWords =
    'Fees partners report on referred users in each currency. A family of 2 near-identical metrics, one for each currency. An item about it applies to every one of them.'

  it('Definition card of a family: called a family by what tells its variants apart, its meaning, then its variants’ own words (R7)', () => {
    const el = render(
      defining(
        { name: 'Partner fees', words: agentWords, family: fees, group: null, member: null },
        'Partner fees are what partners report.',
      ),
      'What is partner fees?',
    )
    const shown = el.querySelector('[data-definition-card]')!
    expect(text(shown)).toContain('Family of 2 metrics, by Currency')
    expect(text(shown)).not.toContain('Metric')
    // The meaning, then a list of the variants' own words, each after its values: never the
    // agent's text in one paragraph.
    const quote = shown.querySelector('blockquote')!
    expect(text(quote.querySelector('p')!)).toBe(fees.meaning)
    expect([...quote.querySelectorAll('li')].map((li) => text(li))).toEqual([
      'USD: Fees partners report on referred users in USD (EUR × row fx_usd).',
    ])
    expect(text(shown)).not.toContain('near-identical')
    // A family with no meaning: its variants say what it is, every one's words at full size.
    const none = render(
      defining(
        { name: 'Partner fees', words: agentWords, family: { ...fees, meaning: null } },
        'Partner fees are what partners report.',
      ),
      'What is partner fees?',
    )
    const said = none.querySelector('[data-definition-card] blockquote')!
    expect(text(said)).toMatch(/^Its 2 variants say what it is in their own words:USD: /)
    expect(said.querySelector('ul')?.className).not.toMatch(/text-sm/)
    expect(text(none)).not.toContain('No meaning yet')
  })

  it('Definition card of a family with no meaning: never stands in for the answer’s sentence (C1)', () => {
    // The sentence repeats a variant's words, which made the card stand in for it (S1).
    const words = 'Partner fees are what partners report, in USD (EUR × row fx_usd).'
    const el = render(
      defining(
        { name: 'Partner fees', family: { ...fees, meaning: null, source: { kind: 'none' } } },
        words,
      ),
      'What is partner fees?',
    )
    expect(text(el)).toContain(words)
    expect(el.querySelector('[data-answer-words] [data-definition-card]')).toBeNull()
    // With a meaning it still stands in.
    const meant = render(
      defining({ name: 'Partner fees', family: fees }, words),
      'What is partner fees?',
    )
    expect(text(meant)).not.toContain(words)
  })

  it('Definition card of a family with no meaning: Write what it means, to its owners and the admins only', () => {
    const none = (meaning: string | null) =>
      defining({ name: 'Partner fees', family: { ...fees, meaning, source: { kind: 'none' } } })
    const write = buttons(render(none(null)), /^Write what it means$/)
    expect(write).toHaveLength(1)
    act(() => (write[0] as HTMLElement).click())
    expect(vi.mocked(openDock)).toHaveBeenLastCalledWith('def', 'Partner fees', {
      meaning: 'write',
    })
    act(() => root?.unmount())
    host?.remove()
    expect(buttons(render(none(fees.meaning)), /^Write what it means$/)).toHaveLength(0)
    act(() => root?.unmount())
    host?.remove()
    const admin = world.me
    world.me = { name: 'Ines Duarte', role: 'Suggests context', owns: [], admin: false }
    try {
      expect(buttons(render(none(null)), /^Write what it means$/)).toHaveLength(0)
    } finally {
      world.me = admin
    }
  })

  it('Definition card of a family: From names where its meaning comes from (C1, C4)', () => {
    const from = (
      source: NonNullable<DefinitionCard['family']>['source'],
      meaning: string | null = fees.meaning,
    ) => {
      const el = render(
        defining({ name: 'Partner fees', member: null, family: { ...fees, meaning, source } }),
        'What is partner fees?',
      )
      const line = el.querySelector('[data-definition-card] blockquote + div p')!
      const said = text(line)
      act(() => root?.unmount())
      host?.remove()
      return said
    }
    expect(from({ kind: 'base', values: ['EUR'], converted: [['USD']] })).toBe(
      'From Cube: the words of EUR, the variant USD is converted from',
    )
    expect(from({ kind: 'base', values: ['EUR'], converted: [['USD'], ['GBP']] })).toBe(
      'From Cube: the words of EUR, the variant the others are converted from',
    )
    expect(from({ kind: 'common', agree: 2 })).toBe('From Cube: the words its 2 variants share')
    expect(from({ kind: 'declared' })).toBe('Written for the family in Cube')
    expect(from({ kind: 'written', by: 'Sofia Brandt', on: '2026-10-20' })).toBe(
      'Written for the family by Sofia Brandt on 20 Oct 2026',
    )
    expect(from({ kind: 'none' }, null)).toBe('From Cube')
    // A turn written before the card knew says only the tool.
    expect(from(undefined)).toBe('From Cube')
  })

  it('Quoted definition of a family: its meaning and variants’ words, the word the question turns on marked in them (R6)', () => {
    const base = example('loop-checked')
    const el = render(
      {
        ...base,
        definitions: [
          {
            name: 'Partner fees',
            words: agentWords,
            family: fees,
            tool: 'Cube',
            mark: 'USD',
          },
        ],
      },
      'Why is partner fees in USD different from EUR?',
    )
    const figure = el.querySelector('figure')!
    expect(text(figure)).toContain('What the definition says about USD, in its own words')
    expect(figure.querySelector('mark')?.closest('li')).not.toBeNull()
    expect(text(figure.querySelector('blockquote')!)).not.toContain('near-identical')
  })

  it('A reply to the chat that read nothing and cites nothing: its words and the actions only', () => {
    const turn: LoopTurn = {
      ...example('loop-checked'),
      text: 'You are welcome.',
      body: [{ t: 'p', runs: [{ t: 'text', text: 'You are welcome.' }] }],
      state: null,
      sources: [],
      subject: null,
      definitions: [],
      read: [],
      footer: { denominator: null, notSeen: null, stale: null },
      reads: [],
      items: [],
      owners: [],
    }
    const el = render(turn, 'thanks!')
    expect(text(el)).toMatch(/^You are welcome\./)
    expect(text(el)).not.toMatch(/What Ask read|Definition|Used|records/)
  })

  it('A decline: its two sentences, then the questions to press, with no state and nothing read', () => {
    const said = [
      "Ask does not answer questions about one person's work.",
      'It can tell you who owns a domain or a metric, who last checked a context item and when, and what changed this week.',
    ]
    const turn: LoopTurn = {
      ...example('loop-checked'),
      text: said.join(' '),
      body: said.map((t) => ({ t: 'p' as const, runs: [{ t: 'text' as const, text: t }] })),
      state: null,
      sources: [],
      subject: null,
      definitions: [],
      read: [],
      footer: { denominator: null, notSeen: null, stale: null },
      reads: [],
      items: [],
      owners: [],
      choices: ['What changed this week?', 'List the conflicts'],
    }
    const el = render(turn, 'what did Tomas write this week?')
    expect(text(el)).toMatch(
      /^Ask does not answer questions about one person's work\.It can tell you who owns a domain or a metric, who last checked a context item and when, and what changed this week\.What changed this week\?List the conflicts/,
    )
    expect(text(el)).not.toMatch(/Checked|Not found|Partial|What Ask read|Used/)
  })

  it('A question back: the question and its readings as choices, with no state', () => {
    const el = render(example('loop-question'))
    expect(text(el)).toContain('Which switch do you mean?')
    expect(text(el)).not.toMatch(/Checked|Not found|Partial/)
  })

  it('An overview: the total of its groups, each group a heading with its count, long ones folded', () => {
    const turn = example('loop-overview')
    const el = render(turn, 'what do i need to handle?')
    const o = turn.overview!
    expect(text(el)).toContain(`${o.total} cards wait on you in your Inbox`)
    const headings = [...el.querySelectorAll('h3')]
    expect(headings.map((h) => h.textContent)).toEqual(o.groups.map((g) => `${g.name}${g.count}`))
    const long = o.groups.find((g) => g.rows.length > 4)!
    const all = [...el.querySelectorAll('button')].find((b) => text(b) === `Show all ${long.count}`)
    expect(all).toBeDefined()
    act(() => all!.click())
    const section = [...el.querySelectorAll('section')].find(
      (s) => s.getAttribute('aria-label') === long.name,
    )!
    expect(section.querySelectorAll('li').length).toBe(long.rows.length)
    // A group a page shows filtered links there.
    expect(
      [...el.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/context?due=1'),
    ).toBe(true)
  })

  it("An overview: each row's citation after its title, one numbering in reading order", () => {
    const turn = example('loop-overview')
    const el = render(turn, 'what do i need to handle?')
    for (const b of buttons(el, /^Show all /)) act(() => (b as HTMLElement).click())
    const cited = [...el.querySelectorAll('section li')].flatMap((li) => {
      const row = li.querySelector('a, button, span.font-medium')!
      // A card's row cites its item after the link; an item's own title carries its number.
      const mark = buttons(li, /^Source \d+: /)[0]
      const own = /, source (\d+)$/.exec(row.textContent ?? '')
      if (!mark && !own) return []
      const title = own ? text(row).slice(0, -own[1]!.length).trim() : text(row)
      if (mark) {
        const [, n, named] = /^Source (\d+): (.*)$/.exec(mark.getAttribute('aria-label')!)!
        expect(row.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(named).toBe(title)
        return [{ n: Number(n), title }]
      }
      // The number is the title's last words.
      expect(row.textContent).toMatch(
        new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      )
      return [{ n: Number(own![1]), title }]
    })
    expect(cited.length).toBeGreaterThan(3)
    // Numbers first come in reading order, 1, 2, 3 …; an item met again keeps its number.
    const first = [...new Set(cited.map((c) => c.n))]
    expect(first).toEqual(first.map((_, i) => i + 1))
    for (const c of cited) expect(cited.find((x) => x.n === c.n)!.title).toBe(c.title)
    expect(cited.length).toBeGreaterThan(first.length)
  })

  it("An overview code drew in the model's place: the model's lead line first, then the total", () => {
    const turn = example('loop-overview')
    const lead: LoopTurn['body'] = [
      {
        t: 'p',
        runs: [
          { t: 'text', text: 'Your Inbox holds ' },
          { t: 'count', value: '20', of: null },
          { t: 'text', text: ' cards.' },
        ],
      },
    ]
    const el = render({ ...turn, body: lead }, 'what do i need to handle?')
    const words = text(el.querySelector('[data-answer-words]')!)
    expect(words.startsWith('Your Inbox holds 20 cards.')).toBe(true)
    expect(words.indexOf('cards wait on you in your Inbox')).toBeGreaterThan(0)
    expect(el.querySelectorAll('[data-answer-words]')).toHaveLength(1)
  })

  it('An overview of the records: by status, what needs a check first', () => {
    const el = render(example('loop-overview-domain'))
    expect(el.querySelector('h3')?.textContent).toMatch(/^due for a check/)
  })
})

describe('while the loop reads', () => {
  it('shows each read as a step, the done ones with what they found and their chips, the current one moving', () => {
    motion(true)
    const { askedTurn } = turnModule
    const turn = {
      ...askedTurn('t1', 'Tickets closed by billing?'),
      reads: {
        steps: [
          {
            runs: [
              { t: 'text' as const, text: 'Looked up what applies to ' },
              { t: 'noun' as const, id: 'value:team/billing' },
              { t: 'text' as const, text: ': ' },
              { t: 'count' as const, value: '2', of: null },
              { t: 'text' as const, text: ' apply' },
            ],
            done: true,
          },
          { runs: [{ t: 'text' as const, text: 'Reading a context item…' }], done: false },
        ],
        nouns: [
          {
            id: 'value:team/billing',
            name: 'Billing',
            of: { id: 'dimension:team', name: 'Team' },
            type: null,
          },
        ],
      },
    }
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root!.render(React.createElement(LoopAnswerBody, { parts, turn })))
    const steps = [...host.querySelectorAll('ol > li')].map(text)
    expect(steps).toEqual(['Looked up what applies to Billing: 2 apply', 'Reading a context item…'])
    expect(buttons(host, /^Billing, value$/)).toHaveLength(1)
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull()
  })
})

/** Whether the person asked for less motion, as the page reads it. */
const motion = (reduce: boolean) => {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('reduce'),
  })) as unknown as typeof window.matchMedia
}

describe('while the loop writes', () => {
  it('shows each sentence that passed the check, then the rest once the answer is in, the words staying put', () => {
    motion(true)
    const { askedTurn, turnReducer } = turnModule
    const whole = example('loop-checked')
    const first: LoopTurn = {
      ...whole,
      body: [{ t: 'p', runs: [{ t: 'text', text: 'The first sentence is final.' }] }],
      text: 'The first sentence is final.',
    }
    let turn = turnReducer(askedTurn('t1', 'Why is the last day short?'), {
      type: 'words',
      words: first,
    })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root!.render(React.createElement(LoopAnswerBody, { parts, turn })))
    expect(text(host.querySelector('[data-answer-words]')!)).toBe('The first sentence is final.')
    // Still being written: no actions and no evidence yet, and the reads' steps give way to it.
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(host.querySelector('ol')).toBeNull()
    expect(text(host)).not.toContain('Used')
    // Taken back, the reads show again.
    turn = turnReducer(turn, { type: 'words', words: null })
    act(() => root!.render(React.createElement(LoopAnswerBody, { parts, turn })))
    expect(host.querySelector('[data-answer-words]')).toBeNull()
    // The whole answer: its words drawn in the same place, and the evidence after them.
    turn = turnReducer(turn, { type: 'words', words: first })
    act(() => root!.render(React.createElement(LoopAnswerBody, { parts, turn })))
    const drawn = host.querySelector('[data-answer-words]')
    turn = turnReducer(turn, {
      type: 'done',
      answer: loopAnswerOf(whole, 'Why is the last day short?', names),
    })
    act(() => root!.render(React.createElement(LoopAnswerBody, { parts, turn })))
    expect(host.querySelector('[data-answer-words]')).toBe(drawn)
    expect(text(drawn!)).toContain('The payment files for Germany')
    expect(buttons(host, /^Good answer$/)).toHaveLength(1)
  })

  it('types the words in at reading pace, whatever size they arrive in, then shows the rest', () => {
    motion(false)
    const { askedTurn, turnReducer } = turnModule
    // Asked here, before the page's clock is held.
    const asked = askedTurn('t1', 'Why is the last day short?')
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    try {
      const whole = example('loop-checked')
      host = document.createElement('div')
      document.body.append(host)
      root = createRoot(host)
      // The whole answer in one piece.
      const turn = turnReducer(asked, {
        type: 'done',
        answer: loopAnswerOf(whole, 'Why is the last day short?', names),
      })
      act(() => root!.render(React.createElement(LoopAnswerBody, { parts, turn })))
      const words = () => text(host!.querySelector('[data-answer-words]')!)
      // None of it yet, and its state keeps its place out of sight.
      expect(words()).toBe('')
      expect(host.querySelector('.invisible')).not.toBeNull()
      expect(buttons(host, /^Good answer$/)).toHaveLength(0)
      act(() => {
        vi.advanceTimersByTime(300)
      })
      const part = words().length
      expect(part).toBeGreaterThan(0)
      act(() => {
        vi.advanceTimersByTime(2000)
      })
      // Every word, a whole word at a time, then the state and the rest.
      expect(words().length).toBeGreaterThan(part)
      expect(words()).toContain('The payment files for Germany')
      expect(host.querySelector('.invisible')).toBeNull()
      expect(buttons(host, /^Good answer$/)).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('types words the model marked in their marks from their first word, never showing a mark', () => {
    motion(false)
    const { askedTurn, turnReducer } = turnModule
    const asked = askedTurn('t1', 'lets create my first context')
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    try {
      host = document.createElement('div')
      document.body.append(host)
      root = createRoot(host)
      const turn = turnReducer(asked, {
        type: 'done',
        answer: loopAnswerOf(example('loop-help-markdown'), 'lets create my first context', names),
      })
      act(() => root!.render(React.createElement(LoopAnswerBody, { parts, turn })))
      const words = () => host!.querySelector('[data-answer-words]')!
      let bold = 0
      for (let ms = 0; ms < 8000; ms += 100) {
        act(() => {
          vi.advanceTimersByTime(100)
        })
        expect(text(words())).not.toMatch(/\*\*|~~|\|/)
        // A bold label is in bold from its first word on.
        for (const strong of words().querySelectorAll('strong'))
          expect(text(strong)).toMatch(
            /^(?:Write|Properties:|Applies|Applies to:|Source:|Event|Rule)$/,
          )
        bold = Math.max(bold, words().querySelectorAll('li > strong').length)
      }
      expect(bold).toBe(3)
      expect(words().querySelector('table')).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows a turn opened from the history at once', () => {
    motion(false)
    const whole = example('loop-checked')
    const turn = doneTurn(loopAnswerOf(whole, 'Why is the last day short?', names))
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root!.render(React.createElement(LoopAnswerBody, { parts, turn })))
    expect(text(host.querySelector('[data-answer-words]')!)).toContain(
      'The payment files for Germany',
    )
    expect(buttons(host, /^Good answer$/)).toHaveLength(1)
  })
})

describe('the nouns of an answer on any workspace', () => {
  const invented: LoopTurn = {
    ...example('loop-checked'),
    subject: {
      names: ['Tickets closed', 'Billing'],
      about: ['metric:tickets_closed', 'value:team/billing'],
      period: 'any date',
      note: null,
      assumedToday: false,
      carried: false,
      uncovered: [],
      unwritten: [],
    },
    sources: [],
    items: [],
    body: [
      {
        t: 'p',
        runs: [
          { t: 'noun', id: 'metric:tickets_closed' },
          { t: 'text', text: ' for ' },
          { t: 'noun', id: 'value:team/billing' },
          { t: 'text', text: ' and ' },
          { t: 'noun', id: 'value:sprint/s41' },
          { t: 'text', text: '; again ' },
          { t: 'noun', id: 'value:team/billing' },
          { t: 'text', text: '.' },
        ],
      },
    ],
    nouns: [
      { id: 'metric:tickets_closed', name: 'Tickets closed', of: null, type: null },
      {
        id: 'value:team/billing',
        name: 'Billing',
        of: { id: 'dimension:team', name: 'Team' },
        type: 'string',
      },
      {
        id: 'value:sprint/s41',
        name: 'Sprint 41',
        of: { id: 'dimension:sprint', name: 'Sprint' },
        type: 'time',
      },
      { id: 'dimension:team', name: 'Team', of: null, type: 'string' },
    ],
    closest: null,
    owners: [],
    conflict: [],
    state: 'grounded',
  }

  it("draws each value in its own dimension's hue and icon, a chip the first time only", () => {
    const el = render(invented, 'Tickets closed by billing?')
    const billing = buttons(el, /^Billing, value$/)
    expect(billing).toHaveLength(1)
    expect((billing[0] as HTMLElement).style.getPropertyValue('--chip-h')).toBe(
      String(dimensionHue('dimension:team')),
    )
    const sprint = buttons(el, /^Sprint 41, value$/)[0] as HTMLElement
    expect(sprint.style.getPropertyValue('--chip-h')).toBe(String(dimensionHue('dimension:sprint')))
    // A time dimension's value draws a calendar; any other a tag.
    expect(sprint.querySelector('svg')?.getAttribute('class')).toMatch(/calendar/)
    expect(billing[0]!.querySelector('svg')?.getAttribute('class')).toMatch(/tag/)
    expect(text(el)).toContain('; again Billing.')
    expect(text(el)).not.toMatch(/market/i)
    // A mark right after a chip reads as the name's own ("Sprint 41;"), with no gap before it.
    expect(sprint.className).toMatch(/\bpr-0\.5\b/)
    expect(billing[0]!.className).not.toMatch(/\bpr-0\.5\b/)
    // Drawn again, the first mention is still the chip.
    const answer = loopAnswerOf(invented, 'Tickets closed by billing?', names)
    act(() =>
      root!.render(
        React.createElement(LoopAnswerBody, { parts, turn: doneTurn(answer), latest: true }),
      ),
    )
    expect(buttons(el, /^Billing, value$/)).toHaveLength(1)
  })

  it('draws a domain with no hue of its own (the sandbox) with a neutral ring, never an empty dot', () => {
    const sandbox: LoopTurn = {
      ...invented,
      body: [
        {
          t: 'p',
          runs: [
            { t: 'text', text: 'It is in ' },
            { t: 'noun', id: 'domain:area_sandbox' },
            { t: 'text', text: '.' },
          ],
        },
      ],
      nouns: [
        ...invented.nouns,
        { id: 'domain:area_sandbox', name: 'Sandbox', of: null, type: null },
      ],
    }
    const chip = buttons(render(sandbox), /^Sandbox, domain$/)[0] as HTMLElement
    const dot = chip.querySelector('[aria-hidden]') as HTMLElement
    expect(dot.className).toMatch(/\bborder-muted-foreground\b/)
    expect(dot.className).not.toMatch(/\bbg-chip-dot\b/)
  })

  it("opens a value's card on a press, which says what it is a value of", () => {
    const el = render(invented, 'Tickets closed by billing?')
    act(() => (buttons(el, /^Billing, value$/)[0] as HTMLElement).click())
    expect(document.body.textContent).toContain('A value of Team')
  })
})

describe('the read line under a question', () => {
  /** The read line of a turn, asked at a period chosen, or none; with Change and the menu. */
  function line(turn: LoopTurn, period?: Answer['period']) {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const answer = {
      ...loopAnswerOf(turn, 'Orders in Norway?', names),
      ...(period ? { period } : {}),
    }
    act(() =>
      root!.render(
        React.createElement(LoopReadLine, {
          parts,
          answer,
          onRescope: () => {},
          onReperiod: () => {},
        }),
      ),
    )
    return host
  }
  const at = (period: string): LoopTurn => {
    const turn = example('loop-checked')
    return { ...turn, subject: { ...turn.subject!, period, note: null, assumedToday: false } }
  }

  it('names the period chosen with its days, and any date or days picked as their days', () => {
    expect(
      buttons(line(at('1-30 Sep 2026'), 'last month'), /^last month \(1-30 Sep 2026\)$/),
    ).toHaveLength(1)
    expect(buttons(line(at('any date'), 'any date'), /^any date$/)).toHaveLength(1)
    expect(
      buttons(
        line(at('5-11 Oct 2026'), { from: '2026-10-05', to: '2026-10-11' }),
        /^5-11 Oct 2026$/,
      ),
    ).toHaveLength(1)
    // Asked with no period chosen, the days the words were read at.
    expect(buttons(line(at('1-23 Oct 2026')), /^1-23 Oct 2026$/)).toHaveLength(1)
  })

  it('offers no period on the answer of what a metric means: dates do not change it', () => {
    const el = line(example('loop-definition'))
    expect(buttons(el, /^Net revenue, metric$/)).toHaveLength(1)
    expect(text(el)).not.toMatch(/date|assumed|Today/)
  })

  it('says the period a question was asked again at until its answer is in', () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root!.render(React.createElement(AskedAtLine, { period: 'last month' })))
    const said = () => [...host!.querySelectorAll('span')].map((s) => s.textContent)
    expect(said()).toEqual(['Asked again at', 'last month'])
    act(() =>
      root!.render(
        React.createElement(AskedAtLine, { period: { from: '2026-10-05', to: '2026-10-11' } }),
      ),
    )
    expect(said()).toEqual(['Asked again at', '5 Oct 2026 to 11 Oct 2026'])
  })
})
